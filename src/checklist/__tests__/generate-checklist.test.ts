/**
 * Core Checklist Generation Tests
 *
 * Tests all 6 success criteria from the Phase 3 roadmap,
 * plus CHKL-01 (personalized checklist), CHKL-02 (rules match V2),
 * and CHKL-03 (PRE + FULL upfront).
 */

import { describe, test, expect } from 'vitest';
import { generateChecklist } from '../engine/index.js';
import {
  employedPurchase,
  selfEmployedRefi,
  retiredCondo,
  minimalApplication,
} from './fixtures/index.js';

/** Fixed date for deterministic tax year: Feb 2026 => currentTaxYear=2025, previousTaxYear=2024 */
const TEST_DATE = new Date('2026-02-15');

// ---------------------------------------------------------------------------
// SC1: Employed borrower gets correct docs
// ---------------------------------------------------------------------------

describe('SC1: Employed borrower', () => {
  const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
  const borrower = result.borrowerChecklists.find(
    (bc) => bc.borrowerName === 'John Test'
  );

  test('result has BorrowerChecklist for "John Test"', () => {
    expect(borrower).toBeDefined();
    expect(borrower!.borrowerName).toBe('John Test');
    expect(borrower!.isMainBorrower).toBe(true);
  });

  test('borrower items include pay stub and LOE', () => {
    const ruleIds = borrower!.items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s1_paystub');
    expect(ruleIds).toContain('s1_loe');
  });

  test('borrower items include T4s (current + previous year)', () => {
    const ruleIds = borrower!.items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s1_t4_previous');
    expect(ruleIds).toContain('s1_t4_current');
  });

  test('borrower items include NOAs (current + previous year)', () => {
    const ruleIds = borrower!.items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s1_noa_previous');
    expect(ruleIds).toContain('s1_noa_current');
  });

  test('shared items include 90-day bank statements for savings', () => {
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_savings_bank');
  });

  test('base pack items present for borrower', () => {
    const ruleIds = borrower!.items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s0_photo_id');
    expect(ruleIds).toContain('s0_second_id');
  });

  test('shared items include void cheque (base pack)', () => {
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s0_void_cheque');
  });
});

// ---------------------------------------------------------------------------
// SC2: Self-employed borrower gets correct docs
// ---------------------------------------------------------------------------

describe('SC2: Self-employed borrower', () => {
  const result = generateChecklist(selfEmployedRefi, undefined, TEST_DATE);
  const borrower = result.borrowerChecklists.find(
    (bc) => bc.borrowerName === 'Jane SelfEmp'
  );

  test('borrower items include T1s (current + previous)', () => {
    const ruleIds = borrower!.items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s3_t1_current');
    expect(ruleIds).toContain('s3_t1_previous');
  });

  test('borrower items include NOAs (current + previous)', () => {
    const ruleIds = borrower!.items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s3_noa_current');
    expect(ruleIds).toContain('s3_noa_previous');
  });

  test('borrower items include sole prop docs (ambiguous businessType falls back to sole prop)', () => {
    // When businessType is null, the engine treats as sole prop (safe fallback)
    // s4_t2125_check is internalOnly, so it goes to internalFlags
    const internalRuleIds = result.internalFlags.map((f) => f.ruleId);
    expect(internalRuleIds).toContain('s4_t2125_check');
  });

  test('shared items do NOT include savings bank statements (refinance = no DP needed)', () => {
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).not.toContain('s14_savings_bank');
  });

  test('shared items include refinance docs', () => {
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s15_refi_mortgage');
    expect(sharedRuleIds).toContain('s15_refi_tax');
  });
});

// ---------------------------------------------------------------------------
// SC6: All PRE and FULL items in single output
// ---------------------------------------------------------------------------

