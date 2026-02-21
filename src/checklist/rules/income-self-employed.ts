/**
 * Sections 3-6: Income — Self-Employed Rules
 *
 * Section 3: General self-employed (all self-employed get these)
 * Section 4: Sole Proprietor (T2125 internal check)
 * Section 5: Incorporated (articles, T2, financials)
 * Section 6: Stated Income / B Lender (dormant — manual flag)
 *
 * Sub-type detection:
 * - Incorporated: businessType contains "corporation" or "incorporated", OR selfPayType includes "salary"
 * - Sole Proprietor: self_employed AND NOT detected as incorporated
 * - Stated Income: NOT auto-detectable; requires Cat's manual flag
 *
 * When detection is uncertain, both sole prop and incorporated docs are included (safer).
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';
import { getTaxYears } from '../utils/tax-years.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Finmo sends source as 'self-employed' (hyphen) but our code originally
 *  used 'self_employed' (underscore). Accept both variants. */
function isSelfEmployedSource(source: string | null | undefined): boolean {
  return source === 'self_employed' || source === 'self-employed';
}

/** Check if borrower has any self-employment income */
function isSelfEmployed(ctx: RuleContext): boolean {
  return ctx.borrowerIncomes.some((inc) => isSelfEmployedSource(inc.source));
}

/**
 * Detect if self-employed borrower is likely incorporated.
 *
 * Heuristics:
 * - businessType contains "corporation", "incorporated", or "inc"
 * - selfPayType array includes "salary" (paying self a salary implies corp structure)
 *
 * Returns false if detection is uncertain — in that case, both sole prop and
 * incorporated docs will be requested (safe default).
 */
function isIncorporated(ctx: RuleContext): boolean {
  return ctx.borrowerIncomes.some((inc) => {
    if (!isSelfEmployedSource(inc.source)) return false;

    // Check businessType field
    if (inc.businessType) {
      const bt = inc.businessType.toLowerCase();
      if (
        bt.includes('corporation') ||
        bt.includes('incorporated') ||
        bt.includes('inc')
      ) {
        return true;
      }
    }

    // Check selfPayType array for salary
    if (Array.isArray(inc.selfPayType)) {
      return inc.selfPayType.some(
        (pt) => typeof pt === 'string' && pt.toLowerCase() === 'salary'
      );
    }

    return false;
  });
}

/**
 * Detect if self-employed borrower is a sole proprietor.
 *
 * A borrower is treated as a sole proprietor if they are self-employed
 * and NOT detected as incorporated. When detection is uncertain (businessType
 * is null/empty and selfPayType is empty), we return true to be safe —
 * this means both sole prop AND incorporated docs may be requested.
 */
function isSoleProprietor(ctx: RuleContext): boolean {
  if (!isSelfEmployed(ctx)) return false;

  // If clearly incorporated, not a sole prop
  if (isIncorporated(ctx)) return false;

  // Self-employed but not detectably incorporated — treat as sole prop
  return true;
}

/**
 * Check if self-employed AND incorporated AND paying self a salary.
 * Used for the T4 rule in section 3.
 */
function isIncorporatedWithSalary(ctx: RuleContext): boolean {
  return ctx.borrowerIncomes.some((inc) => {
    if (!isSelfEmployedSource(inc.source)) return false;
    if (!isIncorporated(ctx)) return false;

    // Check selfPayType for salary
    if (Array.isArray(inc.selfPayType)) {
      return inc.selfPayType.some(
        (pt) => typeof pt === 'string' && pt.toLowerCase() === 'salary'
      );
    }
    return false;
  });
}

/**
 * Stated income is NOT auto-detectable from Finmo data.
 * Always returns false — these rules require manual activation by Cat.
 */
function isStatedIncome(_ctx: RuleContext): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Section 3: General Self-Employed (all SE get these)
// ---------------------------------------------------------------------------

