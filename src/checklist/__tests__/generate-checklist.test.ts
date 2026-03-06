/**
 * Core Checklist Generation Tests
 *
 * Tests all 6 success criteria from the Phase 3 roadmap,
 * plus CHKL-01 (personalized checklist), CHKL-02 (rules match V2),
 * and CHKL-03 (PRE + FULL upfront).
 */

import { describe, test, expect } from 'vitest';
import { generateChecklist } from '../engine/index.js';
import type { FinmoApplicationResponse } from '../types/index.js';
import {
  employedPurchase,
  selfEmployedRefi,
  retiredCondo,
  minimalApplication,
  pensionPurchase,
  rentalMixedUse,
  supportIncome,
  emptyAssetsDp,
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

  test('shared items include consolidated DP bank statement', () => {
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_dp_bank_statement');
  });

  test('base pack items present for borrower', () => {
    const ruleIds = borrower!.items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s0_id');
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

  test('shared items do NOT include DP bank statement (refinance = no DP needed)', () => {
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).not.toContain('s14_dp_bank_statement');
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

  test('both PRE and FULL items coexist in output (not separated)', () => {
    // Shared and borrower items combined should contain both stages
    const allItems = [
      ...result.borrowerChecklists.flatMap((bc) => bc.items),
      ...result.sharedItems,
    ];
    const stages = new Set(allItems.map((i) => i.stage));
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
  test('base pack has exactly 2 items (1 ID + void cheque)', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const borrowerBasePack = result.borrowerChecklists[0].items.filter(
      (i) => i.section === '0_base_pack'
    );
    const sharedBasePack = result.sharedItems.filter(
      (i) => i.section === '0_base_pack'
    );
    // 1 per-borrower (consolidated ID) + 1 shared (void_cheque)
    expect(borrowerBasePack.length).toBe(1);
    expect(sharedBasePack.length).toBe(1);
  });

  test('employed salary produces 4 income items (paystub, LOE, 2 T4s)', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const section1Items = result.borrowerChecklists[0].items.filter(
      (i) => i.section === '1_income_employed_salary'
    );
    expect(section1Items.length).toBe(4);
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
    // Combined output has both PRE and FULL items
    const allStages = new Set([
      ...result.borrowerChecklists.flatMap((bc) => bc.items.map((i) => i.stage)),
      ...result.sharedItems.map((i) => i.stage),
    ]);
    expect(allStages.size).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// BUG 1: Per-property rental rule evaluation
// ---------------------------------------------------------------------------

describe('BUG 1: Per-property rental rule evaluation', () => {
  const result = generateChecklist(rentalMixedUse, undefined, TEST_DATE);

  test('rental property (owner_occupied_rental) gets rental docs', () => {
    // prop-rm-002 is the rental property (use=owner_occupied_rental, rentalIncome=1500)
    const rentalPropertyChecklist = result.propertyChecklists.find(
      (pc) => pc.propertyId === 'prop-rm-002'
    );
    expect(rentalPropertyChecklist).toBeDefined();
    const ruleIds = rentalPropertyChecklist!.items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s10_rental_lease');
    expect(ruleIds).toContain('s10_rental_mortgage');
  });

  test('owner-occupied subject property does NOT get rental docs', () => {
    // prop-rm-001 is the subject property (use=owner_occupied, rentalIncome=0)
    const subjectPropertyChecklist = result.propertyChecklists.find(
      (pc) => pc.propertyId === 'prop-rm-001'
    );
    // Either it has no checklist at all (no per-property items), or it has no rental items
    if (subjectPropertyChecklist) {
      const ruleIds = subjectPropertyChecklist.items.map((i) => i.ruleId);
      expect(ruleIds).not.toContain('s10_rental_lease');
      expect(ruleIds).not.toContain('s10_rental_tax');
      expect(ruleIds).not.toContain('s10_rental_mortgage');
    }
  });

  test('rental T1 (per_borrower scope) still fires for any property with rental income', () => {
    // s10_rental_t1 is per_borrower scope, should fire when ANY property has rental income
    const borrowerRuleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(borrowerRuleIds).toContain('s10_rental_t1');
  });
});

// ---------------------------------------------------------------------------
// BUG 2: DP bank statement with empty assets
// ---------------------------------------------------------------------------

describe('BUG 2: DP bank statement with empty assets', () => {
  test('purchase with downPayment > 0 and empty assets still generates DP bank statement', () => {
    const result = generateChecklist(emptyAssetsDp, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_dp_bank_statement');
  });

  test('refinance with downPayment=0 and empty assets does NOT generate DP bank statement', () => {
    // Use the self-employed refi fixture (goal=refinance, DP=0)
    const result = generateChecklist(selfEmployedRefi, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).not.toContain('s14_dp_bank_statement');
  });

  test('purchase with downPayment=0 and empty assets does NOT generate DP bank statement', () => {
    // Create a modified empty-assets fixture with DP=0
    const zeroDpFixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(emptyAssetsDp));
    zeroDpFixture.application.downPayment = 0;
    const result = generateChecklist(zeroDpFixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).not.toContain('s14_dp_bank_statement');
  });
});

// ---------------------------------------------------------------------------
// BUG 3: Gift detection uses asset.type
// ---------------------------------------------------------------------------

describe('BUG 3: Gift detection uses asset.type', () => {
  test('asset with type="gift" triggers gift rules (no description needed)', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(employedPurchase));
    fixture.assets = [
      {
        id: 'asset-gift-type',
        applicationId: fixture.application.id,
        type: 'gift' as any,
        value: 30000,
        downPayment: 30000,
        description: '',
        owners: [fixture.borrowers[0].id],
        visibility: null,
      },
    ];
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_gift_donor_info');
    expect(sharedRuleIds).toContain('s14_gift_amount');
  });

  test('asset with type="gift_family" triggers gift rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(employedPurchase));
    fixture.assets = [
      {
        id: 'asset-gift-family',
        applicationId: fixture.application.id,
        type: 'gift_family' as any,
        value: 25000,
        downPayment: 25000,
        description: '',
        owners: [fixture.borrowers[0].id],
        visibility: null,
      },
    ];
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_gift_donor_info');
  });

  test('asset with type="other" and description="Gift from parents" still triggers gift (backward compat)', () => {
    // The existing gift-down-payment fixture uses this pattern
    const result = generateChecklist(
      // use the existing gift fixture which has type=other, description="Gift from parents"
      JSON.parse(JSON.stringify(employedPurchase)) as FinmoApplicationResponse,
      undefined,
      TEST_DATE
    );
    // Modify to have gift description
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(employedPurchase));
    fixture.assets = [
      {
        id: 'asset-desc-gift',
        applicationId: fixture.application.id,
        type: 'other' as any,
        value: 40000,
        downPayment: 40000,
        description: 'Gift from parents',
        owners: [fixture.borrowers[0].id],
        visibility: null,
      },
    ];
    const result2 = generateChecklist(fixture, undefined, TEST_DATE);
    const sharedRuleIds = result2.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_gift_donor_info');
  });

  test('asset with type="cash_savings" and no gift description does NOT trigger gift rules', () => {
    // The employed-purchase fixture has type=cash_savings, description="Savings account"
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).not.toContain('s14_gift_donor_info');
    expect(sharedRuleIds).not.toContain('s14_gift_amount');
  });
});

// ---------------------------------------------------------------------------
// BUG 4: Pension/CPP/OAS income detection
// ---------------------------------------------------------------------------

describe('BUG 4: Pension/CPP/OAS income detection', () => {
  test('income with source="pension" triggers retired rules', () => {
    const result = generateChecklist(pensionPurchase, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s7_pension_letter');
    expect(ruleIds).toContain('s7_cpp_oas_t4a');
    expect(ruleIds).toContain('s7_bank_pension');
  });

  test('income with source="cpp" triggers retired rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(pensionPurchase));
    fixture.incomes[0].source = 'cpp';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s7_pension_letter');
  });

  test('income with source="oas" triggers retired rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(pensionPurchase));
    fixture.incomes[0].source = 'oas';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s7_pension_letter');
  });

  test('income with source="canada_pension_plan" triggers retired rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(pensionPurchase));
    fixture.incomes[0].source = 'canada_pension_plan';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s7_pension_letter');
  });

  test('income with source="old_age_security" triggers retired rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(pensionPurchase));
    fixture.incomes[0].source = 'old_age_security';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s7_pension_letter');
  });

  test('income with source="retired" still triggers retired rules (backward compat)', () => {
    const result = generateChecklist(retiredCondo, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s7_pension_letter');
    expect(ruleIds).toContain('s7_cpp_oas_t4a');
  });
});

