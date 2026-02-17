// ============================================================================
// Tests: Checklist Filter — filterChecklistByExistingDocs
// ============================================================================

import { describe, it, expect } from 'vitest';
import { filterChecklistByExistingDocs } from '../checklist-filter.js';
import type { ExistingDoc } from '../folder-scanner.js';
import type {
  GeneratedChecklist,
  ChecklistItem,
  BorrowerChecklist,
} from '../../checklist/types/index.js';

// ============================================================================
// Fixtures
// ============================================================================

function makeItem(overrides: Partial<ChecklistItem> & { displayName: string }): ChecklistItem {
  const { displayName, ...rest } = overrides;
  return {
    ruleId: 'test_rule',
    document: displayName,
    displayName,
    stage: 'PRE',
    forEmail: true,
    section: 'test_section',
    ...rest,
  };
}

function makeChecklist(
  borrowerChecklists: BorrowerChecklist[],
  sharedItems: ChecklistItem[] = [],
): GeneratedChecklist {
  const allItems = [
    ...borrowerChecklists.flatMap(bc => bc.items),
    ...sharedItems,
  ];
  return {
    applicationId: 'test-app',
    generatedAt: '2026-02-17T00:00:00Z',
    borrowerChecklists,
    propertyChecklists: [],
    sharedItems,
    internalFlags: [],
    warnings: [],
    stats: {
      totalItems: allItems.length,
      preItems: allItems.filter(i => i.stage === 'PRE').length,
      fullItems: allItems.filter(i => i.stage === 'FULL').length,
      perBorrowerItems: borrowerChecklists.reduce((s, bc) => s + bc.items.length, 0),
      sharedItems: sharedItems.length,
      internalFlags: 0,
      warnings: 0,
    },
  };
}