function generalSelfEmployedRules(): ChecklistRule[] {
  return [
    {
      id: 's3_t1_current',
      section: '3_income_self_employed_general',
      document: 'T1 General — Current year (full return)',
      get displayName() {
        const { currentTaxYear } = getTaxYears(new Date());
        return `${currentTaxYear} T1 General (full return including all schedules)`;
      },
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isSelfEmployed,
    },
    {
      id: 's3_t1_previous',
      section: '3_income_self_employed_general',
      document: 'T1 General — Previous year (full return)',
      get displayName() {
        const { previousTaxYear } = getTaxYears(new Date());
        return `${previousTaxYear} T1 General (full return including all schedules)`;
      },
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isSelfEmployed,
    },
    {
      id: 's3_noa_current',
      section: '3_income_self_employed_general',
      document: 'NOA — Current year',
      get displayName() {
        const { currentTaxYear } = getTaxYears(new Date());
        return `${currentTaxYear} Notice of Assessment (NOA)`;
      },
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isSelfEmployed,
      notes:
        'If NOA shows amount owing, also provide CRA Statement of Account showing taxes paid to zero',
    },
    {
      id: 's3_noa_previous',
      section: '3_income_self_employed_general',
      document: 'NOA — Previous year',
      get displayName() {
        const { previousTaxYear } = getTaxYears(new Date());
        return `${previousTaxYear} Notice of Assessment (NOA)`;
      },
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isSelfEmployed,
    },
    {
      id: 's3_t4_salary',
      section: '3_income_self_employed_general',
      document: 'T4 (if paying self a salary from corporation)',
      get displayName() {
        const { currentTaxYear } = getTaxYears(new Date());
        return `${currentTaxYear} T4 (salary from corporation)`;
      },
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isIncorporatedWithSalary,
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 4: Sole Proprietor
// ---------------------------------------------------------------------------

function soleProprietorRules(): ChecklistRule[] {
  return [
    {
      id: 's4_t2125_check',
      section: '4_income_self_employed_sole_prop',
      document: 'T2125 (Statement of Business Activities) — internal check',
      displayName: 'T2125 verification',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isSoleProprietor,
      internalOnly: true,
      internalCheckNote:
        'Verify T1 includes T2125 (Statement of Business Activities). Do NOT request T2125 separately — it is part of the T1 package.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 5: Incorporated
// ---------------------------------------------------------------------------

function incorporatedRules(): ChecklistRule[] {
  return [
    {
      id: 's5_articles',
      section: '5_income_self_employed_incorporated',
      document: 'Articles of Incorporation',
      displayName: 'Articles of Incorporation',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isIncorporated,
    },
    {
      id: 's5_t2_schedule50',
      section: '5_income_self_employed_incorporated',
      document:
        'T2 Corporate Tax Return with Schedule 50 OR Central Securities Register',
      displayName:
        'T2 Corporate Tax Return with Schedule 50, OR Central Securities Register',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isIncorporated,
      internalCheckNote:
        'Verify T2 includes Schedule 50 (shareholder listing). If not included, request Central Securities Register separately.',
    },
    {
      id: 's5_financials',
      section: '5_income_self_employed_incorporated',
      document: '2 years accountant-prepared financial statements',
      displayName:
        '2 years of accountant-prepared financial statements (balance sheet + income statement)',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isIncorporated,
    },
    {
      id: 's5_business_bank',
      section: '5_income_self_employed_incorporated',
      document: 'Business bank statements (6-12 months)',
      displayName: 'Business bank statements (6-12 months)',
      stage: 'LENDER_CONDITION',
      scope: 'per_borrower',
      condition: isIncorporated,
      notes:
        'Rarely requested upfront — only collect if conditioned by lender.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 6: Stated Income / B Lender (dormant — requires manual flag)
// ---------------------------------------------------------------------------

function statedIncomeRules(): ChecklistRule[] {
  return [
    {
      id: 's6_business_bank',
      section: '6_income_self_employed_stated',
      document: 'Business bank statements (6-12 months)',
      displayName: 'Business bank statements (6-12 months)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isStatedIncome,
      notes:
        'Stated income / B-lender program. If stated income is from a corporation, also collect all Section 5 (Incorporated) documents.',
    },
    {
      id: 's6_personal_bank',
      section: '6_income_self_employed_stated',
      document: 'Personal bank statements (3 months)',
      displayName: 'Personal bank statements (3 months)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isStatedIncome,
    },
    {
      id: 's6_business_reg',
      section: '6_income_self_employed_stated',
      document: 'Business registration',
      displayName: 'Business registration',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isStatedIncome,
    },
    {
      id: 's6_income_declaration',
      section: '6_income_self_employed_stated',
      document: 'Signed income declaration',
      displayName: 'Signed income declaration (must be reasonable for industry)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isStatedIncome,
    },
  ];
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const incomeSelfEmployedRules: ChecklistRule[] = [
  ...generalSelfEmployedRules(),
  ...soleProprietorRules(),
  ...incorporatedRules(),
  ...statedIncomeRules(),
];
