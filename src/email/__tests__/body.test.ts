// ============================================================================
// Tests: Email Body Generator — generateEmailBody (HTML)
// ============================================================================

import { describe, test, expect } from 'vitest';
import { generateEmailBody } from '../body.js';
import type {
  GeneratedChecklist,
  BorrowerChecklist,
  PropertyChecklist,
  ChecklistItem,
} from '../../checklist/types/index.js';
import type { EmailContext } from '../types.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

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

function makeTwoBorrowerChecklist(): GeneratedChecklist {
  const meganItems: ChecklistItem[] = [
    makeItem({ ruleId: 'm1', displayName: 'Letter of Employment confirming back to work date' }),
    makeItem({ ruleId: 'm2', displayName: 'Last pay stub prior to your mat leave' }),
    makeItem({ ruleId: 'm3', displayName: '2024 T4' }),
    makeItem({ ruleId: 'm_internal', displayName: 'Verify T1 includes T2125', forEmail: false }),
  ];

  const coryItems: ChecklistItem[] = [
    makeItem({ ruleId: 'c1', displayName: '2023/2024 T1s' }),
    makeItem({
      ruleId: 'c2',
      displayName: '2023/2024 Notice of Assessments',
      notes: 'if your 2024 NOA shows an amount owing, please also provide your CRA Statement of account showing all income tax has been paid.',
    }),
    makeItem({ ruleId: 'c3', displayName: '2 years business financials for RunGuide Media' }),
    makeItem({ ruleId: 'c_internal', displayName: 'Check Schedule 50', forEmail: false }),
  ];

  const borrowerChecklists: BorrowerChecklist[] = [
    {
      borrowerId: 'b1',
      borrowerName: 'Megan Smith',
      isMainBorrower: true,
      items: meganItems,
    },
    {
      borrowerId: 'b2',
      borrowerName: 'Cory Johnson',
      isMainBorrower: false,
      items: coryItems,
    },
  ];

  const propertyChecklists: PropertyChecklist[] = [
    {
      propertyId: 'p1',
      propertyDescription: 'Smoke Bluff Rd, Squamish',
      items: [
        makeItem({ ruleId: 'p1_1', displayName: 'Current Mortgage Statement' }),
        makeItem({ ruleId: 'p1_2', displayName: '2025 Property Tax Bill' }),
      ],
    },
    {
      propertyId: 'p2',
      propertyDescription: 'Keefer Place, Vancouver',
      items: [
        makeItem({ ruleId: 'p2_1', displayName: 'Current Mortgage Statement' }),
        makeItem({
          ruleId: 'p2_2',
          displayName: 'Confirmation of Condo Fees',
          notes: 'via Annual Strata Statement outlining the fees for your unit or 3 months bank statements showing the withdrawals.',
        }),
      ],
    },
  ];

  const sharedItems: ChecklistItem[] = [
    makeItem({
      ruleId: 's1',
      displayName: 'Void Cheque',
      section: '0_base_pack',
      notes: 'for the account you anticipate your payments to be made from',
    }),
    makeItem({
      ruleId: 's2',
      displayName: '90-day bank statement history for the account(s) holding your down payment funds',
      section: '14_down_payment',
    }),
  ];

  return {
    applicationId: 'test-app-001',
    generatedAt: '2026-02-13T00:00:00Z',
    borrowerChecklists,
    propertyChecklists,
    sharedItems,
    internalFlags: [],
    warnings: [],
    stats: {
      totalItems: 12,
      preItems: 12,
      fullItems: 0,
      perBorrowerItems: 8,
      sharedItems: 2,
      internalFlags: 0,
      warnings: 0,
    },
  };
}

