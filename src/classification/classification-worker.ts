/**
 * Classification Worker — BullMQ Document Classification Pipeline
 *
 * Processes jobs from the doc-classification queue, orchestrating:
 * 1. Read PDF from temp file
 * 2. Classify document via Claude API
 * 3. Match document to CRM contact via smart matching agent (Phase 14)
 * 4. Route by match outcome:
 *    - auto_filed: file to matched folder, CRM note with reasoning (MATCH-03)
 *    - needs_review/conflict: file to global Needs Review/, CRM task (MATCH-04)
 *    - auto_created: create new contact + folder, file there (MATCH-02)
 *    - error: fall back to legacy resolveContactId
 * 5. Check classification confidence (low -> per-client Needs Review)
 * 6. For property-specific docs, resolve deal subfolder from opportunity
 * 7. Generate filename (Cat's naming convention)
 * 8. Route to correct subfolder
 * 9. File to Google Drive (upload or update existing)
 * 10. Clean up temp file
 *
 * Error handling is per-stage: classification failure, Drive failure, and CRM
 * failure are each caught independently. Temp files are cleaned up in all paths.
 *
 * Implements:
 * - MATCH-03: Auto-filed docs get CRM note (not task) with reasoning
 * - MATCH-04: Low-confidence matching -> global Needs Review with CRM task
 * - MATCH-02: Zero-match -> auto-create contact + folder
 * - FILE-05: Low confidence classification -> manual review via CRM task
 * - FILE-04: Existing files are updated, not duplicated
 *
 * Follows the same lazy singleton Worker pattern as intake-worker.ts.
 */

import { readFile, unlink } from 'node:fs/promises';
import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../webhook/queue.js';
import { classificationConfig } from './config.js';
import { classifyDocument } from './classifier.js';
import { generateFilename } from './naming.js';
import { routeToSubfolder, getPersonSubfolderName } from './router.js';
import { getDriveClient } from './drive-client.js';
import { resolveTargetFolder, uploadFile, findExistingFile, updateFileContent, findOrCreateFolder } from './filer.js';
import { storeOriginal } from '../drive/originals.js';
import { resolveContactId, getContact, getContactDriveFolderId, extractDriveFolderId } from '../crm/contacts.js';
import { crmConfig } from '../crm/config.js';
import { findOpportunityByFinmoId, getOpportunityFieldValue } from '../crm/opportunities.js';
import { PIPELINE_IDS } from '../crm/types/index.js';
import type { CrmContact } from '../crm/types/index.js';
import { createReviewTask } from '../crm/tasks.js';
import { createCrmNote } from '../crm/notes.js';
import { updateDocTracking } from '../crm/tracking-sync.js';
import { PROPERTY_SPECIFIC_TYPES } from '../drive/doc-expiry.js';
import { matchDocument } from '../matching/agent.js';
import { autoCreateFromDoc } from '../matching/auto-create.js';
import { DOC_TYPE_LABELS } from './types.js';
import type { ClassificationJobData, ClassificationJobResult } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CLASSIFICATION_QUEUE_NAME = 'doc-classification';

// ---------------------------------------------------------------------------
// Pipeline Processor
// ---------------------------------------------------------------------------

/**
 * Process a single classification job.
 *
 * Exported for direct unit testing (same pattern as processJob in webhook/worker.ts
 * and processIntakeJob in intake-worker.ts).
 *
 * @param job - BullMQ job containing temp file path, filename, sender, etc.
 * @returns ClassificationJobResult with filing outcome
 */
