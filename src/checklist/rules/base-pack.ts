/**
 * Section 0: Base Pack Rules — Always Request
 *
 * These documents are required for every application regardless of
 * borrower type, income source, or deal structure.
 *
 * Exclusions (CHKL-05):
 * - Signed Credit Consent: Auto-sent by Finmo, do NOT request separately.
 */

import type { ChecklistRule } from '../types/index.js';

export const basePackRules: ChecklistRule[] = [
  // -------------------------------------------------------------------------
  // Section 0: Identification
  // -------------------------------------------------------------------------
  {
    id: 's0_id',
    section: '0_base_pack',
    document: 'Two pieces of government-issued ID',
    displayName:
      'Two pieces of government-issued ID (e.g., driver\'s license, passport, PR card, credit card, SIN card, birth certificate, or firearms license)',
    stage: 'PRE',
    scope: 'per_borrower',
    condition: () => true,
  },

  // -------------------------------------------------------------------------
  // Section 0: Banking
  // -------------------------------------------------------------------------
  {
    id: 's0_void_cheque',
    section: '0_base_pack',
    document: 'Void cheque or direct deposit form',
    displayName: 'Void cheque or direct deposit form',
    stage: 'FULL',
    scope: 'shared',
    condition: () => true,
  },
];
