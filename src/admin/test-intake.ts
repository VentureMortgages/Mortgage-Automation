/**
 * Test Intake Endpoint — Battle-test the doc intake pipeline
 *
 * Runs the full intake→classify→match→file pipeline synchronously for a
 * single Gmail message and returns a detailed JSON trace of every step.
 *
 * Endpoints:
 * - POST /admin/test-intake  — Process a message through the full pipeline
 * - GET  /admin/recent-messages — List recent messages in the docs inbox
 *
 * Supports dryRun mode (default: true) which classifies + matches but
 * does NOT upload to Drive or update CRM.
 *
 * Consumers: manual testing by Cat/Taylor/Luca before production cutover
 */

import type { Request, Response } from 'express';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { intakeConfig, getConversionStrategy } from '../intake/config.js';
import { getGmailReadonlyClient, markMessageProcessed } from '../email/gmail-client.js';
import { getMessageDetails } from '../intake/gmail-reader.js';
import { extractAttachments, downloadAttachment } from '../intake/attachment-extractor.js';
import { convertToPdf, ConversionError } from '../intake/pdf-converter.js';
import { classifyDocument } from '../classification/classifier.js';
import { generateFilename } from '../classification/naming.js';
import { routeToSubfolder, getPersonSubfolderName } from '../classification/router.js';
import { matchDocument } from '../matching/agent.js';
import { getContact, getContactDriveFolderId, resolveContactId } from '../crm/contacts.js';
import { crmConfig } from '../crm/config.js';
import { classificationConfig } from '../classification/config.js';
import { extractFromZip, isZipMimeType } from '../intake/zip-extractor.js';
import { DOC_TYPE_LABELS } from '../classification/types.js';
import type { ClassificationResult } from '../classification/types.js';
import { getDriveClient } from '../classification/drive-client.js';
import { findOrCreateFolder, uploadFile, findExistingFile, updateFileContent, resolveTargetFolder } from '../classification/filer.js';
import { storeOriginal } from '../drive/originals.js';
import { updateDocTracking } from '../crm/tracking-sync.js';
import { createCrmNote } from '../crm/notes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentTrace {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  classification: ClassificationResult | null;
  classificationError: string | null;
  generatedFilename: string | null;
  subfolderTarget: string | null;
  personSubfolder: string | null;
  matching: {
    outcome: string;
    confidence: number;
    reasoning: string;
    chosenContactId: string | null;
    chosenContactName: string | null;
    chosenDriveFolderId: string | null;
    signals: Array<{ type: string; value: string; confidence: number; tier: number }>;
    candidates: Array<{ contactId: string; contactName: string; confidence: number }>;
  } | null;
  matchingError: string | null;
  filing: {
    dryRun: boolean;
    clientFolderId: string | null;
    clientFolderSource: string;
    targetSubfolder: string;
    action: 'would_create' | 'would_update' | 'created' | 'updated' | 'skipped';
    driveFileId: string | null;
    driveFileLink: string | null;
  } | null;
  filingError: string | null;
  crmUpdate: {
    dryRun: boolean;
    wouldUpdate: boolean;
    trackingTarget: string | null;
  } | null;
}

interface TestIntakeResponse {
  email: {
    messageId: string;
    from: string;
    subject: string;
    threadId: string | null;
    cc: string[];
    date: string;
    attachmentCount: number;
    domainFilterPassed: boolean;
  };
  documents: DocumentTrace[];
  summary: {
    totalAttachments: number;
    classified: number;
    matched: number;
    wouldAutoFile: number;
    wouldNeedReview: number;
    errors: string[];
  };
  dryRun: boolean;
  processingTimeMs: number;
}

// ---------------------------------------------------------------------------
// POST /admin/test-intake
// ---------------------------------------------------------------------------

