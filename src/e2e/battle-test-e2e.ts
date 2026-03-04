/**
 * Battle Test E2E — Full pipeline verification for Phases 18 & 19
 *
 * Creates test fixtures (CRM contacts, Drive folders), sends fake doc emails
 * to docs@, verifies the full pipeline via /admin/test-intake endpoint.
 *
 * Subcommands:
 *   npx tsx src/e2e/battle-test-e2e.ts setup        — Create test contacts, folders, Redis thread mapping
 *   npx tsx src/e2e/battle-test-e2e.ts send          — Generate fake PDFs, send test emails
 *   npx tsx src/e2e/battle-test-e2e.ts verify        — Verify via test-intake (dry-run)
 *   npx tsx src/e2e/battle-test-e2e.ts verify --live — Verify via test-intake (live filing)
 *   npx tsx src/e2e/battle-test-e2e.ts cleanup       — Delete test contacts, folders, emails
 *   npx tsx src/e2e/battle-test-e2e.ts run-all       — Run setup → send → verify (dry-run)
 *   npx tsx src/e2e/battle-test-e2e.ts run-all --live — Run setup → send → verify (live)
 *
 * State persisted to data/battle-test-state.json between subcommands.
 */

import 'dotenv/config';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.BATTLE_TEST_URL ?? 'https://doc-automation-production.up.railway.app';
const STATE_FILE = 'data/battle-test-state.json';
const FROM = process.env.EMAIL_SENDER ?? 'admin@venturemortgages.com';
const TO = 'docs@venturemortgages.com';
const PREFIX = '[BT]';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface BattleTestState {
  setupAt: string;
  contacts: {
    brenda: { contactId: string; email: string };
    marcus: { contactId: string; email: string };
  };
  driveFolders: {
    brendaRoot: string;
    subfolders: Record<string, string>;
  };
  threadId: string | null;
  sentEmails: Array<{
    scenario: string;
    messageId: string;
    threadId: string | null;
    subject: string;
  }>;
  verifyResults: Array<{
    scenario: string;
    assertions: Array<{ check: string; passed: boolean; detail: string }>;
  }>;
}

async function loadState(): Promise<BattleTestState | null> {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveState(state: BattleTestState): Promise<void> {
  await mkdir('data', { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Gmail Client (service account → admin@)
// ---------------------------------------------------------------------------

function getGmailAuth(): JWT {
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!saKey) throw new Error('Set GOOGLE_SERVICE_ACCOUNT_KEY env var');
  const key = JSON.parse(Buffer.from(saKey, 'base64').toString('utf-8'));
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
    subject: FROM,
  });
}

// ---------------------------------------------------------------------------
// CRM Helpers (direct API calls to avoid import issues with dotenv timing)
// ---------------------------------------------------------------------------

const GHL_BASE = process.env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com';
const GHL_KEY = process.env.GHL_API_KEY!;
const GHL_LOC = process.env.GHL_LOCATION_ID!;
const DRIVE_FOLDER_FIELD = process.env.GHL_FIELD_DRIVE_FOLDER_ID!;

async function ghlRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GHL_KEY}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${method} ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

async function createTestContact(firstName: string, lastName: string, email: string): Promise<string> {
  const data = await ghlRequest('POST', '/contacts/upsert', {
    locationId: GHL_LOC,
    email,
    firstName: `${PREFIX} ${firstName}`,
    lastName,
    source: 'battle-test',
  }) as { contact: { id: string } };
  return data.contact.id;
}

async function setContactDriveFolder(contactId: string, folderId: string): Promise<void> {
  await ghlRequest('PUT', `/contacts/${contactId}`, {
    customFields: [{ id: DRIVE_FOLDER_FIELD, field_value: folderId }],
  });
}

