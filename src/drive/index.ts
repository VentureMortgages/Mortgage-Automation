// ============================================================================
// Drive Module — Barrel Export
// ============================================================================
//
// Drive folder scanning, document expiry rules, and checklist filtering
// for the "returning client" optimization.

// Folder scanner
export {
  listClientFolderFiles,
  parseDocFromFilename,
  resolveDocumentType,
  scanClientFolder,
  extractDealReference,
} from './folder-scanner.js';
export type { DriveFileEntry, ParsedDoc, ExistingDoc } from './folder-scanner.js';

// Document expiry
export { isDocStillValid, PROPERTY_SPECIFIC_TYPES } from './doc-expiry.js';

// Checklist filter
export { filterChecklistByExistingDocs } from './checklist-filter.js';
export type { AlreadyOnFileDoc, FilterResult } from './checklist-filter.js';
