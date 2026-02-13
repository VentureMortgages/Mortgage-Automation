/**
 * Sections 16-17: Residency Programs & First-Time Buyer
 *
 * Section 16: Newcomer (PR < 5 years), Work Permit, Non-Resident
 * Section 17: First-Time Buyer (all items removed — internal flag only)
 *
 * ALL residency rules are dormant (manual flag) — residency status is NOT
 * auto-detectable from Finmo application data.
 *
 * Exclusions (CHKL-05):
 * - International credit report (work permit): Removed ("Not required")
 * - Foreign bank good-standing letter: Removed ("Not necessary")
 * - First-time buyer declaration: Removed ("Not necessary")
 * - First-time buyer ownership confirmation: Removed ("Not necessary")
 */

import type { ChecklistRule, RuleContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Newcomer status (PR < 5 years) is NOT auto-detectable from Finmo.
 * Always returns false — requires Cat's manual activation.
 */
function isNewcomer(_ctx: RuleContext): boolean {
  return false;
}

/**
 * Work permit holder is NOT auto-detectable from Finmo.
 * Always returns false — requires Cat's manual activation.
 */
function hasWorkPermit(_ctx: RuleContext): boolean {
  return false;
}

/**
 * Non-resident (foreign buyer) is NOT auto-detectable from Finmo.
 * Always returns false — requires Cat's manual activation.
 */
function isNonResident(_ctx: RuleContext): boolean {
  return false;
}

/**
 * First-time buyer status IS detectable from borrower.firstTime field.
 * However, no documents are needed — all doc items were removed by Cat.
 * This only produces an internal flag for tracking.
 */
function isFirstTimeBuyer(ctx: RuleContext): boolean {
  return ctx.borrower.firstTime === true;
}

// ---------------------------------------------------------------------------
// Section 16: Newcomer (PR < 5 years) — dormant
// ---------------------------------------------------------------------------

function newcomerRules(): ChecklistRule[] {
  return [
    {
      id: 's16_newcomer_pr',
      section: '16_residency_newcomer',
      document: 'PR card',
      displayName: 'Permanent Resident (PR) card',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isNewcomer,
    },
    {
      id: 's16_newcomer_passport',
      section: '16_residency_newcomer',
      document: 'Passport',
      displayName: 'Passport',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isNewcomer,
    },
    {
      id: 's16_newcomer_employment',
      section: '16_residency_newcomer',
      document: 'Canadian employment (3+ months)',
      displayName: 'Proof of Canadian employment (minimum 3 months)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isNewcomer,
    },
    {
      id: 's16_newcomer_credit',
      section: '16_residency_newcomer',
      document: 'International credit report OR 12 months Canadian payment history',
      displayName:
        'International credit report, OR 12 months of Canadian payment history',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isNewcomer,
      notes: 'Only needed if they hold foreign securities',
    },
    {
      id: 's16_newcomer_dp',
      section: '16_residency_newcomer',
      document: 'Down payment verification (may require foreign statements)',
      displayName:
        'Down payment verification (may require foreign bank statements)',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isNewcomer,
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 16: Work Permit — dormant
// ---------------------------------------------------------------------------

function workPermitRules(): ChecklistRule[] {
  return [
    {
      id: 's16_wp_permit',
      section: '16_residency_work_permit',
      document: 'Work permit (12+ months remaining)',
      displayName: 'Work permit (must have 12+ months remaining)',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasWorkPermit,
    },
    {
      id: 's16_wp_sin',
      section: '16_residency_work_permit',
      document: 'SIN starting with 9',
      displayName: 'Social Insurance Number (SIN) starting with 9',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasWorkPermit,
    },
    {
      id: 's16_wp_passport',
      section: '16_residency_work_permit',
      document: 'Passport',
      displayName: 'Passport',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasWorkPermit,
    },
    {
      id: 's16_wp_employment',
      section: '16_residency_work_permit',
      document: 'Canadian employment letter',
      displayName: 'Canadian employment letter',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: hasWorkPermit,
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 16: Non-Resident (Foreign Buyer) — dormant
// ---------------------------------------------------------------------------

function nonResidentRules(): ChecklistRule[] {
  return [
    {
      id: 's16_nr_passport',
      section: '16_residency_non_resident',
      document: 'Passport',
      displayName: 'Passport',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isNonResident,
      notes: 'Foreign buyer ban in effect until 2027 (with exceptions)',
    },
    {
      id: 's16_nr_income',
      section: '16_residency_non_resident',
      document: 'Proof of foreign income',
      displayName: 'Proof of foreign income',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isNonResident,
    },
    {
      id: 's16_nr_credit',
      section: '16_residency_non_resident',
      document: 'International credit report',
      displayName: 'International credit report',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isNonResident,
    },
    {
      id: 's16_nr_dp',
      section: '16_residency_non_resident',
      document: 'Down payment proof (foreign bank statements)',
      displayName: 'Down payment proof (foreign bank statements)',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isNonResident,
    },
    {
      id: 's16_nr_lawyer',
      section: '16_residency_non_resident',
      document: 'Canadian lawyer for ILA',
      displayName: 'Canadian lawyer for Independent Legal Advice (ILA)',
      stage: 'FULL',
      scope: 'per_borrower',
      condition: isNonResident,
    },
  ];
}

// ---------------------------------------------------------------------------
// Section 17: First-Time Buyer — internal flag only
// ---------------------------------------------------------------------------

function firstTimeBuyerRules(): ChecklistRule[] {
  return [
    {
      id: 's17_ftb_flag',
      section: '17_first_time_buyer',
      document: 'First-time buyer status — internal tracking',
      displayName: 'First-time buyer — no additional docs needed',
      stage: 'PRE',
      scope: 'per_borrower',
      condition: isFirstTimeBuyer,
      internalOnly: true,
      internalCheckNote:
        'First-time buyer status determined from application data. No additional documents needed. Status is tracked for FHSA/HBP eligibility.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export const residencyRules: ChecklistRule[] = [
  ...newcomerRules(),
  ...workPermitRules(),
  ...nonResidentRules(),
  ...firstTimeBuyerRules(),
];