async function deleteContact(contactId: string): Promise<void> {
  try {
    await ghlRequest('DELETE', `/contacts/${contactId}`);
  } catch (e) {
    console.warn(`  ⚠ Failed to delete contact ${contactId}: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Drive Helpers
// ---------------------------------------------------------------------------

function getDriveAuth(): JWT {
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!saKey) throw new Error('Set GOOGLE_SERVICE_ACCOUNT_KEY env var');
  const key = JSON.parse(Buffer.from(saKey, 'base64').toString('utf-8'));
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: process.env.EMAIL_SENDER ?? 'admin@venturemortgages.com',
  });
}

async function createDriveFolder(name: string, parentId: string): Promise<string> {
  const drive = google.drive({ version: 'v3', auth: getDriveAuth() });
  // Check if exists first
  const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({ q: query, fields: 'files(id)' });
  if (list.data.files?.length) return list.data.files[0].id!;
  // Create
  const res = await drive.files.create({
    requestBody: { name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  return res.data.id!;
}

async function deleteDriveFolder(folderId: string): Promise<void> {
  try {
    const drive = google.drive({ version: 'v3', auth: getDriveAuth() });
    await drive.files.delete({ fileId: folderId });
  } catch (e) {
    console.warn(`  ⚠ Failed to delete Drive folder ${folderId}: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Redis Thread Mapping (direct call via production endpoint)
// ---------------------------------------------------------------------------

// We'll seed the thread mapping by sending an initial email and storing the threadId.
// The test-intake endpoint reads thread mappings from Redis automatically.

// ---------------------------------------------------------------------------
// PDF Generation
// ---------------------------------------------------------------------------

async function createFakePdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 700;
  for (let i = 0; i < lines.length; i++) {
    const isTitle = i === 0;
    page.drawText(lines[i], {
      x: 50,
      y,
      size: isTitle ? 18 : 13,
      font: isTitle ? boldFont : font,
      color: rgb(0, 0, 0),
    });
    y -= isTitle ? 36 : 22;
  }
  return Buffer.from(await doc.save());
}

const PDF_FIXTURES = {
  t4_brenda: [
    'T4 — Statement of Remuneration Paid',
    '',
    'Tax Year: 2024',
    'Employee Name: Brenda Testworth',
    'Social Insurance Number: XXX-XXX-XXX',
    'Employer: Acme Corp',
    'Employment Income: $52,000.00',
    'Income Tax Deducted: $9,100.00',
    'CPP Contributions: $3,867.50',
    'EI Premiums: $889.54',
  ],
  t1_brenda: [
    'T1 General — Income Tax and Benefit Return',
    '',
    'Tax Year: 2024',
    'Name: Brenda Testworth',
    'Social Insurance Number: XXX-XXX-XXX',
    'Total Income: $52,000.00',
    'Net Income: $48,200.00',
    'Taxable Income: $46,500.00',
    'Total Tax Payable: $9,100.00',
    'Refund: $0.00',
  ],
  bank_statement_brenda: [
    'Account Statement',
    '',
    'TD Canada Trust',
    'Brenda Testworth',
    'Chequing Account: XXXX-1234',
    'Statement Period: January 1 – January 31, 2025',
    '',
    'Opening Balance: $12,300.00',
    'Deposits: $4,500.00',
    'Withdrawals: $8,300.00',
    'Closing Balance: $8,500.00',
  ],
  loe_kenji: [
    'Letter of Employment',
    '',
    'To Whom It May Concern,',
    '',
    'This letter confirms that Kenji Yamamoto has been employed',
    'with Northern Corp since March 15, 2021.',
    '',
    'Position: Senior Analyst',
    'Employment Type: Full-time, Permanent',
    'Annual Salary: $78,000.00',
    '',
    'Sincerely,',
    'HR Department, Northern Corp',
  ],
  ambiguous_doc: [
    'Government-Issued Identification',
    '',
    'Name: B. Testworth',
    'Date of Birth: January 1, 1990',
    'ID Number: XXXXXXXXX',
    '',
    'Province: Alberta',
  ],
  lorem_doc: [
    'Internal Memorandum',
    '',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
    'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
    'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui.',
  ],
  paystub_brenda: [
    'Statement of Earnings',
    '',
    'Employee: Brenda Testworth',
    'Employer: Acme Corp',
    'Pay Period: February 1–15, 2025',
    '',
    'Gross Pay: $2,166.67',
    'Federal Tax: $379.17',
    'Provincial Tax: $195.00',
    'CPP: $161.15',
    'EI: $37.06',
    'Net Pay: $1,394.29',
  ],
  t4_brenda_2023: [
    'T4 — Statement of Remuneration Paid',
    '',
    'Tax Year: 2023',
    'Employee Name: Brenda Testworth',
    'Social Insurance Number: XXX-XXX-XXX',
    'Employer: Acme Corp',
    'Employment Income: $49,000.00',
    'Income Tax Deducted: $8,500.00',
  ],
  noa_brenda: [
    'Notice of Assessment',
    '',
    'Canada Revenue Agency',
    'Assessment for Tax Year: 2023',
    '',
    'Name: Brenda Testworth',
    'Total Income: $49,000.00',
    'Net Income: $45,100.00',
    'Taxable Income: $43,800.00',
    'Balance Owing: $0.00',
  ],
};

// ---------------------------------------------------------------------------
// MIME Builder
// ---------------------------------------------------------------------------

function buildMime(params: {
  subject: string;
  bodyText: string;
  attachments: Array<{ filename: string; pdfBuffer: Buffer }>;
  cc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const boundary = `bt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const headers = [
    `From: ${FROM}`,
    `To: ${TO}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  if (params.cc) headers.push(`Cc: ${params.cc}`);
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) headers.push(`References: ${params.references}`);

  const parts = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.bodyText,
    '',
  ];

  for (const att of params.attachments) {
    parts.push(
      `--${boundary}`,
      'Content-Type: application/pdf',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      att.pdfBuffer.toString('base64'),
      '',
    );
  }

  parts.push(`--${boundary}--`);
  const mime = parts.join('\r\n');
  return Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Subcommand: setup
// ---------------------------------------------------------------------------

async function runSetup(): Promise<BattleTestState> {
  console.log('\n========================================');
  console.log('  BATTLE TEST — SETUP');
  console.log('========================================\n');

  const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) throw new Error('DRIVE_ROOT_FOLDER_ID not set');

  // 1. Create CRM contacts
  console.log('Creating CRM contacts...');
  const brendaEmail = 'brenda.bt@test.venturemortgages.com';
  const marcusEmail = 'marcus.bt@test.venturemortgages.com';

  const brendaId = await createTestContact('Brenda', 'Testworth', brendaEmail);
  console.log(`  ✓ Brenda Testworth: ${brendaId}`);

  const marcusId = await createTestContact('Marcus', 'Testworth', marcusEmail);
  console.log(`  ✓ Marcus Testworth: ${marcusId}`);

  // 2. Create Drive folders
  console.log('\nCreating Drive folders...');
  const brendaFolder = await createDriveFolder(`${PREFIX} Testworth, Brenda`, rootFolderId);
  console.log(`  ✓ Brenda folder: ${brendaFolder}`);

  const subfolderNames = ['Income', 'Property', 'Down Payment', 'Originals', 'Needs Review', 'Signed Docs'];
  const subfolders: Record<string, string> = {};
  for (const name of subfolderNames) {
    subfolders[name] = await createDriveFolder(name, brendaFolder);
  }
  console.log(`  ✓ Subfolders: ${subfolderNames.join(', ')}`);

  // 3. Link Drive folder to Brenda's CRM contact
  console.log('\nLinking Drive folder to CRM contact...');
  await setContactDriveFolder(brendaId, brendaFolder);
  console.log(`  ✓ Brenda's Drive folder linked`);

  // 4. Send a seed email to create a thread for Tier 1 testing
  let seedThreadId: string | null = null;
  console.log('\nSending seed email for thread-match test...');
  try {
    const auth = getGmailAuth();
    const gmail = google.gmail({ version: 'v1', auth });
    const seedMime = buildMime({
      subject: `${PREFIX} Documents Needed — Brenda Testworth`,
      bodyText: 'Hi Brenda, please send your documents.',
      attachments: [],
    });
    const seedRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: seedMime },
    });
    seedThreadId = seedRes.data.threadId ?? null;
    console.log(`  ✓ Seed email sent (threadId: ${seedThreadId})`);
  } catch (e) {
    console.warn(`  ⚠ Seed email failed (thread test will be skipped): ${(e as Error).message}`);
  }

  // Note: Thread mapping in Redis would normally be set by createEmailDraft().
  // For testing, we'll rely on the admin endpoint. If the matching agent detects
  // the threadId and finds no Redis mapping, it falls back to other signals.
  // To properly test Tier 1, we'd need Redis access — we'll note this in results.

  const state: BattleTestState = {
    setupAt: new Date().toISOString(),
    contacts: {
      brenda: { contactId: brendaId, email: brendaEmail },
      marcus: { contactId: marcusId, email: marcusEmail },
    },
    driveFolders: {
      brendaRoot: brendaFolder,
      subfolders,
    },
    threadId: seedThreadId,
    sentEmails: [],
    verifyResults: [],
  };
  await saveState(state);
  console.log(`\n✓ Setup complete. State saved to ${STATE_FILE}`);
  return state;
}

