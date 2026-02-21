/**
 * E2E test helper — Send a test email with PDF to docs@ inbox
 *
 * Uses service account with domain-wide delegation to impersonate admin@
 * and send an email to docs@ with a test PDF attachment.
 *
 * Usage: npx tsx src/e2e/send-test-email.ts
 */

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const SA_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (!SA_KEY) {
  console.error('Set GOOGLE_SERVICE_ACCOUNT_KEY env var (base64-encoded JSON)');
  process.exit(1);
}

const key = JSON.parse(Buffer.from(SA_KEY, 'base64').toString('utf-8'));

// Impersonate admin@ to send
const auth = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/gmail.compose'],
  subject: 'admin@venturemortgages.com',
});

const gmail = google.gmail({ version: 'v1', auth });

// Create a tiny valid PDF
const pdfContent = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n206\n%%EOF',
);
const pdfBase64 = pdfContent.toString('base64');

const boundary = 'boundary_test_' + Date.now();
const to = 'docs@venturemortgages.com';
const from = 'admin@venturemortgages.com';
const subject = `FWD: Test T4 Document - Pipeline Test ${new Date().toISOString().split('T')[0]}`;

const mimeMessage = [
  `From: ${from}`,
  `To: ${to}`,
  `Subject: ${subject}`,
  `MIME-Version: 1.0`,
  `Content-Type: multipart/mixed; boundary="${boundary}"`,
  '',
  `--${boundary}`,
  'Content-Type: text/plain; charset="UTF-8"',
  '',
  'Forwarding test T4 document for pipeline testing.',
  '',
  `--${boundary}`,
  'Content-Type: application/pdf',
  `Content-Disposition: attachment; filename="T4-2024-TestEmp-Borrower.pdf"`,
  'Content-Transfer-Encoding: base64',
  '',
  pdfBase64,
  '',
  `--${boundary}--`,
].join('\r\n');

// base64url encode the MIME message
const raw = Buffer.from(mimeMessage)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

async function main() {
  console.log('Sending test email from admin@ to docs@...');
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
  console.log('Sent! Message ID:', res.data.id);
  console.log('Thread ID:', res.data.threadId);
  console.log('\nNow watch Railway logs for the pipeline to process it.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