const twoBorrowerContext: EmailContext = {
  borrowerFirstNames: ['Megan', 'Cory'],
  docInboxEmail: 'docs@venturemortgages.com',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateEmailBody', () => {
  const checklist = makeTwoBorrowerChecklist();

  test('returns HTML wrapped in max-width container', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('<div style="');
    expect(body).toContain('max-width:600px');
    expect(body).toContain('</div>');
  });

  test('starts with greeting using both first names', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('<p>Hey Megan and Cory!</p>');
  });

  test('includes intro paragraph', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('Thanks for filling out the application');
  });

  test('has per-borrower sections with underlined headers', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('<u>Megan</u>');
    expect(body).toContain('<u>Cory</u>');
  });

  test('has bold doc names in list items', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    // Simple names (no delimiter) are fully bold
    expect(body).toContain('<strong>2024 T4</strong>');
    expect(body).toContain('<strong>2023/2024 T1s</strong>');
  });

  test('uses <ul>/<li> for bullet lists', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('<ul');
    expect(body).toContain('<li>');
  });

  test('excludes forEmail=false items', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).not.toContain('Verify T1 includes T2125');
    expect(body).not.toContain('Check Schedule 50');
  });

  test('has per-property sections with underlined address headers', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('<u>Smoke Bluff Rd, Squamish:</u>');
    expect(body).toContain('<u>Keefer Place, Vancouver:</u>');
    expect(body).toContain('<strong>Current Mortgage Statement</strong>');
    expect(body).toContain('<strong>2025 Property Tax Bill</strong>');
  });

  test('has sub-categorized shared sections (Down Payment / Other)', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    // Down Payment section for items with section starting with "14_"
    expect(body).toContain('<u>Down Payment</u>');
    // Other section for remaining shared items (void cheque)
    expect(body).toContain('<u>Other</u>');
    expect(body).toContain('<strong>Void Cheque</strong>');
  });

  test('includes notes inline in parentheses after bold doc name', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    // NOA with notes: bold name followed by (note)
    expect(body).toContain('<strong>2023/2024 Notice of Assessments</strong> (if your 2024 NOA');
    // Void cheque with notes
    expect(body).toContain('<strong>Void Cheque</strong> (for the account you anticipate');
    // Condo fees with notes — "Confirmation of Condo Fees" has no delimiter, so fully bold
    expect(body).toContain('<strong>Confirmation of Condo Fees</strong> (via Annual Strata');
  });

  test('bold formatting splits at delimiter — only title is bold', () => {
    // Create fixture with items that have delimiters in displayName
    const delimiterChecklist: GeneratedChecklist = {
      ...checklist,
      borrowerChecklists: [{
        borrowerId: 'b1',
        borrowerName: 'Test Person',
        isMainBorrower: true,
        items: [
          makeItem({
            ruleId: 'loe',
            displayName: 'Letter of Employment (dated within 30 days) — must include: position, start date',
          }),
          makeItem({
            ruleId: 'simple',
            displayName: 'Recent pay stub',
          }),
        ],
      }],
      propertyChecklists: [],
      sharedItems: [],
    };
    const ctx: EmailContext = {
      borrowerFirstNames: ['Test'],
      docInboxEmail: 'docs@test.com',
    };
    const body = generateEmailBody(delimiterChecklist, ctx);
    // Title only bolded, rest in normal text
    expect(body).toContain('<strong>Letter of Employment</strong> (dated within 30 days)');
    // Simple name is fully bold
    expect(body).toContain('<strong>Recent pay stub</strong>');
  });

  test('ends with closing referencing doc inbox email as mailto link', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('mailto:docs@venturemortgages.com');
    expect(body).toContain('Thanks!');
  });

  test('does not include hardcoded signature (Gmail auto-appends Cat\'s)', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).not.toContain('Mortgage Agent');
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  test('single borrower uses just first name in greeting', () => {
    const singleBorrower: GeneratedChecklist = {
      ...checklist,
      borrowerChecklists: [checklist.borrowerChecklists[0]],
    };
    const singleContext: EmailContext = {
      borrowerFirstNames: ['Megan'],
      docInboxEmail: 'docs@venturemortgages.com',
    };
    const body = generateEmailBody(singleBorrower, singleContext);
    expect(body).toContain('<p>Hey Megan!</p>');
    expect(body).not.toContain('Hey Megan and');
  });

  test('omits shared sections when no shared items have forEmail=true', () => {
    const noShared: GeneratedChecklist = {
      ...checklist,
      sharedItems: [
        makeItem({ ruleId: 's_internal', displayName: 'Internal shared item', forEmail: false }),
      ],
    };
    const body = generateEmailBody(noShared, twoBorrowerContext);
    expect(body).not.toContain('<u>Other</u>');
    expect(body).not.toContain('<u>Down Payment</u>');
    expect(body).not.toContain('<u>Property</u>');
  });

  test('omits property sections when no property checklists', () => {
    const noProperties: GeneratedChecklist = {
      ...checklist,
      propertyChecklists: [],
    };
    const body = generateEmailBody(noProperties, twoBorrowerContext);
    expect(body).not.toContain('Smoke Bluff');
    expect(body).not.toContain('Keefer Place');
  });

  // ---------------------------------------------------------------------------
  // Already on file section
  // ---------------------------------------------------------------------------

  test('renders "already on file" section when alreadyOnFile is provided', () => {
    const ctx: EmailContext = {
      ...twoBorrowerContext,
      alreadyOnFile: [
        {
          checklistItem: makeItem({ displayName: 'T4 — Current year' }),
          driveFileId: 'f1',
          borrowerName: 'Megan',
        },
        {
          checklistItem: makeItem({ displayName: 'Void Cheque' }),
          driveFileId: 'f2',
          borrowerName: 'Megan',
        },
      ],
    };
    const body = generateEmailBody(checklist, ctx);

    // Should have the on-file header
    expect(body).toContain('We already have the following documents on file');
    // Should list the docs
    expect(body).toContain('<strong>T4</strong>');
    expect(body).toContain('<strong>Void Cheque</strong>');
    // Should have the transition text
    expect(body).toContain('We just need the following additional documents');
    // Should NOT have the standard intro paragraph
    expect(body).not.toContain('ensure the accuracy of your pre-approval budget');
  });

  test('uses standard intro when alreadyOnFile is empty', () => {
    const ctx: EmailContext = {
      ...twoBorrowerContext,
      alreadyOnFile: [],
    };
    const body = generateEmailBody(checklist, ctx);

    expect(body).not.toContain('We already have the following documents on file');
    expect(body).toContain('ensure the accuracy of your pre-approval budget');
  });

  test('uses standard intro when alreadyOnFile is undefined', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);

    expect(body).not.toContain('We already have the following documents on file');
    expect(body).toContain('ensure the accuracy of your pre-approval budget');
  });

  test('on-file section strips parenthetical details from doc names', () => {
    const ctx: EmailContext = {
      ...twoBorrowerContext,
      alreadyOnFile: [
        {
          checklistItem: makeItem({ displayName: 'Letter of Employment (dated within 30 days)' }),
          driveFileId: 'f1',
          borrowerName: 'Megan',
        },
      ],
    };
    const body = generateEmailBody(checklist, ctx);

    expect(body).toContain('<strong>Letter of Employment</strong>');
    // Should NOT include the parenthetical in the on-file list
    expect(body).not.toContain('on file.*dated within 30 days');
  });
});
