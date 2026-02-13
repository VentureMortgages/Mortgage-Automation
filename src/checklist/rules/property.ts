/**
 * Section 15: Property (Deal Type) Rules
 *
 * Covers: Purchase, Refinance, Condo, Multi-Unit, Investment
 *
 * Exclusions (CHKL-05):
 * - Home inspection report: Removed ("Not necessary")
 * - Payout statement (refinance): Removed ("Handled by lawyers")
 * - T776 for multi-unit: Removed (should be in T1; handled by Section 10 internal check)
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if this is a purchase application */
function isPurchase(ctx: RuleContext): boolean {
  return ctx.application.goal === 'purchase';
}

/** Check if this is a refinance application */
function isRefinance(ctx: RuleContext): boolean {
  return ctx.application.goal === 'refinance';
}

/**
 * Check if the subject property is a condo.
 * Detected by property type "condo" or presence of monthly condo/strata fees.
 */
function isCondo(ctx: RuleContext): boolean {
  if (!ctx.subjectProperty) return false;
  return (
    ctx.subjectProperty.type === 'condo' ||
    (ctx.subjectProperty.monthlyFees !== null &&
      ctx.subjectProperty.monthlyFees > 0)
  );
}

/**
 * Condo fee confirmation is ONLY required for refinance (not purchase).
 * Per Cat: "Only if NOT a purchase."
 */
function isCondoRefinance(ctx: RuleContext): boolean {
  return isCondo(ctx) && isRefinance(ctx);
}

/** Check if the subject property has multiple units (2+) */
function isMultiUnit(ctx: RuleContext): boolean {
  if (!ctx.subjectProperty) return false;
  return (
    ctx.subjectProperty.numberOfUnits !== null &&
    ctx.subjectProperty.numberOfUnits > 1
  );
}

/** Check if the property is non-owner-occupied (investment) */
function isInvestment(ctx: RuleContext): boolean {
  return ctx.application.use !== 'owner_occupied';
}

// ---------------------------------------------------------------------------
// Purchase
// ---------------------------------------------------------------------------

function purchaseRules(): ChecklistRule[] {
  return [
    {
      id: 's15_purchase_offer',
      section: '15_property_purchase',
      document: 'Accepted Offer / APS (signed)',
      displayName: 'Accepted Offer / Agreement of Purchase and Sale (signed)',
      stage: 'PRE',
      scope: 'shared',
      condition: isPurchase,
    },
    {
      id: 's15_purchase_mls',
      section: '15_property_purchase',
      document: 'MLS listing',
      displayName: 'MLS listing',
      stage: 'FULL',
      scope: 'shared',
      condition: isPurchase,
    },
  ];
}

// ---------------------------------------------------------------------------
// Refinance
// ---------------------------------------------------------------------------

function refinanceRules(): ChecklistRule[] {
  return [
    {
      id: 's15_refi_mortgage',
      section: '15_property_refinance',
      document: 'Current mortgage statement',
      displayName: 'Current mortgage statement',
      stage: 'PRE',
      scope: 'shared',
      condition: isRefinance,
    },
    {
      id: 's15_refi_tax',
      section: '15_property_refinance',
      document: 'Property tax bill (most recent)',
      displayName: 'Property tax bill (most recent)',
      stage: 'PRE',
      scope: 'shared',
      condition: isRefinance,
    },
    {
      id: 's15_refi_insurance',
      section: '15_property_refinance',
      document: 'Home insurance policy',
      displayName: 'Home insurance policy',
      stage: 'FULL',
      scope: 'shared',
      condition: isRefinance,
    },
  ];
}

// ---------------------------------------------------------------------------
// Condo
// ---------------------------------------------------------------------------

function condoRules(): ChecklistRule[] {
  return [
    {
      id: 's15_condo_fee',
      section: '15_property_condo',
      document: 'Condo fee confirmation OR 3 months bank statements showing strata withdrawals',
      displayName:
        'Condo fee confirmation, OR 3 months of bank statements showing strata fee withdrawals',
      stage: 'PRE',
      scope: 'shared',
      // Per Cat: Only for refinance, NOT purchase
      condition: isCondoRefinance,
    },
    {
      id: 's15_condo_status',
      section: '15_property_condo',
      document: 'Status Certificate (ON) / Strata Form B (BC)',
      displayName: 'Status Certificate (ON) or Strata Form B (BC)',
      stage: 'FULL',
      scope: 'shared',
      condition: isCondo,
      notes: 'Usually handled by lawyers',
    },
  ];
}

// ---------------------------------------------------------------------------
// Multi-Unit (2-4 units)
// ---------------------------------------------------------------------------

function multiUnitRules(): ChecklistRule[] {
  return [
    {
      id: 's15_multiunit_leases',
      section: '15_property_multiunit',
      document: 'Lease agreements for all units',
      displayName: 'Lease agreements for all units',
      stage: 'PRE',
      scope: 'shared',
      condition: isMultiUnit,
    },
    {
      id: 's15_multiunit_appraisal',
      section: '15_property_multiunit',
      document: 'Appraisal (lender ordered)',
      displayName: 'Appraisal (lender ordered)',
      stage: 'LENDER_CONDITION',
      scope: 'shared',
      condition: isMultiUnit,
      notes: 'Usually only mentioned once we have an approval',
    },
  ];
}

// ---------------------------------------------------------------------------
// Investment (Non-Owner-Occupied)
// ---------------------------------------------------------------------------

function investmentRules(): ChecklistRule[] {
  return [
    {
      id: 's15_investment_income_proof',
      section: '15_property_investment',
      document: 'Proof of other income (beyond rental)',
      displayName: 'Proof of other income (beyond rental income)',
      stage: 'PRE',
      scope: 'shared',
      condition: isInvestment,
    },
    {
      id: 's15_investment_appraisal',
      section: '15_property_investment',
      document: 'Appraisal (lender ordered)',
      displayName: 'Appraisal (lender ordered)',
      stage: 'LENDER_CONDITION',
      scope: 'shared',
      condition: isInvestment,
    },
  ];
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const propertyRules: ChecklistRule[] = [
  ...purchaseRules(),
  ...refinanceRules(),
  ...condoRules(),
  ...multiUnitRules(),
  ...investmentRules(),
];
