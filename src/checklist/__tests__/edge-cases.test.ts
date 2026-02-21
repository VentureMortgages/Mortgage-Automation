/**
 * Edge Cases — Robustness Tests
 *
 * Verifies the engine handles missing, unexpected, or unusual data
 * gracefully without crashing.
 */

import { describe, test, expect } from 'vitest';
import { generateChecklist } from '../engine/index.js';
import { getTaxYears } from '../utils/tax-years.js';
import type { FinmoApplicationResponse } from '../types/index.js';
import {
  employedPurchase,
  selfEmployedRefi,
  minimalApplication,
} from './fixtures/index.js';

const TEST_DATE = new Date('2026-02-15');

describe('Edge cases', () => {
  test('minimal application produces base pack without crashing', () => {
    const result = generateChecklist(minimalApplication, undefined, TEST_DATE);

    // Should have valid structure
    expect(result.applicationId).toBe('test-minimal-001');
    expect(result.borrowerChecklists).toHaveLength(1);

    // Base pack items present
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s0_id');

    // No income-specific items (no income data)
    expect(ruleIds).not.toContain('s1_paystub');
    expect(ruleIds).not.toContain('s3_t1_current');
    expect(ruleIds).not.toContain('s7_pension_letter');
  });

  test('unknown income source does not crash', () => {
    // Create fixture with unknown income source
    const unknownFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      incomes: [
        {
          ...employedPurchase.incomes[0],
          source: 'unknown_weird_type',
          payType: null,
          jobType: null,
        },
      ],
    };
    const result = generateChecklist(unknownFixture, undefined, TEST_DATE);
    // Should not crash — just no income-specific items
    expect(result.borrowerChecklists).toHaveLength(1);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    // Base pack still present
    expect(ruleIds).toContain('s0_id');
    // No employed/SE/retired items
    expect(ruleIds).not.toContain('s1_paystub');
    expect(ruleIds).not.toContain('s3_t1_current');
    expect(ruleIds).not.toContain('s7_pension_letter');
  });

  test('borrower with multiple incomes deduplicates items', () => {
    // Two salaried incomes for the same borrower
    const multiIncomeFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      incomes: [
        {
          ...employedPurchase.incomes[0],
          id: 'income-multi-1',
        },
        {
          ...employedPurchase.incomes[0],
          id: 'income-multi-2',
          business: 'Second Corp',
          title: 'Part-time Dev',
        },
      ],
    };
    const result = generateChecklist(multiIncomeFixture, undefined, TEST_DATE);

    // Should have only ONE s1_paystub (deduplicated)
    const paystubItems = result.borrowerChecklists[0].items.filter(
      (i) => i.ruleId === 's1_paystub'
    );
    expect(paystubItems).toHaveLength(1);

    // Should have only ONE s1_loe
    const loeItems = result.borrowerChecklists[0].items.filter(
      (i) => i.ruleId === 's1_loe'
    );
    expect(loeItems).toHaveLength(1);
  });

  test('empty borrowers array produces empty checklists', () => {
    const noBorrowerFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      borrowers: [],
    };
    const result = generateChecklist(noBorrowerFixture, undefined, TEST_DATE);
    expect(result.borrowerChecklists).toHaveLength(0);
    // Shared items are still evaluated (using main borrower context which is null)
    // Engine should not crash
    expect(result.warnings).toBeDefined();
  });

  test('Finmo hourly_guaranted payType triggers salary/hourly rules', () => {
    const fixture: FinmoApplicationResponse = {
      ...employedPurchase,
      incomes: [
        {
          ...employedPurchase.incomes[0],
          payType: 'hourly_guaranted',
        },
      ],
    };
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s1_paystub');
    expect(ruleIds).toContain('s1_loe');
    expect(ruleIds).toContain('s1_t4_previous');
    expect(ruleIds).toContain('s1_t4_current');
  });

  test('Finmo hourly_non_guaranted payType triggers salary/hourly rules', () => {
    const fixture: FinmoApplicationResponse = {
      ...employedPurchase,
      incomes: [
        {
          ...employedPurchase.incomes[0],
          payType: 'hourly_non_guaranted',
        },
      ],
    };
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s1_paystub');
    expect(ruleIds).toContain('s1_loe');
  });

  test('Finmo self-employed source (hyphen) triggers SE rules', () => {
    const fixture: FinmoApplicationResponse = {
      ...selfEmployedRefi,
      incomes: [
        {
          ...selfEmployedRefi.incomes[0],
          source: 'self-employed',
        },
      ],
    };
    const result = generateChecklist(fixture, undefined, TEST_DATE);
    const ruleIds = result.borrowerChecklists[0].items.map((i) => i.ruleId);
    expect(ruleIds).toContain('s3_t1_current');
    expect(ruleIds).toContain('s3_t1_previous');
    expect(ruleIds).toContain('s3_noa_current');
    expect(ruleIds).toContain('s3_noa_previous');
  });

  test('tax year calculation is dynamic based on date', () => {
    // getTaxYears uses the date to calculate which tax year is "current"
    // Before May: currentTaxYear = year - 1 (T4s not yet available)
    const febYears = getTaxYears(new Date('2026-02-15'));
    expect(febYears.currentTaxYear).toBe(2025);
    expect(febYears.previousTaxYear).toBe(2024);
    expect(febYears.t4Available).toBe(false);

    // After May: currentTaxYear = year (T4s available)
    const juneYears = getTaxYears(new Date('2026-06-15'));
    expect(juneYears.currentTaxYear).toBe(2026);
    expect(juneYears.previousTaxYear).toBe(2025);
    expect(juneYears.t4Available).toBe(true);

    // Verify that generated displayNames include a tax year reference
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const t4Current = result.borrowerChecklists[0].items.find(
      (i) => i.ruleId === 's1_t4_current'
    );
    // displayName should contain a 4-digit year
    expect(t4Current!.displayName).toMatch(/\d{4}/);
  });
});