export async function processClassificationJob(
  job: Job<ClassificationJobData>,
): Promise<ClassificationJobResult> {
  const { tempFilePath, originalFilename, senderEmail, applicationId, source, intakeDocumentId } =
    job.data;

  try {
    // a. Read PDF from temp file
    const pdfBuffer = await readFile(tempFilePath);

    // b. Classify the document
    const classification = await classifyDocument(pdfBuffer, originalFilename);
    console.log('[classification] Classified document:', {
      documentType: classification.documentType,
      confidence: classification.confidence,
    });

    // c. Smart matching: resolve CRM contact via matching agent (Phase 14)
    const matchDecision = await matchDocument({
      intakeDocumentId,
      classificationResult: classification,
      senderEmail,
      threadId: job.data.threadId,
      ccAddresses: job.data.ccAddresses,
      emailSubject: job.data.emailSubject,
      applicationId,
      originalFilename,
    });

    let contactId = matchDecision.chosenContactId;
    let clientFolderId = matchDecision.chosenDriveFolderId;

    console.log('[classification] Match decision:', {
      outcome: matchDecision.outcome,
      confidence: matchDecision.confidence,
      hasContactId: !!contactId,
    });

    // d. Handle match outcomes
    switch (matchDecision.outcome) {
      case 'auto_filed':
        // High confidence match — proceed with normal filing
        // CRM note created after filing (below)
        break;

      case 'needs_review':
      case 'conflict': {
        // Low confidence or conflicting signals — route to global Needs Review/
        const drive = getDriveClient();
        const globalNeedsReviewId = await findOrCreateFolder(
          drive, 'Needs Review', classificationConfig.driveRootFolderId,
        );
        const fileId = await uploadFile(drive, pdfBuffer, originalFilename, globalNeedsReviewId);

        // Also store in Originals/ if we have a best-guess contact folder
        if (clientFolderId) {
          try { await storeOriginal(drive, clientFolderId, pdfBuffer, originalFilename); } catch { /* non-fatal */ }
        }

        // CRM task with signals + Drive link (MATCH-04)
        const signalSummary = matchDecision.signals.map(s => `${s.type}=${s.value}`).join(', ');
        const bestGuess = matchDecision.candidates[0]?.contactName ?? 'Unknown';
        const taskBody = `Incoming doc may belong to [${bestGuess}] (${(matchDecision.confidence * 100).toFixed(0)}%). ` +
          `Signals: ${signalSummary || 'none'}. File: https://drive.google.com/file/d/${fileId}/view`;

        const taskContactId = contactId ?? matchDecision.candidates[0]?.contactId;
        if (taskContactId) {
          try {
            await createReviewTask(
              taskContactId,
              `Match Review: ${originalFilename}`,
              taskBody,
            );
          } catch { /* non-fatal */ }
        }

        // Clean up temp file
        await unlink(tempFilePath).catch(() => {});

        return {
          intakeDocumentId,
          classification,
          filed: false,
          driveFileId: fileId,
          manualReview: true,
          error: null,
        };
      }

      case 'auto_created': {
        // No match found — create new contact + folder
        const created = await autoCreateFromDoc({
          classificationResult: classification,
          senderEmail,
          originalFilename,
        });
        if (created) {
          contactId = created.contactId;
          clientFolderId = created.driveFolderId;
        } else {
          // autoCreateFromDoc failed — route to global Needs Review as last resort
          const drive = getDriveClient();
          const globalNrId = await findOrCreateFolder(
            drive, 'Needs Review', classificationConfig.driveRootFolderId,
          );
          const fileId = await uploadFile(drive, pdfBuffer, originalFilename, globalNrId);
          await unlink(tempFilePath).catch(() => {});
          return {
            intakeDocumentId,
            classification,
            filed: false,
            driveFileId: fileId,
            manualReview: true,
            error: null,
          };
        }
        break;
      }

      case 'error': {
        // Matching failed — fall back to legacy resolveContactId
        console.warn('[classification] Matching agent error, falling back to legacy resolveContactId');
        const fallback = await resolveContactId({
          senderEmail,
          borrowerFirstName: classification.borrowerFirstName ?? null,
          borrowerLastName: classification.borrowerLastName ?? null,
        });
        contactId = fallback.contactId;
        break;
      }
    }

    // e. Check classification confidence threshold (FILE-05 + ORIG-02: low confidence -> Needs Review/)
    // This is SEPARATE from matching confidence — classification confidence measures doc type certainty
    if (classification.confidence < classificationConfig.confidenceThreshold) {
      console.log('[classification] Low confidence, routing to Needs Review:', {
        confidence: classification.confidence,
        threshold: classificationConfig.confidenceThreshold,
      });

      // ORIG-02: Save low-confidence doc to Needs Review/ folder
      let needsReviewFileId: string | null = null;
      let needsReviewFileLink: string | null = null;

      // Resolve client folder (needed for Needs Review/)
      let lowConfClientFolderId: string | null = clientFolderId;
      if (!lowConfClientFolderId && contactId) {
        try {
          const contact = await getContact(contactId);
          lowConfClientFolderId = getContactDriveFolderId(contact, crmConfig.driveFolderIdFieldId);
        } catch (err) {
          console.error('[classification] Failed to resolve contact folder for low-confidence doc (non-fatal):', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (!lowConfClientFolderId && classificationConfig.driveRootFolderId) {
        lowConfClientFolderId = classificationConfig.driveRootFolderId;
      }

      if (lowConfClientFolderId) {
        try {
          const drive = getDriveClient();
          const needsReviewFolderId = await findOrCreateFolder(drive, 'Needs Review', lowConfClientFolderId);
          needsReviewFileId = await uploadFile(drive, pdfBuffer, originalFilename, needsReviewFolderId);
          needsReviewFileLink = `https://drive.google.com/file/d/${needsReviewFileId}/view`;
          console.log('[classification] Saved to Needs Review:', {
            fileId: needsReviewFileId,
            filename: originalFilename,
          });

          // Also store a copy in Originals/ for the full audit trail
          await storeOriginal(drive, lowConfClientFolderId, pdfBuffer, originalFilename);
        } catch (err) {
          console.error('[classification] Failed to save to Needs Review (non-fatal):', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Create CRM task with filename and Drive link
      try {
        if (contactId) {
          const taskBody = needsReviewFileLink
            ? `File: ${originalFilename}\nDrive link: ${needsReviewFileLink}\n\nClassification uncertain (confidence: ${classification.confidence}). Best guess: ${classification.documentType}. Please review and file manually.`
            : `Classification uncertain (confidence: ${classification.confidence}). Best guess: ${classification.documentType}. Source: ${source}. Please review and file manually.`;

          await createReviewTask(
            contactId,
            `Manual Review: ${originalFilename}`,
            taskBody,
          );
        } else {
          console.warn('[classification] No CRM contact found for manual review task:', {
            hasEmail: !!senderEmail,
            applicationId,
          });
        }
      } catch (crmErr) {
        console.error('[classification] Failed to create manual review CRM task:', {
          error: crmErr instanceof Error ? crmErr.message : String(crmErr),
        });
      }

      // Clean up temp file
      await unlink(tempFilePath).catch(() => {});

      return {
        intakeDocumentId,
        classification,
        filed: false,
        driveFileId: needsReviewFileId,
        manualReview: true,
        error: null,
      };
    }

    // f. Resolve client Drive folder from CRM contact (DRIVE-02)
    let dealSubfolderId: string | null = null;
    let contact: CrmContact | null = null;

    if (!clientFolderId && contactId) {
      try {
        // Fetch contact ONCE — shared with tracking-sync later (DRIVE-02, rate limit optimization)
        contact = await getContact(contactId);
        clientFolderId = getContactDriveFolderId(contact, crmConfig.driveFolderIdFieldId);

        if (clientFolderId) {
          console.log('[classification] Resolved client folder from CRM contact:', {
            hasClientFolder: true,
          });
        }
      } catch (err) {
        console.error('[classification] Failed to read contact folder ID (non-fatal):', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (contactId) {
      // If we already have clientFolderId (from matching), still fetch contact for tracking
      try {
        contact = await getContact(contactId);
      } catch {
        // non-fatal
      }
    }

    // Fallback to global root folder (DRIVE-07)
    if (!clientFolderId && classificationConfig.driveRootFolderId) {
      clientFolderId = classificationConfig.driveRootFolderId;
      console.log('[classification] Using DRIVE_ROOT_FOLDER_ID fallback');
    }

    // If still no folder, route to manual review
    if (!clientFolderId) {
      console.warn('[classification] Cannot resolve client Drive folder, routing to manual review');
      try {
        if (contactId) {
          await createReviewTask(
            contactId,
            `Manual Review: ${originalFilename}`,
            `Could not resolve client Drive folder. Document type: ${classification.documentType}. ` +
              `Source: ${source}. Please file manually.`,
          );
        }
      } catch {
        // CRM task creation failure is non-fatal
      }
      await unlink(tempFilePath).catch(() => {});
      return {
        intakeDocumentId,
        classification,
        filed: false,
        driveFileId: null,
        manualReview: true,
        error: null,
      };
    }

    // For property-specific docs, resolve deal subfolder from opportunity (DRIVE-05)
    const isPropertySpecific = PROPERTY_SPECIFIC_TYPES.has(classification.documentType);

    if (isPropertySpecific && contactId && applicationId) {
      try {
        const opp = await findOpportunityByFinmoId(
          contactId,
          PIPELINE_IDS.LIVE_DEALS,
          applicationId,
        );
        if (opp) {
          const subfolderId = getOpportunityFieldValue(
            opp,
            crmConfig.oppDealSubfolderIdFieldId,
          );
          if (typeof subfolderId === 'string' && subfolderId.length > 0) {
            dealSubfolderId = extractDriveFolderId(subfolderId);
            console.log('[classification] Resolved deal subfolder from opportunity');
          }
        }
      } catch (err) {
        // Non-fatal: fall back to client folder for property-specific docs
        console.error('[classification] Failed to resolve deal subfolder (non-fatal):', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // g. Generate filename
    const fallbackName =
      classification.borrowerFirstName ?? originalFilename.replace(/\.[^.]+$/, '');
    const filename = generateFilename(classification, fallbackName);

    // h. Route to subfolder
    const subfolderTarget = routeToSubfolder(classification.documentType);
    const personName = getPersonSubfolderName(
      classification.borrowerFirstName,
      classification.borrowerLastName,
      'Borrower',
    );

    // i. Resolve target folder in Drive (DRIVE-04/DRIVE-05)
    const drive = getDriveClient();
    const baseFolderId = (isPropertySpecific && dealSubfolderId)
      ? dealSubfolderId   // Property-specific docs -> deal subfolder
      : clientFolderId;   // Reusable docs -> client folder

    // ORIG-01: Store original in Originals/ before classification/renaming (silent safety net)
    // Always stored at client folder level, not deal subfolder — per CONTEXT.md
    // Belt-and-suspenders try/catch: storeOriginal never throws, but if it somehow does, filing must continue
    try {
      await storeOriginal(drive, clientFolderId, pdfBuffer, originalFilename);
    } catch {
      // storeOriginal handles its own errors — this is a safety net for the safety net
    }

    const targetFolderId = await resolveTargetFolder(
      drive,
      baseFolderId,
      subfolderTarget,
      personName,
    );

    // j. Check for existing file (versioning — FILE-04)
    const docLabel =
      DOC_TYPE_LABELS[classification.documentType] ?? classification.documentType;
    const existing = await findExistingFile(drive, docLabel, targetFolderId);

    // k. Upload or update
    let driveFileId: string;
    if (existing) {
      await updateFileContent(drive, existing.id, pdfBuffer, filename);
      driveFileId = existing.id;
      console.log('[classification] Updated existing file:', {
        fileId: existing.id,
        filename,
      });
    } else {
      driveFileId = await uploadFile(drive, pdfBuffer, filename, targetFolderId);
      console.log('[classification] Uploaded new file:', {
        fileId: driveFileId,
        filename,
      });
    }

    // l. CRM note for auto_filed (MATCH-03): informational note, not task
    if (matchDecision.outcome === 'auto_filed' && contactId) {
      try {
        await createCrmNote(
          contactId,
          `${DOC_TYPE_LABELS[classification.documentType] ?? classification.documentType} filed to ${classification.borrowerFirstName ?? 'client'}'s folder. ` +
          `Matched: ${matchDecision.reasoning} (confidence: ${matchDecision.confidence.toFixed(2)})\n\n` +
          `[Automated by Venture Mortgages Doc System]`,
        );
      } catch {
        // CRM note creation is non-fatal
      }
    }

    // m. Update CRM tracking (Phase 8 — non-fatal)
    if (senderEmail || contactId) {
      try {
        const trackingResult = await updateDocTracking({
          senderEmail: senderEmail ?? '',
          documentType: classification.documentType,
          driveFileId,
          source,
          receivedAt: job.data.receivedAt,
          ...(contactId ? { contactId } : {}),
          finmoApplicationId: applicationId ?? undefined,
          prefetchedContact: contact ?? undefined,
        });

        if (trackingResult.updated) {
          console.log('[classification] CRM tracking updated:', {
            contactId: trackingResult.contactId,
            opportunityId: trackingResult.opportunityId,
            trackingTarget: trackingResult.trackingTarget,
            newStatus: trackingResult.newStatus,
            crossDealUpdates: trackingResult.crossDealUpdates,
          });
        } else {
          console.log('[classification] CRM tracking skipped:', {
            reason: trackingResult.reason,
          });
        }

        if (trackingResult.errors.length > 0) {
          console.warn('[classification] Tracking partial errors:', {
            errors: trackingResult.errors,
          });
        }
      } catch (trackingErr) {
        // Tracking failure is NON-FATAL — doc is already filed to Drive
        console.error('[classification] Tracking update failed:', {
          error: trackingErr instanceof Error ? trackingErr.message : String(trackingErr),
          intakeDocumentId,
        });
      }
    }

    // n. Clean up temp file
    await unlink(tempFilePath).catch(() => {});

    // o. Return result
    return {
      intakeDocumentId,
      classification,
      filed: true,
      driveFileId,
      manualReview: false,
      error: null,
    };
  } catch (err) {
    // Top-level catch: log error metadata (no PII), clean up temp file
    console.error('[classification] Pipeline error:', {
      error: err instanceof Error ? err.message : String(err),
      intakeDocumentId,
      source,
    });

    // Clean up temp file even on error
    await unlink(tempFilePath).catch(() => {});

    return {
      intakeDocumentId,
      classification: null,
      filed: false,
      driveFileId: null,
      manualReview: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Classification Worker (Lazy Singleton)
// ---------------------------------------------------------------------------

let _worker: Worker<ClassificationJobData, ClassificationJobResult> | null = null;

/**
 * Create and start the classification BullMQ worker (lazy singleton).
 *
 * Listens on the doc-classification queue with concurrency 1.
 * Logs completed and failed events for observability.
 */
export function createClassificationWorker(): Worker<
  ClassificationJobData,
  ClassificationJobResult
> {
  if (_worker) return _worker;

  _worker = new Worker<ClassificationJobData, ClassificationJobResult>(
    CLASSIFICATION_QUEUE_NAME,
    processClassificationJob,
    {
      connection: createRedisConnection(),
      concurrency: 1,
    },
  );

  _worker.on('completed', (job) => {
    console.log(`[classification-worker] Job ${job.id} completed`, {
      intakeDocumentId: job.data.intakeDocumentId,
      filed: job.returnvalue?.filed,
      manualReview: job.returnvalue?.manualReview,
    });
  });

  _worker.on('failed', (job, err) => {
    console.error(`[classification-worker] Job ${job?.id} failed`, {
      intakeDocumentId: job?.data?.intakeDocumentId,
      error: err.message,
      attempt: job?.attemptsMade,
    });
  });

  console.log(
    '[classification-worker] Started, listening for jobs on queue:',
    CLASSIFICATION_QUEUE_NAME,
  );
  return _worker;
}

/**
 * Close the classification worker for graceful shutdown.
 * Resets the singleton so a new worker can be created if needed.
 */
export async function closeClassificationWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
