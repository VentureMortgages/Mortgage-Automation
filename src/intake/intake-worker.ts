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
import { getGmailReadonlyClient } from '../email/gmail-client.js';
import { getMessageDetails } from './gmail-reader.js';
import { extractAttachments, downloadAttachment } from './attachment-extractor.js';
import { convertToPdf, ConversionError } from './pdf-converter.js';
import { downloadFinmoDocument, isDocRequestProcessed, markDocRequestProcessed } from './finmo-downloader.js';
import { isBccCopy, handleSentDetection } from './sent-detector.js';
import { getContactIdBySubject } from '../feedback/original-store.js';
import { pollForNewMessages, getInitialHistoryId } from './gmail-reader.js';
import { INTAKE_QUEUE_NAME, getIntakeQueue, getStoredHistoryId, storeHistoryId } from './gmail-monitor.js';
import { CLASSIFICATION_QUEUE_NAME } from '../classification/classification-worker.js';
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
    return {
      documentsProcessed: 0,
      documentIds: [],
      errors: sentResult.errors,
    };
  }

  // 2. Get full message for attachment extraction
  const fullMessage = await gmailClient.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  // 3. Extract attachments from MIME parts
  const parts = fullMessage.data.payload?.parts ?? [];
  const attachments = extractAttachments(parts);

  if (attachments.length === 0) {
    console.log(`[intake] Gmail message ${messageId}: no attachments found`);
    return { documentsProcessed: 0, documentIds: [], errors: [] };
  }

  // 4. Process each valid attachment and enqueue for classification (Phase 7)
  const documents: IntakeDocument[] = [];

  for (let index = 0; index < attachments.length; index++) {
    const att = attachments[index];

    // Skip unsupported MIME types
    const strategy = getConversionStrategy(att.mimeType);
    if (strategy === 'unsupported') {
      errors.push(`Unsupported MIME type: ${att.mimeType} (${att.filename})`);
      continue;
    }

    // Skip oversized attachments
    if (att.size > intakeConfig.maxAttachmentBytes) {
      errors.push(
        `Attachment too large: ${att.filename} (${att.size} bytes > ${intakeConfig.maxAttachmentBytes} max)`,
      );
      continue;
    }

    try {
      // 5. Download attachment data
      const buffer = await downloadAttachment(gmailClient, messageId, att.attachmentId);

      // 6. Convert to PDF
      const { pdfBuffer } = await convertToPdf(buffer, att.mimeType);

      // 7. Create IntakeDocument
      const doc: IntakeDocument = {
        id: `gmail-${messageId}-${index}`,
        pdfBuffer,
        originalFilename: att.filename,
        originalMimeType: att.mimeType,
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

      // Log document metadata (no PII — just file info)
      console.log(`[intake] Produced IntakeDocument:`, {
        id: doc.id,
        source: doc.source,
        originalFilename: doc.originalFilename,
        originalMimeType: doc.originalMimeType,
        senderEmail: doc.senderEmail,
      });
    } catch (err) {
      if (err instanceof ConversionError) {
        errors.push(`${err.code}: ${att.filename} — ${err.message}`);
      } else {
        errors.push(`Failed to process ${att.filename}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(
    `[intake] Processed gmail message ${messageId}: ${documents.length} docs, ${errors.length} errors`,
  );

  return {
    documentsProcessed: documents.length,
    documentIds,
    errors,
  };
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
