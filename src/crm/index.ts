// ============================================================================
// CRM Module — Barrel Export
// ============================================================================
//
// Public API for the CRM integration module. All downstream consumers should
// import from this barrel rather than individual files.
//
// NOT exported:
// - GHL SDK client (src/crm/client.ts) — internal implementation detail
// - Setup scripts (src/crm/setup/) — one-time utilities, not runtime code
// - Error classes (src/crm/errors.ts) — used internally by service modules

// CRM types and constants
export type {
  CrmCustomFieldUpdate,
  CrmContactUpsertInput,
  CrmTaskInput,
  CrmOpportunityInput,
  CrmContact,
  MissingDocEntry,
  CrmNoteInput,
  CrmOpportunity,
  CrmOpportunityCustomField,
} from './types/index.js';

export {
  EXISTING_FIELDS,
  FIELD_GROUP_ID,
  PIPELINE_IDS,
  LOCATION_ID,
  DOC_TRACKING_FIELD_DEFS,
  EXISTING_OPP_FIELDS,
  OPP_DOC_TRACKING_FIELD_DEFS,
  OPP_FIELD_GROUP_ID,
} from './types/index.js';

// Configuration
export { crmConfig, validateConfig } from './config.js';
export type { CrmConfig } from './config.js';

// CRM services
export { upsertContact, findContactByEmail, findContactByName, resolveContactId, getContact } from './contacts.js';
export type { ResolveContactResult } from './contacts.js';
export { createAuditNote } from './notes.js';
export { createReviewTask, createPreReadinessTask, addBusinessDays } from './tasks.js';
export {
  searchOpportunities,
  getOpportunity,
  updateOpportunityFields,
  updateOpportunityStage,
  findOpportunityByFinmoId,
  getOpportunityFieldValue,
} from './opportunities.js';

// Checklist-to-CRM mapper
export {
  mapChecklistToFields,
  mapChecklistToDocNames,
  mapChecklistToDocEntries,
  computeDocStatus,
  buildChecklistSummary,
} from './checklist-mapper.js';

// Doc-type matcher — bridges classifier output to checklist document names
export { findMatchingChecklistDoc } from './doc-type-matcher.js';

// Tracking sync orchestrator (Phase 8) — document-received CRM updates
export { updateDocTracking, parseContactTrackingFields, parseOpportunityTrackingFields } from './tracking-sync.js';
export type { TrackingUpdateInput, TrackingUpdateResult } from './tracking-sync.js';

// Orchestrator — main entry point for webhook handler
export { syncChecklistToCrm } from './checklist-sync.js';
export type { SyncChecklistInput, SyncChecklistResult } from './checklist-sync.js';
