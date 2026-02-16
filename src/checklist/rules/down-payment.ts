/**
 * Section 14: Down Payment (Source of Funds)
 *
 * Covers: Savings, RRSP, TFSA, FHSA, Gift, Sale of Property, Inheritance, Borrowed
 *
 * This is the most complex section with varied conditions and special cases:
 * - Gift letter is internal-only (CHKL-06): collected later when lender is picked
 * - Gift donor proof of funds: only appears when "found_property" (condition handles it)
 * - Inheritance and Borrowed are manual flags if not detectable from asset descriptions
 *
 * Exclusions (CHKL-05):
 * - T1036 (HBP withdrawal): Moved to LENDER_CONDITION
 * - Proof of first-time buyer: Moved to LENDER_CONDITION
 * - FHSA withdrawal confirmation: Moved to LENDER_CONDITION
 * - Evidence of strong credit history (borrowed): Removed ("From credit report")
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No down payment needed for refinances — skip all DP rules */
function isNotRefinance(ctx: RuleContext): boolean {
  return ctx.application.goal !== 'refinance';
}

/** Check if application has savings assets (excluded for refinances) */
function hasSavings(ctx: RuleContext): boolean {
  if (!isNotRefinance(ctx)) return false;
  return ctx.assets.some((a) => a.type === 'cash_savings');
}

/** Check if application has RRSP assets (excluded for refinances) */
function hasRRSP(ctx: RuleContext): boolean {
  if (!isNotRefinance(ctx)) return false;
  return ctx.assets.some((a) => a.type === 'rrsp');
}

/**
 * Check if application has TFSA assets (excluded for refinances).
 * Can be typed as "tfsa" or described as "TFSA" in a cash_savings asset.
 */
function hasTFSA(ctx: RuleContext): boolean {
  if (!isNotRefinance(ctx)) return false;
  return ctx.assets.some(
    (a) =>
      a.type === 'tfsa' ||
      (a.type === 'cash_savings' &&
        a.description?.toUpperCase().includes('TFSA'))
  );
}

/** Check if application has FHSA assets (excluded for refinances) */
function hasFHSA(ctx: RuleContext): boolean {
  if (!isNotRefinance(ctx)) return false;
  return ctx.assets.some(
    (a) => a.description?.toUpperCase().includes('FHSA')
  );
}

/** Check if application has gift-sourced down payment (excluded for refinances) */
function hasGift(ctx: RuleContext): boolean {
  if (!isNotRefinance(ctx)) return false;
  return ctx.assets.some(
    (a) => a.description?.toLowerCase().includes('gift')
  );
}

/**
 * Check if gift donor proof of funds should be requested.
 * Only when gift is detected AND application process is "found_property"
 * (accepted offer exists). At pre-approval stage, proof expires.
 */
function hasGiftAndFoundProperty(ctx: RuleContext): boolean {
  return hasGift(ctx) && ctx.application.process === 'found_property';
}

/** Check if any property is being sold as DP source (excluded for refinances) */
function hasPropertySale(ctx: RuleContext): boolean {
  if (!isNotRefinance(ctx)) return false;
  return ctx.properties.some((p) => p.isSelling === true);
}

/**
 * Check if application has inheritance-sourced funds (excluded for refinances).
 * Detected by asset description containing "inheritance".
 */
function hasInheritance(ctx: RuleContext): boolean {
  if (!isNotRefinance(ctx)) return false;
  return ctx.assets.some(
    (a) => a.description?.toLowerCase().includes('inheritance')
  );
}

/**
 * Check if application has borrowed down payment funds (excluded for refinances).
 * Detected by asset description containing "borrow" or similar.
 */
function hasBorrowedDownPayment(ctx: RuleContext): boolean {
  if (!isNotRefinance(ctx)) return false;
  return ctx.assets.some(
    (a) => a.description?.toLowerCase().includes('borrow')
  );
}

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

function savingsRules(): ChecklistRule[] {
  return [
    {
      id: 's14_savings_bank',
      section: '14_down_payment_savings',
      document: '90-day bank statement history',
      displayName:
        '90-day bank statement history for the account(s) currently holding your down payment funds (must show account ownership — name and account number)',
      stage: 'PRE',
      scope: 'shared',
      condition: hasSavings,
    },
    {
      id: 's14_large_deposit',
      section: '14_down_payment_savings',
      document: 'Large deposit explanations',
      displayName: 'Explanation for any deposits over $5k that aren\'t from your payroll',
      stage: 'FULL',
      scope: 'shared',
      condition: hasSavings,
      notes:
        'If transfer from other account, we will need 90-day statement showing the transfer',
    },
  ];
}

// ---------------------------------------------------------------------------
// RRSP
// ---------------------------------------------------------------------------

function rrspRules(): ChecklistRule[] {
  return [
    {
      id: 's14_rrsp_statement',
      section: '14_down_payment_rrsp',
      document: 'RRSP statement (90 days)',
      displayName: 'RRSP statement (90-day history)',
      stage: 'PRE',
      scope: 'shared',
      condition: hasRRSP,
    },
  ];
}

// ---------------------------------------------------------------------------
// TFSA
// ---------------------------------------------------------------------------