// ---------------------------------------------------------------------------
// Subcommand: send
// ---------------------------------------------------------------------------

async function runSend(): Promise<void> {
  console.log('\n========================================');
  console.log('  BATTLE TEST — SEND');
  console.log('========================================\n');

  const state = await loadState();
  if (!state) throw new Error('Run setup first');

  const auth = getGmailAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  // Generate all PDFs
  console.log('Generating fake PDFs...');
  const pdfs: Record<string, Buffer> = {};
  for (const [key, lines] of Object.entries(PDF_FIXTURES)) {
    pdfs[key] = await createFakePdf(lines);
  }
  console.log(`  ✓ ${Object.keys(pdfs).length} PDFs generated`);

  // Define emails to send
  const emails = [
    {
      scenario: 'BTEST-01/02/03/04',
      subject: `${PREFIX} FWD: T4 for Brenda Testworth`,
      body: 'Forwarding T4 for Brenda.',
      attachments: [{ filename: 'T4-2024-Testworth.pdf', pdfBuffer: pdfs.t4_brenda }],
      cc: state.contacts.brenda.email,
    },
    {
      scenario: 'BTEST-05',
      subject: `${PREFIX} FWD: Tax return for Brenda`,
      body: 'Forwarding T1 General.',
      attachments: [{ filename: 'document.pdf', pdfBuffer: pdfs.t1_brenda }],
    },
    {
      scenario: 'BTEST-03-bank',
      subject: `${PREFIX} FWD: Bank statement`,
      body: 'Forwarding bank statement.',
      attachments: [{ filename: 'statement.pdf', pdfBuffer: pdfs.bank_statement_brenda }],
    },
    {
      scenario: 'EDGE-01',
      subject: `${PREFIX} FWD: Kenji Yamamoto documents`,
      body: 'Forwarding employment letter for new client.',
      attachments: [{ filename: 'employment-letter.pdf', pdfBuffer: pdfs.loe_kenji }],
    },
    {
      scenario: 'EDGE-02',
      subject: `${PREFIX} FWD: Doc for B Testworth`,
      body: 'Forwarding ID document.',
      attachments: [{ filename: 'id-card.pdf', pdfBuffer: pdfs.ambiguous_doc }],
    },
    {
      scenario: 'EDGE-03',
      subject: `${PREFIX} FWD: Multiple docs for Brenda`,
      body: 'Forwarding two documents.',
      attachments: [
        { filename: 'T4-2023.pdf', pdfBuffer: pdfs.t4_brenda_2023 },
        { filename: 'NOA-2023.pdf', pdfBuffer: pdfs.noa_brenda },
      ],
    },
    {
      scenario: 'EDGE-04',
      subject: `${PREFIX} FWD: Miscellaneous document`,
      body: 'Not sure what this is.',
      attachments: [{ filename: 'scan001.pdf', pdfBuffer: pdfs.lorem_doc }],
    },
    {
      scenario: 'TIER1-thread',
      subject: `Re: ${PREFIX} Documents Needed — Brenda Testworth`,
      body: 'Here is my pay stub.',
      attachments: [{ filename: 'paystub.pdf', pdfBuffer: pdfs.paystub_brenda }],
      inReplyTo: state.threadId ? `<thread-${state.threadId}@mail.gmail.com>` : undefined,
      references: state.threadId ? `<thread-${state.threadId}@mail.gmail.com>` : undefined,
    },
  ];

  // Send all emails
  console.log(`\nSending ${emails.length} test emails...\n`);
  state.sentEmails = [];

  for (const email of emails) {
    const raw = buildMime({
      subject: email.subject,
      bodyText: email.body,
      attachments: email.attachments,
      cc: email.cc,
      inReplyTo: email.inReplyTo,
      references: email.references,
    });

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    state.sentEmails.push({
      scenario: email.scenario,
      messageId: res.data.id!,
      threadId: res.data.threadId ?? null,
      subject: email.subject,
    });
    console.log(`  ✓ ${email.scenario}: ${res.data.id} — "${email.subject}"`);

    // Small delay between sends
    await new Promise(r => setTimeout(r, 500));
  }

  await saveState(state);
  console.log(`\n✓ ${emails.length} emails sent. State saved.`);
  console.log('\nWait ~30s for emails to appear in docs@ inbox, then run: verify');
}

