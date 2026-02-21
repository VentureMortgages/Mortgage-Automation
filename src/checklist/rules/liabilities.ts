/**
 * Section 11: Liabilities (Debts)
 *
 * Covers LOC statements.
 *
 * Note: Credit card, car loan, student loan, and personal loan statements are
 * NOT requested — they appear on the credit report.
 *
 * Removed (Cat feedback):
 * - s11_mortgage_statements: All properties are already in the application
 * - s11_support_agreement: Consolidated into situations.ts (s12_separation_agreement)
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if borrower has unsecured line of credit liabilities */
function hasLineOfCredit(ctx: RuleContext): boolean {
  return ctx.borrowerLiabilities.some(
    (lib) => lib.type === 'unsecured_line_credit'
  );
}

// ---------------------------------------------------------------------------
// Section 11: Liabilities
// ---------------------------------------------------------------------------

export const liabilityRules: ChecklistRule[] = [
  {
    id: 's11_loc_statements',
    section: '11_liabilities',
    document: 'Line of credit statements',
    displayName: 'Line of credit statements',
    stage: 'PRE',
    scope: 'per_borrower',
    condition: hasLineOfCredit,
  },
];
