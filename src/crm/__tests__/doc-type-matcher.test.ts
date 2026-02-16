// ============================================================================
// Tests: Doc-Type Matcher — Bridges classifier output to checklist doc names
// ============================================================================
//
// Tests findMatchingChecklistDoc() using real checklist document names from
// the rule files. Verifies label prefix, contains, and alias matching
// strategies, plus edge cases.

import { describe, test, expect } from 'vitest';
import { findMatchingChecklistDoc } from '../doc-type-matcher.js';
import type { MissingDocEntry } from '../types/index.js';

// ============================================================================
// Realistic missingDocs list — matches actual checklist rule document names
// ============================================================================

const sampleMissingDocs: MissingDocEntry[] = [
  { name: 'Government-issued photo ID', stage: 'PRE' },
  { name: 'Second form of ID', stage: 'PRE' },
  { name: 'Void cheque or direct deposit form', stage: 'PRE' },
  { name: 'Recent paystub (within 30 days)', stage: 'PRE' },
  { name: 'Letter of Employment', stage: 'PRE' },
  { name: 'T4 — Current year', stage: 'PRE' },
  { name: 'T4 — Previous year', stage: 'FULL' },
  { name: 'NOA — Previous year', stage: 'PRE' },
  { name: 'NOA — Current year', stage: 'FULL' },
  { name: '90-day bank statement history', stage: 'PRE' },
  { name: 'Purchase agreement', stage: 'FULL' },
  { name: 'PR card', stage: 'PRE' },
  { name: 'T1 General — Current year (full return)', stage: 'FULL' },
  { name: 'Articles of Incorporation', stage: 'FULL' },
  { name: '2 years accountant-prepared financial statements', stage: 'FULL' },
  { name: 'Pension letter stating current year entitlement', stage: 'PRE' },
  { name: 'Employment contract', stage: 'PRE' },
  { name: 'Property tax bill (most recent)', stage: 'FULL' },
  { name: 'Mortgage statements for other properties', stage: 'FULL' },
  { name: 'Home insurance policy', stage: 'FULL' },
  { name: 'Lease agreements for all units', stage: 'FULL' },
  { name: 'Separation agreement / court order (paying support)', stage: 'PRE' },
  { name: 'Passport', stage: 'PRE' },
  { name: 'Work permit', stage: 'PRE' },
];

// ============================================================================
// Label Prefix Matches
// ============================================================================

describe('findMatchingChecklistDoc', () => {
  describe('label prefix matching', () => {
    test('t4 matches "T4 — Current year" (first T4 entry)', () => {
      const result = findMatchingChecklistDoc('t4', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('T4 — Current year');
      expect(result!.stage).toBe('PRE');
    });

    test('noa matches "NOA — Previous year" (first NOA entry)', () => {
      const result = findMatchingChecklistDoc('noa', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('NOA — Previous year');
    });

    test('void_cheque matches "Void cheque or direct deposit form"', () => {
      const result = findMatchingChecklistDoc('void_cheque', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Void cheque or direct deposit form');
    });

    test('purchase_agreement matches "Purchase agreement"', () => {
      const result = findMatchingChecklistDoc('purchase_agreement', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Purchase agreement');
    });

    test('pr_card matches "PR card"', () => {
      const result = findMatchingChecklistDoc('pr_card', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('PR card');
    });

    test('passport matches "Passport"', () => {
      const result = findMatchingChecklistDoc('passport', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Passport');
    });

    test('work_permit matches "Work permit"', () => {
      const result = findMatchingChecklistDoc('work_permit', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Work permit');
    });

    test('home_insurance matches "Home insurance policy"', () => {
      const result = findMatchingChecklistDoc('home_insurance', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Home insurance policy');
    });

    test('employment_contract matches "Employment contract"', () => {
      const result = findMatchingChecklistDoc('employment_contract', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Employment contract');
    });
  });

  // ============================================================================
  // Contains Matches
  // ============================================================================

  describe('contains matching', () => {
    test('bank_statement matches "90-day bank statement history" via contains', () => {
      const result = findMatchingChecklistDoc('bank_statement', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('90-day bank statement history');
    });

    test('property_tax_bill matches "Property tax bill (most recent)" via contains', () => {
      const result = findMatchingChecklistDoc('property_tax_bill', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Property tax bill (most recent)');
    });

    test('mortgage_statement matches "Mortgage statements for other properties" via contains', () => {
      const result = findMatchingChecklistDoc('mortgage_statement', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Mortgage statements for other properties');
    });

    test('financial_statement matches "2 years accountant-prepared financial statements" via contains', () => {
      const result = findMatchingChecklistDoc('financial_statement', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('2 years accountant-prepared financial statements');
    });
  });

  // ============================================================================
  // Alias Matches
  // ============================================================================

  describe('alias matching', () => {
    test('pay_stub matches "Recent paystub (within 30 days)" via alias', () => {
      const result = findMatchingChecklistDoc('pay_stub', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Recent paystub (within 30 days)');
    });

    test('loe matches "Letter of Employment" via alias', () => {
      const result = findMatchingChecklistDoc('loe', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Letter of Employment');
    });

    test('photo_id matches "Government-issued photo ID" via alias', () => {
      const result = findMatchingChecklistDoc('photo_id', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Government-issued photo ID');
    });

    test('t1 matches "T1 General — Current year (full return)" via alias', () => {
      const result = findMatchingChecklistDoc('t1', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('T1 General — Current year (full return)');
    });

    test('separation_agreement matches "Separation agreement / court order" via alias', () => {
      const result = findMatchingChecklistDoc('separation_agreement', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Separation agreement / court order (paying support)');
    });

    test('pension_letter matches "Pension letter stating current year entitlement" via alias', () => {
      const result = findMatchingChecklistDoc('pension_letter', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Pension letter stating current year entitlement');
    });

    test('lease_agreement matches "Lease agreements for all units" via alias', () => {
      const result = findMatchingChecklistDoc('lease_agreement', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Lease agreements for all units');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    test('other returns null (label "Document" is too generic)', () => {
      const result = findMatchingChecklistDoc('other', sampleMissingDocs);
      expect(result).toBeNull();
    });

    test('returns null for empty missingDocs array', () => {
      const result = findMatchingChecklistDoc('t4', []);
      expect(result).toBeNull();
    });

    test('returns null when document type not in missingDocs', () => {
      const limitedDocs: MissingDocEntry[] = [
        { name: 'T4 — Current year', stage: 'PRE' },
      ];
      const result = findMatchingChecklistDoc('bank_statement', limitedDocs);
      expect(result).toBeNull();
    });

    test('returned match includes correct stage field', () => {
      const result = findMatchingChecklistDoc('purchase_agreement', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.stage).toBe('FULL');
    });

    test('second_id matches "Second form of ID" via alias', () => {
      const result = findMatchingChecklistDoc('second_id', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Second form of ID');
    });

    test('articles_of_incorporation matches "Articles of Incorporation"', () => {
      const result = findMatchingChecklistDoc('articles_of_incorporation', sampleMissingDocs);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Articles of Incorporation');
    });
  });
});
