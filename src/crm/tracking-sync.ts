// ============================================================================
// Tracking Sync Orchestrator — Document-received CRM updates (Phase 8 + 10)
// ============================================================================
//
// The single function that takes a document receipt event and performs all CRM
// updates. Phase 10 migrates tracking from contacts to opportunities:
//
// 1. Resolve contact (email or pre-resolved contactId)
// 2. Search for open opportunities in the Live Deals pipeline
// 3. Determine tracking strategy:
//    - Reusable docs (T4, pay stub, bank statement, ID) → update ALL open opportunities
//    - Property-specific docs (purchase agreement, MLS) → update only the matched opportunity
// 4. For each target opportunity: read tracking fields, match doc, update fields
// 5. Trigger milestones: PRE readiness task (once), pipeline stage advance (per-opp)
// 6. Create audit note on contact (once, not per-opportunity)
//
// Fallback: if no opportunities exist, falls back to contact-level tracking
// (old Phase 8 behavior) for backward compatibility.
//
// PII safety: Only document type names and status labels are written. No
// borrower names, income amounts, SIN numbers in log output.

import { findContactByEmail, getContact, upsertContact } from './contacts.js';
import { createAuditNote } from './notes.js';
import { findMatchingChecklistDoc } from './doc-type-matcher.js';
import {
  computeDocStatus,
  formatMissingDocsForCrm,
  formatReceivedDocsForCrm,
  parseMissingDocsText,
  parseReceivedDocsText,
} from './checklist-mapper.js';
import type { DocEntry } from './checklist-mapper.js';
import { createPreReadinessTask } from './tasks.js';
import {
  searchOpportunities,
  getOpportunity,
  updateOpportunityFields,
  updateOpportunityStage,
  getOpportunityFieldValue,
} from './opportunities.js';
import { PROPERTY_SPECIFIC_TYPES } from '../drive/doc-expiry.js';
import { crmConfig } from './config.js';
import type { CrmConfig } from './config.js';
import { PIPELINE_IDS, EXISTING_OPP_FIELDS } from './types/index.js';
import type { MissingDocEntry, CrmContact, CrmOpportunity } from './types/index.js';
import type { DocumentType } from '../classification/types.js';

// ============================================================================
// Types
// ============================================================================

export interface TrackingUpdateInput {
  senderEmail: string;
  documentType: DocumentType;
  driveFileId: string;
  source: 'gmail' | 'finmo';
  receivedAt: string;
  /** Pre-resolved contact ID — skips email lookup when provided */
  contactId?: string;
  /** Finmo application UUID — for finding the right opportunity (property-specific docs) */
  finmoApplicationId?: string;
}

export interface TrackingUpdateResult {
  updated: boolean;
  reason?: 'no-contact' | 'no-match-in-checklist' | 'already-received' | 'ambiguous-deal';
  contactId?: string;
  /** ID of the first (or only) opportunity updated */
  opportunityId?: string;
  /** Where tracking was written: opportunity (preferred) or contact (fallback) */
  trackingTarget?: 'opportunity' | 'contact';
  /** Number of opportunities updated (for reusable docs that fan out) */
  crossDealUpdates?: number;
  newStatus?: string;
  noteId?: string;
  errors: string[];
}

// ============================================================================
// Pure helper — parse tracking fields from contact custom fields
// ============================================================================

/** Parsed tracking field values from a CRM contact or opportunity's custom fields */
export interface ParsedTrackingFields {
  missingDocs: MissingDocEntry[];
  receivedDocs: string[];
  preDocsTotal: number;
  preDocsReceived: number;
  fullDocsTotal: number;
  fullDocsReceived: number;
}

/**
 * Extracts and parses tracking field values from a CRM contact record.
 *
 * Pure function for testability. Handles missing fields (defaults to
 * empty/zero), and supports both legacy JSON and new text formats
 * for missingDocs/receivedDocs fields (backward compatible).
 *
 * @param contact - The CRM contact record with customFields
 * @param fieldIds - The field ID mapping from config
 * @returns Parsed tracking field values with safe defaults
 */