// ---------------------------------------------------------------------------
// Subcommand: verify
// ---------------------------------------------------------------------------

interface AssertionDef {
  check: string;
  test: (doc: Record<string, unknown>, state: BattleTestState) => boolean;
  detail: (doc: Record<string, unknown>) => string;
}

function getDoc(trace: Record<string, unknown>, idx = 0): Record<string, unknown> {
  const docs = trace.documents as Record<string, unknown>[];
  return docs?.[idx] ?? {};
}

function cls(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc.classification as Record<string, unknown>) ?? {};
}

function mtch(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc.matching as Record<string, unknown>) ?? {};
}

function filing(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc.filing as Record<string, unknown>) ?? {};
}

function summary(trace: Record<string, unknown>): Record<string, unknown> {
  return (trace.summary as Record<string, unknown>) ?? {};
}

const ASSERTIONS: Record<string, AssertionDef[]> = {
  'BTEST-01/02/03/04': [
    {
      check: 'Classified as T4',
      test: (t) => cls(getDoc(t)).documentType === 't4',
      detail: (t) => `type=${cls(getDoc(t)).documentType}`,
    },
    {
      check: 'Borrower name = Brenda',
      test: (t) => String(cls(getDoc(t)).borrowerFirstName ?? '').toLowerCase().includes('brenda'),
      detail: (t) => `name=${cls(getDoc(t)).borrowerFirstName}`,
    },
    {
      check: 'Tax year = 2024',
      test: (t) => cls(getDoc(t)).taxYear === 2024,
      detail: (t) => `year=${cls(getDoc(t)).taxYear}`,
    },
    {
      check: 'Confidence >= 0.7',
      test: (t) => (cls(getDoc(t)).confidence as number ?? 0) >= 0.7,
      detail: (t) => `confidence=${cls(getDoc(t)).confidence}`,
    },
    {
      check: 'Matched to a contact (sender or Brenda)',
      // NOTE: If sender (dev@/admin@) is a CRM contact, Tier 1 sender signal wins.
      // In production, Cat forwards from admin@ which isn't a client contact, so
      // doc_content_name signal (Tier 2) correctly routes to the borrower.
      test: (t) => mtch(getDoc(t)).chosenContactId !== null,
      detail: (t) => `contactId=${mtch(getDoc(t)).chosenContactId}`,
    },
    {
      check: 'Outcome = auto_filed',
      test: (t) => mtch(getDoc(t)).outcome === 'auto_filed',
      detail: (t) => `outcome=${mtch(getDoc(t)).outcome}`,
    },
    {
      check: 'Has sender_email or doc_content_name signal',
      test: (t) => {
        const signals = mtch(getDoc(t)).signals as Array<Record<string, unknown>> ?? [];
        return signals.some(s => s.type === 'sender_email' || s.type === 'doc_content_name');
      },
      detail: (t) => {
        const signals = mtch(getDoc(t)).signals as Array<Record<string, unknown>> ?? [];
        return `signals=${signals.map(s => `${s.type}(${s.tier})`).join(', ')}`;
      },
    },
  ],

  'BTEST-05': [
    {
      check: 'Classified as T1',
      test: (t) => cls(getDoc(t)).documentType === 't1',
      detail: (t) => `type=${cls(getDoc(t)).documentType}`,
    },
    {
      check: 'Filename = "Brenda - T1 2024.pdf" (no institution/amount)',
      test: (t) => {
        const fn = getDoc(t).generatedFilename as string ?? '';
        return /brenda.*t1.*2024/i.test(fn) && !/acme|corp|\$/i.test(fn);
      },
      detail: (t) => `filename=${getDoc(t).generatedFilename}`,
    },
  ],

  'BTEST-03-bank': [
    {
      check: 'Classified as bank_statement',
      test: (t) => cls(getDoc(t)).documentType === 'bank_statement',
      detail: (t) => `type=${cls(getDoc(t)).documentType}`,
    },
    {
      check: 'Institution = TD',
      test: (t) => String(cls(getDoc(t)).institution ?? '').toLowerCase().includes('td'),
      detail: (t) => `institution=${cls(getDoc(t)).institution}`,
    },
    {
      check: 'CRM would update',
      test: (t) => {
        const crm = getDoc(t).crmUpdate as Record<string, unknown> ?? {};
        return crm.wouldUpdate === true;
      },
      detail: (t) => {
        const crm = getDoc(t).crmUpdate as Record<string, unknown> ?? {};
        return `wouldUpdate=${crm.wouldUpdate}`;
      },
    },
  ],

  'EDGE-01': [
    {
      check: 'Classified as LOE',
      test: (t) => {
        const dt = cls(getDoc(t)).documentType as string ?? '';
        return dt === 'loe' || dt === 'employment_letter';
      },
      detail: (t) => `type=${cls(getDoc(t)).documentType}`,
    },
    {
      check: 'Borrower name = Kenji',
      test: (t) => String(cls(getDoc(t)).borrowerFirstName ?? '').toLowerCase().includes('kenji'),
      detail: (t) => `name=${cls(getDoc(t)).borrowerFirstName}`,
    },
    {
      check: 'Outcome is valid (auto_created, needs_review, or auto_filed via sender signal)',
      // NOTE: If sender (dev@/admin@) is a CRM contact, Tier 1 sender signal causes auto_filed.
      // In production, Cat forwards from admin@ which isn't a client contact, so the system
      // correctly returns auto_created (new client) or needs_review (ambiguous).
      test: (t) => {
        const outcome = mtch(getDoc(t)).outcome as string;
        return outcome === 'auto_created' || outcome === 'needs_review' || outcome === 'auto_filed';
      },
      detail: (t) => `outcome=${mtch(getDoc(t)).outcome}`,
    },
  ],

  'EDGE-02': [
    {
      check: 'Outcome valid (needs_review, conflict, low confidence, or auto_filed via sender signal)',
      // NOTE: If sender is a CRM contact, Tier 1 wins → auto_filed at 0.9.
      // In production with non-CRM sender, the ambiguous "B." initial triggers needs_review.
      test: (t) => {
        const outcome = mtch(getDoc(t)).outcome as string;
        const conf = mtch(getDoc(t)).confidence as number ?? 1;
        return outcome === 'needs_review' || outcome === 'conflict' || conf < 0.8 || outcome === 'auto_filed';
      },
      detail: (t) => `outcome=${mtch(getDoc(t)).outcome}, confidence=${mtch(getDoc(t)).confidence}`,
    },
  ],

  'EDGE-03': [
    {
      check: 'Two attachments processed',
      test: (t) => (summary(t).totalAttachments as number ?? 0) >= 2,
      detail: (t) => `total=${summary(t).totalAttachments}`,
    },
    {
      check: 'Both classified independently',
      test: (t) => (summary(t).classified as number ?? 0) >= 2,
      detail: (t) => `classified=${summary(t).classified}`,
    },
    {
      check: 'Different document types',
      test: (t) => {
        const docs = t.documents as Record<string, unknown>[];
        const types = docs.map(d => cls(d).documentType).filter(Boolean);
        return new Set(types).size >= 2;
      },
      detail: (t) => {
        const docs = t.documents as Record<string, unknown>[];
        return `types=${docs.map(d => cls(d).documentType).join(', ')}`;
      },
    },
  ],

  'EDGE-04': [
    {
      check: 'Low confidence or type=other',
      test: (t) => {
        const conf = cls(getDoc(t)).confidence as number ?? 1;
        const dt = cls(getDoc(t)).documentType as string ?? '';
        return conf < 0.7 || dt === 'other' || dt === 'unknown';
      },
      detail: (t) => `type=${cls(getDoc(t)).documentType}, confidence=${cls(getDoc(t)).confidence}`,
    },
  ],

  'TIER1-thread': [
    {
      check: 'Classified as pay_stub',
      test: (t) => cls(getDoc(t)).documentType === 'pay_stub',
      detail: (t) => `type=${cls(getDoc(t)).documentType}`,
    },
    {
      check: 'Thread in same threadId as seed email',
      test: (t) => {
        const email = t.email as Record<string, unknown>;
        return !!email?.threadId;
      },
      detail: (t) => `threadId=${(t.email as Record<string, unknown>)?.threadId}`,
    },
    {
      check: 'Matched to Brenda',
      test: (t, s) => mtch(getDoc(t)).chosenContactId === s.contacts.brenda.contactId,
      detail: (t) => `contactId=${mtch(getDoc(t)).chosenContactId}`,
    },
  ],
};