// ---------------------------------------------------------------------------
// BUG 5: Activated support and CCB rules
// ---------------------------------------------------------------------------

describe('BUG 5: Activated support and CCB rules', () => {
  test('income with source="child_support" triggers support rules', () => {
    const result = generateChecklist(supportIncome, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s10_support_agreement');
    expect(ruleIds).toContain('s10_support_proof');
  });

  test('income with source="spousal_support" triggers support rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(supportIncome));
    fixture.incomes[1].source = 'spousal_support';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s10_support_agreement');
    expect(ruleIds).toContain('s10_support_proof');
  });

  test('income with source="ccb" triggers CCB proof rule', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(supportIncome));
    fixture.incomes[1].source = 'ccb';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s10_ccb_proof');
  });

  test('income with source="canada_child_benefit" triggers CCB proof rule', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(supportIncome));
    fixture.incomes[1].source = 'canada_child_benefit';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s10_ccb_proof');
  });

  test('employed income alone does NOT trigger support or CCB rules', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).not.toContain('s10_support_agreement');
    expect(ruleIds).not.toContain('s10_support_proof');
    expect(ruleIds).not.toContain('s10_ccb_proof');
  });
});

// ---------------------------------------------------------------------------
// BUG 7: Owner-occupied/rental property use type
// ---------------------------------------------------------------------------

