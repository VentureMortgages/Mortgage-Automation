import { describe, it, expect } from 'vitest';
import { sanitizeForLog, PII_FIELDS } from '../sanitize.js';

describe('sanitizeForLog', () => {
  // -------------------------------------------------------------------------
  // 1. Primitives pass through unchanged
  // -------------------------------------------------------------------------
  describe('primitive values', () => {
    it('returns string unchanged', () => {
      expect(sanitizeForLog('hello')).toBe('hello');
    });

    it('returns number unchanged', () => {
      expect(sanitizeForLog(42)).toBe(42);
    });

    it('returns boolean unchanged', () => {
      expect(sanitizeForLog(true)).toBe(true);
      expect(sanitizeForLog(false)).toBe(false);
    });

    it('returns null unchanged', () => {
      expect(sanitizeForLog(null)).toBeNull();
    });

    it('returns undefined unchanged', () => {
      expect(sanitizeForLog(undefined)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Known PII fields are redacted
  // -------------------------------------------------------------------------
  describe('PII field redaction', () => {
    it('redacts sinNumber', () => {
      expect(sanitizeForLog({ sinNumber: '123-456-789' })).toEqual({
        sinNumber: '[REDACTED]',
      });
    });

    it('redacts email', () => {
      expect(sanitizeForLog({ email: 'john@example.com' })).toEqual({
        email: '[REDACTED]',
      });
    });

    it('redacts phone and workPhone', () => {
      expect(
        sanitizeForLog({ phone: '555-1234', workPhone: '555-5678' })
      ).toEqual({
        phone: '[REDACTED]',
        workPhone: '[REDACTED]',
      });
    });

    it('redacts phoneNumber', () => {
      expect(sanitizeForLog({ phoneNumber: '555-0000' })).toEqual({
        phoneNumber: '[REDACTED]',
      });
    });

    it('redacts birthDate', () => {
      expect(sanitizeForLog({ birthDate: '1990-01-15' })).toEqual({
        birthDate: '[REDACTED]',
      });
    });

    it('redacts financial fields: income, incomePeriodAmount, balance, creditLimit, monthlyPayment, creditScore', () => {
      const input = {
        income: 85000,
        incomePeriodAmount: 7083,
        balance: 15000,
        creditLimit: 25000,
        monthlyPayment: 500,
        creditScore: 780,
      };
      const result = sanitizeForLog(input);
      expect(result).toEqual({
        income: '[REDACTED]',
        incomePeriodAmount: '[REDACTED]',
        balance: '[REDACTED]',
        creditLimit: '[REDACTED]',
        monthlyPayment: '[REDACTED]',
        creditScore: '[REDACTED]',
      });
    });

    it('redacts address fields: line1, line2, streetNumber, streetName, postCode', () => {
      const input = {
        line1: '123 Main St',
        line2: 'Unit 4',
        streetNumber: '123',
        streetName: 'Main',
        postCode: 'V5K 1A1',
      };
      const result = sanitizeForLog(input);
      expect(result).toEqual({
        line1: '[REDACTED]',
        line2: '[REDACTED]',
        streetNumber: '[REDACTED]',
        streetName: '[REDACTED]',
        postCode: '[REDACTED]',
      });
    });

    it('redacts ipAddress and location', () => {
      expect(
        sanitizeForLog({ ipAddress: '192.168.1.1', location: 'Vancouver, BC' })
      ).toEqual({
        ipAddress: '[REDACTED]',
        location: '[REDACTED]',
      });
    });

    it('redacts all PII_FIELDS entries', () => {
      // Build an object with every PII field
      const input: Record<string, string> = {};
      for (const field of PII_FIELDS) {
        input[field] = `value-${field}`;
      }

      const result = sanitizeForLog(input) as Record<string, unknown>;
      for (const field of PII_FIELDS) {
        expect(result[field]).toBe('[REDACTED]');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Non-PII fields preserved
  // -------------------------------------------------------------------------
  describe('non-PII fields preserved', () => {
    it('preserves applicationId', () => {
      expect(sanitizeForLog({ applicationId: 'app-123' })).toEqual({
        applicationId: 'app-123',
      });
    });

    it('preserves id, goal, applicationStatus, isMainBorrower, employmentType', () => {
      const input = {
        id: 'bor-456',
        goal: 'purchase',
        applicationStatus: 'pre_qualified',
        isMainBorrower: true,
        employmentType: 'full_time',
      };
      expect(sanitizeForLog(input)).toEqual(input);
    });

    it('preserves firstName and lastName (borderline but needed for logging)', () => {
      expect(
        sanitizeForLog({ firstName: 'John', lastName: 'Doe' })
      ).toEqual({ firstName: 'John', lastName: 'Doe' });
    });
  });

  // -------------------------------------------------------------------------
  // 4. Nested objects
  // -------------------------------------------------------------------------
  describe('nested objects', () => {
    it('redacts PII in nested objects while preserving non-PII', () => {
      const input = {
        borrower: {
          sinNumber: '123-456-789',
          firstName: 'John',
          email: 'john@example.com',
          id: 'bor-1',
        },
      };
      expect(sanitizeForLog(input)).toEqual({
        borrower: {
          sinNumber: '[REDACTED]',
          firstName: 'John',
          email: '[REDACTED]',
          id: 'bor-1',
        },
      });
    });

    it('handles multiple levels of nesting', () => {
      const input = {
        level1: {
          level2: {
            sinNumber: 'secret',
            safe: 'ok',
          },
        },
      };
      expect(sanitizeForLog(input)).toEqual({
        level1: {
          level2: {
            sinNumber: '[REDACTED]',
            safe: 'ok',
          },
        },
      });
    });
  });

  // -------------------------------------------------------------------------
  // 5. Arrays replaced with summary
  // -------------------------------------------------------------------------
  describe('array handling', () => {
    it('replaces arrays with [Array(N)] summary', () => {
      expect(sanitizeForLog({ items: [1, 2, 3] })).toEqual({
        items: '[Array(3)]',
      });
    });

    it('replaces empty arrays with [Array(0)]', () => {
      expect(sanitizeForLog({ items: [] })).toEqual({
        items: '[Array(0)]',
      });
    });

    it('does not iterate into array contents (prevents PII leakage)', () => {
      const input = {
        borrowers: [
          { sinNumber: '111', firstName: 'Alice' },
          { sinNumber: '222', firstName: 'Bob' },
        ],
      };
      expect(sanitizeForLog(input)).toEqual({
        borrowers: '[Array(2)]',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 6. Depth limit
  // -------------------------------------------------------------------------
  describe('depth limit', () => {
    it('stops recursing at depth 10 and returns [Object]', () => {
      // Build an object nested 12 levels deep
      let obj: Record<string, unknown> = { leaf: 'value' };
      for (let i = 0; i < 12; i++) {
        obj = { nested: obj };
      }

      const result = sanitizeForLog(obj) as Record<string, unknown>;

      // Navigate 10 levels deep — at level 10+, should be '[Object]'
      let current: unknown = result;
      for (let i = 0; i < 10; i++) {
        current = (current as Record<string, unknown>).nested;
      }
      expect(current).toBe('[Object]');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Null/undefined input
  // -------------------------------------------------------------------------
  describe('null/undefined input', () => {
    it('returns null as-is', () => {
      expect(sanitizeForLog(null)).toBeNull();
    });

    it('returns undefined as-is', () => {
      expect(sanitizeForLog(undefined)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 8. Real-world Finmo borrower object
  // -------------------------------------------------------------------------
  describe('real-world Finmo borrower', () => {
    it('redacts all PII while preserving metadata', () => {
      const borrower = {
        id: 'bor-abc-123',
        applicationId: 'app-xyz-789',
        firstName: 'Taylor',
        lastName: 'Atkinson',
        sinNumber: '123-456-789',
        email: 'taylor@example.com',
        phone: '604-555-1234',
        workPhone: '604-555-5678',
        birthDate: '1985-06-15',
        income: 125000,
        creditScore: 780,
        isMainBorrower: true,
        marital: 'married',
        goal: 'purchase',
        line1: '123 West Broadway',
        line2: 'Suite 400',
        streetNumber: '123',
        streetName: 'West Broadway',
        postCode: 'V5Y 1P3',
        ipAddress: '24.85.100.50',
        location: 'Vancouver, BC, Canada',
      };

      const result = sanitizeForLog(borrower) as Record<string, unknown>;

      // Non-PII preserved
      expect(result.id).toBe('bor-abc-123');
      expect(result.applicationId).toBe('app-xyz-789');
      expect(result.firstName).toBe('Taylor');
      expect(result.lastName).toBe('Atkinson');
      expect(result.isMainBorrower).toBe(true);
      expect(result.marital).toBe('married');
      expect(result.goal).toBe('purchase');

      // PII redacted
      expect(result.sinNumber).toBe('[REDACTED]');
      expect(result.email).toBe('[REDACTED]');
      expect(result.phone).toBe('[REDACTED]');
      expect(result.workPhone).toBe('[REDACTED]');
      expect(result.birthDate).toBe('[REDACTED]');
      expect(result.income).toBe('[REDACTED]');
      expect(result.creditScore).toBe('[REDACTED]');
      expect(result.line1).toBe('[REDACTED]');
      expect(result.line2).toBe('[REDACTED]');
      expect(result.streetNumber).toBe('[REDACTED]');
      expect(result.streetName).toBe('[REDACTED]');
      expect(result.postCode).toBe('[REDACTED]');
      expect(result.ipAddress).toBe('[REDACTED]');
      expect(result.location).toBe('[REDACTED]');
    });
  });
});

describe('PII_FIELDS', () => {
  it('contains all expected PII field names', () => {
    const expected = [
      'sinNumber', 'email', 'phone', 'workPhone', 'phoneNumber',
      'birthDate', 'income', 'incomePeriodAmount', 'balance',
      'creditLimit', 'monthlyPayment', 'creditScore',
      'line1', 'line2', 'streetNumber', 'streetName', 'postCode',
      'ipAddress', 'location',
    ];
    for (const field of expected) {
      expect(PII_FIELDS.has(field)).toBe(true);
    }
  });

  it('does NOT contain firstName or lastName', () => {
    expect(PII_FIELDS.has('firstName')).toBe(false);
    expect(PII_FIELDS.has('lastName')).toBe(false);
  });
});
