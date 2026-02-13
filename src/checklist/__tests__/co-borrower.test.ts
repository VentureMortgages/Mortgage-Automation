/**
 * CHKL-04: Co-Borrower Duplication Tests
 *
 * Verifies that per-borrower rules are evaluated for EACH borrower,
 * producing separate BorrowerChecklist entries with correct names
 * and appropriate income-specific items.
 */

import { describe, test, expect } from 'vitest';
import { generateChecklist } from '../engine/index.js';
import { coBorrowerMixed } from './fixtures/index.js';

const TEST_DATE = new Date('2026-02-15');

describe('CHKL-04: Co-borrower duplication', () => {
  const result = generateChecklist(coBorrowerMixed, undefined, TEST_DATE);

  test('generates separate BorrowerChecklist for each borrower', () => {
    expect(result.borrowerChecklists.length).toBe(2);
  });

  test('each borrower has correct name', () => {
    const names = result.borrowerChecklists.map((bc) => bc.borrowerName);
    expect(names).toContain('Alice Main');
    expect(names).toContain('Bob Co');
  });

  test('main borrower is flagged correctly', () => {
    const alice = result.borrowerChecklists.find(
      (bc) => bc.borrowerName === 'Alice Main'
    );
    const bob = result.borrowerChecklists.find(
      (bc) => bc.borrowerName === 'Bob Co'
    );
    expect(alice!.isMainBorrower).toBe(true);
    expect(bob!.isMainBorrower).toBe(false);
  });

  test('both borrowers get base pack items', () => {
    for (const bc of result.borrowerChecklists) {
      const ruleIds = bc.items.map((i) => i.ruleId);
      expect(ruleIds).toContain('s0_photo_id');
      expect(ruleIds).toContain('s0_second_id');
    }
  });

  test('both borrowers get their own income docs', () => {
    const alice = result.borrowerChecklists.find(
      (bc) => bc.borrowerName === 'Alice Main'
    );
    const bob = result.borrowerChecklists.find(
      (bc) => bc.borrowerName === 'Bob Co'
    );

    // Both have salary/hourly income, so both get section 1 items
    const aliceRuleIds = alice!.items.map((i) => i.ruleId);
    const bobRuleIds = bob!.items.map((i) => i.ruleId);

    expect(aliceRuleIds).toContain('s1_paystub');
    expect(aliceRuleIds).toContain('s1_loe');
    expect(bobRuleIds).toContain('s1_paystub');
    expect(bobRuleIds).toContain('s1_loe');
  });

  test('bonus-specific docs only appear for borrower with bonuses', () => {
    const alice = result.borrowerChecklists.find(
      (bc) => bc.borrowerName === 'Alice Main'
    );
    const bob = result.borrowerChecklists.find(
      (bc) => bc.borrowerName === 'Bob Co'
    );

    const aliceRuleIds = alice!.items.map((i) => i.ruleId);
    const bobRuleIds = bob!.items.map((i) => i.ruleId);

    // Bob (bonuses:true) should have bonus items
    expect(bobRuleIds).toContain('s10_bonus_t4s');
    expect(bobRuleIds).toContain('s10_bonus_letter');

    // Alice (bonuses:false) should NOT have bonus items
    expect(aliceRuleIds).not.toContain('s10_bonus_t4s');
    expect(aliceRuleIds).not.toContain('s10_bonus_letter');
  });
});
