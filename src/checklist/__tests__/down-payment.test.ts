/**
 * Down Payment Rules + CHKL-06 Gift Letter Tests
 *
 * Section 14 down payment source detection and the special
 * gift letter handling (internal-only, not sent to client).
 */

import { describe, test, expect } from 'vitest';
import { generateChecklist } from '../engine/index.js';
import type { FinmoApplicationResponse } from '../types/index.js';
import {
  employedPurchase,
  giftDownPayment,
} from './fixtures/index.js';

const TEST_DATE = new Date('2026-02-15');

// ---------------------------------------------------------------------------
// Down payment source detection
// ---------------------------------------------------------------------------

describe('Down payment rules', () => {
  test('cash savings triggers 90-day bank statement', () => {
    const result = generateChecklist(employedPurchase, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_savings_bank');
  });

  test('RRSP triggers RRSP statement', () => {
    // Add RRSP asset to fixture
    const rrspFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      assets: [
        ...employedPurchase.assets,
        {
          id: 'asset-rrsp',
          applicationId: employedPurchase.application.id,
          type: 'rrsp',
          value: 30000,
          downPayment: 25000,
          description: 'RRSP at TestBank',
          owners: ['borrower-001'],
          visibility: null,
        },
      ],
    };
    const result = generateChecklist(rrspFixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_rrsp_statement');
  });

  test('TFSA triggers TFSA statement', () => {
    // Add TFSA asset (typed as tfsa)
    const tfsaFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      assets: [
        {
          id: 'asset-tfsa',
          applicationId: employedPurchase.application.id,
          type: 'tfsa',
          value: 15000,
          downPayment: 15000,
          description: 'TFSA',
          owners: ['borrower-001'],
          visibility: null,
        },
      ],
    };
    const result = generateChecklist(tfsaFixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_tfsa_statement');
  });

  test('TFSA detected from description when type is cash_savings', () => {
    // Type is cash_savings but description says TFSA
    const tfsaDescFixture: FinmoApplicationResponse = {
      ...employedPurchase,
      assets: [
        {
          id: 'asset-tfsa-desc',
          applicationId: employedPurchase.application.id,
          type: 'cash_savings',
          value: 10000,
          downPayment: 10000,
          description: 'TFSA at TestBank',
          owners: ['borrower-001'],
          visibility: null,
        },
      ],
    };
    const result = generateChecklist(tfsaDescFixture, undefined, TEST_DATE);
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).toContain('s14_tfsa_statement');
  });
});

// ---------------------------------------------------------------------------
// CHKL-06: Gift letter handling
// ---------------------------------------------------------------------------

describe('CHKL-06: Gift letter handling', () => {
  const result = generateChecklist(giftDownPayment, undefined, TEST_DATE);

  test('gift donor info is in shared items (forEmail: true)', () => {
    const giftDonorInfo = result.sharedItems.find(
      (i) => i.ruleId === 's14_gift_donor_info'
    );
    expect(giftDonorInfo).toBeDefined();
    expect(giftDonorInfo!.forEmail).toBe(true);
  });

  test('gift amount is in shared items (forEmail: true)', () => {
    const giftAmount = result.sharedItems.find(
      (i) => i.ruleId === 's14_gift_amount'
    );
    expect(giftAmount).toBeDefined();
    expect(giftAmount!.forEmail).toBe(true);
  });

  test('gift letter is in internalFlags, NOT in shared items or borrower items', () => {
    // In internal flags
    const internalRuleIds = result.internalFlags.map((f) => f.ruleId);
    expect(internalRuleIds).toContain('s14_gift_letter');

    // NOT in shared items
    const sharedRuleIds = result.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).not.toContain('s14_gift_letter');

    // NOT in any borrower checklist
    for (const bc of result.borrowerChecklists) {
      const borrowerRuleIds = bc.items.map((i) => i.ruleId);
      expect(borrowerRuleIds).not.toContain('s14_gift_letter');
    }
  });

  test('gift proof of funds included when process is found_property', () => {
    const proofOfFunds = result.sharedItems.find(
      (i) => i.ruleId === 's14_gift_proof_of_funds'
    );
    expect(proofOfFunds).toBeDefined();
    expect(proofOfFunds!.forEmail).toBe(true);
  });

  test('gift proof of funds NOT included when process is searching', () => {
    // Modify fixture to process: "searching"
    const searchingFixture: FinmoApplicationResponse = {
      ...giftDownPayment,
      application: {
        ...giftDownPayment.application,
        process: 'searching',
      },
    };
    const searchResult = generateChecklist(
      searchingFixture,
      undefined,
      TEST_DATE
    );
    const sharedRuleIds = searchResult.sharedItems.map((i) => i.ruleId);
    expect(sharedRuleIds).not.toContain('s14_gift_proof_of_funds');
  });
});
