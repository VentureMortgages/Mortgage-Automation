/**
 * Sections 7-9: Income — Other Types
 *
 * Section 7: Retired (pension, CPP/OAS, investment income)
 * Section 8: Maternity / Parental Leave (dormant — manual flag)
 * Section 9: Probation (dormant — manual flag)
 *
 * Exclusions (CHKL-05):
 * - Retired NOA: Removed by Cat ("Not required")
 * - RRIF/Annuity statement: Removed by Cat ("Rarely see this")
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if borrower has retired income */
function isRetired(ctx: RuleContext): boolean {
  return ctx.borrowerIncomes.some((inc) => inc.source === 'retired');
}

/**
 * Maternity/Parental leave is NOT auto-detectable from Finmo data.
 * Always returns false — requires Cat's manual activation.
 */
function isMaternity(_ctx: RuleContext): boolean {
  return false;
}

/**
 * Probation is NOT reliably auto-detectable from Finmo data.
 * Short tenure does not necessarily mean probation.
 * Always returns false — requires Cat's manual activation.
 */
function isProbation(_ctx: RuleContext): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Section 7: Retired
// ---------------------------------------------------------------------------

function retiredRules(): ChecklistRule[] {
  return [
    {
      id: 's7_pension_letter',
      section: '7_income_retired',
      document: 'Pension letter stating current year entitlement',
      displayName: 'Pension letter stating current year entitlement',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isRetired,
    },
    {
      id: 's7_cpp_oas_t4a',
      section: '7_income_retired',
      document: '2 years CPP/OAS T4As',
      displayName: '2 years of CPP/OAS T4A slips',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isRetired,
      notes: 'If applicable',
    },
    {
      id: 's7_bank_pension',
      section: '7_income_retired',
      document: '3 months bank statements showing pension deposits',
      displayName: '3 months of bank statements showing pension deposits',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isRetired,
    },
    {
      id: 's7_t5s',
      section: '7_income_retired',
      document: '2 years T5s',
      displayName: '2 years of T5 slips (dividends / investment income)',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isRetired,
      notes: 'If receiving dividends or investment income',
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 8: Maternity / Parental Leave (dormant)
// ---------------------------------------------------------------------------

function maternityRules(): ChecklistRule[] {
  return [
    {
      id: 's8_loe_return',
      section: '8_income_maternity',
      document: 'LOE confirming return date',
      displayName:
        'Letter of Employment confirming return date (must show guaranteed return)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isMaternity,
    },
    {
      id: 's8_pre_leave_paystub',
      section: '8_income_maternity',
      document: 'Pre-leave paystub',
      displayName: 'Pre-leave pay stub (showing pre-leave salary)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isMaternity,
    },
    {
      id: 's8_ei_statement',
      section: '8_income_maternity',
      document: 'EI statement',
      displayName: 'Employment Insurance (EI) benefit statement',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isMaternity,
      notes: 'If applicable',
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 9: Probation (dormant)
// ---------------------------------------------------------------------------

function probationRules(): ChecklistRule[] {
  return [
    {
      id: 's9_loe_probation',
      section: '9_income_probation',
      document: 'LOE with probation details',
      displayName:
        'Letter of Employment with probation details (end date, confirmation of permanent hire)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isProbation,
    },
    {
      id: 's9_employment_history',
      section: '9_income_probation',
      document: '3 years previous employment history',
      displayName: '3 years of previous employment history',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isProbation,
      notes: 'If not included in application',
    },
  ];
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const incomeOtherRules: ChecklistRule[] = [
  ...retiredRules(),
  ...maternityRules(),
  ...probationRules(),
];
