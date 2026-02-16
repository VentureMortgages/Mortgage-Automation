/**
 * Subfolder Router
 *
 * Maps document types to the correct subfolder target within a client's
 * Google Drive folder, using the SUBFOLDER_ROUTING lookup table from types.ts.
 *
 * Subfolder structure (from DRIVE_STRUCTURE.md):
 *   - Person subfolders: income, ID, tax, residency, business, situation docs
 *   - Subject Property: purchase agreements, MLS, property tax, insurance
 *   - Non-Subject Property: lease agreements, mortgage statements
 *   - Down Payment: bank statements, RRSP/TFSA/FHSA, gift letters
 *   - Root: void cheque, unclassified docs
 *
 * Pure function — no side effects, no I/O.
 *
 * Consumers: classification-worker.ts (Phase 7 Plan 05)
 */

import { SUBFOLDER_ROUTING } from './types.js';
import type { DocumentType, SubfolderTarget } from './types.js';

// ---------------------------------------------------------------------------
// Subfolder Routing
// ---------------------------------------------------------------------------

/**
 * Route a document type to the correct subfolder target.
 *
 * @param documentType - The classified document type
 * @returns The subfolder target ('person', 'subject_property', 'down_payment', etc.)
 */
export function routeToSubfolder(documentType: DocumentType): SubfolderTarget {
  return SUBFOLDER_ROUTING[documentType] ?? 'root';
}

// ---------------------------------------------------------------------------
// Person Subfolder Naming
// ---------------------------------------------------------------------------

/**
 * Build the person subfolder name.
 *
 * Per DRIVE_STRUCTURE.md, person subfolders use first name only:
 *   "Terry/", "Kathy/", "Susan/"
 *
 * @param firstName - Borrower's first name (may be null)
 * @param lastName - Borrower's last name (unused per Drive convention, kept for interface consistency)
 * @param fallback - Fallback name when firstName is null/empty (e.g., "Borrower 1")
 * @returns The person subfolder name
 */
export function getPersonSubfolderName(
  firstName: string | null,
  lastName: string | null,
  fallback: string,
): string {
  const trimmed = firstName?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  return fallback;
}
