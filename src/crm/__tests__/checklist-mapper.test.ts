// ============================================================================
// Tests: Checklist-to-CRM Field Mapper
// ============================================================================
//
// Tests the pure mapper functions with real Phase 3 test fixtures.
// No mocks needed — these are all pure transformations.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateChecklist } from '../../checklist/engine/index.js';
import { fixtures } from '../../checklist/__tests__/fixtures/index.js';
import {
  mapChecklistToFields,
  mapChecklistToDocNames,
  mapChecklistToDocEntries,
  computeDocStatus,
  buildChecklistSummary,
  formatMissingDocsForCrm,
  formatReceivedDocsForCrm,
  parseMissingDocsText,
  parseReceivedDocsText,
} from '../checklist-mapper.js';
import type { ChecklistItem, GeneratedChecklist } from '../../checklist/types/index.js';

// ============================================================================
// Shared test config — fake field IDs for deterministic testing
// ============================================================================

const mockFieldIds = {
  docStatus: 'test-doc-status',
  docRequestSent: 'test-doc-sent',
  missingDocs: 'test-missing',
  receivedDocs: 'test-received',
  preDocsTotal: 'test-pre-total',
  preDocsReceived: 'test-pre-received',
  fullDocsTotal: 'test-full-total',
  fullDocsReceived: 'test-full-received',
  lastDocReceived: 'test-last-doc',
};

// ============================================================================
// mapChecklistToFields
// ============================================================================

describe('mapChecklistToFields', () => {
  let checklist: GeneratedChecklist;

  beforeEach(() => {
    // Use employedPurchase fixture for deterministic results
    checklist = generateChecklist(fixtures.employedPurchase);
    // Mock Date for deterministic docRequestSent field
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('produces correct number of field updates (8 fields)', () => {
    const result = mapChecklistToFields(checklist, { fieldIds: mockFieldIds });
    // 8 fields: docStatus, preDocsTotal, preDocsReceived, fullDocsTotal,
    // fullDocsReceived, missingDocs, receivedDocs, docRequestSent
    // (lastDocReceived is NOT set on initial sync — no docs received yet)
    expect(result).toHaveLength(8);
  });

  test('PRE count matches checklist stats', () => {
    const result = mapChecklistToFields(checklist, { fieldIds: mockFieldIds });

    const docStatusField = result.find((f) => f.id === 'test-doc-status');
    expect(docStatusField?.field_value).toBe('In Progress');

    const preTotalField = result.find((f) => f.id === 'test-pre-total');
    expect(preTotalField?.field_value).toBe(checklist.stats.preItems);

    const preReceivedField = result.find((f) => f.id === 'test-pre-received');
    expect(preReceivedField?.field_value).toBe(0);
  });

  test('FULL count matches checklist stats', () => {
    const result = mapChecklistToFields(checklist, { fieldIds: mockFieldIds });

    const fullTotalField = result.find((f) => f.id === 'test-full-total');
    expect(fullTotalField?.field_value).toBe(checklist.stats.fullItems);

    const fullReceivedField = result.find((f) => f.id === 'test-full-received');
    expect(fullReceivedField?.field_value).toBe(0);
  });

  test('missing docs field contains readable text with stage tags', () => {
    const result = mapChecklistToFields(checklist, { fieldIds: mockFieldIds });

    const missingDocsField = result.find((f) => f.id === 'test-missing');
    expect(missingDocsField).toBeDefined();

    const text = missingDocsField!.field_value as string;
    // Should be newline-separated readable text, NOT JSON
    expect(text.startsWith('[')).toBe(false);
    // Each line should have a [STAGE] tag
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/\[(PRE|FULL|LATER|CONDITIONAL|LENDER_CONDITION)\]$/);
    }
  });

  test('received docs field is empty string initially', () => {
    const result = mapChecklistToFields(checklist, { fieldIds: mockFieldIds });

    const receivedDocsField = result.find((f) => f.id === 'test-received');
    expect(receivedDocsField?.field_value).toBe('');
  });

  test('doc request sent date is today', () => {
    const result = mapChecklistToFields(checklist, { fieldIds: mockFieldIds });

    const sentField = result.find((f) => f.id === 'test-doc-sent');
    expect(sentField?.field_value).toBe('2026-02-14');
  });
});

