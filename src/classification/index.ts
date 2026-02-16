// ============================================================================
// Classification Module — Barrel Export
// ============================================================================
//
// Public API for the document classification & filing module (Phase 7).
// All downstream consumers should import from this barrel rather than
// individual files.
//
// Provides:
// - Type definitions for document types, classification results, filing decisions
// - Configuration (Anthropic key, confidence threshold, Drive settings, kill switch)
// - Classifier (Claude API with structured output)
// - Naming (Cat's filename convention)
// - Router (document type -> subfolder mapping)
// - Drive client (OAuth2 / service account)
// - Filer (folder resolution, file upload, versioning)
// - Classification worker (BullMQ pipeline orchestrator)

// Types (type-only exports)
export type {
  DocumentType,
  ClassificationResult,
  SubfolderTarget,
  FilingDecision,
  ClassificationJobData,
  ClassificationJobResult,
} from './types.js';

// Constants
export {
  DOCUMENT_TYPES,
  SUBFOLDER_ROUTING,
  DOC_TYPE_LABELS,
  ClassificationResultSchema,
} from './types.js';

// Config
export { classificationConfig } from './config.js';
export type { ClassificationConfig } from './config.js';

// Classifier
export { classifyDocument } from './classifier.js';

// Naming
export { generateFilename, sanitizeFilename } from './naming.js';

// Router
export { routeToSubfolder, getPersonSubfolderName } from './router.js';

// Drive client
export { getDriveClient } from './drive-client.js';
export type { DriveClient } from './drive-client.js';

// Filer
export {
  findFolder,
  findOrCreateFolder,
  uploadFile,
  findExistingFile,
  updateFileContent,
  resolveTargetFolder,
} from './filer.js';

// Classification worker
export {
  CLASSIFICATION_QUEUE_NAME,
  processClassificationJob,
  createClassificationWorker,
  closeClassificationWorker,
} from './classification-worker.js';
