/**
 * Generate a single Gmail draft for the Corp Borrower scenario (for Cat to review).
 *
 * Usage: npx tsx src/email/setup/draft-corp-email.ts
 */

import 'dotenv/config';
import { generateChecklist } from '../../checklist/engine/generate-checklist.js';
import { generateEmailBody } from '../body.js';
import { encodeMimeMessage } from '../mime.js';
import { emailConfig } from '../config.js';
import { createGmailDraft } from '../gmail-client.js';
import type { FinmoApplicationResponse } from '../../checklist/types/index.js';

import corpJson from '../../checklist/__tests__/fixtures/self-employed-corp.json' with { type: 'json' };

async function main(): Promise<void> {
  const data = corpJson as unknown as FinmoApplicationResponse;
  const testDate = new Date('2026-02-15T12:00:00Z');

  // 1. Generate checklist
  const checklist = generateChecklist(data, undefined, testDate);

  const borrowerFirstNames = checklist.borrowerChecklists.map(
    (bc) => bc.borrowerName.split(' ')[0],
  );

  console.log('=== Corp Borrower Email Draft ===\n');
  console.log(`Borrowers: ${borrowerFirstNames.join(', ')}`);
  console.log(`Stats: ${checklist.stats.totalItems} items (${checklist.stats.preItems} PRE, ${checklist.stats.fullItems} FULL)`);
  console.log(`Internal flags: ${checklist.internalFlags.length}`);
  console.log('');

  // 2. Generate email body
  const body = generateEmailBody(checklist, {
    borrowerFirstNames,
    docInboxEmail: emailConfig.docInbox,
  });

  // 3. Print email
  console.log('EMAIL BODY:');
  console.log('-'.repeat(60));
  console.log(body);
  console.log('-'.repeat(60));
  console.log('');

  // 4. Create Gmail draft
  const names = borrowerFirstNames.join(' & ');
  const recipient = emailConfig.recipientOverride ?? 'dev@venturemortgages.com';
  const subject = `${emailConfig.subjectPrefix}Documents Needed — ${names} (Corp Self-Employed)`;

  const raw = encodeMimeMessage({
    to: recipient,
    from: emailConfig.senderAddress,
    subject,
    body,
  });

  const draftId = await createGmailDraft(raw);
  console.log(`Draft created: ${draftId}`);
  console.log(`Subject: ${subject}`);
  console.log(`To: ${recipient}`);
  console.log('\nCheck Gmail Drafts to review!');
}

main().catch((err: unknown) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
