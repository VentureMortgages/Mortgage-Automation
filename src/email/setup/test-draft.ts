/**
 * Quick test: Create a draft email in dev@venturemortgages.com's Gmail.
 *
 * Run with: npx tsx src/email/setup/test-draft.ts
 *
 * This creates a real draft in Gmail — check dev@'s Drafts folder after running.
 */

import 'dotenv/config';
import { generateEmailBody } from '../body.js';
import { encodeMimeMessage } from '../mime.js';
import { emailConfig } from '../config.js';
import { createGmailDraft } from '../gmail-client.js';
import type { GeneratedChecklist } from '../../checklist/types/index.js';

// Build a realistic test checklist
const testChecklist: GeneratedChecklist = {
  borrowerChecklists: [
    {
      borrowerName: 'Test Borrower',
      borrowerId: 'test-borrower-1',
      isMainBorrower: true,
      items: [
        { ruleId: 'test-1', document: 'pay stubs', displayName: '2 most recent pay stubs', stage: 'PRE', section: '1_income_employed_salary', forEmail: true, notes: 'Must show year-to-date earnings' },
        { ruleId: 'test-2', document: 'T4 slips', displayName: 'T4 slips (2 years)', stage: 'PRE', section: '1_income_employed_salary', forEmail: true },
        { ruleId: 'test-3', document: '90-day bank statements', displayName: '90-day bank statements', stage: 'PRE', section: '14_down_payment_savings', forEmail: true, notes: 'All pages, all accounts used for down payment or savings' },
        { ruleId: 'test-4', document: 'Letter of employment', displayName: 'Letter of employment', stage: 'PRE', section: '1_income_employed_salary', forEmail: true, notes: 'Must include position, salary, start date, and employment status' },
      ],
    },
  ],
  propertyChecklists: [
    {
      propertyDescription: '123 Test Street, Toronto',
      propertyId: 'test-property-1',
      items: [
        { ruleId: 'test-5', document: 'MLS listing', displayName: 'MLS listing', stage: 'FULL', section: '15_property_purchase', forEmail: true },
        { ruleId: 'test-6', document: 'Purchase agreement', displayName: 'Purchase agreement', stage: 'FULL', section: '15_property_purchase', forEmail: true, notes: 'All pages including schedules and amendments' },
      ],
    },
  ],
  sharedItems: [
    { ruleId: 'test-7', document: 'Void cheque', displayName: 'Void cheque or direct deposit form', stage: 'FULL', section: '0_base_pack', forEmail: true },
  ],
  internalFlags: [],
  stats: { totalItems: 7, preItems: 4, fullItems: 3, perBorrowerItems: 4, sharedItems: 1, internalFlags: 0, warnings: 0 },
  applicationId: 'test-app-1',
  warnings: [],
  generatedAt: new Date().toISOString(),
};

async function main(): Promise<void> {
  console.log('Testing Gmail draft creation...');
  console.log(`Mode: ${emailConfig.isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
  console.log(`Sender: ${emailConfig.senderAddress}`);
  console.log(`Recipient override: ${emailConfig.recipientOverride ?? 'none (production)'}`);
  console.log('');

  // 1. Generate email body
  const body = generateEmailBody(testChecklist, {
    borrowerFirstNames: ['Test'],
    docInboxEmail: emailConfig.docInbox,
  });

  console.log('--- EMAIL BODY PREVIEW ---');
  console.log(body);
  console.log('--- END PREVIEW ---\n');

  // 2. Build subject + recipient
  const recipient = emailConfig.recipientOverride ?? 'dev@venturemortgages.com';
  const subject = `${emailConfig.subjectPrefix}Documents Needed — Test Borrower`;

  // 3. Encode MIME
  const raw = encodeMimeMessage({
    to: recipient,
    from: emailConfig.senderAddress,
    subject,
    body,
  });

  // 4. Create draft in Gmail
  console.log(`Creating draft: "${subject}" to ${recipient}...`);
  const draftId = await createGmailDraft(raw);

  console.log('');
  console.log('='.repeat(60));
  console.log(`Draft created successfully!`);
  console.log(`Draft ID: ${draftId}`);
  console.log(`Check dev@venturemortgages.com Gmail -> Drafts folder`);
  console.log('='.repeat(60));
}

main().catch((err: unknown) => {
  console.error('Test failed:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
