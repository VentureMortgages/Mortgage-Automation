// ============================================================================
// Tests: Document Expiry Rules
// ============================================================================

import { describe, it, expect } from 'vitest';
import { isDocStillValid, PROPERTY_SPECIFIC_TYPES } from '../doc-expiry.js';
import type { ExistingDoc } from '../folder-scanner.js';

// ============================================================================
// Helper
// ============================================================================

function makeDoc(overrides: Partial<ExistingDoc> & { documentType: ExistingDoc['documentType'] }): ExistingDoc {
  return {
    fileId: 'f1',
    filename: 'test.pdf',
    borrowerName: 'Jane',
    modifiedTime: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

// Reference date: Feb 17, 2026
const NOW = new Date('2026-02-17T12:00:00Z');

// ============================================================================
// Property-specific types
// ============================================================================

describe('PROPERTY_SPECIFIC_TYPES', () => {
  it('includes all property/deal-specific types', () => {
    expect(PROPERTY_SPECIFIC_TYPES.has('purchase_agreement')).toBe(true);
    expect(PROPERTY_SPECIFIC_TYPES.has('mls_listing')).toBe(true);
    expect(PROPERTY_SPECIFIC_TYPES.has('property_tax_bill')).toBe(true);
    expect(PROPERTY_SPECIFIC_TYPES.has('home_insurance')).toBe(true);
    expect(PROPERTY_SPECIFIC_TYPES.has('gift_letter')).toBe(true);
    expect(PROPERTY_SPECIFIC_TYPES.has('lease_agreement')).toBe(true);
    expect(PROPERTY_SPECIFIC_TYPES.has('mortgage_statement')).toBe(true);
  });

  it('does not include reusable types', () => {
    expect(PROPERTY_SPECIFIC_TYPES.has('t4')).toBe(false);
    expect(PROPERTY_SPECIFIC_TYPES.has('void_cheque')).toBe(false);
    expect(PROPERTY_SPECIFIC_TYPES.has('photo_id')).toBe(false);
  });
});

// ============================================================================
// isDocStillValid
// ============================================================================

describe('isDocStillValid', () => {
  // --- Property-specific: always invalid ---
  it('returns false for property-specific types', () => {
    expect(isDocStillValid(makeDoc({ documentType: 'purchase_agreement' }), NOW)).toBe(false);
    expect(isDocStillValid(makeDoc({ documentType: 'mls_listing' }), NOW)).toBe(false);
    expect(isDocStillValid(makeDoc({ documentType: 'gift_letter' }), NOW)).toBe(false);
  });

  // --- No expiry ---
  it('returns true for void cheque (no expiry)', () => {
    const doc = makeDoc({ documentType: 'void_cheque', modifiedTime: '2020-01-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns true for separation agreement (no expiry)', () => {
    const doc = makeDoc({ documentType: 'separation_agreement', modifiedTime: '2018-06-15T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns true for articles of incorporation (no expiry)', () => {
    const doc = makeDoc({ documentType: 'articles_of_incorporation', modifiedTime: '2015-01-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns true for employment contract (no expiry)', () => {
    const doc = makeDoc({ documentType: 'employment_contract', modifiedTime: '2019-03-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  // --- 5-year expiry (IDs) ---
  it('returns true for ID uploaded within 5 years', () => {
    const doc = makeDoc({ documentType: 'photo_id', modifiedTime: '2022-01-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns false for ID uploaded more than 5 years ago', () => {
    const doc = makeDoc({ documentType: 'photo_id', modifiedTime: '2020-01-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(false);
  });

  it('returns true for PR card within 5 years', () => {
    const doc = makeDoc({ documentType: 'pr_card', modifiedTime: '2023-06-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  // --- Tax year match ---
  it('returns true for T4 from current tax year (2025)', () => {
    // In Feb 2026, currentTaxYear = 2025, accept 2024 and 2025
    const doc = makeDoc({ documentType: 't4', year: 2025 });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns true for T4 from previous tax year (2024)', () => {
    const doc = makeDoc({ documentType: 't4', year: 2024 });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns false for T4 from two years ago (2023)', () => {
    const doc = makeDoc({ documentType: 't4', year: 2023 });
    expect(isDocStillValid(doc, NOW)).toBe(false);
  });

  it('returns false for tax doc without year', () => {
    const doc = makeDoc({ documentType: 't4', year: undefined });
    expect(isDocStillValid(doc, NOW)).toBe(false);
  });

  it('returns true for NOA from 2024', () => {
    const doc = makeDoc({ documentType: 'noa', year: 2024 });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns true for T1 from 2025', () => {
    const doc = makeDoc({ documentType: 't1', year: 2025 });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  // --- 30-day freshness ---
  it('returns true for pay stub within 30 days', () => {
    const doc = makeDoc({ documentType: 'pay_stub', modifiedTime: '2026-02-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns false for pay stub older than 30 days', () => {
    const doc = makeDoc({ documentType: 'pay_stub', modifiedTime: '2026-01-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(false);
  });

  it('returns true for LOE within 30 days', () => {
    const doc = makeDoc({ documentType: 'loe', modifiedTime: '2026-02-10T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns false for LOE older than 30 days', () => {
    const doc = makeDoc({ documentType: 'loe', modifiedTime: '2025-12-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(false);
  });

  // --- 90-day freshness ---
  it('returns true for bank statement within 90 days', () => {
    const doc = makeDoc({ documentType: 'bank_statement', modifiedTime: '2026-01-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns false for bank statement older than 90 days', () => {
    const doc = makeDoc({ documentType: 'bank_statement', modifiedTime: '2025-10-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(false);
  });

  it('returns true for RRSP statement within 90 days', () => {
    const doc = makeDoc({ documentType: 'rrsp_statement', modifiedTime: '2025-12-15T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  // --- 1-year freshness ---
  it('returns true for financial statement within 1 year', () => {
    const doc = makeDoc({ documentType: 'financial_statement', modifiedTime: '2025-06-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  it('returns false for financial statement older than 1 year', () => {
    const doc = makeDoc({ documentType: 'financial_statement', modifiedTime: '2024-12-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(false);
  });

  it('returns true for work permit within 1 year', () => {
    const doc = makeDoc({ documentType: 'work_permit', modifiedTime: '2025-06-01T00:00:00Z' });
    expect(isDocStillValid(doc, NOW)).toBe(true);
  });

  // --- Unknown type ---
  it('returns false for unknown/unhandled document type', () => {
    const doc = makeDoc({ documentType: 'other' as any });
    expect(isDocStillValid(doc, NOW)).toBe(false);
  });
});
