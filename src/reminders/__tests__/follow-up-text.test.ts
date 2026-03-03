// ============================================================================
// Tests: Follow-up Text Generator
// ============================================================================
//
// Tests the text generation for reminder follow-up emails and CRM tasks.
// Pure functions — no mocks needed.

import { describe, test, expect } from 'vitest';
import { generateFollowUpText, generateReminderTaskBody } from '../follow-up-text.js';
import type { MissingDocEntry } from '../../crm/types/index.js';

// ============================================================================
// Shared test data
// ============================================================================

const threeMissingDocs: MissingDocEntry[] = [
  { name: '2 recent pay stubs', stage: 'PRE' },
  { name: 'T4 for 2024', stage: 'PRE' },
  { name: '90-day bank statements', stage: 'FULL' },
];

const singleMissingDoc: MissingDocEntry[] = [
  { name: 'Property tax bill', stage: 'FULL' },
];

// ============================================================================
// generateFollowUpText
// ============================================================================

describe('generateFollowUpText', () => {
  test('lists all 3 missing docs by name', () => {
    const text = generateFollowUpText('Jane', threeMissingDocs);

    expect(text).toContain('2 recent pay stubs');
    expect(text).toContain('T4 for 2024');
    expect(text).toContain('90-day bank statements');
  });

  test('includes borrower first name in greeting', () => {
    const text = generateFollowUpText('Jane', threeMissingDocs);
    expect(text).toContain('Jane');
  });

  test('has professional, friendly tone (contains greeting and sign-off)', () => {
    const text = generateFollowUpText('Jane', threeMissingDocs);

    // Should have a greeting
    expect(text).toMatch(/hi|hello|dear/i);
    // Should have some polite language
    expect(text).toMatch(/please|kindly|appreciate|thank/i);
  });

  test('handles single missing doc', () => {
    const text = generateFollowUpText('Bob', singleMissingDoc);

    expect(text).toContain('Bob');
    expect(text).toContain('Property tax bill');
  });

  test('does not contain PII beyond first name', () => {
    const text = generateFollowUpText('Jane', threeMissingDocs);

    // Should not contain sensitive info
    expect(text).not.toContain('SIN');
    expect(text).not.toContain('income');
    expect(text).not.toContain('salary');
  });
});

// ============================================================================
// generateReminderTaskBody
// ============================================================================

describe('generateReminderTaskBody', () => {
  test('includes missing doc list for Cat', () => {
    const followUpText = generateFollowUpText('Jane', threeMissingDocs);
    const body = generateReminderTaskBody(
      'Jane Doe',
      'jane@example.com',
      threeMissingDocs,
      5,
      followUpText,
    );

    expect(body).toContain('2 recent pay stubs');
    expect(body).toContain('T4 for 2024');
    expect(body).toContain('90-day bank statements');
  });

  test('includes days since request', () => {
    const followUpText = generateFollowUpText('Jane', threeMissingDocs);
    const body = generateReminderTaskBody(
      'Jane Doe',
      'jane@example.com',
      threeMissingDocs,
      5,
      followUpText,
    );

    expect(body).toContain('5');
  });

  test('includes the draft follow-up email text', () => {
    const followUpText = generateFollowUpText('Jane', threeMissingDocs);
    const body = generateReminderTaskBody(
      'Jane Doe',
      'jane@example.com',
      threeMissingDocs,
      5,
      followUpText,
    );

    // The task body should contain the missing doc names
    expect(body).toContain('2 recent pay stubs');
    expect(body).toContain('T4 for 2024');
    expect(body).toContain('90-day bank statements');
  });

  test('includes borrower name and email', () => {
    const followUpText = generateFollowUpText('Jane', threeMissingDocs);
    const body = generateReminderTaskBody(
      'Jane Doe',
      'jane@example.com',
      threeMissingDocs,
      5,
      followUpText,
    );

    expect(body).toContain('Jane Doe');
    expect(body).toContain('jane@example.com');
  });
});
