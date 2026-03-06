/**
 * E2E Test: Feedback Loop Verification
 *
 * Two-step verification:
 *
 *   Step 1 — Create draft:
 *     npx tsx src/e2e/test-feedback.ts create
 *     → Fetches a real Finmo app, generates checklist, creates Gmail draft
 *     → Stores original HTML + context in a local file (no Redis needed)
 *     → Draft has BCC + X-Venture headers for tracking
 *     → Edit the draft in Gmail (remove/reword items), then SEND it
 *
 *   Step 2 — Capture feedback (after you've sent the edited draft):
 *     npx tsx src/e2e/test-feedback.ts capture
 *     → Scans inbox for the BCC copy (looks for X-Venture headers)
 *     → Diffs original vs sent using Gemini
 *     → Stores feedback record in data/feedback-records.json
 *
 * Prerequisites:
 *   - GEMINI_API_KEY in .env (for diff analysis in step 2)
 *   - GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_REFRESH_TOKEN in .env
 *   - FINMO_API_KEY in .env
 *
 * Note: This script stores the original email in a local file instead of
 * Redis so it can be run without infrastructure. In production, the webhook
 * worker stores originals in Redis with a 30-day TTL.
 */

import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { generateChecklist } from '../checklist/engine/generate-checklist.js';
import { generateEmailBody } from '../email/body.js';
import { encodeMimeMessage } from '../email/mime.js';
import { extractEmailHtml } from '../feedback/html-extractor.js';
import { analyzeEdits } from '../feedback/diff-analyzer.js';
import { appendFeedbackRecord, loadFeedbackRecords } from '../feedback/feedback-store.js';
import { buildContextText } from '../feedback/utils.js';
import { randomUUID } from 'node:crypto';
import type { FinmoApplicationResponse } from '../checklist/types/index.js';
import type { ApplicationContext } from '../feedback/types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGINAL_FILE = path.resolve(__dirname, '../../data/feedback-test-original.json');

const TARGET_EMAIL = process.env.EMAIL_SENDER
  ?? (process.env.APP_ENV === 'production' ? 'admin@venturemortgages.com' : 'dev@venturemortgages.com');

const BCC_EMAIL = process.env.EMAIL_BCC ?? TARGET_EMAIL;
const DOC_INBOX = process.env.DOC_INBOX ?? 'dev@venturemortgages.com';

// A real Finmo app to test with (single purchase, salaried — common case)
const TEST_APP_ID = 'c278bd6a-bdd0-456d-b148-893622499212';
const TEST_CONTACT_ID = 'feedback-test-contact';

// ---------------------------------------------------------------------------
// Gmail Client
// ---------------------------------------------------------------------------

function createGmailClient(scopes: string[]) {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');

  const key = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  const auth = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes,
    subject: TARGET_EMAIL,
  });

  return google.gmail({ version: 'v1', auth });
}

// ---------------------------------------------------------------------------
// Finmo Fetch
// ---------------------------------------------------------------------------

