/**
 * Test Fixtures — Typed Finmo Application Responses
 *
 * All fixtures use FAKE data only. No real client PII.
 * Each fixture represents a different application profile for testing.
 */

import type { FinmoApplicationResponse } from '../../types/index.js';

import employedPurchaseJson from './employed-purchase.json' with { type: 'json' };
import selfEmployedRefiJson from './self-employed-refi.json' with { type: 'json' };
import retiredCondoJson from './retired-condo.json' with { type: 'json' };
import coBorrowerMixedJson from './co-borrower-mixed.json' with { type: 'json' };
import giftDownPaymentJson from './gift-down-payment.json' with { type: 'json' };
import minimalApplicationJson from './minimal-application.json' with { type: 'json' };

/** Single employed borrower purchasing a detached home */
export const employedPurchase = employedPurchaseJson as unknown as FinmoApplicationResponse;

/** Single self-employed borrower refinancing (businessType null — ambiguous sub-type) */
export const selfEmployedRefi = selfEmployedRefiJson as unknown as FinmoApplicationResponse;

/** Single retired borrower refinancing a condo */
export const retiredCondo = retiredCondoJson as unknown as FinmoApplicationResponse;

/** Two borrowers: Alice (salaried, no bonus) + Bob (hourly, with bonus) purchasing */
export const coBorrowerMixed = coBorrowerMixedJson as unknown as FinmoApplicationResponse;

/** Single borrower with gift down payment, process: found_property */
export const giftDownPayment = giftDownPaymentJson as unknown as FinmoApplicationResponse;

/** Minimal application — no incomes, no assets, no properties */
export const minimalApplication = minimalApplicationJson as unknown as FinmoApplicationResponse;

/** All fixtures as a named collection */
export const fixtures = {
  employedPurchase,
  selfEmployedRefi,
  retiredCondo,
  coBorrowerMixed,
  giftDownPayment,
  minimalApplication,
} as const;
