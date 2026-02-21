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
      id: 's12_separation_agreement',
      section: '12_situations_divorce',
      document: 'Separation/Divorce agreement',
      displayName:
        'Separation/Divorce agreement outlining any child/spousal support obligations',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isDivorcedOrSeparated,
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
