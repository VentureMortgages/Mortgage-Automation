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
 * Uses "LastName, FirstName" format (e.g., "Smith, John") matching
 * Taylor's Drive folder naming convention.
 *
 * @param firstName - Borrower's first name (may be null)
 * @param lastName - Borrower's last name (may be null)
 * @param fallback - Fallback name when names are null/empty (e.g., "Borrower")
 * @returns The person subfolder name in "LastName, FirstName" format
 */
export function getPersonSubfolderName(
  firstName: string | null,
  lastName: string | null,
  fallback: string,
): string {
  const first = firstName?.trim();
  const last = lastName?.trim();

  if (last && first) {
    return `${last}, ${first}`;
  }
  if (last) {
    return last;
  }
  if (first) {
    return first;
  }
  return fallback;
}
