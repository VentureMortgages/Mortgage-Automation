/**
 * Generate an HTML email draft for Cat to review the new formatting.
 * Uses the co-borrower fixture for a realistic multi-section email.
 *
 * Usage: npx tsx src/email/setup/draft-html-preview.ts
 */

import 'dotenv/config';
import { generateChecklist } from '../../checklist/engine/generate-checklist.js';
import { generateEmailBody } from '../body.js';
import { encodeMimeMessage } from '../mime.js';
import { emailConfig } from '../config.js';
import { createGmailDraft } from '../gmail-client.js';
import type { FinmoApplicationResponse } from '../../checklist/types/index.js';

import coBorrowerJson from '../../checklist/__tests__/fixtures/co-borrower-mixed.json' with { type: 'json' };

async function main(): Promise<void> {
  const data = coBorrowerJson as unknown as FinmoApplicationResponse;
  const testDate = new Date('2026-02-15T12:00:00Z');

  const checklist = generateChecklist(data, undefined, testDate);

  const borrowerFirstNames = checklist.borrowerChecklists.map(
    (bc) => bc.borrowerName.split(' ')[0],
  );

  console.log('=== HTML Email Preview Draft ===\n');
  console.log(`Borrowers: ${borrowerFirstNames.join(', ')}`);
  console.log(`Stats: ${checklist.stats.totalItems} items (${checklist.stats.preItems} PRE, ${checklist.stats.fullItems} FULL)`);
  console.log('');

  const body = generateEmailBody(checklist, {
    borrowerFirstNames,
    docInboxEmail: emailConfig.docInbox,
  });

  const names = borrowerFirstNames.join(' & ');
  const recipient = emailConfig.recipientOverride ?? 'dev@venturemortgages.com';
  const subject = `${emailConfig.subjectPrefix}Documents Needed — ${names} (HTML Preview)`;

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
  console.log('\nCheck Gmail Drafts to review the HTML formatting!');
}

main().catch((err: unknown) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
