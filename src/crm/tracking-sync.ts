// ============================================================================
// Tracking Sync Orchestrator — Document-received CRM updates (Phase 8)
// ============================================================================
//
// The single function that takes a document receipt event and performs all CRM
// updates: reads the contact's current tracking fields, moves the matched doc
// from missingDocs to receivedDocs, increments counters, writes updated fields,
// creates an audit note, and triggers milestone actions (PRE readiness task,
// pipeline advance to All Docs Received).
//
// Pattern: critical operations (field update) vs non-critical (notes, tasks,
// pipeline). Non-critical failures are captured in errors[] but do not prevent
// the result from being `updated: true`.
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
import { moveToAllDocsReceived } from './opportunities.js';
import { crmConfig } from './config.js';
import type { CrmConfig } from './config.js';
import type { MissingDocEntry, CrmContact } from './types/index.js';
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
}

export interface TrackingUpdateResult {
  updated: boolean;
  reason?: 'no-contact' | 'no-match-in-checklist' | 'already-received';
  contactId?: string;
  newStatus?: string;
  noteId?: string;
  errors: string[];
}

// ============================================================================
// Pure helper — parse tracking fields from contact custom fields
// ============================================================================

/** Parsed tracking field values from a CRM contact's customFields array */
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

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Updates CRM tracking fields when a document is classified and filed.
 *
 * This is the Phase 8 capstone orchestrator. It reads the contact's current
 * tracking state, finds the matching checklist doc, updates fields (moves
 * doc from missing to received, increments counters, recomputes status),
 * creates an audit note, and triggers milestone actions.
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
  const fieldIds = crmConfig.fieldIds;

  // 1. Find contact by email (or use pre-resolved contactId)
  const contactId = input.contactId ?? await findContactByEmail(input.senderEmail);
  if (!contactId) {
    return { updated: false, reason: 'no-contact', errors: [] };
  }

  // 2. Get contact record with current custom field values
  const contact = await getContact(contactId);

  // 3. Parse current tracking field values
  const fields = parseContactTrackingFields(contact, fieldIds);

  // 4. Find matching checklist doc
  const matchedDoc = findMatchingChecklistDoc(input.documentType, fields.missingDocs);
  if (!matchedDoc) {
    return { updated: false, reason: 'no-match-in-checklist', errors: [] };
  }

  // 5. Check if already received (prevent duplicate tracking on re-uploads)
  if (fields.receivedDocs.includes(matchedDoc.name)) {
    return { updated: false, reason: 'already-received', errors: [] };
  }

  // 6. Compute new field values
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

  // 7. Write updated fields to contact (human-readable format)
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

  // 8. Create audit note (non-critical)
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

  // 9. Trigger milestone actions (non-critical)
  if (newStatus === 'PRE Complete') {
    try {
      await createPreReadinessTask(contactId, `${contact.firstName} ${contact.lastName}`);
    } catch (err) {
      errors.push(`PRE readiness task failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (newStatus === 'All Complete') {
    try {
      await moveToAllDocsReceived(contactId, `${contact.firstName} ${contact.lastName}`);
    } catch (err) {
      errors.push(`Pipeline advance failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 10. Return result
  return {
    updated: true,
    contactId,
    newStatus,
    noteId,
    errors,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Safely parse a numeric value, returning defaultValue on failure */
function parseNumeric(value: unknown, defaultValue: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}
