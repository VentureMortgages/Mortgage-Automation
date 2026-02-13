/**
 * Sections 12-13: Situations
 *
 * Section 12: Divorce / Separation
 * Section 13: Bankruptcy / Consumer Proposal (dormant — manual flag)
 *
 * Exclusions (CHKL-05):
 * - Equifax + TransUnion reports (bankruptcy): Removed ("From credit pull")
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if borrower is divorced or separated */
function isDivorcedOrSeparated(ctx: RuleContext): boolean {
  return (
    ctx.borrower.marital === 'divorced' ||
    ctx.borrower.marital === 'separated'
  );
}

/**
 * Bankruptcy / Consumer Proposal is NOT auto-detectable from Finmo data.
 * Always returns false — requires Cat's manual activation.
 */
function hasBankruptcy(_ctx: RuleContext): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Section 12: Divorce / Separation
// ---------------------------------------------------------------------------

function divorceRules(): ChecklistRule[] {
  return [
    {
      id: 's12_separation',
      section: '12_situations_divorce',
      document: 'Separation agreement (signed)',
      displayName: 'Separation agreement (signed)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isDivorcedOrSeparated,
    },
    {
      id: 's12_divorce_decree',
      section: '12_situations_divorce',
      document: 'Divorce decree / certificate',
      displayName: 'Divorce decree or certificate',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isDivorcedOrSeparated,
    },
    {
      id: 's12_property_settlement',
      section: '12_situations_divorce',
      document: 'Property settlement docs',
      displayName: 'Property settlement documents',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isDivorcedOrSeparated,
    },
    {
      id: 's12_spousal_buyout',
      section: '12_situations_divorce',
      document: 'Spousal buyout agreement',
      displayName: 'Spousal buyout agreement',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isDivorcedOrSeparated,
      notes: 'If applicable',
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 13: Bankruptcy / Consumer Proposal (dormant)
// ---------------------------------------------------------------------------

function bankruptcyRules(): ChecklistRule[] {
  return [
    {
      id: 's13_discharge',
      section: '13_situations_bankruptcy',
      document: 'Certificate of discharge (bankruptcy)',
      displayName: 'Certificate of discharge (bankruptcy)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasBankruptcy,
    },
    {
      id: 's13_full_performance',
      section: '13_situations_bankruptcy',
      document: 'Certificate of full performance (consumer proposal)',
      displayName: 'Certificate of full performance (consumer proposal)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasBankruptcy,
    },
    {
      id: 's13_explanation',
      section: '13_situations_bankruptcy',
      document: 'Explanation letter',
      displayName: 'Explanation letter (bankruptcy or consumer proposal)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasBankruptcy,
    },
  ];
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const situationRules: ChecklistRule[] = [
  ...divorceRules(),
  ...bankruptcyRules(),
];