export function parseContactTrackingFields(
  contact: CrmContact,
  fieldIds: CrmConfig['fieldIds'],
): ParsedTrackingFields {
  const fieldMap = new Map(
    contact.customFields.map((f) => [f.id, f.value]),
  );

  // Parse missingDocs/receivedDocs — supports both JSON and text formats
  const missingDocs = parseMissingDocsText(
    fieldMap.get(fieldIds.missingDocs),
  ) as MissingDocEntry[];
  const receivedDocs = parseReceivedDocsText(
    fieldMap.get(fieldIds.receivedDocs),
  );

  // Parse numeric fields with safe defaults
  const preDocsTotal = parseNumeric(fieldMap.get(fieldIds.preDocsTotal), 0);
  const preDocsReceived = parseNumeric(fieldMap.get(fieldIds.preDocsReceived), 0);
  const fullDocsTotal = parseNumeric(fieldMap.get(fieldIds.fullDocsTotal), 0);
  const fullDocsReceived = parseNumeric(fieldMap.get(fieldIds.fullDocsReceived), 0);

  return {
    missingDocs,
    receivedDocs,
    preDocsTotal,
    preDocsReceived,
    fullDocsTotal,
    fullDocsReceived,
  };
}

/**
 * Extracts and parses tracking field values from a CRM opportunity record.
 *
 * Similar to parseContactTrackingFields but uses the opportunity-specific
 * custom field format (fieldValueString/fieldValueNumber/fieldValueDate)
 * via getOpportunityFieldValue().
 *
 * @param opp - The CRM opportunity record with customFields
 * @param fieldIds - The opportunity field ID mapping from config
 * @returns Parsed tracking field values with safe defaults
 */
