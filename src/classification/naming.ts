/**
 * File Naming Module
 *
 * Generates filenames following Cat's naming convention from DRIVE_STRUCTURE.md:
 *   "FirstName - DocType [Institution] [Year] [Amount].pdf"
 *
 * Examples from Cat's actual Drive:
 *   - "Kathy - T4A CPP 2024 $16k.pdf"
 *   - "Terry - T4RIF Scotia 2024 $34k.pdf"
 *   - "Susan - Pay Stub.pdf"
 *   - "Kathy - ID.pdf"
 *   - "4587 Postill Dr - Purchase Agreement.pdf"
 *
 * Pure function — no side effects, no I/O.
 *
 * Consumers: classification-worker.ts (Phase 7 Plan 05)
 */

import { DOC_TYPE_LABELS } from './types.js';
import type { ClassificationResult } from './types.js';

// ---------------------------------------------------------------------------
// Filename Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename by replacing forbidden characters.
 *
 * Replaces: / \ : * ? " < > |
 * Preserves: $ + . ( ) — these appear in Cat's naming conventions
 * Collapses multiple spaces, trims whitespace.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\:*?"<>|]/g, '-')    // Replace forbidden chars with dash
    .replace(/\s+/g, ' ')             // Collapse multiple spaces
    .trim();                           // Trim leading/trailing whitespace
}

// ---------------------------------------------------------------------------
// Filename Generation
// ---------------------------------------------------------------------------

/**
 * Generate a filename following Cat's naming convention.
 *
 * Pattern: "Name - DocType [Institution] [Year] [Amount].pdf"
 *
 * @param classification - The classification result from Claude
 * @param fallbackName - Name to use when borrowerFirstName is null (e.g., address, "Borrower 1")
 * @returns Sanitized filename with .pdf extension
 */
export function generateFilename(
  classification: ClassificationResult,
  fallbackName: string,
): string {
  const name = classification.borrowerFirstName ?? fallbackName;
  const docLabel = DOC_TYPE_LABELS[classification.documentType] ?? classification.documentType;

  const parts: string[] = [name, '-', docLabel];

  if (classification.institution) {
    parts.push(classification.institution);
  }

  if (classification.taxYear) {
    parts.push(String(classification.taxYear));
  }

  if (classification.amount) {
    parts.push(classification.amount);
  }

  return sanitizeFilename(parts.join(' ') + '.pdf');
}