function tfsaRules(): ChecklistRule[] {
  return [
    {
      id: 's14_tfsa_statement',
      section: '14_down_payment_tfsa',
      document: 'TFSA statement (90 days)',
      displayName: 'TFSA statement (90-day history)',
      stage: 'PRE',
      scope: 'shared',
      condition: hasTFSA,
    },
  ];
}

// ---------------------------------------------------------------------------
// FHSA
// ---------------------------------------------------------------------------

function fhsaRules(): ChecklistRule[] {
  return [
    {
      id: 's14_fhsa_statement',
      section: '14_down_payment_fhsa',
      document: 'FHSA statement',
      displayName: 'First Home Savings Account (FHSA) statement',
      stage: 'PRE',
      scope: 'shared',
      condition: hasFHSA,
    },
  ];
}

// ---------------------------------------------------------------------------
// Gift
// ---------------------------------------------------------------------------

function giftRules(): ChecklistRule[] {
  return [
    {
      id: 's14_gift_donor_info',
      section: '14_down_payment_gift',
      document: 'Donor contact information',
      displayName:
        'Gift donor contact information (full name, relationship to borrower, address, phone, email)',
      stage: 'PRE',
      scope: 'shared',
      condition: hasGift,
    },
    {
      id: 's14_gift_amount',
      section: '14_down_payment_gift',
      document: 'Amount of gift',
      displayName: 'Confirmed gift amount',
      stage: 'PRE',
      scope: 'shared',
      condition: hasGift,
    },
    {
      id: 's14_gift_savings_note',
      section: '14_down_payment_gift',
      document: 'Bank statements for savings used alongside gift',
      displayName:
        '90-day bank statement history if you\'ll also be using some of your savings in addition to the gifted funds',
      stage: 'PRE',
      scope: 'shared',
      condition: hasGift,
    },
    {
      id: 's14_gift_proof_of_funds',
      section: '14_down_payment_gift',
      document: 'Donor proof of funds OR transfer confirmation + current balance',
      displayName:
        'Gift donor proof of funds, OR transfer confirmation plus current account balance',
      stage: 'PRE',
      scope: 'shared',
      condition: hasGiftAndFoundProperty,
    },
    // CHKL-06: Gift letter is internal-only — collected later when lender is picked
    {
      id: 's14_gift_letter',
      section: '14_down_payment_gift',
      document: 'Gift letter (signed)',
      displayName: 'Gift letter (signed)',
      stage: 'LATER',
      scope: 'shared',
      condition: hasGift,
      internalOnly: true,
      internalCheckNote:
        'Collect gift letter once lender is picked. Do NOT request upfront — the format varies by lender.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Sale of Property
// ---------------------------------------------------------------------------

function saleOfPropertyRules(): ChecklistRule[] {
  return [
    {
      id: 's14_sale_offer',
      section: '14_down_payment_sale',
      document: 'Accepted offer / sale agreement',
      displayName: 'Accepted offer or sale agreement (for property being sold)',
      stage: 'PRE',
      scope: 'shared',
      condition: hasPropertySale,
    },
    {
      id: 's14_sale_mortgage',
      section: '14_down_payment_sale',
      document: 'Most recent mortgage statement to confirm equity',
      displayName:
        'Most recent mortgage statement for property being sold (to confirm equity amount)',
      stage: 'PRE',
      scope: 'shared',
      condition: hasPropertySale,
    },
    {
      id: 's14_sale_lawyer',
      section: '14_down_payment_sale',
      document: "Lawyer's statement of adjustments",
      displayName: "Lawyer's statement of adjustments (after closing)",
      stage: 'FULL',
      scope: 'shared',
      condition: hasPropertySale,
    },
  ];
}

// ---------------------------------------------------------------------------
// Inheritance
// ---------------------------------------------------------------------------

function inheritanceRules(): ChecklistRule[] {
  return [
    {
      id: 's14_inheritance_will',
      section: '14_down_payment_inheritance',
      document: 'Will / estate docs',
      displayName: 'Will or estate documents',
      stage: 'PRE',
      scope: 'shared',
      condition: hasInheritance,
    },
    {
      id: 's14_inheritance_executor',
      section: '14_down_payment_inheritance',
      document: 'Executor letter',
      displayName: 'Executor letter',
      stage: 'PRE',
      scope: 'shared',
      condition: hasInheritance,
    },
    {
      id: 's14_inheritance_bank',
      section: '14_down_payment_inheritance',
      document: 'Bank statement showing receipt',
      displayName: 'Bank statement showing inheritance receipt',
      stage: 'FULL',
      scope: 'shared',
      condition: hasInheritance,
    },
  ];
}

// ---------------------------------------------------------------------------
// Borrowed Down Payment
// ---------------------------------------------------------------------------

function borrowedRules(): ChecklistRule[] {
  return [
    {
      id: 's14_borrowed_statement',
      section: '14_down_payment_borrowed',
      document: 'LOC or personal loan statement',
      displayName: 'Line of credit or personal loan statement (for borrowed down payment)',
      stage: 'PRE',
      scope: 'shared',
      condition: hasBorrowedDownPayment,
    },
  ];
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const downPaymentRules: ChecklistRule[] = [
  ...savingsRules(),
  ...rrspRules(),
  ...tfsaRules(),
  ...fhsaRules(),
  ...giftRules(),
  ...saleOfPropertyRules(),
  ...inheritanceRules(),
  ...borrowedRules(),
];