export function parseOpportunityTrackingFields(
  opp: CrmOpportunity,
  fieldIds: CrmConfig['opportunityFieldIds'],
): ParsedTrackingFields {
  // Parse missingDocs/receivedDocs — opportunity fields store strings
  const missingDocsRaw = getOpportunityFieldValue(opp, fieldIds.missingDocs);
  const receivedDocsRaw = getOpportunityFieldValue(opp, fieldIds.receivedDocs);

  const missingDocs = parseMissingDocsText(
    typeof missingDocsRaw === 'string' ? missingDocsRaw : undefined,
  ) as MissingDocEntry[];
  const receivedDocs = parseReceivedDocsText(
    typeof receivedDocsRaw === 'string' ? receivedDocsRaw : undefined,
  );

  // Parse numeric fields with safe defaults
  const preDocsTotal = parseNumericValue(
    getOpportunityFieldValue(opp, fieldIds.preDocsTotal), 0,
  );
  const preDocsReceived = parseNumericValue(
    getOpportunityFieldValue(opp, fieldIds.preDocsReceived), 0,
  );
  const fullDocsTotal = parseNumericValue(
    getOpportunityFieldValue(opp, fieldIds.fullDocsTotal), 0,
  );
  const fullDocsReceived = parseNumericValue(
    getOpportunityFieldValue(opp, fieldIds.fullDocsReceived), 0,
  );

  return {
    missingDocs,
    receivedDocs,
    preDocsTotal,
    preDocsReceived,
    fullDocsTotal,
    fullDocsReceived,
  };
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Updates CRM tracking fields when a document is classified and filed.
 *
 * Phase 10: reads/writes tracking fields on opportunities (not contacts).
 * Reusable docs update ALL open opportunities for the contact.
 * Property-specific docs update only the matched opportunity.
 * Falls back to contact-level tracking when no opportunities exist.
 *
 * Non-fatal errors (audit note, PRE task, pipeline advance) are captured
 * in the errors[] array but do not prevent the result from being updated=true.
 *
 * @param input - Document receipt event details
 * @returns Result with updated status, or reason for skipping
 */
export async function updateDocTracking(
  input: TrackingUpdateInput,
): Promise<TrackingUpdateResult> {
  const errors: string[] = [];
  const oppFieldIds = crmConfig.opportunityFieldIds;

  // 1. Resolve contact (email or pre-resolved contactId)
  const contactId = input.contactId ?? await findContactByEmail(input.senderEmail);
  if (!contactId) {
    return { updated: false, reason: 'no-contact', errors: [] };
  }

  // 2. Get contact record (needed for borrower name in milestones + audit)
  const contact = await getContact(contactId);

  // 3. Search for open opportunities in Live Deals pipeline
  const allOpportunities = await searchOpportunities(contactId, PIPELINE_IDS.LIVE_DEALS);
  const openOpportunities = allOpportunities.filter((o) => o.status === 'open');

  // 4. If no open opportunities: fall back to contact-level tracking
  if (openOpportunities.length === 0) {
    console.warn('[tracking-sync] No open opportunities found, falling back to contact-level tracking');
    return updateDocTrackingOnContact(input, contact, contactId, errors);
  }

  // 5. Determine tracking strategy based on document type
  const isPropertySpecific = PROPERTY_SPECIFIC_TYPES.has(input.documentType);

  let targetOpportunities: CrmOpportunity[];

  if (isPropertySpecific) {
    // Single-deal mode: find the specific opportunity
    const matched = resolveTargetOpportunity(openOpportunities, input.finmoApplicationId);
    if (!matched) {
      // Ambiguous: multiple opportunities, can't determine which one
      return {
        updated: false,
        reason: 'ambiguous-deal',
        contactId,
        errors: [],
      };
    }
    targetOpportunities = [matched];
  } else {
    // Cross-deal mode: update ALL open opportunities
    targetOpportunities = openOpportunities;
  }

  // 6. Process each target opportunity
  let firstOpportunityId: string | undefined;
  let firstNewStatus: string | undefined;
  let firstMatchedDocName: string | undefined;
  let updatedCount = 0;
  let preTaskCreated = false;

  for (const opp of targetOpportunities) {
    // Fetch full opportunity (search results may not include custom fields)
    const fullOpp = await getOpportunity(opp.id);

    // Parse current tracking fields
    const fields = parseOpportunityTrackingFields(fullOpp, oppFieldIds);

    // Find matching checklist doc
    const matchedDoc = findMatchingChecklistDoc(input.documentType, fields.missingDocs);
    if (!matchedDoc) {
      // This doc type is not in this opportunity's checklist -- skip
      continue;
    }

    // Check if already received
    if (fields.receivedDocs.includes(matchedDoc.name)) {
      continue;
    }

    // Compute new field values
    const updatedMissing = fields.missingDocs.filter((d) => d.name !== matchedDoc.name);
    const updatedReceived = [...fields.receivedDocs, matchedDoc.name];

    let newPreReceived = fields.preDocsReceived;
    let newFullReceived = fields.fullDocsReceived;

    if (matchedDoc.stage === 'PRE') {
      newPreReceived += 1;
    } else if (matchedDoc.stage === 'FULL') {
      newFullReceived += 1;
    }
    // LATER, CONDITIONAL, LENDER_CONDITION: don't increment either counter

    const newStatus = computeDocStatus(
      fields.preDocsTotal,
      newPreReceived,
      fields.fullDocsTotal,
      newFullReceived,
    );

    // Write updated fields to opportunity
    await updateOpportunityFields(opp.id, [
      { id: oppFieldIds.missingDocs, field_value: formatMissingDocsForCrm(updatedMissing) },
      { id: oppFieldIds.receivedDocs, field_value: formatReceivedDocsForCrm(updatedReceived) },
      { id: oppFieldIds.preDocsReceived, field_value: newPreReceived },
      { id: oppFieldIds.fullDocsReceived, field_value: newFullReceived },
      { id: oppFieldIds.docStatus, field_value: newStatus },
      { id: oppFieldIds.lastDocReceived, field_value: new Date().toISOString().split('T')[0] },
    ]);

    updatedCount++;
    if (!firstOpportunityId) {
      firstOpportunityId = opp.id;
      firstNewStatus = newStatus;
      firstMatchedDocName = matchedDoc.name;
    }

    // Milestone: pipeline stage advance (per-opportunity)
    if (newStatus === 'All Complete') {
      try {
        await updateOpportunityStage(opp.id, crmConfig.stageIds.allDocsReceived);
      } catch (err) {
        errors.push(`Pipeline advance failed for opp ${opp.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Milestone: PRE readiness task (only ONCE across all opportunities)
    if (newStatus === 'PRE Complete' && !preTaskCreated) {
      try {
        await createPreReadinessTask(contactId, `${contact.firstName} ${contact.lastName}`);
        preTaskCreated = true;
      } catch (err) {
        errors.push(`PRE readiness task failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 7. If no opportunities were actually updated (doc not in any checklist)
  if (updatedCount === 0) {
    return {
      updated: false,
      reason: 'no-match-in-checklist',
      contactId,
      errors: [],
    };
  }

  // 8. Create audit note on CONTACT (once, not per-opportunity)
  let noteId: string | undefined;
  try {
    noteId = await createAuditNote(contactId, {
      documentType: firstMatchedDocName!,
      source: input.source,
      driveFileId: input.driveFileId,
    });
  } catch (err) {
    errors.push(`Audit note failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 9. Return result
  return {
    updated: true,
    contactId,
    opportunityId: firstOpportunityId,
    trackingTarget: 'opportunity',
    crossDealUpdates: updatedCount,
    newStatus: firstNewStatus,
    noteId,
    errors,
  };
}

// ============================================================================
// Contact-level fallback (when no opportunities exist)
// ============================================================================

/**
 * Original Phase 8 contact-level tracking path.
 * Used when the contact has no open opportunities in the Live Deals pipeline.
 */
async function updateDocTrackingOnContact(
  input: TrackingUpdateInput,
  contact: CrmContact,
  contactId: string,
  errors: string[],
): Promise<TrackingUpdateResult> {
  const fieldIds = crmConfig.fieldIds;

  // Parse current tracking field values from contact
  const fields = parseContactTrackingFields(contact, fieldIds);

  // Find matching checklist doc
  const matchedDoc = findMatchingChecklistDoc(input.documentType, fields.missingDocs);
  if (!matchedDoc) {
    return { updated: false, reason: 'no-match-in-checklist', errors: [] };
  }

  // Check if already received
  if (fields.receivedDocs.includes(matchedDoc.name)) {
    return { updated: false, reason: 'already-received', errors: [] };
  }

  // Compute new field values
  const updatedMissing = fields.missingDocs.filter((d) => d.name !== matchedDoc.name);
  const updatedReceived = [...fields.receivedDocs, matchedDoc.name];

  let newPreReceived = fields.preDocsReceived;
  let newFullReceived = fields.fullDocsReceived;

  if (matchedDoc.stage === 'PRE') {
    newPreReceived += 1;
  } else if (matchedDoc.stage === 'FULL') {
    newFullReceived += 1;
  }

  const newStatus = computeDocStatus(
    fields.preDocsTotal,
    newPreReceived,
    fields.fullDocsTotal,
    newFullReceived,
  );

  // Write updated fields to contact
  await upsertContact({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    customFields: [
      { id: fieldIds.missingDocs, field_value: formatMissingDocsForCrm(updatedMissing) },
      { id: fieldIds.receivedDocs, field_value: formatReceivedDocsForCrm(updatedReceived) },
      { id: fieldIds.preDocsReceived, field_value: newPreReceived },
      { id: fieldIds.fullDocsReceived, field_value: newFullReceived },
      { id: fieldIds.docStatus, field_value: newStatus },
      { id: fieldIds.lastDocReceived, field_value: new Date().toISOString().split('T')[0] },
    ],
  });

  // Audit note (non-critical)
  let noteId: string | undefined;
  try {
    noteId = await createAuditNote(contactId, {
      documentType: matchedDoc.name,
      source: input.source,
      driveFileId: input.driveFileId,
    });
  } catch (err) {
    errors.push(`Audit note failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Milestone actions (non-critical)
  if (newStatus === 'PRE Complete') {
    try {
      await createPreReadinessTask(contactId, `${contact.firstName} ${contact.lastName}`);
    } catch (err) {
      errors.push(`PRE readiness task failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (newStatus === 'All Complete') {
    // Contact fallback doesn't have an opportunity ID; skip pipeline stage update
    // (no opportunity to advance)
  }

  return {
    updated: true,
    contactId,
    trackingTarget: 'contact',
    newStatus,
    noteId,
    errors,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Resolves the target opportunity for a property-specific document.
 *
 * Strategy:
 * - If finmoApplicationId provided: find the opportunity with matching Finmo App ID field
 * - If only one opportunity: use it (unambiguous)
 * - If multiple opportunities and no finmoApplicationId: return null (ambiguous)
 */
function resolveTargetOpportunity(
  opportunities: CrmOpportunity[],
  finmoApplicationId?: string,
): CrmOpportunity | null {
  if (opportunities.length === 1) {
    return opportunities[0];
  }

  if (!finmoApplicationId) {
    return null; // ambiguous — multiple deals, can't determine which
  }

  // Match by Finmo Application ID custom field
  const match = opportunities.find((opp) => {
    const fieldValue = getOpportunityFieldValue(opp, EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID);
    return fieldValue === finmoApplicationId;
  });

  return match ?? null;
}

/** Safely parse a numeric value, returning defaultValue on failure */
function parseNumeric(value: unknown, defaultValue: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/** Parse a value from getOpportunityFieldValue into a number */
function parseNumericValue(value: string | number | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}