describe('BUG 7: Owner-occupied/rental property use type', () => {
  test('application with use="owner_occupied_rental" triggers investment appraisal', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(employedPurchase));
    fixture.application.use = 'owner_occupied_rental';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    // s15_investment_appraisal is LENDER_CONDITION stage so it won't be in sharedItems
    // but it should be generated. Check all items including internal flags.
    const allRuleIds = [
      ...result.sharedItems.map((i) => i.ruleId),
      ...result.internalFlags.map((f) => f.ruleId),
    ];
    // Investment appraisal is LENDER_CONDITION which sets forEmail=false
    // So it goes to internalFlags
    expect(allRuleIds).toContain('s15_investment_appraisal');
  });

  test('application with use="rental_investment" triggers investment appraisal', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(employedPurchase));
    fixture.application.use = 'rental_investment';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const allRuleIds = [
      ...result.sharedItems.map((i) => i.ruleId),
      ...result.internalFlags.map((f) => f.ruleId),
    ];
    expect(allRuleIds).toContain('s15_investment_appraisal');
  });

  test('application with use="owner_occupied" does NOT trigger investment rules', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const allRuleIds = [
      ...result.sharedItems.map((i) => i.ruleId),
      ...result.internalFlags.map((f) => f.ruleId),
    ];
    expect(allRuleIds).not.toContain('s15_investment_appraisal');
  });

  test('application with use="second_home" does NOT trigger investment rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(employedPurchase));
    fixture.application.use = 'second_home';
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const allRuleIds = [
      ...result.sharedItems.map((i) => i.ruleId),
      ...result.internalFlags.map((f) => f.ruleId),
    ];
    expect(allRuleIds).not.toContain('s15_investment_appraisal');
  });
});

// ---------------------------------------------------------------------------
// Cat Feedback: Commission T4 duplication (Steffie)
// ---------------------------------------------------------------------------

describe('Cat feedback: Commission T4 duplication', () => {
  test('borrower with salaried + commission income does NOT get s10_commission_t4s', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(employedPurchase));
    // Add a commission income entry alongside the salaried one
    fixture.incomes.push({
      ...fixture.incomes[0],
      id: 'income-commission',
      payType: 'commission',
      income: 20000,
      incomePeriodAmount: 20000,
    });
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    // Should have salary T4s but NOT commission T4s
    expect(ruleIds).toContain('s1_t4_previous');
    expect(ruleIds).toContain('s1_t4_current');
    expect(ruleIds).not.toContain('s10_commission_t4s');
    // Commission statements + employer letter should still appear
    expect(ruleIds).toContain('s10_commission_statements');
  });

  test('borrower with commission ONLY (no salary) DOES get s10_commission_t4s', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(employedPurchase));
    fixture.incomes = [{
      ...fixture.incomes[0],
      payType: 'commission',
    }];
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s10_commission_t4s');
    expect(ruleIds).not.toContain('s1_t4_previous');
  });
});

// ---------------------------------------------------------------------------
// Cat Feedback: Property section duplication (Steffie, Andrea & Robert, Erin)
// ---------------------------------------------------------------------------