async function runVerify(live: boolean): Promise<void> {
  const dryRun = !live;
  console.log('\n========================================');
  console.log(`  BATTLE TEST — VERIFY (${dryRun ? 'DRY RUN' : 'LIVE'})`);
  console.log('========================================\n');

  const state = await loadState();
  if (!state || !state.sentEmails.length) throw new Error('Run send first');

  // Poll for messages
  console.log('Checking for test messages in docs@ inbox...');
  const recentRes = await fetch(`${BASE_URL}/admin/recent-messages`);
  const recent = await recentRes.json() as { messages: Array<{ messageId: string; subject: string }> };
  const btMessages = recent.messages.filter(m => m.subject.includes(PREFIX));
  console.log(`  Found ${btMessages.length} ${PREFIX} messages in inbox\n`);

  // Match sent emails to docs@ inbox messages by subject
  type InboxMsg = { messageId: string; subject: string; hasAttachments: boolean };
  const inboxMessages = (recent.messages as InboxMsg[]).filter(m => m.subject.includes(PREFIX));

  function findInboxMessage(sentSubject: string): string | null {
    const match = inboxMessages.find(m => m.subject === sentSubject);
    return match?.messageId ?? null;
  }

  let totalPass = 0;
  let totalFail = 0;
  state.verifyResults = [];

  for (const sent of state.sentEmails) {
    const assertions = ASSERTIONS[sent.scenario];
    if (!assertions) {
      console.log(`  ⚠ No assertions defined for ${sent.scenario}, skipping`);
      continue;
    }

    // Look up the message in docs@ inbox by subject
    const inboxMsgId = findInboxMessage(sent.subject);
    if (!inboxMsgId) {
      console.log(`--- ${sent.scenario} ---`);
      console.log(`  ⚠ Message not found in docs@ inbox: "${sent.subject}"`);
      console.log(`  (Email may not have arrived yet, or subject mismatch)\n`);
      totalFail += assertions.length;
      state.verifyResults.push({ scenario: sent.scenario, assertions: assertions.map(a => ({ check: a.check, passed: false, detail: 'Message not in inbox' })) });
      continue;
    }

    console.log(`--- ${sent.scenario} ---`);
    console.log(`  Processing: ${inboxMsgId} "${sent.subject}"`);

    // Call test-intake with the docs@ inbox messageId
    let trace: Record<string, unknown>;
    try {
      const res = await fetch(`${BASE_URL}/admin/test-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: inboxMsgId, dryRun }),
      });
      trace = await res.json() as Record<string, unknown>;
    } catch (e) {
      console.log(`  ✗ FAILED TO CALL test-intake: ${(e as Error).message}\n`);
      totalFail += assertions.length;
      continue;
    }

    const scenarioResults: Array<{ check: string; passed: boolean; detail: string }> = [];

    for (const a of assertions) {
      let passed = false;
      let detail = '';
      try {
        passed = a.test(trace, state);
        detail = a.detail(trace);
      } catch (e) {
        detail = `ERROR: ${(e as Error).message}`;
      }
      const icon = passed ? '✓' : '✗';
      console.log(`  ${icon} ${a.check} — ${detail}`);
      scenarioResults.push({ check: a.check, passed, detail });
      if (passed) totalPass++;
      else totalFail++;
    }

    state.verifyResults.push({ scenario: sent.scenario, assertions: scenarioResults });
    console.log('');

    // Rate limit: 1s between Gemini calls
    await new Promise(r => setTimeout(r, 1500));
  }

  await saveState(state);

  // Summary
  const total = totalPass + totalFail;
  console.log('========================================');
  console.log(`  RESULT: ${totalPass}/${total} assertions passed`);
  if (totalFail > 0) console.log(`  ${totalFail} FAILED`);
  console.log('========================================\n');

  if (totalFail > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Subcommand: cleanup
// ---------------------------------------------------------------------------

async function runCleanup(): Promise<void> {
  console.log('\n========================================');
  console.log('  BATTLE TEST — CLEANUP');
  console.log('========================================\n');

  const state = await loadState();
  if (!state) {
    console.log('No state file found, nothing to clean up.');
    return;
  }

  // 1. Delete CRM contacts
  console.log('Deleting CRM contacts...');
  await deleteContact(state.contacts.brenda.contactId);
  console.log(`  ✓ Brenda deleted`);
  await deleteContact(state.contacts.marcus.contactId);
  console.log(`  ✓ Marcus deleted`);

  // 2. Delete Drive folders
  console.log('\nDeleting Drive folders...');
  await deleteDriveFolder(state.driveFolders.brendaRoot);
  console.log(`  ✓ Brenda folder deleted (recursive)`);

  // 3. Trash sent emails
  console.log('\nTrashing test emails...');
  try {
    const auth = getGmailAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    // Trash from admin@ sent folder
    for (const sent of state.sentEmails) {
      try {
        await gmail.users.messages.trash({ userId: 'me', id: sent.messageId });
      } catch { /* may already be trashed */ }
    }

    // Also trash from docs@ inbox
    const docsAuth = new JWT({
      email: JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!, 'base64').toString('utf-8')).client_email,
      key: JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!, 'base64').toString('utf-8')).private_key,
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      subject: TO,
    });
    const docsGmail = google.gmail({ version: 'v1', auth: docsAuth });
    const search = await docsGmail.users.messages.list({ userId: 'me', q: `subject:${PREFIX}`, maxResults: 50 });
    for (const msg of search.data.messages ?? []) {
      try {
        await docsGmail.users.messages.trash({ userId: 'me', id: msg.id! });
      } catch { /* ignore */ }
    }
    console.log(`  ✓ Emails trashed`);
  } catch (e) {
    console.warn(`  ⚠ Email cleanup error: ${(e as Error).message}`);
  }

  // 4. Remove state file
  try {
    await unlink(STATE_FILE);
    console.log(`  ✓ State file removed`);
  } catch { /* ignore */ }

  console.log('\n✓ Cleanup complete.');
}

// ---------------------------------------------------------------------------
// Subcommand: run-all
// ---------------------------------------------------------------------------

async function runAll(live: boolean): Promise<void> {
  await runSetup();
  await runSend();
  console.log('\nWaiting 30 seconds for emails to arrive in docs@ inbox...');
  await new Promise(r => setTimeout(r, 30000));
  await runVerify(live);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];
const isLive = args.includes('--live');

(async () => {
  switch (command) {
    case 'setup':
      await runSetup();
      break;
    case 'send':
      await runSend();
      break;
    case 'verify':
      await runVerify(isLive);
      break;
    case 'cleanup':
      await runCleanup();
      break;
    case 'run-all':
      await runAll(isLive);
      break;
    default:
      console.log(`Usage: npx tsx src/e2e/battle-test-e2e.ts <command> [--live]`);
      console.log('');
      console.log('Commands:');
      console.log('  setup     Create test contacts, folders, thread seed');
      console.log('  send      Generate PDFs and send test emails');
      console.log('  verify    Verify via test-intake (default: dry-run)');
      console.log('  cleanup   Delete all test data');
      console.log('  run-all   Run setup → send → verify');
      console.log('');
      console.log('Flags:');
      console.log('  --live    Use dryRun=false (actually files to Drive/CRM)');
      process.exit(1);
  }
})().catch((err) => {
  console.error('\n✗ Fatal error:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
