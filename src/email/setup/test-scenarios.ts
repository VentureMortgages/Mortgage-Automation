/**
 * E2E test: Generate draft emails for multiple borrower scenarios.
 *
 * Run with: npx tsx src/email/setup/test-scenarios.ts
 *
 * Creates a Gmail draft for each scenario in dev@'s Drafts folder.
 * Shows how different conditions produce different doc request emails.
 */

import 'dotenv/config';
import { generateChecklist } from '../../checklist/engine/generate-checklist.js';
import { generateEmailBody } from '../body.js';
import { encodeMimeMessage } from '../mime.js';
import { emailConfig } from '../config.js';
import { createGmailDraft } from '../gmail-client.js';
import type { FinmoApplicationResponse } from '../../checklist/types/index.js';

// Import test fixtures
import employedPurchaseJson from '../../checklist/__tests__/fixtures/employed-purchase.json' with { type: 'json' };
import selfEmployedRefiJson from '../../checklist/__tests__/fixtures/self-employed-refi.json' with { type: 'json' };
import retiredCondoJson from '../../checklist/__tests__/fixtures/retired-condo.json' with { type: 'json' };
import coBorrowerMixedJson from '../../checklist/__tests__/fixtures/co-borrower-mixed.json' with { type: 'json' };
import giftDownPaymentJson from '../../checklist/__tests__/fixtures/gift-down-payment.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Scenario Definitions
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  description: string;
  data: FinmoApplicationResponse;
}

const scenarios: Scenario[] = [
  {
    name: 'Employed Purchase',
    description: 'Single employed borrower purchasing a detached home',
    data: employedPurchaseJson as unknown as FinmoApplicationResponse,
  },
  {
    name: 'Self-Employed Refinance',
    description: 'Single self-employed borrower refinancing',
    data: selfEmployedRefiJson as unknown as FinmoApplicationResponse,
  },
  {
    name: 'Retired Condo',
    description: 'Single retired borrower refinancing a condo',
    data: retiredCondoJson as unknown as FinmoApplicationResponse,
  },
  {
    name: 'Co-Borrower Mixed',
    description: 'Two borrowers: Alice (salaried) + Bob (hourly with bonus)',
    data: coBorrowerMixedJson as unknown as FinmoApplicationResponse,
  },
  {
    name: 'Gift Down Payment',
    description: 'Single borrower with gift down payment, found property',
    data: giftDownPaymentJson as unknown as FinmoApplicationResponse,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('  E2E TEST: Generating draft emails for all scenarios');
  console.log(`  Mode: ${emailConfig.isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
  console.log(`  Sender: ${emailConfig.senderAddress}`);
  console.log(`  Recipient: ${emailConfig.recipientOverride ?? 'real client'}`);
  console.log('='.repeat(70));
  console.log('');

  const testDate = new Date('2026-02-15T12:00:00Z');

  for (const scenario of scenarios) {
    console.log('-'.repeat(70));
    console.log(`SCENARIO: ${scenario.name}`);
    console.log(`  ${scenario.description}`);
    console.log('-'.repeat(70));

    // 1. Generate checklist
    const checklist = generateChecklist(scenario.data, undefined, testDate);

    // Extract borrower first names
    const borrowerFirstNames = checklist.borrowerChecklists.map(
      (bc) => bc.borrowerName.split(' ')[0],
    );

    console.log(`  Borrowers: ${borrowerFirstNames.join(', ')}`);
    console.log(`  Stats: ${checklist.stats.totalItems} items (${checklist.stats.preItems} PRE, ${checklist.stats.fullItems} FULL)`);
    console.log(`  Properties: ${checklist.propertyChecklists.length}`);
    console.log(`  Shared items: ${checklist.sharedItems.filter((i) => i.forEmail).length}`);
    console.log(`  Internal flags: ${checklist.internalFlags.length}`);
    if (checklist.warnings.length > 0) {
      console.log(`  Warnings: ${checklist.warnings.join(', ')}`);
    }
    console.log('');

    // 2. Generate email body
    const body = generateEmailBody(checklist, {
      borrowerFirstNames,
      docInboxEmail: emailConfig.docInbox,
    });

    // 3. Build subject + recipient
    const names = borrowerFirstNames.join(' & ');
    const recipient = emailConfig.recipientOverride ?? 'dev@venturemortgages.com';
    const subject = `${emailConfig.subjectPrefix}Documents Needed — ${names} (${scenario.name})`;

    // 4. Print the email body
    console.log('  EMAIL BODY:');
    for (const line of body.split('\n')) {
      console.log(`  | ${line}`);
    }
    console.log('');

    // 5. Create Gmail draft
    const raw = encodeMimeMessage({
      to: recipient,
      from: emailConfig.senderAddress,
      subject,
      body,
    });

    const draftId = await createGmailDraft(raw);
    console.log(`  Draft created: ${draftId}`);
    console.log(`  Subject: ${subject}`);
    console.log('');
  }

  console.log('='.repeat(70));
  console.log(`  Done! ${scenarios.length} drafts created in dev@'s Gmail.`);
  console.log('  Check Gmail -> Drafts to review each scenario.');
  console.log('='.repeat(70));
}

main().catch((err: unknown) => {
  console.error('Script failed:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