// ============================================================================
// mapChecklistToDocNames
// ============================================================================

describe('mapChecklistToDocNames', () => {
  test('extracts document field not displayName', () => {
    const items: ChecklistItem[] = [
      {
        ruleId: 'test-rule-1',
        document: 'T4',
        displayName: 'T4 income tax slip for the most recent tax year',
        stage: 'PRE',
        forEmail: true,
        section: 'income',
      },
    ];

    const result = mapChecklistToDocNames(items);
    expect(result).toEqual(['T4']);
  });

  test('handles empty items array', () => {
    const result = mapChecklistToDocNames([]);
    expect(result).toEqual([]);
  });

  test('contains no PII (sanity check)', () => {
    const checklist = generateChecklist(fixtures.employedPurchase);
    const allItems = [
      ...checklist.borrowerChecklists.flatMap((bc) => bc.items),
      ...checklist.propertyChecklists.flatMap((pc) => pc.items),
      ...checklist.sharedItems,
    ];
    const docNames = mapChecklistToDocNames(allItems);

    for (const name of docNames) {
      // No dollar amounts
      expect(name).not.toMatch(/\$\d+/);
      // No SIN patterns (xxx-xxx-xxx)
      expect(name).not.toMatch(/\d{3}-\d{3}-\d{3}/);
      // No email addresses
      expect(name).not.toMatch(/@.*\./);
    }
  });
});

// ============================================================================
// mapChecklistToDocEntries
// ============================================================================

describe('mapChecklistToDocEntries', () => {
  test('returns objects with name and stage fields', () => {
    const items: ChecklistItem[] = [
      {
        ruleId: 'test-rule-1',
        document: 'T4 — Current year',
        displayName: 'T4 income tax slip for the current tax year',
        stage: 'PRE',
        forEmail: true,
        section: 'income',
      },
      {
        ruleId: 'test-rule-2',
        document: 'Letter of Employment',
        displayName: 'Letter of employment from employer',
        stage: 'FULL',
        forEmail: true,
        section: 'income',
      },
    ];

    const result = mapChecklistToDocEntries(items);
    expect(result).toEqual([
      { name: 'T4 — Current year', stage: 'PRE' },
      { name: 'Letter of Employment', stage: 'FULL' },
    ]);
  });

  test('handles empty items array', () => {
    const result = mapChecklistToDocEntries([]);
    expect(result).toEqual([]);
  });

  test('preserves all stage types', () => {
    const items: ChecklistItem[] = [
      { ruleId: 'r1', document: 'Doc A', displayName: 'A', stage: 'PRE', forEmail: true, section: 'income' },
      { ruleId: 'r2', document: 'Doc B', displayName: 'B', stage: 'FULL', forEmail: true, section: 'income' },
      { ruleId: 'r3', document: 'Doc C', displayName: 'C', stage: 'LATER', forEmail: true, section: 'income' },
      { ruleId: 'r4', document: 'Doc D', displayName: 'D', stage: 'CONDITIONAL', forEmail: true, section: 'income' },
    ];

    const result = mapChecklistToDocEntries(items);
    expect(result.map(e => e.stage)).toEqual(['PRE', 'FULL', 'LATER', 'CONDITIONAL']);
  });
});

// ============================================================================
// computeDocStatus
// ============================================================================

describe('computeDocStatus', () => {
  test('returns Not Started when no docs received', () => {
    expect(computeDocStatus(5, 0, 3, 0)).toBe('Not Started');
  });

  test('returns In Progress when some PRE received', () => {
    expect(computeDocStatus(5, 2, 3, 0)).toBe('In Progress');
  });

  test('returns In Progress when some FULL received but PRE not complete', () => {
    expect(computeDocStatus(5, 3, 3, 1)).toBe('In Progress');
  });

  test('returns PRE Complete when all PRE received', () => {
    expect(computeDocStatus(5, 5, 3, 0)).toBe('PRE Complete');
  });

  test('returns PRE Complete when all PRE but only some FULL received', () => {
    expect(computeDocStatus(5, 5, 3, 2)).toBe('PRE Complete');
  });

  test('returns All Complete when everything received', () => {
    expect(computeDocStatus(5, 5, 3, 3)).toBe('All Complete');
  });

  test('handles zero totals (no docs)', () => {
    expect(computeDocStatus(0, 0, 0, 0)).toBe('All Complete');
  });
});

