// ============================================================================
// Intake Module — Barrel Export
// ============================================================================
//
// Public API for the document intake module (Phase 6). All downstream
// consumers should import from this barrel rather than individual files.
//
// Provides:
// - Type definitions for IntakeDocument, jobs, and results
// - Configuration (polling interval, max size, MIME types)
// - Gmail inbox reading (polling, message details, historyId seeding)
// - Attachment extraction (MIME part walking, download, decode)
// - PDF conversion (images to PDF, passthrough, error handling)
// - Gmail monitor (BullMQ job scheduler for periodic polling)
// - Finmo document handler (webhook endpoint for doc uploads)
// - Intake worker (BullMQ worker for processing pipeline)

// Types (type-only exports)
export type {
  IntakeDocument,
  IntakeJobData,
  IntakeResult,
  IntakeSource,
  GmailMessageMeta,
  AttachmentInfo,
  ConversionStrategy,
} from './types.js';

// Config
export { intakeConfig, SUPPORTED_MIME_TYPES, getConversionStrategy } from './config.js';
export type { IntakeConfig } from './config.js';

// Gmail reading
export { pollForNewMessages, getMessageDetails, getInitialHistoryId } from './gmail-reader.js';

// Attachment extraction
export { extractAttachments, downloadAttachment } from './attachment-extractor.js';

// PDF conversion
export { convertToPdf, ConversionError } from './pdf-converter.js';
export type { ConversionResult } from './pdf-converter.js';

// Gmail monitor
export { startGmailMonitor, getIntakeQueue, closeIntakeQueue, INTAKE_QUEUE_NAME } from './gmail-monitor.js';

// History ID persistence
export { getStoredHistoryId, storeHistoryId } from './gmail-monitor.js';

// Finmo document handler
export { finmoDocumentHandler } from './finmo-docs.js';

// Finmo document download
export {
  downloadFinmoDocument,
  isDocRequestProcessed,
  markDocRequestProcessed,
} from './finmo-downloader.js';
export type { FinmoDownloadResult } from './finmo-downloader.js';

// Intake worker
export { createIntakeWorker, processIntakeJob, closeIntakeWorker } from './intake-worker.js';
