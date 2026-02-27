/**
 * Generate draft emails from REAL Finmo applications as Gmail drafts.
 *
 * Run with: npx tsx src/email/setup/test-real-apps.ts
 * Target: TARGET_EMAIL env var (default: admin@venturemortgages.com)
 *
 * Uses service account with domain-wide delegation to impersonate
 * the target email and create drafts there for review.
 *
 * Fetches diverse real applications from Finmo, runs each through the
 * checklist engine + email body generator, and creates Gmail drafts.
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { generateChecklist } from '../../checklist/engine/generate-checklist.js';
import { generateEmailBody } from '../body.js';
import { encodeMimeMessage } from '../mime.js';
import type { FinmoApplicationResponse } from '../../checklist/types/index.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TARGET_EMAIL = process.env.TARGET_EMAIL ?? 'admin@venturemortgages.com';
const DOC_INBOX = process.env.DOC_INBOX ?? 'docs@venturemortgages.com';

// ---------------------------------------------------------------------------
// Real application IDs (diverse scenarios from Finmo)
// ---------------------------------------------------------------------------

const REAL_APPS = [
  {
    id: 'c278bd6a-bdd0-456d-b148-893622499212',
    label: 'Single purchase — hourly employed, gift + savings (Megan Fedak)',
  },
  {
    id: 'fffebfb6-465f-40cd-9636-245d3052033d',
    label: 'Single purchase — hourly + CPP income, RRSP assets (Angela Yurich)',
  },
  {
    id: '2114c189-ede0-4efc-9f54-8c87a4aeacbe',
    label: 'Couple purchase — both hourly, gift down payment (Depever/Jarman)',
  },
  {
    id: '13c71d64-2d98-4dcd-91b3-f484ccb81f4f',
    label: 'Couple purchase — salaried + self-employed (Zurstrom/Zurstrom)',
  },
  {
    id: '7a1f3d8e-26ed-43cb-8445-e820c97d9a86',
    label: 'Couple refinance — both salaried, multiple properties (Cameron/Taras)',
  },
  {
    id: '5ad0ea44-e83c-4827-b78a-b7eaffae7251',
    label: 'Couple refinance — self-employed + hourly (Gabelhouse)',
  },
  {
    id: 'b5be54ae-ea9f-4268-a4f2-04d08b889774',
    label: 'Renewal — single self-employed (Erin Sloan)',
  },
  {
    id: '46a54d2b-d0b1-411c-8649-f04b70114e63',
    label: 'Investment purchase — self-employed + salaried (Pitre/Sinclair)',
  },
  {
    id: '170867c2-298e-440a-8ec2-7f81e7e7aba3',
    label: 'Rental purchase — both hourly+salaried, gift (Trischuk/Calder)',
  },
  {
    id: 'cbc40cdd-a520-408c-853c-f83c939804e9',
    label: '3-borrower investment refi — mixed income (Farina family)',
  },
  {
    id: 'bd67aa5f-864e-4eaa-8cc4-444ad3f842ed',
    label: 'Single refinance — commission + salaried (Steffie Pellerin)',
  },
];

// ---------------------------------------------------------------------------
// Service Account Gmail Client (bypasses OAuth2 priority in gmail-client.ts)
// ---------------------------------------------------------------------------

function createAdminGmailClient() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY not set in .env. ' +
        'Base64-encode the service account JSON key and add it.',
    );
  }

  const key = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));

  const auth = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
    subject: TARGET_EMAIL,
  });

  return google.gmail({ version: 'v1', auth });
}

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
  console.log('  Draft Generator: Real Finmo applications → admin@ Gmail drafts');
  console.log(`  Drafts will appear in: ${TARGET_EMAIL}`);
  console.log(`  Doc inbox: ${DOC_INBOX}`);
  console.log(`  Apps to process: ${REAL_APPS.length}`);
  console.log('='.repeat(70));
  console.log('');

  const gmail = createAdminGmailClient();
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

      const borrowerNames =
        data.borrowers?.map((b) => `${b.firstName} ${b.lastName}`) ?? [];
      const incomeTypes =
        data.incomes?.map((i) => `${i.source}/${i.payType ?? 'n/a'}`) ?? [];
      console.log(`  Borrowers: ${borrowerNames.join(', ')}`);
      console.log(`  Goal: ${data.application?.goal ?? 'n/a'}`);
      console.log(`  Incomes: ${incomeTypes.join(', ')}`);

      // 2. Generate checklist
      const checklist = generateChecklist(data);

      const borrowerFirstNames = checklist.borrowerChecklists.map(
        (bc) => bc.borrowerName.split(' ')[0],
      );

      console.log(
        `  Checklist: ${checklist.stats.totalItems} items ` +
          `(${checklist.stats.preItems} PRE, ${checklist.stats.fullItems} FULL)`,
      );
      console.log(`  Properties: ${checklist.propertyChecklists.length}`);
      console.log(
        `  Shared items: ${checklist.sharedItems.filter((i) => i.forEmail).length}`,
      );
      if (checklist.warnings.length > 0) {
        console.log(`  Warnings: ${checklist.warnings.join(', ')}`);
      }

      // 3. Generate email body
      const body = generateEmailBody(checklist, {
        borrowerFirstNames,
        docInboxEmail: DOC_INBOX,
      });

      // 4. Build subject + encode MIME
      const names = borrowerFirstNames.join(' & ');
      const subject = `[REVIEW] Documents Needed — ${names}`;

      const raw = encodeMimeMessage({
        to: TARGET_EMAIL, // draft "To" — Cat will change before sending
        from: TARGET_EMAIL,
        subject,
        body,
      });

      // 5. Create draft in admin@'s Gmail
      const response = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw } },
      });

      const draftId = response.data.id;
      console.log(`  Draft created: ${draftId}`);
      console.log(`  Subject: ${subject}`);
      successCount++;
    } catch (err) {
      console.error(
        `  ERROR: ${err instanceof Error ? err.message : err}`,
      );
      if (err instanceof Error && err.stack) {
        console.error(`  ${err.stack.split('\n').slice(1, 3).join('\n  ')}`);
      }
    }

    console.log('');
  }

  console.log('='.repeat(70));
  console.log(
    `  Done! ${successCount}/${REAL_APPS.length} drafts created in ${TARGET_EMAIL}'s Gmail.`,
  );
  console.log('  Cat can review in Gmail → Drafts.');
  console.log('='.repeat(70));
}

main().catch((err: unknown) => {
  console.error('Script failed:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
