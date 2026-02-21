/**
 * Classification Worker — BullMQ Document Classification Pipeline
 *
 * Processes jobs from the doc-classification queue, orchestrating:
 * 1. Read PDF from temp file
 * 2. Classify document via Claude API
 * 3. Check confidence threshold (low -> CRM manual review task)
 * 4. Resolve client Drive folder (best-effort via CRM contact lookup)
 * 5. Generate filename (Cat's naming convention)
 * 6. Route to correct subfolder
 * 7. File to Google Drive (upload or update existing)
 * 8. Clean up temp file
 *
 * Error handling is per-stage: classification failure, Drive failure, and CRM
 * failure are each caught independently. Temp files are cleaned up in all paths.
 *
 * Implements:
 * - FILE-05: Low confidence -> manual review via CRM task
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
import { resolveTargetFolder, uploadFile, findExistingFile, updateFileContent } from './filer.js';
import { resolveContactId } from '../crm/contacts.js';
import { createReviewTask } from '../crm/tasks.js';
import { updateDocTracking } from '../crm/tracking-sync.js';
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

    // c. Resolve CRM contact (once — email first, name fallback)
    const resolved = await resolveContactId({
      senderEmail,
      borrowerFirstName: classification.borrowerFirstName ?? null,
      borrowerLastName: classification.borrowerLastName ?? null,
    });

    const contactId = resolved.contactId;
    console.log('[classification] Contact resolution:', {
      resolvedVia: resolved.resolvedVia,
      hasContactId: !!contactId,
    });

    // d. Check confidence threshold (FILE-05: low confidence -> manual review)
    if (classification.confidence < classificationConfig.confidenceThreshold) {
      console.log('[classification] Low confidence, routing to manual review:', {
        confidence: classification.confidence,
        threshold: classificationConfig.confidenceThreshold,
      });

      try {
        if (contactId) {
          await createReviewTask(
            contactId,
            `Manual Review: ${originalFilename}`,
            `Classification uncertain (confidence: ${classification.confidence}). ` +
              `Best guess: ${classification.documentType}. Source: ${source}. ` +
              `Please review and file manually.`,
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
        driveFileId: null,
        manualReview: true,
        error: null,
      };
    }

    // e. Resolve client Drive folder
    // TODO: Phase 8 will add a CRM custom field for Drive folder ID.
    // For now, use driveRootFolderId as fallback.
    let clientFolderId: string | null = null;

    if (contactId) {
      clientFolderId = classificationConfig.driveRootFolderId || null;
    }

    // Fallback: use Drive root folder if available
    if (!clientFolderId && classificationConfig.driveRootFolderId) {
      clientFolderId = classificationConfig.driveRootFolderId;
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

    // e. Generate filename
    const fallbackName =
      classification.borrowerFirstName ?? originalFilename.replace(/\.[^.]+$/, '');
    const filename = generateFilename(classification, fallbackName);

    // f. Route to subfolder
    const subfolderTarget = routeToSubfolder(classification.documentType);
    const personName = getPersonSubfolderName(
      classification.borrowerFirstName,
      classification.borrowerLastName,
      'Borrower',
    );

    // g. Resolve target folder in Drive
    const drive = getDriveClient();
    const targetFolderId = await resolveTargetFolder(
      drive,
      clientFolderId,
      subfolderTarget,
      personName,
    );

    // h. Check for existing file (versioning — FILE-04)
    const docLabel =
      DOC_TYPE_LABELS[classification.documentType] ?? classification.documentType;
    const existing = await findExistingFile(drive, docLabel, targetFolderId);

    // i. Upload or update
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

    // j. Update CRM tracking (Phase 8 — non-fatal)
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

    // k. Clean up temp file
    await unlink(tempFilePath).catch(() => {});

    // l. Return result
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
