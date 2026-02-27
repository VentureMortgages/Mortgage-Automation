/**
 * Section 15: Property (Deal Type) Rules
 *
 * Covers: Purchase, Refinance, Renewal/Switch, Condo, Multi-Unit, Investment
 *
 * Goal handling:
 * - "purchase": New property acquisition
 * - "refinance": Refinancing existing mortgage
 * - "renew" / other existing-property goals: Treated like refinance for docs
 *   (mortgage statement, property tax bill, + home insurance for switches)
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
 * Check if this is an existing-property deal (refinance, renewal, switch).
 * These all need mortgage statement + property tax bill.
 * Matches "refinance", "renew", and any non-purchase goal where a property exists.
 */
function isExistingPropertyDeal(ctx: RuleContext): boolean {
  if (isPurchase(ctx)) return false;
  // Refinance or renewal/switch — any non-purchase goal with a subject property
  return ctx.application.goal === 'refinance' ||
    ctx.application.goal === 'renew' ||
    // Future-proof: if goal is unknown but there's a subject property, treat as existing
    (ctx.subjectProperty !== null && ctx.application.goal !== null);
}

/**
 * Check if this is a renewal/switch (not a refinance).
 * Per Cat: home insurance is "only needed for switches, not refinances."
 */
function isRenewalOrSwitch(ctx: RuleContext): boolean {
  return ctx.application.goal === 'renew';
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
 * Condo fee confirmation is required for existing-property deals (not purchase).
 * Per Cat: "Only if NOT a purchase."
 */
function isCondoExistingDeal(ctx: RuleContext): boolean {
  return isCondo(ctx) && isExistingPropertyDeal(ctx);
}

/** Check if the subject property has multiple units (2+) */
function isMultiUnit(ctx: RuleContext): boolean {
  if (!ctx.subjectProperty) return false;
  return (
    ctx.subjectProperty.numberOfUnits !== null &&
    ctx.subjectProperty.numberOfUnits > 1
  );
}

/**
 * Check if the property is non-owner-occupied (investment).
 * Null/missing `use` is NOT treated as investment — only explicit non-owner values.
 */
function isInvestment(ctx: RuleContext): boolean {
  return ctx.application.use !== null &&
    ctx.application.use !== undefined &&
    ctx.application.use !== 'owner_occupied';
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
      condition: isExistingPropertyDeal,
    },
    {
      id: 's15_refi_tax',
      section: '15_property_refinance',
      document: 'Property tax bill (most recent)',
      displayName: 'Property tax bill (most recent)',
      stage: 'PRE',
      scope: 'shared',
      condition: isExistingPropertyDeal,
    },
    // Home insurance: per Cat — "only needed for switches, not refinances"
    {
      id: 's15_switch_insurance',
      section: '15_property_refinance',
      document: 'Home insurance',
      displayName: 'Home insurance policy',
      stage: 'PRE',
      scope: 'shared',
      condition: isRenewalOrSwitch,
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
      // Per Cat: Only for existing-property deals (refinance/renewal), NOT purchase
      condition: isCondoExistingDeal,
    },
    // Status Certificate / Strata Form B: removed per Cat — handled by lawyers
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
