/**
 * Intake Worker — BullMQ Document Processing Pipeline
 *
 * Processes intake jobs from the doc-intake queue. Two source types:
 *
 * **Gmail source:**
 * 1. Fetch message details (sender, subject, date)
 * 2. Get full message for attachment extraction
 * 3. Extract attachments from MIME parts
 * 4. Filter: skip unsupported types and oversized attachments
 * 5. Download each valid attachment
 * 6. Convert to PDF (images converted, PDFs pass through)
 * 7. Produce IntakeDocument objects (logged, not yet stored)
 *
 * **Finmo source:**
 * 1. Dedup check via Redis (skip already-processed doc requests)
 * 2. Download files from Finmo API (list detail, signed URL, download)
 * 3. Convert to PDF (images converted, PDFs pass through)
 * 4. Produce IntakeDocument objects
 * 5. Mark doc request as processed in Redis
 *
 * Design:
 * - processIntakeJob is exported for direct unit testing
 * - Worker uses lazy singleton pattern (same as webhook/worker.ts)
 * - Concurrency 1 (sequential processing)
 * - ConversionError per attachment is caught — does not fail the whole job
 * - Oversized attachments are skipped with a logged warning
 *
 * IMPORTANT: IntakeDocument.pdfBuffer is NOT stored in BullMQ job data.
 * Buffers can be 10+ MB — storing them in Redis is an anti-pattern.
 * The worker downloads and processes within the job handler scope.
 *
 * After producing each IntakeDocument, the worker writes the PDF buffer to a
 * temp file and enqueues a classification job to the doc-classification queue.
 * This avoids storing large buffers in Redis (BullMQ job data).
 *
 * Consumers: BullMQ scheduler (gmail-monitor.ts triggers polls)
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Worker, Job, Queue } from 'bullmq';
import { createRedisConnection } from '../webhook/queue.js';
import { intakeConfig, getConversionStrategy } from './config.js';
import { getGmailReadonlyClient, markMessageProcessed } from '../email/gmail-client.js';
import { getMessageDetails } from './gmail-reader.js';
import { extractAttachments, downloadAttachment } from './attachment-extractor.js';
import { convertToPdf, ConversionError } from './pdf-converter.js';
import { extractFromZip, isZipMimeType } from './zip-extractor.js';
import { downloadFinmoDocument, isDocRequestProcessed, markDocRequestProcessed } from './finmo-downloader.js';
import { isBccCopy, handleSentDetection } from './sent-detector.js';
import { extractForwardingNotes, findPlainTextBody } from './body-extractor.js';
import { getContactIdBySubject } from '../feedback/original-store.js';
import { pollForNewMessages, getInitialHistoryId } from './gmail-reader.js';
import { INTAKE_QUEUE_NAME, getIntakeQueue, getStoredHistoryId, storeHistoryId } from './gmail-monitor.js';
import { CLASSIFICATION_QUEUE_NAME } from '../classification/classification-worker.js';
import { getPendingChoice, deletePendingChoice, sendFollowUpConfirmation, buildFollowUpBody } from '../email/filing-confirmation.js';
import type { PendingChoice } from '../email/filing-confirmation.js';
import { extractReplyText, parseFilingReply } from './reply-parser.js';
import { moveFile, findOrCreateFolder } from '../classification/filer.js';
import { getDriveClient } from '../classification/drive-client.js';
import { upsertContact, getContact } from '../crm/contacts.js';
import { crmConfig } from '../crm/config.js';
import { classificationConfig } from '../classification/config.js';
import type { IntakeJobData, IntakeResult, IntakeDocument } from './types.js';
import type { ClassificationJobData } from '../classification/types.js';

// ---------------------------------------------------------------------------
// Classification Queue (Lazy Singleton)
// ---------------------------------------------------------------------------

let _classificationQueue: Queue<ClassificationJobData> | null = null;

function getClassificationQueue(): Queue<ClassificationJobData> {
  if (_classificationQueue) return _classificationQueue;
  _classificationQueue = new Queue(CLASSIFICATION_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  return _classificationQueue;
}

/**
 * Close the classification queue connection for graceful shutdown.
 * Resets the singleton so a new connection can be created if needed.
 */
