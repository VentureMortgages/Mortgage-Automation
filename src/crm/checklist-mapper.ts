// ============================================================================
// Checklist-to-CRM Field Mapper — Pure transformation functions
// ============================================================================
//
// Transforms Phase 3 GeneratedChecklist output into CRM custom field update
// payloads for MyBrokerPro (GoHighLevel). All functions are pure — no API
// calls, no side effects, no config imports. Config values are passed as
// parameters for testability.
//
// PII safety: These functions produce document TYPE names only (e.g.,
// "T4 (Previous Year)", "Recent pay stub"). They never output borrower
// names, income amounts, SIN numbers, or addresses in field values.

import type {
  GeneratedChecklist,
  ChecklistItem,
} from '../checklist/types/index.js';

import type { CrmCustomFieldUpdate } from './types/index.js';
import type { CrmConfig } from './config.js';

// ============================================================================
// Function 1: mapChecklistToFields
// ============================================================================

/**
 * Maps a GeneratedChecklist into an array of CRM custom field updates.
 *
 * This is the core bridge between the checklist engine (Phase 3) and the
 * CRM (Phase 4). It produces the exact payload format GoHighLevel expects
 * for contact custom field updates.
 *
 * Initially all items are "missing" (none received yet). The doc status
 * is set to "In Progress" since the checklist was just generated and sent.
 *
 * @param checklist - The generated checklist from the rule engine
 * @param config - Object containing fieldIds (passed, not imported, for purity)
 * @returns Array of CRM custom field updates ready for the contacts API
 */
export function mapChecklistToFields(
  checklist: GeneratedChecklist,
  config: { fieldIds: CrmConfig['fieldIds'] },
): CrmCustomFieldUpdate[] {
  // 1. Flatten all client-facing items from all sources
  const allItems: ChecklistItem[] = [
    ...checklist.borrowerChecklists.flatMap((bc) => bc.items),
    ...checklist.propertyChecklists.flatMap((pc) => pc.items),
    ...checklist.sharedItems,
  ];

  // 2. Separate by stage for PRE/FULL counts
  const preItems = allItems.filter((i) => i.stage === 'PRE');
  const fullItems = allItems.filter((i) => i.stage === 'FULL');

  // 3. Extract document names for missing docs JSON (initially ALL are missing)
  const missingDocNames = mapChecklistToDocNames(allItems);

  // 4. Build the update array
  return [
    { id: config.fieldIds.docStatus, field_value: 'In Progress' },
    { id: config.fieldIds.preDocsTotal, field_value: preItems.length },
    { id: config.fieldIds.preDocsReceived, field_value: 0 },
    { id: config.fieldIds.fullDocsTotal, field_value: fullItems.length },
    { id: config.fieldIds.fullDocsReceived, field_value: 0 },
    { id: config.fieldIds.missingDocs, field_value: JSON.stringify(missingDocNames) },
    { id: config.fieldIds.receivedDocs, field_value: '[]' },
    { id: config.fieldIds.docRequestSent, field_value: new Date().toISOString().split('T')[0] },
  ];
}

// ============================================================================
// Function 2: mapChecklistToDocNames
// ============================================================================

/**
 * Extracts short document names from checklist items for CRM storage.
 *
 * Uses the `document` field (internal name), NOT `displayName` (which may
 * be very long). The `document` field is shorter and more readable in the
 * CRM UI LONG_TEXT field.
 *
 * PII safety: These are document TYPE names only (e.g., "T4 (Previous Year)",
 * "Recent pay stub"). They contain NO borrower names, income amounts, SIN
 * numbers, or addresses.
 *
 * @param items - Checklist items to extract names from
 * @returns Array of document type name strings
 */
export function mapChecklistToDocNames(items: ChecklistItem[]): string[] {
  return items.map((item) => item.document);
}

// ============================================================================
// Function 3: computeDocStatus
// ============================================================================

/**
 * Determines the aggregate document collection status label.
 *
 * Returns one of the SINGLE_OPTIONS picklist values defined in the CRM:
 * - "All Complete" — all PRE and FULL docs received
 * - "PRE Complete" — all PRE docs received (FULL may still be outstanding)
 * - "In Progress" — at least one doc has been received
 * - "Not Started" — no docs received yet
 *
 * Used by:
 * - This module (mapChecklistToFields sets initial "In Progress")
 * - Phase 8 (Tracking Integration) when updating status as docs arrive
 *
 * @param preTotal - Total number of PRE-stage documents required
 * @param preReceived - Number of PRE-stage documents received so far
 * @param fullTotal - Total number of FULL-stage documents required
 * @param fullReceived - Number of FULL-stage documents received so far
 * @returns The status label string matching CRM picklist values
 */
export function computeDocStatus(
  preTotal: number,
  preReceived: number,
  fullTotal: number,
  fullReceived: number,
): string {
  if (preReceived >= preTotal && fullReceived >= fullTotal) return 'All Complete';
  if (preReceived >= preTotal) return 'PRE Complete';
  if (preReceived > 0 || fullReceived > 0) return 'In Progress';
  return 'Not Started';
}

// ============================================================================
// Function 4: buildChecklistSummary
// ============================================================================

/**
 * Builds a compact text summary for CRM task body content.
 *
 * Used when creating Cat's review task — provides a quick overview of what
 * was generated without requiring Cat to open the full checklist.
 *
 * Contains only counts and borrower names (which are already visible in
 * the CRM contact record, so not a PII concern for task body).
 *
 * @param checklist - The generated checklist to summarize
 * @returns Multi-line text summary string
 */
export function buildChecklistSummary(checklist: GeneratedChecklist): string {
  const lines: string[] = [];
  lines.push(
    `Total: ${checklist.stats.totalItems - checklist.stats.internalFlags} client docs, ${checklist.stats.internalFlags} internal flags`,
  );
  lines.push(`PRE: ${checklist.stats.preItems} | FULL: ${checklist.stats.fullItems}`);

  for (const bc of checklist.borrowerChecklists) {
    lines.push(`${bc.borrowerName}: ${bc.items.length} items`);
  }
  if (checklist.sharedItems.length > 0) {
    lines.push(`Shared: ${checklist.sharedItems.length} items`);
  }
  if (checklist.warnings.length > 0) {
    lines.push(`Warnings: ${checklist.warnings.length} warning(s)`);
  }

  return lines.join('\n');
}
