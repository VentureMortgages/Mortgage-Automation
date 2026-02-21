/**
 * Tests for Applier — Checklist modification with conservative thresholds
 *
 * Tests cover:
 * - Removes items that appear in 2+ matching records
 * - Does NOT remove items that appear in only 1 record
 * - Applies rewords that appear in 2+ matching records
 * - Returns original checklist when no modifications needed
 * - Does not mutate the original checklist
 * - Handles empty matches array
 */

import { describe, it, expect, vi } from 'vitest';
import type { GeneratedChecklist, ChecklistItem } from '../../checklist/types/index.js';
import type { FeedbackMatch, FeedbackRecord } from '../types.js';

vi.mock('../config.js', () => ({
  feedbackConfig: {
    minMatchesForAutoApply: 2,
  },
}));

import { applyFeedbackToChecklist } from '../applier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(displayName: string, doc?: string): ChecklistItem {
  return {
    ruleId: `rule_${displayName.replace(/\s/g, '_')}`,
    document: doc ?? displayName,
    displayName,
    stage: 'PRE',
    forEmail: true,
    section: 'test_section',
  };
}

function makeChecklist(items: ChecklistItem[]): GeneratedChecklist {
  return {
    applicationId: 'app-test',
    generatedAt: '2026-02-20T00:00:00Z',
    borrowerChecklists: [
      {
        borrowerId: 'b1',
        borrowerName: 'Test Borrower',
        isMainBorrower: true,
        items: items.slice(0, 2),
      },
    ],
    propertyChecklists: [],
    sharedItems: items.slice(2),
    internalFlags: [],
    warnings: [],
    stats: {
      totalItems: items.length,
      preItems: items.length,
      fullItems: 0,
      perBorrowerItems: 2,
      sharedItems: items.length - 2,
      internalFlags: 0,
      warnings: 0,
    },
  };
}

function makeMatch(edits: Partial<FeedbackRecord['edits']>): FeedbackMatch {
  return {
    similarity: 0.9,
    record: {
      id: 'rec-1',
      contactId: 'contact-1',
      createdAt: '2026-02-20T00:00:00Z',
      context: {
        goal: 'purchase',
        incomeTypes: ['employed/salaried'],
        propertyTypes: ['owner_occupied'],
        borrowerCount: 1,
        hasGiftDP: false,
        hasRentalIncome: false,
      },
      contextText: 'Single purchase, salaried',
      embedding: null,
      edits: {
        itemsRemoved: [],
        itemsAdded: [],
        itemsReworded: [],
        sectionsReordered: false,
        otherChanges: null,
        noChanges: false,
        ...edits,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feedback Applier', () => {
  it('removes items that appear in 2+ matching records', () => {
    const checklist = makeChecklist([
      makeItem('Pay Stub'),
      makeItem('T4'),
      makeItem('Void Cheque'),
    ]);

    const matches = [
      makeMatch({ itemsRemoved: ['Void Cheque'] }),
      makeMatch({ itemsRemoved: ['Void Cheque'] }),
    ];

    const result = applyFeedbackToChecklist(checklist, matches);

    const allItems = [
      ...result.borrowerChecklists[0].items,
      ...result.sharedItems,
    ];
    const names = allItems.map(i => i.displayName);
    expect(names).toContain('Pay Stub');
    expect(names).toContain('T4');
    expect(names).not.toContain('Void Cheque');
  });

  it('does NOT remove items with only 1 match', () => {
    const checklist = makeChecklist([
      makeItem('Pay Stub'),
      makeItem('T4'),
      makeItem('Void Cheque'),
    ]);

    const matches = [
      makeMatch({ itemsRemoved: ['Void Cheque'] }),
      makeMatch({ itemsRemoved: [] }),
    ];

    const result = applyFeedbackToChecklist(checklist, matches);

    const allItems = [
      ...result.borrowerChecklists[0].items,
      ...result.sharedItems,
    ];
    const names = allItems.map(i => i.displayName);
    expect(names).toContain('Void Cheque');
  });

  it('applies rewords from 2+ matching records', () => {
    const checklist = makeChecklist([
      makeItem('Letter of Employment'),
      makeItem('T4'),
      makeItem('Void Cheque'),
    ]);

    const matches = [
      makeMatch({
        itemsReworded: [{ original: 'Letter of Employment', modified: 'LOE (within 30 days)' }],
      }),
      makeMatch({
        itemsReworded: [{ original: 'Letter of Employment', modified: 'LOE (within 30 days)' }],
      }),
    ];

    const result = applyFeedbackToChecklist(checklist, matches);

    const allItems = [
      ...result.borrowerChecklists[0].items,
      ...result.sharedItems,
    ];
    const loe = allItems.find(i => i.displayName.includes('LOE'));
    expect(loe).toBeDefined();
    expect(loe!.displayName).toBe('LOE (within 30 days)');
  });

  it('returns original checklist when no modifications needed', () => {
    const checklist = makeChecklist([
      makeItem('Pay Stub'),
      makeItem('T4'),
      makeItem('Void Cheque'),
    ]);

    const matches = [
      makeMatch({ itemsRemoved: ['Something Else'] }),
      makeMatch({ itemsRemoved: ['Another Thing'] }),
    ];

    const result = applyFeedbackToChecklist(checklist, matches);

    // Should be the same reference (no copy needed)
    expect(result).toBe(checklist);
  });

  it('does not mutate the original checklist', () => {
    const checklist = makeChecklist([
      makeItem('Pay Stub'),
      makeItem('T4'),
      makeItem('Void Cheque'),
    ]);

    const originalItemCount = checklist.borrowerChecklists[0].items.length + checklist.sharedItems.length;

    const matches = [
      makeMatch({ itemsRemoved: ['Void Cheque'] }),
      makeMatch({ itemsRemoved: ['Void Cheque'] }),
    ];

    applyFeedbackToChecklist(checklist, matches);

    // Original should be unchanged
    const afterItemCount = checklist.borrowerChecklists[0].items.length + checklist.sharedItems.length;
    expect(afterItemCount).toBe(originalItemCount);
  });

  it('handles empty matches array', () => {
    const checklist = makeChecklist([
      makeItem('Pay Stub'),
      makeItem('T4'),
      makeItem('Void Cheque'),
    ]);

    const result = applyFeedbackToChecklist(checklist, []);

    expect(result).toBe(checklist);
  });
});
