/**
 * Barrel export for all checklist rules.
 *
 * Combines all rule arrays into a single `allRules` export.
 * Also exports individual rule arrays for testing and selective use.
 *
 * Rule counts by file:
 * - base-pack:              3 rules  (Section 0)
 * - income-employed:        9 rules  (Sections 1-2)
 * - income-self-employed:  14 rules  (Sections 3-6)
 * - income-other:           9 rules  (Sections 7-9)
 * - variable-income:       16 rules  (Section 10)
 * - liabilities:            3 rules  (Section 11)
 * - situations:             7 rules  (Sections 12-13)
 * - down-payment:          15 rules  (Section 14)
 * - property:              11 rules  (Section 15)
 * - residency:             15 rules  (Sections 16-17)
 * ---
 * Total:                  ~102 rules
 */

import type { ChecklistRule } from '../types/index.js';
import { basePackRules } from './base-pack.js';
import { incomeEmployedRules } from './income-employed.js';
import { incomeSelfEmployedRules } from './income-self-employed.js';
import { incomeOtherRules } from './income-other.js';
import { variableIncomeRules } from './variable-income.js';
import { liabilityRules } from './liabilities.js';
import { situationRules } from './situations.js';
import { downPaymentRules } from './down-payment.js';
import { propertyRules } from './property.js';
import { residencyRules } from './residency.js';

// Re-export individual rule arrays for targeted testing
export {
  basePackRules,
  incomeEmployedRules,
  incomeSelfEmployedRules,
  incomeOtherRules,
  variableIncomeRules,
  liabilityRules,
  situationRules,
  downPaymentRules,
  propertyRules,
  residencyRules,
};

/** All checklist rules combined — used by the rule engine for evaluation */
export const allRules: ChecklistRule[] = [
  ...basePackRules,
  ...incomeEmployedRules,
  ...incomeSelfEmployedRules,
  ...incomeOtherRules,
  ...variableIncomeRules,
  ...liabilityRules,
  ...situationRules,
  ...downPaymentRules,
  ...propertyRules,
  ...residencyRules,
];

/**
 * Sections that require Cat's manual activation.
 *
 * Rules in these sections have conditions that always return false.
 * Cat must manually flag an application to enable them.
 */
export const manualFlagSections = [
  {
    section: '6_income_self_employed_stated',
    description: 'Stated Income / B Lender — not auto-detectable from Finmo',
  },
  {
    section: '8_income_maternity',
    description: 'Maternity / Parental Leave — not auto-detectable from Finmo',
  },
  {
    section: '9_income_probation',
    description: 'Probation — not reliably inferred from short tenure',
  },
  {
    section: '10_variable_income_support',
    description: 'Support Income (Receiving) — not auto-detectable from Finmo',
  },
  {
    section: '10_variable_income_other',
    description: 'Other Income (disability, social assistance, trust, investment) — not auto-detectable',
  },
  {
    section: '13_situations_bankruptcy',
    description: 'Bankruptcy / Consumer Proposal — not auto-detectable from Finmo',
  },
  {
    section: '16_residency_newcomer',
    description: 'Newcomer (PR < 5 years) — not auto-detectable from Finmo',
  },
  {
    section: '16_residency_work_permit',
    description: 'Work Permit — not auto-detectable from Finmo',
  },
  {
    section: '16_residency_non_resident',
    description: 'Non-Resident (Foreign Buyer) — not auto-detectable from Finmo',
  },
] as const;
