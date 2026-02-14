// ============================================================================
// Tests: Email Body Generator — generateEmailBody
// ============================================================================
//
// Tests that generateEmailBody transforms a GeneratedChecklist into a
// formatted, personalized doc request email matching Cat's exact tone and
// structure from EMAIL_TEMPLATE_REFERENCE.md.
//
// TDD RED phase: these tests are written before the implementation exists.

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

/** Two-borrower, two-property, shared items fixture */
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
      notes: 'for the account you anticipate your payments to be made from',
    }),
    makeItem({
      ruleId: 's2',
      displayName: '3 months bank statements for the account(s) holding your down payment funds',
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
// Tests: Two-borrower Scenario
// ---------------------------------------------------------------------------

describe('generateEmailBody', () => {
  const checklist = makeTwoBorrowerChecklist();

  test('starts with greeting using both first names', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toMatch(/^Hey Megan and Cory!/);
  });

  test('includes intro paragraph', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('Thanks for filling out the application');
  });

  test('has per-borrower section with first name header and bullet items', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);

    // Megan section: header followed by bulleted items
    expect(body).toContain('Megan\n');
    expect(body).toContain('- Letter of Employment confirming back to work date');
    expect(body).toContain('- Last pay stub prior to your mat leave');
    expect(body).toContain('- 2024 T4');

    // Cory section: header followed by bulleted items
    expect(body).toContain('Cory\n');
    expect(body).toContain('- 2023/2024 T1s');
    expect(body).toContain('- 2 years business financials for RunGuide Media');
  });

  test('excludes forEmail=false items', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).not.toContain('Verify T1 includes T2125');
    expect(body).not.toContain('Check Schedule 50');
  });

  test('has per-property sections with address headers and bullet items', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('Smoke Bluff Rd, Squamish:');
    expect(body).toContain('Keefer Place, Vancouver:');
    expect(body).toContain('- Current Mortgage Statement');
    expect(body).toContain('- 2025 Property Tax Bill');
  });

  test('has shared Other section with bullet items', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('Other\n');
    expect(body).toContain('- Void Cheque');
    expect(body).toContain('- 3 months bank statements for the account(s) holding your down payment funds');
  });

  test('includes notes inline in parentheses', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);

    // NOA notes should appear inline in parentheses
    expect(body).toContain('- 2023/2024 Notice of Assessments (if your 2024 NOA shows an amount owing');

    // Void cheque notes
    expect(body).toContain('- Void Cheque (for the account you anticipate your payments');

    // Condo fees notes
    expect(body).toContain('- Confirmation of Condo Fees (via Annual Strata Statement');
  });

  test('ends with closing referencing doc inbox email', () => {
    const body = generateEmailBody(checklist, twoBorrowerContext);
    expect(body).toContain('send these documents directly to docs@venturemortgages.com');
    expect(body).toMatch(/Thanks!$/);
  });

  // ---------------------------------------------------------------------------
  // Edge Cases: Single borrower
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
    const greetingLine = body.split('\n')[0];
    expect(greetingLine).toBe('Hey Megan!');
    expect(greetingLine).not.toContain(' and ');
  });

  // ---------------------------------------------------------------------------
  // Edge Cases: No shared items with forEmail=true
  // ---------------------------------------------------------------------------

  test('omits Other section when no shared items have forEmail=true', () => {
    const noShared: GeneratedChecklist = {
      ...checklist,
      sharedItems: [
        makeItem({ ruleId: 's_internal', displayName: 'Internal shared item', forEmail: false }),
      ],
    };
    const body = generateEmailBody(noShared, twoBorrowerContext);
    expect(body).not.toContain('Other');
  });

  // ---------------------------------------------------------------------------
  // Edge Cases: No property checklists
  // ---------------------------------------------------------------------------

  test('omits property sections when no property checklists', () => {
    const noProperties: GeneratedChecklist = {
      ...checklist,
      propertyChecklists: [],
    };
    const body = generateEmailBody(noProperties, twoBorrowerContext);
    expect(body).not.toContain('Smoke Bluff');
    expect(body).not.toContain('Keefer Place');
  });
});
