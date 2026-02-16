/**
 * Tests for File Naming Module
 *
 * Tests cover Cat's actual naming patterns from DRIVE_STRUCTURE.md:
 * - T4 with all fields: "Kathy - T4 CPP 2024 $16k.pdf"
 * - T4RIF with institution and amount
 * - Pay stub without year/amount
 * - ID only
 * - T5 with institution and amount
 * - Null borrower name uses fallback
 * - Void cheque (shared doc)
 * - Purchase agreement (property doc with address)
 * - Sanitizes special characters
 * - Unknown doc type uses 'Document' label
 * - Amount with no institution
 */

import { describe, it, expect } from 'vitest';
import { generateFilename, sanitizeFilename } from '../naming.js';
import type { ClassificationResult } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<ClassificationResult>): ClassificationResult {
  return {
    documentType: 'other',
    confidence: 0.9,
    borrowerFirstName: null,
    borrowerLastName: null,
    taxYear: null,
    amount: null,
    institution: null,
    pageCount: 1,
    additionalNotes: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Naming Module', () => {

  // -------------------------------------------------------------------------
  // generateFilename
  // -------------------------------------------------------------------------

  describe('generateFilename', () => {
    it('T4 with all fields', () => {
      const result = makeResult({
        documentType: 't4',
        borrowerFirstName: 'Kathy',
        institution: 'CPP',
        taxYear: 2024,
        amount: '$16k',
      });

      expect(generateFilename(result, 'Unknown')).toBe('Kathy - T4 CPP 2024 $16k.pdf');
    });

    it('T4RIF with institution and amount', () => {
      const result = makeResult({
        documentType: 't4rif',
        borrowerFirstName: 'Terry',
        institution: 'Scotia',
        taxYear: 2024,
        amount: '$34k',
      });

      expect(generateFilename(result, 'Unknown')).toBe('Terry - T4RIF Scotia 2024 $34k.pdf');
    });

    it('Pay stub without year/amount', () => {
      const result = makeResult({
        documentType: 'pay_stub',
        borrowerFirstName: 'Susan',
      });

      expect(generateFilename(result, 'Unknown')).toBe('Susan - Pay Stub.pdf');
    });

    it('ID only', () => {
      const result = makeResult({
        documentType: 'photo_id',
        borrowerFirstName: 'Kathy',
      });

      expect(generateFilename(result, 'Unknown')).toBe('Kathy - ID.pdf');
    });

    it('T5 with institution and amount', () => {
      const result = makeResult({
        documentType: 't5',
        borrowerFirstName: 'Terry',
        institution: 'Desjardins',
        taxYear: 2024,
        amount: '$585',
      });

      expect(generateFilename(result, 'Unknown')).toBe('Terry - T5 Desjardins 2024 $585.pdf');
    });

    it('null borrower name uses fallback', () => {
      const result = makeResult({
        documentType: 'noa',
        borrowerFirstName: null,
        taxYear: 2024,
      });

      expect(generateFilename(result, 'John')).toBe('John - NOA 2024.pdf');
    });

    it('void cheque (shared doc)', () => {
      const result = makeResult({
        documentType: 'void_cheque',
        borrowerFirstName: null,
      });

      expect(generateFilename(result, 'Albrecht')).toBe('Albrecht - Void Cheque.pdf');
    });

    it('purchase agreement (property doc)', () => {
      const result = makeResult({
        documentType: 'purchase_agreement',
        borrowerFirstName: null,
      });

      expect(generateFilename(result, '4587 Postill Dr')).toBe('4587 Postill Dr - Purchase Agreement.pdf');
    });

    it('sanitizes special characters', () => {
      const result = makeResult({
        documentType: 't4',
        borrowerFirstName: 'Test/User',
        institution: 'Bank:Corp',
        taxYear: 2024,
        amount: '$16k',
      });

      const filename = generateFilename(result, 'Fallback');
      // Should not contain / \ : * ? " < > |
      expect(filename).not.toMatch(/[/\\:*?"<>|]/);
      expect(filename).toContain('Test-User');
      expect(filename).toContain('Bank-Corp');
    });

    it('unknown doc type uses Document label', () => {
      const result = makeResult({
        documentType: 'other',
        borrowerFirstName: 'Jane',
      });

      expect(generateFilename(result, 'Unknown')).toBe('Jane - Document.pdf');
    });

    it('amount with no institution', () => {
      const result = makeResult({
        documentType: 'bank_statement',
        borrowerFirstName: 'Susan',
        amount: '$630k+',
      });

      expect(generateFilename(result, 'Unknown')).toBe('Susan - Bank Statement $630k+.pdf');
    });
  });

  // -------------------------------------------------------------------------
  // sanitizeFilename
  // -------------------------------------------------------------------------

  describe('sanitizeFilename', () => {
    it('removes forbidden characters', () => {
      expect(sanitizeFilename('file/name\\test:bad*chars?.pdf')).toBe('file-name-test-bad-chars-.pdf');
    });

    it('collapses multiple spaces', () => {
      expect(sanitizeFilename('too   many    spaces.pdf')).toBe('too many spaces.pdf');
    });

    it('trims whitespace', () => {
      expect(sanitizeFilename('  padded.pdf  ')).toBe('padded.pdf');
    });

    it('preserves dollar signs and plus signs', () => {
      expect(sanitizeFilename('Name - T4 $16k+.pdf')).toBe('Name - T4 $16k+.pdf');
    });

    it('preserves parentheses', () => {
      expect(sanitizeFilename('Document (1).pdf')).toBe('Document (1).pdf');
    });
  });
});