// ============================================================================
// buildChecklistSummary
// ============================================================================

describe('buildChecklistSummary', () => {
  test('includes total counts', () => {
    const checklist = generateChecklist(fixtures.employedPurchase);
    const summary = buildChecklistSummary(checklist);

    expect(summary).toContain('Total:');
    expect(summary).toContain('PRE:');
    expect(summary).toContain('FULL:');
  });

  test('includes borrower names for co-borrower', () => {
    const checklist = generateChecklist(fixtures.coBorrowerMixed);
    const summary = buildChecklistSummary(checklist);

    // The co-borrower fixture has two borrowers
    // Summary should mention both borrower names
    for (const bc of checklist.borrowerChecklists) {
      expect(summary).toContain(bc.borrowerName);
    }
  });

  test('includes warning count when warnings exist', () => {
    // Minimal application may produce warnings about missing data
    const checklist = generateChecklist(fixtures.minimalApplication);
    if (checklist.warnings.length > 0) {
      const summary = buildChecklistSummary(checklist);
      expect(summary).toContain('Warnings:');
    }
  });
});

// ============================================================================
// CRM Display Formatting
// ============================================================================

describe('formatMissingDocsForCrm', () => {
  test('formats entries as readable lines with stage tags', () => {
    const result = formatMissingDocsForCrm([
      { name: 'T4 — Current year', stage: 'PRE' },
      { name: 'Void cheque', stage: 'FULL' },
    ]);
    expect(result).toBe('T4 — Current year [PRE]\nVoid cheque [FULL]');
  });

  test('returns empty string for empty array', () => {
    expect(formatMissingDocsForCrm([])).toBe('');
  });
});

describe('formatReceivedDocsForCrm', () => {
  test('formats names as newline-separated text', () => {
    const result = formatReceivedDocsForCrm(['T4 — Current year', 'Letter of Employment']);
    expect(result).toBe('T4 — Current year\nLetter of Employment');
  });

  test('returns empty string for empty array', () => {
    expect(formatReceivedDocsForCrm([])).toBe('');
  });
});

describe('parseMissingDocsText', () => {
  test('parses new text format', () => {
    const result = parseMissingDocsText('T4 — Current year [PRE]\nVoid cheque [FULL]');
    expect(result).toEqual([
      { name: 'T4 — Current year', stage: 'PRE' },
      { name: 'Void cheque', stage: 'FULL' },
    ]);
  });

  test('parses legacy JSON format', () => {
    const json = JSON.stringify([
      { name: 'T4 — Current year', stage: 'PRE' },
      { name: 'NOA', stage: 'FULL' },
    ]);
    const result = parseMissingDocsText(json);
    expect(result).toEqual([
      { name: 'T4 — Current year', stage: 'PRE' },
      { name: 'NOA', stage: 'FULL' },
    ]);
  });

  test('returns empty array for empty/null input', () => {
    expect(parseMissingDocsText('')).toEqual([]);
    expect(parseMissingDocsText(null)).toEqual([]);
    expect(parseMissingDocsText(undefined)).toEqual([]);
  });

  test('handles malformed JSON by falling through to text parsing', () => {
    const result = parseMissingDocsText('[not valid json');
    // Falls through to text parsing — "[not valid json" has no stage tag, defaults to PRE
    expect(result).toHaveLength(1);
    expect(result[0].stage).toBe('PRE');
  });
});

describe('parseReceivedDocsText', () => {
  test('parses new text format', () => {
    const result = parseReceivedDocsText('T4 — Current year\nLetter of Employment');
    expect(result).toEqual(['T4 — Current year', 'Letter of Employment']);
  });

  test('parses legacy JSON format', () => {
    const json = JSON.stringify(['T4', 'LOE']);
    const result = parseReceivedDocsText(json);
    expect(result).toEqual(['T4', 'LOE']);
  });

  test('returns empty array for empty/null input', () => {
    expect(parseReceivedDocsText('')).toEqual([]);
    expect(parseReceivedDocsText(null)).toEqual([]);
  });
});
