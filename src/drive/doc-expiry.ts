// ============================================================================
// Document Expiry Rules — Determines if an existing doc is still valid
// ============================================================================
//
// Different document types have different shelf lives. A T4 from 2024 is valid
// for a 2026 application, but a pay stub from 6 months ago is not.
//
// Property-specific docs (purchase agreement, MLS, etc.) are NEVER reusable
// across deals — they're always excluded from the scan.

import type { DocumentType } from '../classification/types.js';
import type { ExistingDoc } from './folder-scanner.js';

// ============================================================================
// Property-specific types — never reusable across deals
// ============================================================================

export const PROPERTY_SPECIFIC_TYPES: Set<DocumentType> = new Set([
  'purchase_agreement',
  'mls_listing',
  'property_tax_bill',
  'home_insurance',
  'gift_letter',
  'lease_agreement',
  'mortgage_statement',
]);

// ============================================================================
// Expiry configuration
// ============================================================================

type ExpiryRule =
  | { type: 'never_expires' }
  | { type: 'days'; days: number }
  | { type: 'years'; years: number }
  | { type: 'tax_year' };

const EXPIRY_RULES: Partial<Record<DocumentType, ExpiryRule>> = {
  // IDs — 5 years
  photo_id: { type: 'years', years: 5 },
  second_id: { type: 'years', years: 5 },
  pr_card: { type: 'years', years: 5 },
  passport: { type: 'years', years: 5 },

  // No expiry
  void_cheque: { type: 'never_expires' },
  separation_agreement: { type: 'never_expires' },
  divorce_decree: { type: 'never_expires' },
  discharge_certificate: { type: 'never_expires' },
  articles_of_incorporation: { type: 'never_expires' },
  employment_contract: { type: 'never_expires' },

  // Tax year match
  t4: { type: 'tax_year' },
  t4a: { type: 'tax_year' },
  noa: { type: 'tax_year' },
  t1: { type: 'tax_year' },
  t2: { type: 'tax_year' },
  t5: { type: 'tax_year' },
  t4rif: { type: 'tax_year' },

  // 30-day freshness
  pay_stub: { type: 'days', days: 30 },
  loe: { type: 'days', days: 30 },

  // 90-day freshness
  bank_statement: { type: 'days', days: 90 },
  rrsp_statement: { type: 'days', days: 90 },
  tfsa_statement: { type: 'days', days: 90 },
  fhsa_statement: { type: 'days', days: 90 },

  // 1-year freshness
  financial_statement: { type: 'years', years: 1 },
  commission_statement: { type: 'years', years: 1 },
  pension_letter: { type: 'years', years: 1 },
  work_permit: { type: 'years', years: 1 },
  cra_statement_of_account: { type: 'years', years: 1 },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Checks whether an existing document is still valid for a new application.
 *
 * Pure function — no side effects. Uses the document type's expiry rule
 * and the file's modifiedTime (when it was uploaded/updated in Drive).
 *
 * Property-specific types always return false (handled separately via
 * PROPERTY_SPECIFIC_TYPES set).
 *
 * @param doc - The existing document from Drive scan
 * @param currentDate - Current date for freshness comparison
 * @returns true if the document is still valid, false if expired
 */
export function isDocStillValid(doc: ExistingDoc, currentDate: Date): boolean {
  // Property-specific docs are never reusable
  if (PROPERTY_SPECIFIC_TYPES.has(doc.documentType)) {
    return false;
  }

  const rule = EXPIRY_RULES[doc.documentType];
  if (!rule) {
    // Unknown doc type — be conservative, treat as expired
    return false;
  }

  switch (rule.type) {
    case 'never_expires':
      return true;

    case 'days': {
      const modDate = new Date(doc.modifiedTime);
      const ageMs = currentDate.getTime() - modDate.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      return ageDays <= rule.days;
    }

    case 'years': {
      const modDate = new Date(doc.modifiedTime);
      const cutoff = new Date(currentDate);
      cutoff.setFullYear(cutoff.getFullYear() - rule.years);
      return modDate >= cutoff;
    }

    case 'tax_year': {
      if (doc.year == null) {
        // No year in filename — can't determine validity
        return false;
      }
      // Current tax year = previous calendar year (taxes filed for last year)
      // Accept current year - 1 or current year
      // e.g., in Feb 2026: 2024 and 2025 T4s are valid
      const currentTaxYear = currentDate.getFullYear() - 1;
      return doc.year >= currentTaxYear - 1;
    }
  }
}
