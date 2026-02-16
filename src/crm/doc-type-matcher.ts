// ============================================================================
// Doc-Type Matcher — Bridges classifier output to checklist document names
// ============================================================================
//
// The classifier (Phase 7) returns DocumentType enum values like 'pay_stub',
// 't4', 'loe'. The CRM stores checklist document names like "Recent paystub
// (within 30 days)", "T4 — Current year", "Letter of Employment". This module
// provides the matching function that finds the corresponding checklist doc
// for a given classified document type.
//
// Matching strategies (in order of precedence):
// 1. Label prefix match — DOC_TYPE_LABELS value matches start of checklist name
// 2. Contains match — label appears anywhere in checklist name (>= 3 chars)
// 3. Alias match — KNOWN_ALIASES provides fallback patterns for tricky mappings

import type { DocumentType } from '../classification/types.js';
import { DOC_TYPE_LABELS } from '../classification/types.js';
import type { MissingDocEntry } from './types/index.js';

// ============================================================================
// Known Aliases — Fallback patterns for label-to-checklist mismatches
// ============================================================================

const KNOWN_ALIASES: Partial<Record<DocumentType, string[]>> = {
  pay_stub: ['paystub', 'pay stub'],
  loe: ['letter of employment', 'employment letter'],
  noa: ['notice of assessment', 'NOA'],
  t1: ['T1 General'],
  photo_id: ['photo ID', 'government-issued'],
  second_id: ['second form of ID', 'second ID'],
  void_cheque: ['void cheque', 'direct deposit'],
  bank_statement: ['bank statement', '90-day bank'],
  purchase_agreement: ['purchase agreement', 'agreement of purchase'],
  pr_card: ['PR card', 'permanent resident'],
  financial_statement: ['financial statement'],
  articles_of_incorporation: ['articles of incorporation'],
  pension_letter: ['pension letter', 'pension benefit'],
  employment_contract: ['employment contract'],
  commission_statement: ['commission statement'],
  lease_agreement: ['lease agreement'],
  property_tax_bill: ['property tax'],
  mortgage_statement: ['mortgage statement'],
  home_insurance: ['home insurance'],
  separation_agreement: ['separation agreement', 'separation/divorce'],
  discharge_certificate: ['discharge certificate', 'bankruptcy discharge'],
  passport: ['passport'],
  work_permit: ['work permit'],
};

// ============================================================================
// Main Matching Function
// ============================================================================

/**
 * Finds the checklist document entry that matches a classified document type.
 *
 * Uses a three-tier matching strategy:
 * 1. Label prefix — DOC_TYPE_LABELS[documentType] matches start of entry name
 * 2. Contains — label appears anywhere in entry name (only for labels >= 3 chars)
 * 3. Alias — KNOWN_ALIASES patterns checked against entry names
 *
 * Returns the FIRST match found (stable ordering from missingDocs array).
 * Returns null if no match is found.
 *
 * @param documentType - The classified document type from Phase 7
 * @param missingDocs - The current missing documents list from CRM
 * @returns The matching MissingDocEntry, or null if no match
 */
export function findMatchingChecklistDoc(
  documentType: DocumentType,
  missingDocs: MissingDocEntry[],
): MissingDocEntry | null {
  const label = DOC_TYPE_LABELS[documentType];
  if (!label) return null;

  const labelLower = label.toLowerCase();

  // 1. Try exact start-of-string match (covers most cases)
  const prefixMatch = missingDocs.find((doc) =>
    doc.name.toLowerCase().startsWith(labelLower),
  );
  if (prefixMatch) return prefixMatch;

  // 2. Try contains match (for cases like "Government-issued photo ID" matching label "ID")
  // Only for labels >= 3 chars to avoid false positives
  if (labelLower.length >= 3) {
    const containsMatch = missingDocs.find((doc) =>
      doc.name.toLowerCase().includes(labelLower),
    );
    if (containsMatch) return containsMatch;
  }

  // 3. Try KNOWN_ALIASES for tricky mappings
  const aliases = KNOWN_ALIASES[documentType];
  if (aliases) {
    for (const alias of aliases) {
      const aliasLower = alias.toLowerCase();
      const aliasMatch = missingDocs.find((doc) =>
        doc.name.toLowerCase().includes(aliasLower),
      );
      if (aliasMatch) return aliasMatch;
    }
  }

  return null;
}
