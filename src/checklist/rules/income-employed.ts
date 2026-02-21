/**
 * Sections 1-2: Income — Employed Rules
 *
 * Section 1: Salary / Hourly employees
 * Section 2: Contract / Seasonal employees
 *
 * Condition functions check borrowerIncomes for matching employment types.
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';
import { getTaxYears } from '../utils/tax-years.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if borrower has salary/hourly employment income.
 *  Finmo sends payType as 'salaried', 'hourly_guaranted', or 'hourly_non_guaranted'
 *  so we use startsWith('hourly') to catch all hourly variants. */
function hasSalaryOrHourly(ctx: RuleContext): boolean {
  return ctx.borrowerIncomes.some(
    (inc) =>
      inc.source === 'employed' &&
      (inc.payType === 'salaried' || inc.payType?.startsWith('hourly'))
  );
}

/** Check if borrower has contract/seasonal employment income */
function hasContract(ctx: RuleContext): boolean {
  return ctx.borrowerIncomes.some(
    (inc) => inc.source === 'employed' && inc.jobType === 'contract'
  );
}

// ---------------------------------------------------------------------------
// Section 1: Salary / Hourly
// ---------------------------------------------------------------------------

function salaryHourlyRules(): ChecklistRule[] {
  return [
    {
      id: 's1_paystub',
      section: '1_income_employed_salary',
      document: 'Recent paystub (within 30 days)',
      displayName: 'Recent pay stub (must show YTD earnings)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasSalaryOrHourly,
    },
    {
      id: 's1_loe',
      section: '1_income_employed_salary',
      document: 'Letter of Employment',
      displayName:
        'Letter of Employment (dated within the last 30 days) — must include: position, start date, salary, full-time/part-time, guaranteed hours',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasSalaryOrHourly,
    },
    {
      id: 's1_t4_previous',
      section: '1_income_employed_salary',
      document: 'T4 — Previous year',
      get displayName() {
        const { previousTaxYear } = getTaxYears(new Date());
        return `${previousTaxYear} T4`;
      },
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasSalaryOrHourly,
    },
    {
      id: 's1_t4_current',
      section: '1_income_employed_salary',
      document: 'T4 — Current year',
      get displayName() {
        const { currentTaxYear } = getTaxYears(new Date());
        return `${currentTaxYear} T4`;
      },
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasSalaryOrHourly,
      notes:
        'If not yet available, provide last pay stub of the previous year showing year-end earnings',
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 2: Contract / Seasonal
// ---------------------------------------------------------------------------

function contractRules(): ChecklistRule[] {
  return [
    {
      id: 's2_contract',
      section: '2_income_employed_contract',
      document: 'Employment contract',
      displayName: 'Employment contract (term, rate, renewal likelihood)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasContract,
    },
    {
      id: 's2_t4s_2year',
      section: '2_income_employed_contract',
      document: '2 years of T4s',
      get displayName() {
        const { currentTaxYear, previousTaxYear } = getTaxYears(new Date());
        return `${previousTaxYear} and ${currentTaxYear} T4s`;
      },
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasContract,
    },
    {
      id: 's2_noas',
      section: '2_income_employed_contract',
      document: 'NOAs (current + previous)',
      get displayName() {
        const { currentTaxYear, previousTaxYear } = getTaxYears(new Date());
        return `${previousTaxYear} and ${currentTaxYear} Notices of Assessment (NOAs)`;
      },
      stage: 'FULL',
      scope: 'per_borrower',
      condition: hasContract,
    },
  ];
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const incomeEmployedRules: ChecklistRule[] = [
  ...salaryHourlyRules(),
  ...contractRules(),
];