export async function testIntakeHandler(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const { messageId, dryRun = true } = req.body as { messageId?: string; dryRun?: boolean };

  if (!messageId) {
    res.status(400).json({ error: 'Missing messageId. Use GET /admin/recent-messages to find one.' });
    return;
  }

  try {
    const gmailClient = getGmailReadonlyClient(intakeConfig.docsInbox);
    const errors: string[] = [];

    // 1. Fetch message metadata
    const messageMeta = await getMessageDetails(gmailClient, messageId);
    const senderDomain = messageMeta.from.split('@')[1]?.toLowerCase();
    const domainFilterPassed = senderDomain === 'venturemortgages.com';

    // 2. Get full message for attachment extraction
    const fullMessage = await gmailClient.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const parts = fullMessage.data.payload?.parts ?? [];
    const attachments = extractAttachments(parts);

    const emailTrace = {
      messageId,
      from: messageMeta.from,
      subject: messageMeta.subject,
      threadId: messageMeta.threadId ?? null,
      cc: messageMeta.cc ?? [],
      date: messageMeta.date,
      attachmentCount: attachments.length,
      domainFilterPassed,
    };

    if (!domainFilterPassed) {
      errors.push(`Sender domain "${senderDomain}" is not venturemortgages.com — would be skipped in production`);
    }

    // 3. Expand attachments: download all, extract ZIPs into individual files
    interface FileToProcess {
      filename: string;
      mimeType: string;
      buffer: Buffer;
      sizeBytes: number;
      sourceAttachment: string;
    }

    const filesToProcess: FileToProcess[] = [];
    const documents: DocumentTrace[] = [];
    let classified = 0;
    let matched = 0;
    let wouldAutoFile = 0;
    let wouldNeedReview = 0;

    for (const att of attachments) {
      if (att.size > intakeConfig.maxAttachmentBytes) {
        errors.push(`Attachment too large: ${att.filename} (${att.size} bytes)`);
        documents.push({
          originalFilename: att.filename, mimeType: att.mimeType, sizeBytes: att.size,
          classification: null, classificationError: `Too large: ${att.size} bytes`, generatedFilename: null,
          subfolderTarget: null, personSubfolder: null, matching: null, matchingError: null,
          filing: null, filingError: null, crmUpdate: null,
        });
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = await downloadAttachment(gmailClient, messageId, att.attachmentId);
      } catch (err) {
        errors.push(`Download failed: ${att.filename}`);
        continue;
      }

      if (isZipMimeType(att.mimeType)) {
        try {
          const extracted = extractFromZip(buffer, att.filename);
          for (const file of extracted) {
            filesToProcess.push({
              filename: file.filename,
              mimeType: file.mimeType,
              buffer: file.buffer,
              sizeBytes: file.buffer.length,
              sourceAttachment: att.filename,
            });
          }
        } catch (err) {
          errors.push(`ZIP extraction failed: ${att.filename} — ${err instanceof Error ? err.message : String(err)}`);
          documents.push({
            originalFilename: att.filename, mimeType: att.mimeType, sizeBytes: att.size,
            classification: null, classificationError: `ZIP extraction failed`, generatedFilename: null,
            subfolderTarget: null, personSubfolder: null, matching: null, matchingError: null,
            filing: null, filingError: null, crmUpdate: null,
          });
        }
        continue;
      }

      filesToProcess.push({
        filename: att.filename,
        mimeType: att.mimeType,
        buffer,
        sizeBytes: att.size,
        sourceAttachment: att.filename,
      });
    }

    // 4. Process each file through classify → match → file
    for (let index = 0; index < filesToProcess.length; index++) {
      const file = filesToProcess[index];
      const docTrace: DocumentTrace = {
        originalFilename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        classification: null,
        classificationError: null,
        generatedFilename: null,
        subfolderTarget: null,
        personSubfolder: null,
        matching: null,
        matchingError: null,
        filing: null,
        filingError: null,
        crmUpdate: null,
      };

      // Check MIME type
      const strategy = getConversionStrategy(file.mimeType);
      if (strategy === 'unsupported') {
        docTrace.classificationError = `Unsupported MIME type: ${file.mimeType}`;
        errors.push(docTrace.classificationError);
        documents.push(docTrace);
        continue;
      }

      try {
        // Convert to PDF
        const { pdfBuffer } = await convertToPdf(file.buffer, file.mimeType);

        // Classify
        const classification = await classifyDocument(pdfBuffer, file.filename);
        docTrace.classification = classification;
        classified++;

        // Generate filename
        const fallbackName = classification.borrowerFirstName ?? file.filename.replace(/\.[^.]+$/, '');
        docTrace.generatedFilename = generateFilename(classification, fallbackName);

        // Route to subfolder
        const subfolderTarget = routeToSubfolder(classification.documentType);
        docTrace.subfolderTarget = subfolderTarget;
        docTrace.personSubfolder = subfolderTarget === 'person'
          ? getPersonSubfolderName(classification.borrowerFirstName, classification.borrowerLastName, 'Borrower')
          : null;

        // Match to contact
        try {
          const intakeDocId = `test-${messageId}-${index}`;
          const matchDecision = await matchDocument({
            intakeDocumentId: intakeDocId,
            classificationResult: classification,
            senderEmail: messageMeta.from,
            threadId: messageMeta.threadId ?? undefined,
            ccAddresses: messageMeta.cc,
            emailSubject: messageMeta.subject,
            applicationId: null,
            originalFilename: file.filename,
          });

          // Resolve contact name for display
          let contactName: string | null = null;
          if (matchDecision.chosenContactId) {
            try {
              const contact = await getContact(matchDecision.chosenContactId);
              contactName = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null;
            } catch { /* non-fatal */ }
          }

          docTrace.matching = {
            outcome: matchDecision.outcome,
            confidence: matchDecision.confidence,
            reasoning: matchDecision.reasoning,
            chosenContactId: matchDecision.chosenContactId,
            chosenContactName: contactName ?? matchDecision.candidates[0]?.contactName ?? null,
            chosenDriveFolderId: matchDecision.chosenDriveFolderId,
            signals: matchDecision.signals.map(s => ({
              type: s.type,
              value: s.value,
              confidence: s.confidence,
              tier: s.tier,
            })),
            candidates: matchDecision.candidates.map(c => ({
              contactId: c.contactId,
              contactName: c.contactName,
              confidence: c.confidence,
            })),
          };
          matched++;

          if (matchDecision.outcome === 'auto_filed') wouldAutoFile++;
          if (matchDecision.outcome === 'needs_review' || matchDecision.outcome === 'conflict') wouldNeedReview++;

          // Resolve Drive folder for filing trace
          let clientFolderId = matchDecision.chosenDriveFolderId;
          let folderSource = 'matching_agent';

          if (!clientFolderId && matchDecision.chosenContactId) {
            try {
              const contact = await getContact(matchDecision.chosenContactId);
              clientFolderId = getContactDriveFolderId(contact, crmConfig.driveFolderIdFieldId);
              folderSource = 'crm_contact_field';
            } catch { /* non-fatal */ }
          }

          if (!clientFolderId && classificationConfig.driveRootFolderId) {
            clientFolderId = classificationConfig.driveRootFolderId;
            folderSource = 'drive_root_fallback';
          }

          // Build filing trace
          const subfolderName = subfolderTarget === 'person'
            ? docTrace.personSubfolder ?? 'Borrower'
            : subfolderTarget === 'root'
              ? '(root)'
              : subfolderTarget.replace(/_/g, ' ');

          if (dryRun) {
            docTrace.filing = {
              dryRun: true,
              clientFolderId,
              clientFolderSource: folderSource,
              targetSubfolder: subfolderName,
              action: 'would_create',
              driveFileId: null,
              driveFileLink: null,
            };
            docTrace.crmUpdate = {
              dryRun: true,
              wouldUpdate: !!matchDecision.chosenContactId,
              trackingTarget: classification.documentType,
            };
          } else {
            // LIVE MODE: actually file to Drive and update CRM
            if (clientFolderId && matchDecision.outcome === 'auto_filed') {
              try {
                const drive = getDriveClient();
                const personName = getPersonSubfolderName(
                  classification.borrowerFirstName,
                  classification.borrowerLastName,
                  'Borrower',
                );

                // Store original
                try { await storeOriginal(drive, clientFolderId, pdfBuffer, file.filename); } catch { /* non-fatal */ }

                // Resolve target folder
                const targetFolderId = await resolveTargetFolder(
                  drive, clientFolderId, subfolderTarget, personName,
                );

                // Check for existing file
                const docLabel = DOC_TYPE_LABELS[classification.documentType] ?? classification.documentType;
                const existing = await findExistingFile(drive, docLabel, targetFolderId);

                let driveFileId: string;
                let action: 'created' | 'updated';

                if (existing) {
                  await updateFileContent(drive, existing.id, pdfBuffer, docTrace.generatedFilename!);
                  driveFileId = existing.id;
                  action = 'updated';
                } else {
                  driveFileId = await uploadFile(drive, pdfBuffer, docTrace.generatedFilename!, targetFolderId);
                  action = 'created';
                }

                docTrace.filing = {
                  dryRun: false,
                  clientFolderId,
                  clientFolderSource: folderSource,
                  targetSubfolder: subfolderName,
                  action,
                  driveFileId,
                  driveFileLink: `https://drive.google.com/file/d/${driveFileId}/view`,
                };

                // CRM note
                if (matchDecision.chosenContactId) {
                  try {
                    await createCrmNote(
                      matchDecision.chosenContactId,
                      `${docLabel} filed to ${classification.borrowerFirstName ?? 'client'}'s folder. ` +
                      `Matched: ${matchDecision.reasoning} (confidence: ${matchDecision.confidence.toFixed(2)}) ` +
                      `[via test-intake]`,
                    );
                  } catch { /* non-fatal */ }
                }

                // CRM tracking update
                if (matchDecision.chosenContactId) {
                  try {
                    const trackingResult = await updateDocTracking({
                      senderEmail: messageMeta.from,
                      documentType: classification.documentType,
                      driveFileId,
                      source: 'gmail',
                      receivedAt: new Date().toISOString(),
                      contactId: matchDecision.chosenContactId,
                    });
                    docTrace.crmUpdate = {
                      dryRun: false,
                      wouldUpdate: trackingResult.updated,
                      trackingTarget: trackingResult.trackingTarget ?? null,
                    };
                  } catch { /* non-fatal */ }
                }
              } catch (err) {
                docTrace.filingError = err instanceof Error ? err.message : String(err);
              }
            } else {
              docTrace.filing = {
                dryRun: false,
                clientFolderId,
                clientFolderSource: folderSource,
                targetSubfolder: subfolderName,
                action: 'skipped',
                driveFileId: null,
                driveFileLink: null,
              };
            }
          }
        } catch (matchErr) {
          docTrace.matchingError = matchErr instanceof Error ? matchErr.message : String(matchErr);
          errors.push(`Matching failed for ${file.filename}: ${docTrace.matchingError}`);
        }
      } catch (err) {
        if (err instanceof ConversionError) {
          docTrace.classificationError = `${err.code}: ${err.message}`;
        } else {
          docTrace.classificationError = err instanceof Error ? err.message : String(err);
        }
        errors.push(`Processing failed for ${file.filename}: ${docTrace.classificationError}`);
      }

      documents.push(docTrace);
    }

    const response: TestIntakeResponse = {
      email: emailTrace,
      documents,
      summary: {
        totalAttachments: attachments.length,
        classified,
        matched,
        wouldAutoFile,
        wouldNeedReview,
        errors,
      },
      dryRun,
      processingTimeMs: Date.now() - startTime,
    };

    res.json(response);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
      hint: 'Is the messageId valid? Use GET /admin/recent-messages to find one.',
      processingTimeMs: Date.now() - startTime,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /admin/recent-messages
// ---------------------------------------------------------------------------

export async function recentMessagesHandler(_req: Request, res: Response): Promise<void> {
  try {
    const gmailClient = getGmailReadonlyClient(intakeConfig.docsInbox);

    // List recent messages (last 20)
    const listResponse = await gmailClient.users.messages.list({
      userId: 'me',
      maxResults: 20,
      labelIds: ['INBOX'],
    });

    const messages = listResponse.data.messages ?? [];

    // Fetch metadata for each
    const results = await Promise.all(
      messages.map(async (msg) => {
        if (!msg.id) return null;
        try {
          const meta = await getMessageDetails(gmailClient, msg.id);

          // Quick check for attachments
          const full = await gmailClient.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Content-Type'],
          });

          // Check if multipart (likely has attachments)
          const contentType = full.data.payload?.headers?.find(
            h => h.name?.toLowerCase() === 'content-type',
          )?.value ?? '';
          const hasAttachments = contentType.includes('multipart/mixed') ||
            (full.data.payload?.parts?.some(p => p.filename && p.filename.length > 0) ?? false);

          return {
            messageId: msg.id,
            from: meta.from,
            subject: meta.subject,
            date: meta.date,
            hasAttachments,
            senderDomain: meta.from.split('@')[1]?.toLowerCase() ?? 'unknown',
            wouldProcess: meta.from.split('@')[1]?.toLowerCase() === 'venturemortgages.com',
          };
        } catch {
          return { messageId: msg.id, error: 'Could not fetch metadata' };
        }
      }),
    );

    res.json({
      inbox: intakeConfig.docsInbox,
      messageCount: results.filter(Boolean).length,
      messages: results.filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// POST /admin/cleanup-inbox
// ---------------------------------------------------------------------------

export async function cleanupInboxHandler(req: Request, res: Response): Promise<void> {
  try {
    const gmailClient = getGmailReadonlyClient(intakeConfig.docsInbox);

    // List all messages currently in INBOX
    const listResponse = await gmailClient.users.messages.list({
      userId: 'me',
      maxResults: 100,
      labelIds: ['INBOX'],
    });

    const messages = listResponse.data.messages ?? [];

    if (messages.length === 0) {
      res.json({ success: true, moved: 0, message: 'Inbox already clean' });
      return;
    }

    let moved = 0;
    const errors: string[] = [];

    for (const msg of messages) {
      if (!msg.id) continue;
      try {
        await markMessageProcessed(intakeConfig.docsInbox, msg.id);
        moved++;
      } catch (err) {
        errors.push(`${msg.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`[admin] Inbox cleanup: moved ${moved}/${messages.length} messages to Processed`);
    res.json({ success: true, moved, total: messages.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
