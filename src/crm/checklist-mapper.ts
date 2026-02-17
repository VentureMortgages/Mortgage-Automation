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
 * If preReceivedDocs are provided (from Drive folder scan), those items
 * are counted as already received and added to the receivedDocs field.
 *
 * @param checklist - The generated checklist from the rule engine
 * @param config - Object containing fieldIds (passed, not imported, for purity)
 * @param preReceivedDocs - Optional doc names already on file from Drive scan
 * @returns Array of CRM custom field updates ready for the contacts API
 */
export function mapChecklistToFields(
  checklist: GeneratedChecklist,
  config: { fieldIds: CrmConfig['fieldIds'] },
  preReceivedDocs?: { name: string; stage: string }[],
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

  // 3. Handle pre-received docs from Drive scan (if any)
  const received = preReceivedDocs ?? [];
  const preReceived = received.filter(d => d.stage === 'PRE').length;
  const fullReceived = received.filter(d => d.stage === 'FULL').length;

  // Total counts include both missing items (in filtered checklist) and pre-received
  const preTotal = preItems.length + preReceived;
  const fullTotal = fullItems.length + fullReceived;

  // 4. Format doc entries as human-readable text for CRM display
  const missingDocEntries = mapChecklistToDocEntries(allItems);
  const missingDocsText = formatMissingDocsForCrm(missingDocEntries);
  const receivedDocsText = formatReceivedDocsForCrm(received.map(d => d.name));

  // 5. Compute initial status
  // "In Progress" is the default when a checklist is sent — even with 0 received,
  // the request has been initiated. Only upgrade to "PRE Complete" / "All Complete"
  // if pre-received docs satisfy those thresholds.
  let docStatus: string;
  if (received.length > 0) {
    docStatus = computeDocStatus(preTotal, preReceived, fullTotal, fullReceived);
  } else {
    docStatus = 'In Progress';
  }

  // 6. Build the update array
  return [
    { id: config.fieldIds.docStatus, field_value: docStatus },
    { id: config.fieldIds.preDocsTotal, field_value: preTotal },
    { id: config.fieldIds.preDocsReceived, field_value: preReceived },
    { id: config.fieldIds.fullDocsTotal, field_value: fullTotal },
    { id: config.fieldIds.fullDocsReceived, field_value: fullReceived },
    { id: config.fieldIds.missingDocs, field_value: missingDocsText },
    { id: config.fieldIds.receivedDocs, field_value: receivedDocsText },
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
// Function 2b: mapChecklistToDocEntries
// ============================================================================

/** Structured entry for missingDocs tracking (name + stage for counter logic) */
export interface DocEntry {
  name: string;
  stage: string;
}

/**
 * Maps checklist items to structured doc entry objects with stage info.
 *
 * Unlike mapChecklistToDocNames (which returns flat strings), this preserves
 * the stage field (PRE/FULL/LATER/CONDITIONAL) so the tracking sync in
 * Phase 8 can determine which counter to increment when a document is received.
 *
 * @param items - Checklist items to extract entries from
 * @returns Array of DocEntry objects with name and stage
 */
export function mapChecklistToDocEntries(items: ChecklistItem[]): DocEntry[] {
  return items.map((item) => ({
    name: item.document,
    stage: item.stage,
  }));
}

// ============================================================================
// CRM Display Formatting — Human-readable text for LARGE_TEXT fields
// ============================================================================

/**
 * Formats missing doc entries as readable text for CRM display.
 *
 * Each line: "Doc Name [STAGE]"
 * Grouped by stage (PRE first, then FULL, then others).
 *
 * Example output:
 *   Two pieces of government-issued ID [PRE]
 *   Recent pay stub [PRE]
 *   Letter of Employment [PRE]
 *   Void cheque [FULL]
 *
 * The tracking sync parser (`parseMissingDocsText`) reads this format back.
 */
export function formatMissingDocsForCrm(entries: DocEntry[]): string {
  if (entries.length === 0) return '';
  return entries.map((e) => `${e.name} [${e.stage}]`).join('\n');
}

/**
 * Formats received doc names as readable text for CRM display.
 *
 * Each line: "Doc Name"
 *
 * Example output:
 *   T4 — Current year
 *   Letter of Employment
 */
export function formatReceivedDocsForCrm(docNames: string[]): string {
  if (docNames.length === 0) return '';
  return docNames.join('\n');
}

/**
 * Parses missing docs from CRM field value.
 *
 * Supports TWO formats for backward compatibility:
 * 1. New text format: "Doc Name [STAGE]\nDoc Name [STAGE]"
 * 2. Legacy JSON format: [{"name":"Doc Name","stage":"STAGE"}, ...]
 *
 * @returns Array of DocEntry objects
 */
export function parseMissingDocsText(value: unknown): DocEntry[] {
  if (typeof value !== 'string' || value.trim() === '') return [];

  const trimmed = value.trim();

  // Try legacy JSON format first (starts with '[')
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (e): e is DocEntry =>
            typeof e === 'object' && e !== null && typeof e.name === 'string' && typeof e.stage === 'string',
        );
      }
    } catch {
      // Fall through to text parsing
    }
  }

  // New text format: one entry per line, "Doc Name [STAGE]"
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^(.+?)\s*\[(\w+)\]$/);
      if (match) {
        return { name: match[1].trim(), stage: match[2] };
      }
      // Line without stage tag — default to PRE
      return { name: line, stage: 'PRE' };
    });
}

/**
 * Parses received docs from CRM field value.
 *
 * Supports TWO formats for backward compatibility:
 * 1. New text format: "Doc Name\nDoc Name"
 * 2. Legacy JSON format: ["Doc Name", "Doc Name"]
 *
 * @returns Array of document name strings
 */
export function parseReceivedDocsText(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];

  const trimmed = value.trim();

  // Try legacy JSON format first (starts with '[')
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((e): e is string => typeof e === 'string');
      }
    } catch {
      // Fall through to text parsing
    }
  }

  // New text format: one entry per line
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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
