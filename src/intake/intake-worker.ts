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
 * - Stub implementation (returns not-implemented error)
 * - Finmo document download requires undocumented API endpoint
 * - Will be implemented when payload format is confirmed via live testing
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
 * Consumers: BullMQ scheduler (gmail-monitor.ts triggers polls)
 */

import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../webhook/queue.js';
import { intakeConfig, getConversionStrategy } from './config.js';
import { getGmailReadonlyClient } from '../email/gmail-client.js';
import { getMessageDetails } from './gmail-reader.js';
import { extractAttachments, downloadAttachment } from './attachment-extractor.js';
import { convertToPdf, ConversionError } from './pdf-converter.js';
import { INTAKE_QUEUE_NAME } from './gmail-monitor.js';
import type { IntakeJobData, IntakeResult, IntakeDocument } from './types.js';

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
  if (!messageId) {
    return {
      documentsProcessed: 0,
      documentIds: [],
      errors: ['Gmail source job missing gmailMessageId'],
    };
  }

  const gmailClient = getGmailReadonlyClient(intakeConfig.docsInbox);
  const errors: string[] = [];
  const documentIds: string[] = [];

  // 1. Get message metadata (sender, subject, date)
  const messageMeta = await getMessageDetails(gmailClient, messageId);

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

  // 4. Process each valid attachment
  // TODO Phase 7: enqueue IntakeDocument to classification queue
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
// Finmo Source Processing (Stub)
// ---------------------------------------------------------------------------

async function processFinmoSource(_job: Job<IntakeJobData>): Promise<IntakeResult> {
  // Finmo document download requires API calls to /api/v1/document-requests/files
  // which is undocumented. Phase 6 detects the webhook event and enqueues it.
  // Actual file download will be implemented when Finmo payload format is confirmed.
  console.log(
    '[intake] Finmo document intake not yet implemented (INTAKE-02). Enqueued for future processing.',
  );

  return {
    documentsProcessed: 0,
    documentIds: [],
    errors: ['Finmo document download not implemented'],
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