describe('Cat feedback: Property section duplication', () => {
  test('multi-unit rental subject property does NOT get s15_multiunit_leases in shared', () => {
    // Refinance with subject property that is multi-unit AND rental
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(selfEmployedRefi));
    fixture.properties[0].numberOfUnits = 3;
    fixture.properties[0].use = 'owner_occupied_rental';
    fixture.properties[0].rentalIncome = 2500;
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    // Per-property rental rules should cover leases
    expect(sharedRuleIds).not.toContain('s15_multiunit_leases');
    // Per-property section should have the rental lease
    const propChecklist = result.propertyChecklists.find(
      (pc) => pc.propertyId === fixture.properties[0].id
    );
    expect(propChecklist).toBeDefined();
    expect(propChecklist!.items.map(i => i.ruleId)).toContain('s10_rental_lease');
  });

  test('multi-unit NON-rental subject property still gets s15_multiunit_leases', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(selfEmployedRefi));
    fixture.properties[0].numberOfUnits = 3;
    fixture.properties[0].use = 'owner_occupied';
    fixture.properties[0].rentalIncome = 0;
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s15_multiunit_leases');
  });

  test('refinance with rental subject property suppresses shared mortgage/tax (per-property covers it)', () => {
    // Subject property IS a rental — per-property rules already request mortgage + tax
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(selfEmployedRefi));
    fixture.properties[0].use = 'owner_occupied_rental';
    fixture.properties[0].rentalIncome = 1800;
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).not.toContain('s15_refi_mortgage');
    expect(sharedRuleIds).not.toContain('s15_refi_tax');
  });

  test('refinance with NON-rental subject property still has shared mortgage/tax', () => {
    // Existing behavior: non-rental refinance keeps these
    const result = generateChecklist(selfEmployedRefi, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s15_refi_mortgage');
    expect(sharedRuleIds).toContain('s15_refi_tax');
  });
});

// ---------------------------------------------------------------------------
// Cat Feedback: Self-employed getting employed docs (Paul)
// ---------------------------------------------------------------------------

describe('Cat feedback: Self-employed with inactive employed income', () => {
  test('inactive employed income does NOT trigger employed rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(selfEmployedRefi));
    // Add an inactive employed income entry (stale data from Finmo)
    fixture.incomes.push({
      ...fixture.incomes[0],
      id: 'income-old-employed',
      source: 'employed',
      payType: 'salaried',
      income: 50000,
      active: false,
      business: 'Old Job Inc',
    });
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    // Should NOT have employed docs
    expect(ruleIds).not.toContain('s1_paystub');
    expect(ruleIds).not.toContain('s1_loe');
    expect(ruleIds).not.toContain('s1_t4_previous');
    // Should still have self-employed docs
    expect(ruleIds).toContain('s3_t1_current');
    expect(ruleIds).toContain('s3_t1_previous');
  });

  test('active employed income alongside self-employed DOES trigger employed rules', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(selfEmployedRefi));
    // Add an ACTIVE employed income entry (legit part-time job)
    fixture.incomes.push({
      ...fixture.incomes[0],
      id: 'income-parttime',
      source: 'employed',
      payType: 'salaried',
      income: 30000,
      active: true,
      business: 'Part Time Co',
    });
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    // Should have BOTH employed and self-employed docs
    expect(ruleIds).toContain('s1_paystub');
    expect(ruleIds).toContain('s3_t1_current');
  });
});

// ---------------------------------------------------------------------------
// Cat Feedback: Property addresses not populated
// ---------------------------------------------------------------------------

describe('Cat feedback: Property address resolution fallback', () => {
  test('property with null addressId but address with matching propertyId resolves address', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(rentalMixedUse));
    // Set addressId to null (simulating missing link)
    fixture.properties[1].addressId = null;
    // Add propertyId to the address (fallback lookup)
    fixture.addresses[1] = {
      ...fixture.addresses[1],
      propertyId: fixture.properties[1].id,
    };
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    // Should resolve the address via propertyId fallback
    const rentalProp = result.propertyChecklists.find(
      (pc) => pc.propertyId === fixture.properties[1].id
    );
    expect(rentalProp).toBeDefined();
    expect(rentalProp!.propertyDescription).toContain('Pine');
  });

  test('property with null addressId and no propertyId fallback shows generic name', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(rentalMixedUse));
    fixture.properties[1].addressId = null;
    // No propertyId on addresses
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const rentalProp = result.propertyChecklists.find(
      (pc) => pc.propertyId === fixture.properties[1].id
    );
    expect(rentalProp).toBeDefined();
    expect(rentalProp!.propertyDescription).toBe('Additional Property');
  });

  test('address with line1 but no structured fields uses line1', () => {
    const fixture: FinmoApplicationResponse = JSON.parse(JSON.stringify(rentalMixedUse));
    // Replace structured fields with line1
    fixture.addresses[1] = {
      ...fixture.addresses[1],
      streetNumber: null,
      streetName: null,
      streetType: null,
      line1: '450 Pine Crescent',
    };
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const rentalProp = result.propertyChecklists.find(
      (pc) => pc.propertyId === fixture.properties[1].id
    );
    expect(rentalProp).toBeDefined();
    expect(rentalProp!.propertyDescription).toContain('450 Pine Crescent');
  });
});
