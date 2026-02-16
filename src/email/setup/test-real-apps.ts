/**
 * E2E test: Pull REAL applications from Finmo API and generate draft emails.
 *
 * Run with: npx tsx src/email/setup/test-real-apps.ts
 *
 * Fetches 5 diverse real applications from Finmo, runs each through the
 * checklist engine + email generator, and creates Gmail drafts in dev@'s inbox.
 */

import 'dotenv/config';
import { generateChecklist } from '../../checklist/engine/generate-checklist.js';
import { generateEmailBody } from '../body.js';
import { encodeMimeMessage } from '../mime.js';
import { emailConfig } from '../config.js';
import { createGmailDraft } from '../gmail-client.js';
import type { FinmoApplicationResponse } from '../../checklist/types/index.js';

// ---------------------------------------------------------------------------
// Real application IDs (diverse scenarios from Finmo)
// ---------------------------------------------------------------------------

const REAL_APPS = [
  {
    id: 'c278bd6a-bdd0-456d-b148-893622499212',
    label: 'Single, purchase, hourly employed, condo + gift asset',
  },
  {
    id: '7a1f3d8e-26ed-43cb-8445-e820c97d9a86',
    label: 'Couple, refinance, salaried employed, detached',
  },
  {
    id: '13c71d64-2d98-4dcd-91b3-f484ccb81f4f',
    label: 'Couple, purchase, salaried + self-employed, detached',
  },
  {
    id: 'a7ff7acb-1b36-4ace-b029-3d81d6a43715',
    label: 'Couple, purchase, both self-employed, condo',
  },
  {
    id: 'ea6c6634-4626-4161-b9f3-7c082860d727',
    label: 'Couple, refinance, hourly employed, multiple condos',
  },
];

// ---------------------------------------------------------------------------
// Finmo API Fetch
// ---------------------------------------------------------------------------

async function fetchApplication(appId: string): Promise<FinmoApplicationResponse> {
  const apiKey = process.env.FINMO_API_KEY;
  if (!apiKey) throw new Error('FINMO_API_KEY not set in .env');

  const res = await fetch(`https://app.finmo.ca/api/v1/applications/${appId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Finmo API ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as FinmoApplicationResponse;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('  E2E TEST: Real Finmo applications → Draft emails');
  console.log(`  Mode: ${emailConfig.isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
  console.log(`  Sender: ${emailConfig.senderAddress}`);
  console.log(`  Recipient: ${emailConfig.recipientOverride ?? 'real client'}`);
  console.log(`  Apps to process: ${REAL_APPS.length}`);
  console.log('='.repeat(70));
  console.log('');

  let successCount = 0;

  for (const app of REAL_APPS) {
    console.log('-'.repeat(70));
    console.log(`APP: ${app.id}`);
    console.log(`  ${app.label}`);
    console.log('-'.repeat(70));

    try {
      // 1. Fetch from Finmo API
      console.log('  Fetching from Finmo API...');
      const data = await fetchApplication(app.id);

      const borrowerNames = data.borrowers?.map(
        (b) => `${b.firstName} ${b.lastName}`,
      ) ?? [];
      const incomeTypes = data.incomes?.map(
        (i) => `${i.source}/${i.payType ?? 'n/a'}`,
      ) ?? [];
      console.log(`  Borrowers: ${borrowerNames.join(', ')}`);
      console.log(`  Goal: ${data.application?.goal ?? 'n/a'}`);
      console.log(`  Incomes: ${incomeTypes.join(', ')}`);

      // 2. Generate checklist
      const checklist = generateChecklist(data);

      const borrowerFirstNames = checklist.borrowerChecklists.map(
        (bc) => bc.borrowerName.split(' ')[0],
      );

      console.log(`  Checklist: ${checklist.stats.totalItems} items (${checklist.stats.preItems} PRE, ${checklist.stats.fullItems} FULL)`);
      console.log(`  Properties: ${checklist.propertyChecklists.length}`);
      console.log(`  Shared items: ${checklist.sharedItems.filter((i) => i.forEmail).length}`);
      if (checklist.warnings.length > 0) {
        console.log(`  Warnings: ${checklist.warnings.join(', ')}`);
      }
      console.log('');

      // 3. Generate email body
      const body = generateEmailBody(checklist, {
        borrowerFirstNames,
        docInboxEmail: emailConfig.docInbox,
      });

      // 4. Build subject + recipient
      const names = borrowerFirstNames.join(' & ');
      const recipient = emailConfig.recipientOverride ?? 'dev@venturemortgages.com';
      const subject = `${emailConfig.subjectPrefix}Documents Needed — ${names}`;

      // 5. Print the email body
      console.log('  EMAIL BODY:');
      for (const line of body.split('\n')) {
        console.log(`  | ${line}`);
      }
      console.log('');

      // 6. Create Gmail draft
      const raw = encodeMimeMessage({
        to: recipient,
        from: emailConfig.senderAddress,
        subject,
        body,
      });

      const draftId = await createGmailDraft(raw);
      console.log(`  Draft created: ${draftId}`);
      console.log(`  Subject: ${subject}`);
      successCount++;
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
    }

    console.log('');
  }

  console.log('='.repeat(70));
  console.log(`  Done! ${successCount}/${REAL_APPS.length} drafts created in dev@'s Gmail.`);
  console.log('  Check Gmail -> Drafts to review each real application.');
  console.log('='.repeat(70));
}

main().catch((err: unknown) => {
  console.error('Script failed:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
