/**
 * Section 11: Liabilities (Debts)
 *
 * Covers mortgage statements, LOC statements, and support payment agreements.
 *
 * Note: Credit card, car loan, student loan, and personal loan statements are
 * NOT requested — they appear on the credit report.
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if borrower has properties (other than the subject property) with mortgages.
 */
function hasOtherMortgagedProperties(ctx: RuleContext): boolean {
  const subjectPropertyId = ctx.application.propertyId;
  return ctx.properties.some(
    (prop) =>
      prop.id !== subjectPropertyId &&
      prop.mortgaged === true
  );
}

/** Check if borrower has unsecured line of credit liabilities */
function hasLineOfCredit(ctx: RuleContext): boolean {
  return ctx.borrowerLiabilities.some(
    (lib) => lib.type === 'unsecured_line_credit'
  );
}

/** Check if borrower is divorced or separated (triggers support liability docs) */
function isDivorcedOrSeparated(ctx: RuleContext): boolean {
  return (
    ctx.borrower.marital === 'divorced' ||
    ctx.borrower.marital === 'separated'
  );
}

// ---------------------------------------------------------------------------
// Section 11: Liabilities
// ---------------------------------------------------------------------------

export const liabilityRules: ChecklistRule[] = [
  {
    id: 's11_mortgage_statements',
    section: '11_liabilities',
    document: 'Mortgage statements for other properties',
    displayName: 'Mortgage statements for other properties owned',
    stage: 'PRE',
    scope: 'per_borrower',
    condition: hasOtherMortgagedProperties,
  },
  {
    id: 's11_loc_statements',
    section: '11_liabilities',
    document: 'Line of credit statements',
    displayName: 'Line of credit statements',
    stage: 'PRE',
    scope: 'per_borrower',
    condition: hasLineOfCredit,
  },
  {
    id: 's11_support_agreement',
    section: '11_liabilities_support',
    document: 'Separation agreement / court order (paying support)',
    displayName: 'Separation agreement or court order (for support obligations)',
    stage: 'PRE',
    scope: 'per_borrower',
    condition: isDivorcedOrSeparated,
    notes: 'May overlap with Section 12 (Divorce/Separation) documents',
  },
];