describe('SC6: All PRE and FULL in single output', () => {
  const result = generateChecklist(employedPurchase, undefined, TEST_DATE);

  test('result contains items with stage PRE', () => {
    const allItems = [
      ...result.borrowerChecklists.flatMap((bc) => bc.items),
      ...result.sharedItems,
    ];
    const preItems = allItems.filter((i) => i.stage === 'PRE');
    expect(preItems.length).toBeGreaterThan(0);
  });

  test('result contains items with stage FULL', () => {
    const allItems = [
      ...result.borrowerChecklists.flatMap((bc) => bc.items),
      ...result.sharedItems,
    ];
    const fullItems = allItems.filter((i) => i.stage === 'FULL');
    expect(fullItems.length).toBeGreaterThan(0);
  });

  test('both PRE and FULL items coexist in same arrays (not separated)', () => {
    // Borrower items should contain both stages
    const borrowerItems = result.borrowerChecklists[0].items;
    const stages = new Set(borrowerItems.map((i) => i.stage));
    expect(stages.has('PRE')).toBe(true);
    expect(stages.has('FULL')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CHKL-01: Generates personalized checklist from Finmo data
// ---------------------------------------------------------------------------

describe('CHKL-01: Generates personalized checklist from Finmo data', () => {
  test('employed fixture produces employed-specific docs', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s1_paystub');
    expect(ruleIds).toContain('s1_loe');
  });

  test('self-employed fixture produces self-employed-specific docs', () => {
    const result = generateChecklist(selfEmployedRefi, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s3_t1_current');
    expect(ruleIds).toContain('s3_t1_previous');
  });

  test('retired fixture produces retired-specific docs', () => {
    const result = generateChecklist(retiredCondo, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s7_pension_letter');
    expect(ruleIds).toContain('s7_cpp_oas_t4a');
  });

  test('employed fixture does NOT produce self-employed docs', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).not.toContain('s3_t1_current');
    expect(ruleIds).not.toContain('s3_t1_previous');
  });
});

// ---------------------------------------------------------------------------
// CHKL-02: Rules match DOC_CHECKLIST_RULES_V2
// ---------------------------------------------------------------------------

describe('CHKL-02: Rules match DOC_CHECKLIST_RULES_V2', () => {
  test('base pack has exactly 3 items (2 IDs + void cheque)', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const borrowerBasePack = result.borrowerChecklists[0].items.filter(
      (i) => i.section === '0_base_pack'
    );
    const sharedBasePack = result.sharedItems.filter(
      (i) => i.section === '0_base_pack'
    );
    // 2 per-borrower (photo_id, second_id) + 1 shared (void_cheque)
    expect(borrowerBasePack.length).toBe(2);
    expect(sharedBasePack.length).toBe(1);
  });

  test('employed salary produces 6 income items (paystub, LOE, 2 T4s, 2 NOAs)', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const section1Items = result.borrowerChecklists[0].items.filter(
      (i) => i.section === '1_income_employed_salary'
    );
    expect(section1Items.length).toBe(6);
  });

  test('retired produces pension letter, CPP T4As, bank statements, T5s', () => {
    const result = generateChecklist(retiredCondo, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s7_pension_letter');
    expect(ruleIds).toContain('s7_cpp_oas_t4a');
    expect(ruleIds).toContain('s7_bank_pension');
    expect(ruleIds).toContain('s7_t5s');
  });

  test('retired does NOT produce NOA (Cat removed) or RRIF', () => {
    const result = generateChecklist(retiredCondo, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    // No retired-specific NOA rule exists (Cat removed it)
    // Employed NOA rules should not fire for retired borrower
    expect(ruleIds).not.toContain('s1_noa_previous');
    expect(ruleIds).not.toContain('s1_noa_current');
    // No RRIF rule exists at all (Cat removed it)
    const allRuleIds = [
      ...ruleIds,
      ...result.internalFlags.map((f) => f.ruleId),
    ];
    expect(allRuleIds.every((id) => !id.includes('rrif'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CHKL-03: PRE + FULL upfront
// ---------------------------------------------------------------------------

describe('CHKL-03: PRE + FULL upfront', () => {
  test('items array contains both stage PRE and stage FULL items', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const allItems = [
      ...result.borrowerChecklists.flatMap((bc) => bc.items),
      ...result.sharedItems,
    ];
    const stages = new Set(allItems.map((i) => i.stage));
    expect(stages.has('PRE')).toBe(true);
    expect(stages.has('FULL')).toBe(true);
  });

  test('no filtering or separation by stage in the output', () => {
    // The output is a flat array per borrower/shared, not split by stage
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    // Verify borrowerChecklists[0].items has both PRE and FULL
    const borrowerStages = new Set(
      result.borrowerChecklists[0].items.map((i) => i.stage)
    );
    expect(borrowerStages.size).toBeGreaterThanOrEqual(2);
  });
});