async function fetchApplication(appId: string): Promise<FinmoApplicationResponse> {
  const apiKey = process.env.FINMO_API_KEY;
  if (!apiKey) throw new Error('FINMO_API_KEY not set');

  const res = await fetch(`https://app.finmo.ca/api/v1/applications/${appId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`Finmo API ${res.status}: ${await res.text()}`);
  return (await res.json()) as FinmoApplicationResponse;
}

// ---------------------------------------------------------------------------
// Local original storage (replaces Redis for this E2E test)
// ---------------------------------------------------------------------------

async function storeOriginalLocally(html: string, context: ApplicationContext): Promise<void> {
  await mkdir(path.dirname(ORIGINAL_FILE), { recursive: true });
  await writeFile(ORIGINAL_FILE, JSON.stringify({ html, context }, null, 2), 'utf-8');
}

async function loadOriginalLocally(): Promise<{ html: string; context: ApplicationContext } | null> {
  try {
    const raw = await readFile(ORIGINAL_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 1: Create Draft
// ---------------------------------------------------------------------------

async function stepCreate(): Promise<void> {
  console.log('='.repeat(60));
  console.log('  STEP 1: Create Draft with Feedback Tracking');
  console.log('='.repeat(60));
  console.log('');

  // 1. Fetch from Finmo
  console.log('1. Fetching Finmo application...');
  const data = await fetchApplication(TEST_APP_ID);
  const borrowerFirstNames = data.borrowers.map(b => b.firstName);
  console.log(`   Borrowers: ${data.borrowers.map(b => `${b.firstName} ${b.lastName}`).join(', ')}`);
  console.log(`   Goal: ${data.application.goal}`);

  // 2. Generate checklist
  console.log('2. Generating checklist...');
  const checklist = generateChecklist(data);
  console.log(`   Items: ${checklist.stats.totalItems} (${checklist.stats.preItems} PRE, ${checklist.stats.fullItems} FULL)`);

  // 3. Build application context
  const applicationContext: ApplicationContext = {
    goal: data.application.goal,
    incomeTypes: data.incomes.map(i => `${i.source}/${i.payType ?? 'none'}`),
    propertyTypes: [...new Set(data.properties.map(p => p.use).filter(Boolean))] as string[],
    borrowerCount: data.borrowers.length,
    hasGiftDP: data.assets.some(a => a.type === 'gift' && (a.downPayment ?? 0) > 0),
    hasRentalIncome: data.properties.some(p => (p.rentalIncome ?? 0) > 0),
  };

  const contextText = buildContextText(applicationContext);
  console.log(`   Context: ${contextText}`);

  // 4. Generate email body
  console.log('3. Generating email body...');
  const body = generateEmailBody(checklist, {
    borrowerFirstNames,
    docInboxEmail: DOC_INBOX,
  });

  // 5. Store original locally (instead of Redis — no infra needed for E2E)
  console.log('4. Storing original locally...');
  await storeOriginalLocally(body, applicationContext);
  console.log(`   Saved to: ${ORIGINAL_FILE}`);

  // 6. Create draft with BCC + X-Venture headers
  console.log('5. Creating Gmail draft...');
  const names = borrowerFirstNames.join(' & ');
  const subject = `[FEEDBACK TEST] Documents Needed — ${names}`;

  const raw = encodeMimeMessage({
    to: TARGET_EMAIL,
    from: TARGET_EMAIL,
    bcc: BCC_EMAIL,
    subject,
    body,
    customHeaders: {
      'X-Venture-Type': 'doc-request',
      'X-Venture-Contact-Id': TEST_CONTACT_ID,
    },
  });

  const gmail = createGmailClient(['https://www.googleapis.com/auth/gmail.compose']);
  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw } },
  });

  console.log(`   Draft ID: ${response.data.id}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   BCC: ${BCC_EMAIL}`);
  console.log('');
  console.log('='.repeat(60));
  console.log('  NEXT STEPS:');
  console.log(`  1. Open ${TARGET_EMAIL}'s Gmail -> Drafts`);
  console.log(`  2. Find "${subject}"`);
  console.log('  3. Edit it: REMOVE at least one doc, REWORD another');
  console.log('  4. Hit SEND');
  console.log('  5. Wait ~30 seconds for BCC to arrive');
  console.log('  6. Run: npx tsx src/e2e/test-feedback.ts capture');
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Step 2: Capture Feedback
// ---------------------------------------------------------------------------

async function stepCapture(): Promise<void> {
  console.log('='.repeat(60));
  console.log('  STEP 2: Capture Feedback from Sent Email');
  console.log('='.repeat(60));
  console.log('');

  // 1. Load the stored original
  console.log('1. Loading stored original...');
  const original = await loadOriginalLocally();
  if (!original) {
    console.log('   No original found. Run "create" step first.');
    return;
  }
  console.log(`   Original loaded (${original.html.length} chars)`);
  console.log(`   Context: ${buildContextText(original.context)}`);

  // 2. Search for the sent email in the inbox
  console.log('');
  console.log('2. Searching for sent email in inbox...');
  const gmail = createGmailClient(['https://www.googleapis.com/auth/gmail.readonly']);

  const searchResult = await gmail.users.messages.list({
    userId: 'me',
    q: 'subject:"[FEEDBACK TEST] Documents Needed" newer_than:1d',
    maxResults: 10,
  });

  const messages = searchResult.data.messages ?? [];
  if (messages.length === 0) {
    console.log('   No matching messages found. Did you send the draft?');
    console.log('   Make sure you waited ~30 seconds after sending.');
    return;
  }

  console.log(`   Found ${messages.length} message(s)`);

  // 3. Find the sent message (look for X-Venture headers or just the most recent)
  let sentMessageId: string | null = null;
  let foundViaHeaders = false;

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id!,
      format: 'metadata',
      metadataHeaders: ['X-Venture-Type', 'X-Venture-Contact-Id', 'Subject'],
    });

    const headers = full.data.payload?.headers ?? [];
    const ventureType = headers.find(h => h.name === 'X-Venture-Type')?.value;
    const contactId = headers.find(h => h.name === 'X-Venture-Contact-Id')?.value;
    const subject = headers.find(h => h.name === 'Subject')?.value;

    console.log(`   Message ${msg.id}: venture=${ventureType ?? 'none'}, contact=${contactId ?? 'none'}`);

    if (ventureType === 'doc-request' && contactId === TEST_CONTACT_ID) {
      sentMessageId = msg.id!;
      foundViaHeaders = true;
      break;
    }
  }

  // Fallback: use the most recent matching message if headers were stripped
  if (!sentMessageId && messages.length > 0) {
    sentMessageId = messages[0].id!;
    console.log(`   X-Venture headers not found (stripped on send). Using most recent message.`);
  }

  if (!sentMessageId) {
    console.log('   Could not find sent message.');
    return;
  }

  console.log(`   Using message: ${sentMessageId} (${foundViaHeaders ? 'matched via headers' : 'fallback to most recent'})`);

  // 4. Extract the sent HTML
  console.log('');
  console.log('3. Extracting sent HTML...');
  const sentHtml = await extractEmailHtml(gmail, sentMessageId);
  if (!sentHtml) {
    console.log('   Could not extract HTML from sent message.');
    return;
  }
  console.log(`   Sent HTML extracted (${sentHtml.length} chars)`);

  // 5. Diff using Gemini
  console.log('');
  console.log('4. Analyzing edits with Gemini...');
  const edits = await analyzeEdits(original.html, sentHtml);

  console.log(`   No changes: ${edits.noChanges}`);
  console.log(`   Items removed: ${edits.itemsRemoved.length}`);
  for (const item of edits.itemsRemoved) console.log(`     - ${item}`);
  console.log(`   Items added: ${edits.itemsAdded.length}`);
  for (const item of edits.itemsAdded) console.log(`     + ${item}`);
  console.log(`   Items reworded: ${edits.itemsReworded.length}`);
  for (const rw of edits.itemsReworded) console.log(`     "${rw.original}" -> "${rw.modified}"`);
  if (edits.otherChanges) console.log(`   Other: ${edits.otherChanges}`);

  if (edits.noChanges) {
    console.log('');
    console.log('   No edits detected. Did you modify the email before sending?');
    return;
  }

  // 6. Store feedback record
  console.log('');
  console.log('5. Storing feedback record...');
  const contextText = buildContextText(original.context);
  await appendFeedbackRecord({
    id: randomUUID(),
    contactId: TEST_CONTACT_ID,
    createdAt: new Date().toISOString(),
    context: original.context,
    contextText,
    embedding: null,
    edits,
  });

  // 7. Show result
  const records = await loadFeedbackRecords();
  console.log(`   Total feedback records: ${records.length}`);
  console.log(`   Record saved to: data/feedback-records.json`);

  console.log('');
  console.log('='.repeat(60));
  console.log('  FEEDBACK LOOP VERIFIED!');
  console.log('');
  console.log('  The system captured Cat\'s edits. On future similar');
  console.log('  applications, these edits will be auto-applied when');
  console.log('  2+ matching records agree.');
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const command = process.argv[2];

if (command === 'create') {
  stepCreate().catch(err => { console.error('Failed:', err); process.exit(1); });
} else if (command === 'capture') {
  stepCapture().catch(err => { console.error('Failed:', err); process.exit(1); });
} else {
  console.log('Usage:');
  console.log('  npx tsx src/e2e/test-feedback.ts create   — Create draft + store original');
  console.log('  npx tsx src/e2e/test-feedback.ts capture  — Capture feedback after sending');
  process.exit(1);
}