export async function closeClassificationQueue(): Promise<void> {
  if (_classificationQueue) {
    await _classificationQueue.close();
    _classificationQueue = null;
  }
}

// ---------------------------------------------------------------------------
// processIntakeJob — Core Processing Logic
// ---------------------------------------------------------------------------

/**
 * Process a single intake job.
 *
 * Exported for testing (same pattern as processJob in webhook/worker.ts).
 *
 * @param job - BullMQ job containing source type and message/document IDs
 * @returns IntakeResult with count and IDs of processed documents
 */
export async function processIntakeJob(job: Job<IntakeJobData>): Promise<IntakeResult> {
  const { source } = job.data;

  if (source === 'finmo') {
    return processFinmoSource(job);
  }

  return processGmailSource(job);
}

// ---------------------------------------------------------------------------
// Gmail Source Processing
// ---------------------------------------------------------------------------

async function processGmailSource(job: Job<IntakeJobData>): Promise<IntakeResult> {
  const messageId = job.data.gmailMessageId;

  // If no messageId, this is a poll job — poll for new messages and enqueue them
  if (!messageId) {
    return processGmailPoll();
  }

  const gmailClient = getGmailReadonlyClient(intakeConfig.docsInbox);
  const errors: string[] = [];
  const documentIds: string[] = [];

  // 1. Get message metadata (sender, subject, date)
  const messageMeta = await getMessageDetails(gmailClient, messageId);

  // 1b. Only process emails from our domain (forwarded by Cat/Taylor)
  const senderDomain = messageMeta.from.split('@')[1]?.toLowerCase();
  if (senderDomain !== 'venturemortgages.com') {
    console.log('[intake] Skipping external sender', { messageId, from: messageMeta.from });
    return { documentsProcessed: 0, documentIds: [], errors: [] };
  }

  // 1c. Check if this is an outbound BCC copy (doc-request email sent by Cat)
  // Primary: X-Venture headers (works if Gmail preserves them)
  // Fallback: subject pattern + Redis lookup (Gmail strips headers, comments, data-* attrs)
  let detectedBcc = isBccCopy(messageMeta);
  if (!detectedBcc && messageMeta.subject.includes('Documents Needed')) {
    const contactId = await getContactIdBySubject(messageMeta.subject);
    if (contactId) {
      messageMeta.ventureType = 'doc-request';
      messageMeta.ventureContactId = contactId;
      detectedBcc = true;
      console.log('[intake] BCC detected via subject mapping', { messageId, contactId });
    }
  }
  if (detectedBcc) {
    console.log('[intake] Detected outbound doc-request email, updating CRM', { messageId });
    const sentResult = await handleSentDetection(messageMeta);
    if (sentResult.errors.length > 0) {
      console.error('[intake] Sent detection errors', { messageId, errors: sentResult.errors });
    }
    return {
      documentsProcessed: 0,
      documentIds: [],
      errors: sentResult.errors,
    };
  }

  // Phase 26: Check if this is a reply to a pending filing choice
  if (messageMeta.threadId) {
    const pendingChoice = await getPendingChoice(messageMeta.threadId);
    if (pendingChoice) {
      console.log('[intake] Reply to pending filing choice detected', {
        messageId,
        threadId: messageMeta.threadId,
      });
      return handleFilingReply(gmailClient, messageId, messageMeta, pendingChoice);
    }
  }

  // 2. Get full message for attachment extraction
  const fullMessage = await gmailClient.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  // 2b. Extract forwarding notes from email body (Phase 23, Phase 25: now async with AI)
  const forwardingNotes = await extractForwardingNotes(fullMessage.data.payload ?? undefined);
  if (forwardingNotes) {
    console.log('[intake] Forwarding notes detected:', {
      messageId,
      hasClientName: !!forwardingNotes.clientName,
      hasClientEmail: !!forwardingNotes.clientEmail,
      hasDocTypeHint: !!forwardingNotes.docTypeHint,
      clientCount: forwardingNotes.clients?.length ?? 0,
      docAssignments: forwardingNotes.docs?.length ?? 0,
    });
  }

  // 2c. Extract RFC 2822 Message-ID header (Phase 25 — for filing confirmation threading)
  const messageHeaders = fullMessage.data.payload?.headers ?? [];
  const rfc822MessageId = messageHeaders.find(h => h.name?.toLowerCase() === 'message-id')?.value ?? undefined;

  // 3. Extract attachments from MIME parts
  const parts = fullMessage.data.payload?.parts ?? [];
  const attachments = extractAttachments(parts);

  if (attachments.length === 0) {
    console.log(`[intake] Gmail message ${messageId}: no attachments found`);
    return { documentsProcessed: 0, documentIds: [], errors: [] };
  }

  // 4. Expand attachments: ZIP files are extracted into individual files
  interface FileToProcess {
    filename: string;
    mimeType: string;
    buffer: Buffer;
    sourceAttachment: string; // original attachment filename for logging
  }

  const filesToProcess: FileToProcess[] = [];

  for (const att of attachments) {
    // Skip oversized attachments
    if (att.size > intakeConfig.maxAttachmentBytes) {
      errors.push(
        `Attachment too large: ${att.filename} (${att.size} bytes > ${intakeConfig.maxAttachmentBytes} max)`,
      );
      continue;
    }

    // Download attachment data
    let buffer: Buffer;
    try {
      buffer = await downloadAttachment(gmailClient, messageId, att.attachmentId);
    } catch (err) {
      errors.push(`Failed to download ${att.filename}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    // ZIP: extract contents and add each file individually
    if (isZipMimeType(att.mimeType)) {
      try {
        const extracted = extractFromZip(buffer, att.filename);
        for (const file of extracted) {
          filesToProcess.push({
            filename: file.filename,
            mimeType: file.mimeType,
            buffer: file.buffer,
            sourceAttachment: att.filename,
          });
        }
      } catch (err) {
        errors.push(`Failed to extract ZIP ${att.filename}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    // Non-ZIP: add directly
    filesToProcess.push({
      filename: att.filename,
      mimeType: att.mimeType,
      buffer,
      sourceAttachment: att.filename,
    });
  }

  // 5. Process each file through conversion → classification
  const documents: IntakeDocument[] = [];

  for (let index = 0; index < filesToProcess.length; index++) {
    const file = filesToProcess[index];

    // Skip unsupported MIME types
    const strategy = getConversionStrategy(file.mimeType);
    if (strategy === 'unsupported') {
      errors.push(`Unsupported MIME type: ${file.mimeType} (${file.filename})`);
      continue;
    }

    try {
      // Convert to PDF
      const { pdfBuffer } = await convertToPdf(file.buffer, file.mimeType);

      // Create IntakeDocument
      const doc: IntakeDocument = {
        id: `gmail-${messageId}-${index}`,
        pdfBuffer,
        originalFilename: file.filename,
        originalMimeType: file.mimeType,
        source: 'gmail',
        senderEmail: messageMeta.from,
        applicationId: null,
        gmailMessageId: messageId,
        receivedAt: job.data.receivedAt,
      };

      documents.push(doc);
      documentIds.push(doc.id);

      // Write PDF to temp file (buffers must NOT go in Redis)
      const tempFilePath = join(tmpdir(), `intake-${randomUUID()}.pdf`);
      await writeFile(tempFilePath, pdfBuffer);

      // Enqueue for classification (Phase 7)
      // Include Gmail metadata for Phase 14 smart matching
      // Phase 25: Per-attachment client assignment from AI-parsed forwarding notes
      let perAttachClientName: string | undefined;
      let perAttachClientEmail: string | undefined;
      let perAttachDocTypeHint: string | undefined;

      if (forwardingNotes?.docs && forwardingNotes.docs.length > 0) {
        // Try to match this file to a doc assignment by type substring match
        const filenameLower = file.filename.toLowerCase();
        const matchedDoc = forwardingNotes.docs.find(d =>
          filenameLower.includes(d.type.toLowerCase()),
        );
        if (matchedDoc) {
          // Check if the matched client is an email
          const emailMatch = matchedDoc.client.match(/(\S+@\S+\.\S+)/);
          if (emailMatch) {
            perAttachClientEmail = emailMatch[1];
          } else {
            perAttachClientName = matchedDoc.client;
          }
          perAttachDocTypeHint = matchedDoc.type;
          console.log('[intake] Per-attachment client assignment:', {
            filename: file.filename,
            assignedClient: matchedDoc.client,
            docType: matchedDoc.type,
          });
        } else if (forwardingNotes.clients && forwardingNotes.clients.length === 1) {
          // Single client in AI result, no doc match — use that client for all
          const singleClient = forwardingNotes.clients[0];
          const emailMatch = singleClient.match(/(\S+@\S+\.\S+)/);
          if (emailMatch) {
            perAttachClientEmail = emailMatch[1];
          } else {
            perAttachClientName = singleClient;
          }
        }
        // Multiple clients and no doc-to-file mapping: leave undefined (matching agent handles it)
      } else {
        // No AI docs[] — fall back to legacy single-client fields
        perAttachClientName = forwardingNotes?.clientName;
        perAttachClientEmail = forwardingNotes?.clientEmail;
        perAttachDocTypeHint = forwardingNotes?.docTypeHint;
      }

      const classificationJob: ClassificationJobData = {
        intakeDocumentId: doc.id,
        tempFilePath,
        originalFilename: doc.originalFilename,
        senderEmail: doc.senderEmail,
        applicationId: doc.applicationId,
        source: doc.source,
        receivedAt: doc.receivedAt,
        threadId: messageMeta.threadId ?? undefined,
        emailSubject: messageMeta.subject,
        ccAddresses: messageMeta.cc,
        // Phase 23/25: Cat's forwarding notes (per-attachment in Phase 25)
        ...(perAttachClientName && { forwardingNoteClientName: perAttachClientName }),
        ...(perAttachClientEmail && { forwardingNoteClientEmail: perAttachClientEmail }),
        ...(perAttachDocTypeHint && { forwardingNoteDocTypeHint: perAttachDocTypeHint }),
        // Phase 25: Message-ID + batch tracking for filing confirmation
        gmailMessageId: messageId,
        ...(rfc822MessageId && { gmailMessageRfc822Id: rfc822MessageId }),
        totalAttachmentCount: filesToProcess.length,
      };

      await getClassificationQueue().add(
        'classify-doc',
        classificationJob,
        { jobId: `classify-${doc.id}` },
      );

      // Log document metadata (no PII — just file info)
      console.log(`[intake] Produced IntakeDocument:`, {
        id: doc.id,
        source: doc.source,
        originalFilename: doc.originalFilename,
        originalMimeType: doc.originalMimeType,
        senderEmail: doc.senderEmail,
        fromZip: file.sourceAttachment !== file.filename ? file.sourceAttachment : undefined,
      });
    } catch (err) {
      if (err instanceof ConversionError) {
        errors.push(`${err.code}: ${file.filename} — ${err.message}`);
      } else {
        errors.push(`Failed to process ${file.filename}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(
    `[intake] Processed gmail message ${messageId}: ${documents.length} docs, ${errors.length} errors`,
  );

  // Move message from Inbox to "Processed" label (non-fatal)
  if (documents.length > 0) {
    await markMessageProcessed(intakeConfig.docsInbox, messageId);
  }

  return {
    documentsProcessed: documents.length,
    documentIds,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Filing Reply Handler (Phase 26)
// ---------------------------------------------------------------------------

/**
 * Handles a reply to a pending filing choice question email.
 *
 * 1. Fetch the full message to extract reply text
 * 2. Strip quoted content
 * 3. Parse reply with AI (Gemini)
 * 4. Execute the filing action (select/create_new/skip/unclear)
 * 5. Send follow-up confirmation
 * 6. Clean up Redis pending choice
 *
 * Non-fatal: errors are caught and logged. On failure, the pending
 * choice remains in Redis (Cat can try replying again until TTL expires).
 */
async function handleFilingReply(
  gmailClient: any,
  messageId: string,
  messageMeta: any,
  pendingChoice: PendingChoice,
): Promise<IntakeResult> {
  try {
    // 1. Fetch full message for body text
    const fullMessage = await gmailClient.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    // 2. Extract plain text body and strip quoted content
    const plainBody = findPlainTextBody(fullMessage.data.payload) ?? '';
    const replyText = extractReplyText(plainBody);

    if (!replyText) {
      console.warn('[intake] Empty reply text in filing reply', { messageId });
      return { documentsProcessed: 0, documentIds: [], errors: [] };
    }

    // 3. Parse reply with AI
    const parseResult = await parseFilingReply(replyText, pendingChoice.options);
    console.log('[intake] Filing reply parsed:', {
      messageId,
      action: parseResult.action,
      selectedIndex: parseResult.selectedIndex,
      confidence: parseResult.confidence,
    });

    // 4. Execute based on action
    const { threadContext, documentInfo, options } = pendingChoice;

    // Low confidence override: treat as unclear
    const effectiveAction = parseResult.confidence < 0.7 && parseResult.action === 'select'
      ? 'unclear' as const
      : parseResult.action;

    switch (effectiveAction) {
      case 'select': {
        const idx = parseResult.selectedIndex!;
        const chosen = options[idx];
        const drive = getDriveClient();

        // Move file from Needs Review to chosen folder
        await moveFile(
          drive,
          documentInfo.driveFileId,
          documentInfo.needsReviewFolderId,
          chosen.folderId,
        );

        // Link folder to CRM contact if we have a contactId
        if (pendingChoice.contactId) {
          try {
            const c = await getContact(pendingChoice.contactId);
            await upsertContact({
              email: c.email,
              firstName: c.firstName,
              lastName: c.lastName,
              customFields: [{ id: crmConfig.driveFolderIdFieldId, field_value: chosen.folderId }],
            });
          } catch {
            // CRM linking is non-fatal
          }
        }

        // Send follow-up confirmation
        const body = buildFollowUpBody('select', chosen.folderName);
        await sendFollowUpConfirmation(threadContext, body);

        // Clean up
        await deletePendingChoice(messageMeta.threadId!);

        console.log('[intake] Filing reply executed: selected', {
          messageId,
          folderName: chosen.folderName,
          driveFileId: documentInfo.driveFileId,
        });
        break;
      }

      case 'create_new': {
        const drive = getDriveClient();

        // Create a new folder using the doc's borrower name from the original classification
        // Fall back to a generic name derived from the original filename
        const newFolderName = documentInfo.originalFilename.replace(/\.[^.]+$/, '');
        const rootFolderId = classificationConfig.driveRootFolderId;
        const newFolderId = await findOrCreateFolder(drive, newFolderName, rootFolderId);

        // Move file from Needs Review to new folder
        await moveFile(
          drive,
          documentInfo.driveFileId,
          documentInfo.needsReviewFolderId,
          newFolderId,
        );

        // Link folder to CRM contact if we have one
        if (pendingChoice.contactId) {
          try {
            const c = await getContact(pendingChoice.contactId);
            await upsertContact({
              email: c.email,
              firstName: c.firstName,
              lastName: c.lastName,
              customFields: [{ id: crmConfig.driveFolderIdFieldId, field_value: newFolderId }],
            });
          } catch {
            // CRM linking is non-fatal
          }
        }

        // Send follow-up confirmation
        const body = buildFollowUpBody('create_new', newFolderName);
        await sendFollowUpConfirmation(threadContext, body);

        // Clean up
        await deletePendingChoice(messageMeta.threadId!);

        console.log('[intake] Filing reply executed: create_new', {
          messageId,
          newFolderName,
          driveFileId: documentInfo.driveFileId,
        });
        break;
      }

      case 'skip': {
        // Acknowledge and leave in Needs Review
        const body = buildFollowUpBody('skip');
        await sendFollowUpConfirmation(threadContext, body);

        // Clean up
        await deletePendingChoice(messageMeta.threadId!);

        console.log('[intake] Filing reply executed: skip', { messageId });
        break;
      }

      case 'unclear': {
        // Ask for clarification — do NOT delete pending choice (Cat can try again)
        const body = buildFollowUpBody('unclear');
        await sendFollowUpConfirmation(threadContext, body);

        console.log('[intake] Filing reply unclear, asked for clarification', { messageId });
        break;
      }
    }

    // Mark the reply message as processed so we don't re-process it
    await markMessageProcessed(intakeConfig.docsInbox, messageId);

    return { documentsProcessed: 0, documentIds: [], errors: [] };
  } catch (err) {
    // Reply handling is non-fatal — pending choice stays in Redis, Cat can retry
    console.error('[intake] Failed to handle filing reply (non-fatal):', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      documentsProcessed: 0,
      documentIds: [],
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

// ---------------------------------------------------------------------------
// Gmail Poll Handler
// ---------------------------------------------------------------------------

/**
 * Polls Gmail for new messages and enqueues individual intake jobs.
 *
 * This bridges the BullMQ scheduler (periodic poll jobs) with per-message
 * processing. On each poll:
 * 1. Read stored historyId from Redis (or get initial on first run)
 * 2. Call Gmail history.list for new messages since that historyId
 * 3. Enqueue an intake job for each new message
 * 4. Store the new historyId for next poll
 */
async function processGmailPoll(): Promise<IntakeResult> {
  const gmailClient = getGmailReadonlyClient(intakeConfig.docsInbox);

  // Get last processed historyId (or seed on first run)
  let historyId = await getStoredHistoryId();
  if (!historyId) {
    historyId = await getInitialHistoryId(gmailClient);
    await storeHistoryId(historyId);
    console.log('[intake] First run — seeded historyId:', historyId);
    return { documentsProcessed: 0, documentIds: [], errors: [] };
  }

  // Poll for new messages
  const { messageIds, newHistoryId } = await pollForNewMessages(gmailClient, historyId);

  // Store updated historyId
  await storeHistoryId(newHistoryId);

  if (messageIds.length === 0) {
    return { documentsProcessed: 0, documentIds: [], errors: [] };
  }

  console.log(`[intake] Poll found ${messageIds.length} new messages`);

  // Enqueue individual message jobs
  const queue = getIntakeQueue();
  for (const msgId of messageIds) {
    await queue.add(
      'process-gmail-message',
      {
        source: 'gmail' as const,
        gmailMessageId: msgId,
        receivedAt: new Date().toISOString(),
      },
      { jobId: `gmail-${msgId}` },
    );
  }

  return {
    documentsProcessed: 0,
    documentIds: [],
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Finmo Source Processing
// ---------------------------------------------------------------------------

async function processFinmoSource(job: Job<IntakeJobData>): Promise<IntakeResult> {
  const { applicationId, documentRequestId } = job.data;
  if (!documentRequestId) {
    return {
      documentsProcessed: 0,
      documentIds: [],
      errors: ['Finmo source job missing documentRequestId'],
    };
  }

  // Dedup check: skip if already processed
  const alreadyProcessed = await isDocRequestProcessed(documentRequestId);
  if (alreadyProcessed) {
    console.log('[intake] Finmo doc request already processed, skipping:', { documentRequestId });
    return { documentsProcessed: 0, documentIds: [], errors: [] };
  }

  const errors: string[] = [];
  const documentIds: string[] = [];
  const documents: IntakeDocument[] = [];

  try {
    // Download files from Finmo
    const downloadResults = await downloadFinmoDocument(
      applicationId ?? '',
      documentRequestId,
    );

    if (downloadResults.length === 0) {
      console.log('[intake] Finmo doc request has no files:', { documentRequestId });
      // Still mark as processed to avoid re-checking
      await markDocRequestProcessed(documentRequestId);
      return { documentsProcessed: 0, documentIds: [], errors: [] };
    }

    for (let index = 0; index < downloadResults.length; index++) {
      const file = downloadResults[index];
      try {
        // Determine conversion strategy
        const strategy = getConversionStrategy(file.mimeType);

        if (strategy === 'unsupported') {
          errors.push(`Unsupported MIME type from Finmo: ${file.mimeType} (${file.filename})`);
          continue;
        }

        // Convert to PDF if needed
        const conversion = await convertToPdf(file.buffer, file.mimeType);

        // Create IntakeDocument
        const doc: IntakeDocument = {
          id: `finmo-${documentRequestId}-${index}`,
          pdfBuffer: conversion.pdfBuffer,
          originalFilename: file.filename,
          originalMimeType: file.mimeType,
          source: 'finmo',
          senderEmail: null,
          applicationId: applicationId ?? null,
          gmailMessageId: null,
          receivedAt: job.data.receivedAt,
        };

        documents.push(doc);
        documentIds.push(doc.id);

        // Write PDF to temp file (buffers must NOT go in Redis)
        const tempFilePath = join(tmpdir(), `intake-${randomUUID()}.pdf`);
        await writeFile(tempFilePath, conversion.pdfBuffer);

        // Enqueue for classification (Phase 7)
        const classificationJob: ClassificationJobData = {
          intakeDocumentId: doc.id,
          tempFilePath,
          originalFilename: doc.originalFilename,
          senderEmail: doc.senderEmail,
          applicationId: doc.applicationId,
          source: doc.source,
          receivedAt: doc.receivedAt,
        };

        await getClassificationQueue().add(
          'classify-doc',
          classificationJob,
          { jobId: `classify-${doc.id}` },
        );

        console.log('[intake] Produced IntakeDocument from Finmo:', {
          id: doc.id,
          source: doc.source,
          originalFilename: doc.originalFilename,
          applicationId: doc.applicationId,
        });
      } catch (err) {
        if (err instanceof ConversionError) {
          errors.push(`${err.code}: ${file.filename} — ${err.message}`);
        } else {
          errors.push(`Failed to process Finmo file ${file.filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch (err) {
    errors.push(`Finmo download failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Mark as processed (even with partial errors, we don't want to re-process)
  if (documentIds.length > 0 || errors.length > 0) {
    await markDocRequestProcessed(documentRequestId);
  }

  console.log(
    `[intake] Processed Finmo doc request ${documentRequestId}: ${documents.length} docs, ${errors.length} errors`,
  );

  return {
    documentsProcessed: documents.length,
    documentIds,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Intake Worker (Lazy Singleton)
// ---------------------------------------------------------------------------

let _worker: Worker<IntakeJobData, IntakeResult> | null = null;

/**
 * Create and start the intake BullMQ worker (lazy singleton).
 *
 * Listens on the doc-intake queue with concurrency 1.
 * Logs completed and failed events for observability.
 */
export function createIntakeWorker(): Worker<IntakeJobData, IntakeResult> {
  if (_worker) return _worker;

  _worker = new Worker<IntakeJobData, IntakeResult>(INTAKE_QUEUE_NAME, processIntakeJob, {
    connection: createRedisConnection(),
    concurrency: 1,
  });

  _worker.on('completed', (job) => {
    console.log(`[intake-worker] Job ${job.id} completed`, {
      source: job.data.source,
      documentsProcessed: job.returnvalue?.documentsProcessed,
    });
  });

  _worker.on('failed', (job, err) => {
    console.error(`[intake-worker] Job ${job?.id} failed`, {
      source: job?.data?.source,
      error: err.message,
      attempt: job?.attemptsMade,
    });
  });

  console.log('[intake-worker] Started, listening for jobs on queue:', INTAKE_QUEUE_NAME);
  return _worker;
}

/**
 * Close the intake worker for graceful shutdown.
 * Resets the singleton so a new worker can be created if needed.
 */
export async function closeIntakeWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