function makeExistingDoc(overrides: Partial<ExistingDoc> & { documentType: ExistingDoc['documentType'] }): ExistingDoc {
  return {
    fileId: 'drive-f1',
    filename: 'test.pdf',
    borrowerName: 'Jane',
    modifiedTime: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

const NOW = new Date('2026-02-17T12:00:00Z');

// ============================================================================
// Tests
// ============================================================================

describe('filterChecklistByExistingDocs', () => {
  it('removes matching borrower items and returns them as alreadyOnFile', () => {
    const checklist = makeChecklist([
      {
        borrowerId: 'b1',
        borrowerName: 'Jane Doe',
        isMainBorrower: true,
        items: [
          makeItem({ displayName: 'T4 — Current year', document: 'T4 — Current year' }),
          makeItem({ displayName: 'Letter of Employment', document: 'Letter of Employment' }),
          makeItem({ displayName: 'Recent pay stub', document: 'Recent pay stub' }),
        ],
      },
    ]);

    const existingDocs: ExistingDoc[] = [
      makeExistingDoc({ documentType: 't4', borrowerName: 'Jane', year: 2025 }),
    ];

    const result = filterChecklistByExistingDocs(checklist, existingDocs, NOW);

    expect(result.alreadyOnFile).toHaveLength(1);
    expect(result.alreadyOnFile[0].checklistItem.displayName).toBe('T4 — Current year');
    expect(result.alreadyOnFile[0].borrowerName).toBe('Jane');

    // Filtered checklist should have 2 items (T4 removed)
    expect(result.filteredChecklist.borrowerChecklists[0].items).toHaveLength(2);
    expect(result.filteredChecklist.borrowerChecklists[0].items.map(i => i.document))
      .toEqual(['Letter of Employment', 'Recent pay stub']);
  });

  it('removes matching shared items', () => {
    const checklist = makeChecklist(
      [{
        borrowerId: 'b1',
        borrowerName: 'Jane Doe',
        isMainBorrower: true,
        items: [],
      }],
      [
        makeItem({ displayName: 'Void Cheque', document: 'Void Cheque' }),
        makeItem({ displayName: '90-day bank statement', document: '90-day bank statement', section: '14_down_payment' }),
      ],
    );

    const existingDocs: ExistingDoc[] = [
      makeExistingDoc({ documentType: 'void_cheque', borrowerName: 'Jane' }),
    ];

    const result = filterChecklistByExistingDocs(checklist, existingDocs, NOW);

    expect(result.alreadyOnFile).toHaveLength(1);
    expect(result.alreadyOnFile[0].checklistItem.displayName).toBe('Void Cheque');
    expect(result.filteredChecklist.sharedItems).toHaveLength(1);
    expect(result.filteredChecklist.sharedItems[0].document).toBe('90-day bank statement');
  });

  it('excludes property-specific types from matching', () => {
    const checklist = makeChecklist([{
      borrowerId: 'b1',
      borrowerName: 'Jane Doe',
      isMainBorrower: true,
      items: [
        makeItem({ displayName: 'Purchase Agreement', document: 'Purchase Agreement' }),
      ],
    }]);

    const existingDocs: ExistingDoc[] = [
      makeExistingDoc({ documentType: 'purchase_agreement', borrowerName: 'Jane' }),
    ];

    const result = filterChecklistByExistingDocs(checklist, existingDocs, NOW);

    expect(result.alreadyOnFile).toHaveLength(0);
    expect(result.filteredChecklist.borrowerChecklists[0].items).toHaveLength(1);
  });

  it('puts expired docs in expiredDocs array', () => {
    const checklist = makeChecklist([{
      borrowerId: 'b1',
      borrowerName: 'Jane Doe',
      isMainBorrower: true,
      items: [
        makeItem({ displayName: 'T4 — Current year', document: 'T4 — Current year' }),
      ],
    }]);

    // T4 from 2022 is expired (too old)
    const existingDocs: ExistingDoc[] = [
      makeExistingDoc({ documentType: 't4', borrowerName: 'Jane', year: 2022 }),
    ];

    const result = filterChecklistByExistingDocs(checklist, existingDocs, NOW);

    expect(result.alreadyOnFile).toHaveLength(0);
    expect(result.expiredDocs).toHaveLength(1);
    expect(result.expiredDocs[0].year).toBe(2022);
    expect(result.filteredChecklist.borrowerChecklists[0].items).toHaveLength(1);
  });

  it('matches borrower name by first name (case-insensitive)', () => {
    const checklist = makeChecklist([
      {
        borrowerId: 'b1',
        borrowerName: 'Jane Doe',
        isMainBorrower: true,
        items: [
          makeItem({ displayName: 'T4 — Current year', document: 'T4 — Current year' }),
        ],
      },
      {
        borrowerId: 'b2',
        borrowerName: 'Mike Smith',
        isMainBorrower: false,
        items: [
          makeItem({ displayName: 'T4 — Current year', document: 'T4 — Current year' }),
        ],
      },
    ]);

    // Only Jane's T4 is on file
    const existingDocs: ExistingDoc[] = [
      makeExistingDoc({ documentType: 't4', borrowerName: 'jane', year: 2025 }),
    ];

    const result = filterChecklistByExistingDocs(checklist, existingDocs, NOW);

    expect(result.alreadyOnFile).toHaveLength(1);
    expect(result.alreadyOnFile[0].borrowerName).toBe('jane');
    // Jane's T4 removed, Mike's T4 still there
    expect(result.filteredChecklist.borrowerChecklists[0].items).toHaveLength(0);
    expect(result.filteredChecklist.borrowerChecklists[1].items).toHaveLength(1);
  });

  it('recomputes stats after filtering', () => {
    const checklist = makeChecklist([{
      borrowerId: 'b1',
      borrowerName: 'Jane Doe',
      isMainBorrower: true,
      items: [
        makeItem({ displayName: 'T4 — Current year', document: 'T4', stage: 'PRE' }),
        makeItem({ displayName: 'LOE', document: 'LOE', stage: 'PRE' }),
        makeItem({ displayName: 'Void Cheque', document: 'Void Cheque', stage: 'FULL' }),
      ],
    }]);

    const existingDocs: ExistingDoc[] = [
      makeExistingDoc({ documentType: 't4', borrowerName: 'Jane', year: 2025 }),
    ];

    const result = filterChecklistByExistingDocs(checklist, existingDocs, NOW);

    expect(result.filteredChecklist.stats.totalItems).toBe(2);
    expect(result.filteredChecklist.stats.preItems).toBe(1);
    expect(result.filteredChecklist.stats.fullItems).toBe(1);
    expect(result.filteredChecklist.stats.perBorrowerItems).toBe(2);
  });

  it('handles empty existing docs gracefully', () => {
    const checklist = makeChecklist([{
      borrowerId: 'b1',
      borrowerName: 'Jane Doe',
      isMainBorrower: true,
      items: [makeItem({ displayName: 'T4', document: 'T4' })],
    }]);

    const result = filterChecklistByExistingDocs(checklist, [], NOW);

    expect(result.alreadyOnFile).toHaveLength(0);
    expect(result.expiredDocs).toHaveLength(0);
    expect(result.filteredChecklist.borrowerChecklists[0].items).toHaveLength(1);
  });

  it('does not remove internal-only items (forEmail=false) even when doc type matches', () => {
    const checklist = makeChecklist([{
      borrowerId: 'b1',
      borrowerName: 'Jane Doe',
      isMainBorrower: true,
      items: [
        makeItem({ displayName: 'T4 — Current year', document: 'T4 — Current year' }),
        makeItem({
          displayName: 'Verify T1 includes T2125',
          document: 'Verify T1 includes T2125',
          forEmail: false,
        }),
      ],
    }]);

    const existingDocs: ExistingDoc[] = [
      makeExistingDoc({ documentType: 't4', borrowerName: 'Jane', year: 2025 }),
      makeExistingDoc({ documentType: 't1', borrowerName: 'Jane', year: 2025 }),
    ];

    const result = filterChecklistByExistingDocs(checklist, existingDocs, NOW);

    // T4 should be removed (forEmail=true, matches)
    expect(result.alreadyOnFile).toHaveLength(1);
    expect(result.alreadyOnFile[0].checklistItem.displayName).toBe('T4 — Current year');

    // Internal item should be preserved even though T1 doc exists
    const remaining = result.filteredChecklist.borrowerChecklists[0].items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].displayName).toBe('Verify T1 includes T2125');
    expect(remaining[0].forEmail).toBe(false);
  });

  it('does not modify the original checklist', () => {
    const originalItems = [
      makeItem({ displayName: 'T4 — Current year', document: 'T4 — Current year' }),
      makeItem({ displayName: 'LOE', document: 'LOE' }),
    ];
    const checklist = makeChecklist([{
      borrowerId: 'b1',
      borrowerName: 'Jane Doe',
      isMainBorrower: true,
      items: originalItems,
    }]);

    const existingDocs: ExistingDoc[] = [
      makeExistingDoc({ documentType: 't4', borrowerName: 'Jane', year: 2025 }),
    ];

    filterChecklistByExistingDocs(checklist, existingDocs, NOW);

    // Original checklist should be unchanged
    expect(checklist.borrowerChecklists[0].items).toHaveLength(2);
  });
});
