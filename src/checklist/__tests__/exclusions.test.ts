/**
 * CHKL-05: Excluded Items — Negative Tests
 *
 * Each of the 13 items excluded from client-facing output (per Cat's review
 * in DOC_CHECKLIST_RULES_V2) gets a negative test confirming it does NOT
 * appear in the generated checklist's client-facing items.
 */

import { describe, test, expect } from 'vitest';
import { generateChecklist } from '../engine/index.js';
import type { FinmoApplicationResponse } from '../types/index.js';
import {
  employedPurchase,
  selfEmployedRefi,
  retiredCondo,
  coBorrowerMixed,
} from './fixtures/index.js';

const TEST_DATE = new Date('2026-02-15');

/** Helper: get all client-facing rule IDs from a result */
function getClientFacingRuleIds(result: ReturnType<typeof generateChecklist>): string[] {
  return [
    ...result.borrowerChecklists.flatMap((bc) => bc.items.map((i) => i.ruleId)),
    ...result.propertyChecklists.flatMap((pc) => pc.items.map((i) => i.ruleId)),
    ...result.sharedItems.map((i) => i.ruleId),
  ];
}

describe('CHKL-05: Excluded items', () => {
  test('1. Signed credit consent is NOT in output', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const ruleIds = getClientFacingRuleIds(result);
    expect(ruleIds.every((id) => !id.includes('credit_consent'))).toBe(true);
  });

  test('2. Bonus payment history is NOT in output (bonus details merged into LOE)', () => {
    // Bob in co-borrower fixture has bonuses:true
    const result = generateChecklist(coBorrowerMixed, undefined, TEST_DATE);
    const ruleIds = getClientFacingRuleIds(result);
    expect(ruleIds.every((id) => id !== 'bonus_payment_history')).toBe(true);
    // Bonus T4s removed (B9), standalone bonus letter removed (merged into LOE)
    expect(ruleIds).not.toContain('s10_bonus_t4s');
    expect(ruleIds).not.toContain('s10_bonus_letter');
    // Bob's LOE should include bonus structure details
    const bob = result.borrowerChecklists.find((bc) => bc.borrowerName === 'Bob Co');
    const bobLoe = bob!.items.find((i) => i.ruleId === 's1_loe');
    expect(bobLoe?.displayName).toContain('bonus structure');
  });

  test('3. T2125 is NOT requested separately (is internal-only)', () => {
    const result = generateChecklist(selfEmployedRefi, undefined, TEST_DATE);
    const clientRuleIds = getClientFacingRuleIds(result);
    // T2125 should NOT be in client-facing output
    expect(clientRuleIds.every((id) => id !== 's4_t2125_check')).toBe(true);
    // BUT should be in internal flags
    const internalRuleIds = result.internalFlags.map((f) => f.ruleId);
    expect(internalRuleIds).toContain('s4_t2125_check');
  });

  test('4. T776 is NOT requested separately (is internal-only)', () => {
    // Create inline fixture with rental income
    const rentalFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      properties: [
        {
          ...employedPurchase.properties[0],
          rentalIncome: 1500,
        },
      ],
    };
    const result = generateChecklist(rentalFixture, undefined, TEST_DATE);
    const clientRuleIds = getClientFacingRuleIds(result);
    // T776 should NOT be in client-facing output
    expect(clientRuleIds.every((id) => id !== 's10_t776_check')).toBe(true);
    // But internal check exists
    const internalRuleIds = result.internalFlags.map((f) => f.ruleId);
    expect(internalRuleIds).toContain('s10_t776_check');
  });

  test('5. Equifax/TransUnion reports NOT requested for bankruptcy', () => {
    // Bankruptcy is dormant (manual flag), but verify no credit report rule exists
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const allRuleIds = [
      ...getClientFacingRuleIds(result),
      ...result.internalFlags.map((f) => f.ruleId),
    ];
    expect(allRuleIds.every((id) => !id.includes('equifax'))).toBe(true);
    expect(allRuleIds.every((id) => !id.includes('transunion'))).toBe(true);
  });

  test('6. Evidence of strong credit history NOT in borrowed down payment', () => {
    // Create inline fixture with borrowed DP
    const borrowedFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      assets: [
        ...employedPurchase.assets,
        {
          id: 'asset-borrowed',
          applicationId: employedPurchase.application.id,
          type: 'other',
          value: 20000,
          downPayment: 20000,
          description: 'Borrowed from line of credit',
          owners: ['borrower-001'],
          visibility: null,
        },
      ],
    };
    const result = generateChecklist(borrowedFixture, undefined, TEST_DATE);
    const ruleIds = getClientFacingRuleIds(result);
    expect(ruleIds.every((id) => !id.includes('credit_history_evidence'))).toBe(true);
  });

  test('7. Home inspection report NOT in purchase', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const ruleIds = getClientFacingRuleIds(result);
    expect(ruleIds.every((id) => !id.includes('home_inspection'))).toBe(true);
  });

  test('8. Payout statement NOT in refinance', () => {
    const result = generateChecklist(selfEmployedRefi, undefined, TEST_DATE);
    const ruleIds = getClientFacingRuleIds(result);
    expect(ruleIds.every((id) => !id.includes('payout_statement'))).toBe(true);
  });

  test('9. International credit NOT in work permit section', () => {
    // Work permit section is dormant, but verify no international credit rule fires
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const ruleIds = getClientFacingRuleIds(result);
    expect(ruleIds.every((id) => !id.includes('international_credit'))).toBe(true);
  });

  test('10. Foreign bank letter NOT in non-resident section', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const ruleIds = getClientFacingRuleIds(result);
    expect(ruleIds.every((id) => !id.includes('foreign_bank_letter'))).toBe(true);
  });

  test('11. First-time buyer declaration NOT requested (internal flag only)', () => {
    // Create inline fixture with firstTime:true borrower
    const ftbFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      borrowers: [
        {
          ...employedPurchase.borrowers[0],
          firstTime: true,
        },
      ],
    };
    const result = generateChecklist(ftbFixture, undefined, TEST_DATE);
    const clientRuleIds = getClientFacingRuleIds(result);
    // No FTB declaration in client output
    expect(clientRuleIds.every((id) => !id.includes('ftb_declaration'))).toBe(true);
    // FTB flag IS in internal flags
    const internalRuleIds = result.internalFlags.map((f) => f.ruleId);
    expect(internalRuleIds).toContain('s17_ftb_flag');
  });

  test('12. Retired NOA is NOT requested', () => {
    const result = generateChecklist(retiredCondo, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    // No section 1 NOAs should fire for retired
    expect(ruleIds).not.toContain('s1_noa_previous');
    expect(ruleIds).not.toContain('s1_noa_current');
    // No retired-specific NOA rule exists
    expect(ruleIds.every((id) => !id.includes('s7_noa'))).toBe(true);
  });

  test('13. RRIF/Annuity NOT requested for retired', () => {
    const result = generateChecklist(retiredCondo, undefined, TEST_DATE);
    const allRuleIds = [
      ...result.borrowerChecklists[0].items.map((i) => i.ruleId),
      ...result.internalFlags.map((f) => f.ruleId),
    ];
    expect(allRuleIds.every((id) => !id.includes('rrif'))).toBe(true);
    expect(allRuleIds.every((id) => !id.includes('annuity'))).toBe(true);
  });
});
