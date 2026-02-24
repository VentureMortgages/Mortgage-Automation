/**
 * Section 10: Variable Income Rules
 *
 * Covers: Commission, Bonus, Rental, Support (receiving), Other Income
 *
 * Auto-detectable: Commission (payType), Bonus (bonuses flag), Rental (rentalIncome > 0)
 * Manual flag: Support receiving, Disability, Social assistance, Trust, Investment income
 *
 * Exclusions (CHKL-05):
 * - Bonus payment history: Removed ("Covered by T4s + LOE")
 * - T776: Removed as separate request (internal check to verify T1 includes it)
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';
import { getTaxYears } from '../utils/tax-years.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if borrower has commission income */
function hasCommission(ctx: RuleContext): boolean {
  return ctx.borrowerIncomes.some((inc) => inc.payType === 'commission');
}

/** Check if borrower has bonus income */
function hasBonus(ctx: RuleContext): boolean {
  return ctx.borrowerIncomes.some((inc) => inc.bonuses === true);
}

/** Check if any property on the application has rental income */
function hasRentalIncome(ctx: RuleContext): boolean {
  return ctx.properties.some((prop) => prop.rentalIncome > 0);
}

/**
 * Support income (receiving) is NOT auto-detectable from Finmo fields.
 * Always returns false — requires Cat's manual activation.
 */
function isReceivingSupport(_ctx: RuleContext): boolean {
  return false;
}

/**
 * Other income types (disability, social assistance, trust, investment)
 * are NOT auto-detectable from Finmo fields.
 * Always returns false — requires Cat's manual activation.
 */
function hasOtherIncome(_ctx: RuleContext): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

function commissionRules(): ChecklistRule[] {
  return [
    {
      id: 's10_commission_t4s',
      section: '10_variable_income_commission',
      document: 'T4 history (2 years showing commission)',
      get displayName() {
        const { currentTaxYear, previousTaxYear } = getTaxYears(new Date());
        return `${previousTaxYear} and ${currentTaxYear} T4s (showing commission income)`;
      },
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasCommission,
    },
    {
      id: 's10_commission_statements',
      section: '10_variable_income_commission',
      document: 'Commission statements (YTD + prior year)',
      displayName: 'Commission statements (year-to-date + prior year)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasCommission,
    },
    {
      id: 's10_commission_employer_letter',
      section: '10_variable_income_commission',
      document: 'Employer letter confirming commission structure',
      displayName: 'Employer letter confirming commission structure',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: hasCommission,
      notes: 'Especially important if commission exceeds 20% of total income',
    },
  ];
}

// ---------------------------------------------------------------------------
// Bonus
// ---------------------------------------------------------------------------

// Bonus letter removed — merged into LOE (s1_loe) via displayNameFn.
// When borrower has bonuses, the LOE request includes bonus structure details.
function bonusRules(): ChecklistRule[] {
  return [];
}

// ---------------------------------------------------------------------------
// Rental Income
// ---------------------------------------------------------------------------

function rentalRules(): ChecklistRule[] {
  return [
    {
      id: 's10_rental_lease',
      section: '10_variable_income_rental',
      document: 'Current lease agreement(s)',
      displayName: 'Current lease agreement(s)',
      stage: 'PRE',
      scope: 'per_property',
      condition: hasRentalIncome,
    },
    {
      id: 's10_rental_tax',
      section: '10_variable_income_rental',
      document: 'Property tax bills (rental)',
      displayName: 'Property tax bills (rental properties)',
      stage: 'PRE',
      scope: 'per_property',
      condition: hasRentalIncome,
      excludeWhen: (ctx) =>
        ctx.properties.filter((p) => p.rentalIncome > 0).every((p) => p.isSelling === true),
    },
    {
      id: 's10_rental_t1',
      section: '10_variable_income_rental',
      document: 'T1 General showing rental income',
      displayName: 'T1 General showing rental income (Schedule T776)',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: hasRentalIncome,
    },
    {
      id: 's10_rental_mortgage',
      section: '10_variable_income_rental',
      document: 'Rental property mortgage statement',
      displayName: 'Rental property mortgage statement',
      stage: 'FULL',
      scope: 'per_property',
      condition: hasRentalIncome,
      notes: 'If applicable',
    },
    // T776 internal check (CHKL-05: do not request separately)
    {
      id: 's10_t776_check',
      section: '10_variable_income_rental',
      document: 'T776 (rental income schedule) — internal check',
      displayName: 'T776 verification',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: hasRentalIncome,
      internalOnly: true,
      internalCheckNote:
        'Verify T1 includes T776 (Statement of Real Estate Rentals). Do NOT request T776 separately — it is part of the T1 package.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Support Income (Receiving) — dormant
// ---------------------------------------------------------------------------

function supportReceivingRules(): ChecklistRule[] {
  return [
    {
      id: 's10_support_agreement',
      section: '10_variable_income_support',
      document: 'Separation/Divorce agreement or court order',
      displayName:
        'Separation/Divorce agreement or court order (outlining child/spousal support entitlement)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isReceivingSupport,
    },
    {
      id: 's10_support_proof',
      section: '10_variable_income_support',
      document: '3 months bank statements showing support receipt',
      displayName: '3 months of bank statements showing support payments received',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isReceivingSupport,
    },
  ];
}

// ---------------------------------------------------------------------------
// Canada Child Benefit (CCB) — dormant (manual flag)
// ---------------------------------------------------------------------------

/**
 * CCB is NOT auto-detectable from Finmo data.
 * Always returns false — requires Cat's manual activation.
 */
function hasChildBenefit(_ctx: RuleContext): boolean {
  return false;
}

function ccbRules(): ChecklistRule[] {
  return [
    {
      id: 's10_ccb_proof',
      section: '10_variable_income_ccb',
      document: 'Canada Child Benefit (CCB) statement',
      displayName: 'Canada Child Benefit (CCB) statement from CRA',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasChildBenefit,
    },
  ];
}

// ---------------------------------------------------------------------------
// Other Income — dormant
// ---------------------------------------------------------------------------

function otherIncomeRules(): ChecklistRule[] {
  return [
    {
      id: 's10_disability',
      section: '10_variable_income_other',
      document: 'Disability award letter + payment statement',
      displayName: 'Disability award letter and payment statement',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasOtherIncome,
    },
    {
      id: 's10_social_assistance',
      section: '10_variable_income_other',
      document: 'Social assistance benefit statement',
      displayName: 'Current social assistance benefit statement',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasOtherIncome,
    },
    {
      id: 's10_trust',
      section: '10_variable_income_other',
      document: 'Trust income docs + payment history',
      displayName: 'Trust documents and payment history',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: hasOtherIncome,
    },
    {
      id: 's10_investment',
      section: '10_variable_income_other',
      document: 'Investment statements + T5 slips',
      displayName: 'Investment statements and T5 slips',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: hasOtherIncome,
    },
  ];
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const variableIncomeRules: ChecklistRule[] = [
  ...commissionRules(),
  ...bonusRules(),
  ...rentalRules(),
  ...ccbRules(),
  ...supportReceivingRules(),
  ...otherIncomeRules(),
];
