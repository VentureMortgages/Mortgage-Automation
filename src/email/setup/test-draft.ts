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
      borrowerIndex: 0,
      isMainBorrower: true,
      items: [
        { id: 'test-1', displayName: '2 most recent pay stubs', category: 'income', stage: 'PRE', scope: 'per_borrower', forEmail: true, notes: 'Must show year-to-date earnings' },
        { id: 'test-2', displayName: 'T4 slips (2 years)', category: 'income', stage: 'PRE', scope: 'per_borrower', forEmail: true },
        { id: 'test-3', displayName: '90-day bank statements', category: 'banking', stage: 'PRE', scope: 'per_borrower', forEmail: true, notes: 'All pages, all accounts used for down payment or savings' },
        { id: 'test-4', displayName: 'Letter of employment', category: 'income', stage: 'PRE', scope: 'per_borrower', forEmail: true, notes: 'Must include position, salary, start date, and employment status' },
      ],
    },
  ],
  propertyChecklists: [
    {
      propertyDescription: '123 Test Street, Toronto',
      propertyIndex: 0,
      items: [
        { id: 'test-5', displayName: 'MLS listing', category: 'property', stage: 'FULL', scope: 'per_property', forEmail: true },
        { id: 'test-6', displayName: 'Purchase agreement', category: 'property', stage: 'FULL', scope: 'per_property', forEmail: true, notes: 'All pages including schedules and amendments' },
      ],
    },
  ],
  sharedItems: [
    { id: 'test-7', displayName: 'Void cheque or direct deposit form', category: 'other', stage: 'FULL', scope: 'shared', forEmail: true },
  ],
  internalFlags: [],
  stats: { totalItems: 7, preItems: 4, fullItems: 3, borrowerCount: 1, propertyCount: 1 },
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
