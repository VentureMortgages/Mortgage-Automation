/**
 * E2E Test: Classify a local PDF and file it to a test folder in Drive
 *
 * Layer 2 integration test — bypasses Gmail intake entirely.
 * Tests: Gemini classification → filename generation → subfolder routing → Drive upload.
 *
 * Usage:
 *   npx tsx src/e2e/test-classify-and-file.ts path/to/document.pdf
 *   npx tsx src/e2e/test-classify-and-file.ts path/to/document.pdf --cleanup
 *
 * What it does:
 *   1. Checks all required env vars / API connectivity
 *   2. Creates a "TEST - Doe, Jane" folder under DRIVE_ROOT_FOLDER_ID
 *   3. Classifies the PDF with Gemini
 *   4. Generates filename (Cat's convention) and routes to subfolder
 *   5. Uploads to the correct subfolder in Drive
 *   6. Optionally cleans up the test folder (--cleanup flag)
 *
 * What it does NOT do:
 *   - No CRM updates (no contact lookup or tracking sync)
 *   - No Gmail reading (no intake monitor)
 *   - No BullMQ/Redis dependency
 *
 * Required env vars: GEMINI_API_KEY, DRIVE_ROOT_FOLDER_ID, and either
 * GOOGLE_REFRESH_TOKEN (OAuth2) or GOOGLE_SERVICE_ACCOUNT_KEY (SA).
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Env var checks (before importing modules that read config eagerly)
// ---------------------------------------------------------------------------

const REQUIRED_VARS = ['GEMINI_API_KEY', 'DRIVE_ROOT_FOLDER_ID'];
const AUTH_VARS = ['GOOGLE_REFRESH_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_KEY'];

const missing = REQUIRED_VARS.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the required values.');
  process.exit(1);
}

if (!AUTH_VARS.some(k => process.env[k])) {
  console.error(`Need at least one of: ${AUTH_VARS.join(' or ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const cleanupFlag = args.includes('--cleanup');
const pdfPathArg = args.find(a => !a.startsWith('--'));

if (!pdfPathArg) {
  console.error('Usage: npx tsx src/e2e/test-classify-and-file.ts <path-to-pdf> [--cleanup]');
  console.error('');
  console.error('Options:');
  console.error('  --cleanup    Delete the test folder after filing');
  console.error('');
  console.error('Example:');
  console.error('  npx tsx src/e2e/test-classify-and-file.ts ~/Documents/sample-t4.pdf');
  process.exit(1);
}

const pdfPath: string = pdfPathArg;

if (!existsSync(pdfPath)) {
  console.error(`File not found: ${pdfPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Imports (after env checks, since config modules read env eagerly)
// ---------------------------------------------------------------------------

import { classifyDocument } from '../classification/classifier.js';
import { generateFilename } from '../classification/naming.js';
import { routeToSubfolder, getPersonSubfolderName } from '../classification/router.js';
import { getDriveClient } from '../classification/drive-client.js';
import {
  findFolder,
  findOrCreateFolder,
  resolveTargetFolder,
  uploadFile,
  findExistingFile,
  updateFileContent,
} from '../classification/filer.js';
import { DOC_TYPE_LABELS } from '../classification/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_FOLDER_NAME = 'TEST - Doe, Jane';
const DRIVE_ROOT = process.env.DRIVE_ROOT_FOLDER_ID!;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== E2E Test: Classify & File to Drive ===\n');

  // --- Step 1: Prerequisites check ---
  console.log('--- Step 1: Checking prerequisites ---');

  const authMode = process.env.GOOGLE_REFRESH_TOKEN ? 'OAuth2' : 'Service Account';
  console.log(`  Auth mode:       ${authMode}`);
  console.log(`  Gemini API key:  ***${process.env.GEMINI_API_KEY!.slice(-4)}`);
  console.log(`  Drive root:      ${DRIVE_ROOT}`);
  console.log(`  Input PDF:       ${pdfPath}`);
  console.log(`  Cleanup:         ${cleanupFlag}`);

  // Quick Drive connectivity check
  const drive = getDriveClient();
  try {
    await drive.files.get({ fileId: DRIVE_ROOT, fields: 'id, name' });
    console.log('  Drive API:       connected');
  } catch (err) {
    console.error(`  Drive API:       FAILED — ${err instanceof Error ? err.message : err}`);
    console.error('\nCannot proceed without Drive access.');
    process.exit(1);
  }

  console.log('');

  // --- Step 2: Read PDF ---
  console.log('--- Step 2: Reading PDF ---');
  const pdfBuffer = await readFile(pdfPath);
  const originalFilename = pdfPath.split(/[\\/]/).pop() ?? 'document.pdf';
  console.log(`  File:   ${originalFilename}`);
  console.log(`  Size:   ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
  console.log('');

  // --- Step 3: Classify with Gemini ---
  console.log('--- Step 3: Classifying with Gemini ---');
  const startTime = Date.now();
  const classification = await classifyDocument(pdfBuffer, originalFilename);
  const elapsed = Date.now() - startTime;

  console.log(`  Document Type:   ${classification.documentType}`);
  console.log(`  Confidence:      ${classification.confidence}`);
  console.log(`  Borrower:        ${classification.borrowerFirstName ?? '?'} ${classification.borrowerLastName ?? '?'}`);
  console.log(`  Tax Year:        ${classification.taxYear ?? 'N/A'}`);
  console.log(`  Amount:          ${classification.amount ?? 'N/A'}`);
  console.log(`  Institution:     ${classification.institution ?? 'N/A'}`);
  console.log(`  Page Count:      ${classification.pageCount ?? 'N/A'}`);
  console.log(`  Notes:           ${classification.additionalNotes ?? 'none'}`);
  console.log(`  Classification:  ${elapsed}ms`);

  if (classification.confidence < 0.7) {
    console.warn(`\n  WARNING: Low confidence (${classification.confidence}). In production this would route to manual review.`);
    console.log('  Continuing with filing for test purposes...');
  }
  console.log('');

  // --- Step 4: Generate filename ---
  console.log('--- Step 4: Generating filename ---');
  const fallbackName = classification.borrowerFirstName ?? 'Borrower';
  const filename = generateFilename(classification, fallbackName);
  console.log(`  Generated:       ${filename}`);

  const docLabel = DOC_TYPE_LABELS[classification.documentType] ?? classification.documentType;
  console.log(`  Doc label:       ${docLabel}`);
  console.log('');

  // --- Step 5: Route to subfolder ---
  console.log('--- Step 5: Routing to subfolder ---');
  const subfolderTarget = routeToSubfolder(classification.documentType);
  const personName = getPersonSubfolderName(
    classification.borrowerFirstName,
    classification.borrowerLastName,
    'Borrower',
  );
  console.log(`  Target:          ${subfolderTarget}`);
  console.log(`  Person name:     ${personName}`);
  console.log('');

  // --- Step 6: Create test folder + upload ---
  console.log('--- Step 6: Filing to Drive ---');

  const testFolderId = await findOrCreateFolder(drive, TEST_FOLDER_NAME, DRIVE_ROOT);
  console.log(`  Test folder:     ${TEST_FOLDER_NAME} (${testFolderId})`);

  const targetFolderId = await resolveTargetFolder(drive, testFolderId, subfolderTarget, personName);
  console.log(`  Target folder:   ${targetFolderId}`);

  // Check for existing file (versioning)
  const existing = await findExistingFile(drive, docLabel, targetFolderId);
  let driveFileId: string;

  if (existing) {
    console.log(`  Existing file:   ${existing.name} (${existing.id}) — updating`);
    await updateFileContent(drive, existing.id, pdfBuffer, filename);
    driveFileId = existing.id;
  } else {
    console.log(`  No existing file — uploading new`);
    driveFileId = await uploadFile(drive, pdfBuffer, filename, targetFolderId);
  }

  console.log(`  Drive file ID:   ${driveFileId}`);
  console.log(`  Drive URL:       https://drive.google.com/file/d/${driveFileId}/view`);
  console.log('');

  // --- Step 7: Summary ---
  console.log('--- Result ---');
  console.log(`  Classification:  ${classification.documentType} (${(classification.confidence * 100).toFixed(0)}%)`);
  console.log(`  Filed as:        ${filename}`);
  console.log(`  Location:        ${TEST_FOLDER_NAME}/${subfolderTarget === 'root' ? '' : subfolderTarget === 'person' ? personName + '/' : subfolderTarget + '/'}${filename}`);
  console.log(`  File URL:        https://drive.google.com/file/d/${driveFileId}/view`);
  console.log('');

  // --- Step 8: Cleanup (optional) ---
  if (cleanupFlag) {
    console.log('--- Step 8: Cleaning up test folder ---');
    try {
      await drive.files.delete({ fileId: testFolderId });
      console.log(`  Deleted:         ${TEST_FOLDER_NAME} (${testFolderId})`);
    } catch (err) {
      console.error(`  Cleanup failed:  ${err instanceof Error ? err.message : err}`);
      console.error(`  Manually delete: https://drive.google.com/drive/folders/${testFolderId}`);
    }
  } else {
    console.log(`To clean up the test folder, run again with --cleanup`);
    console.log(`Or delete manually: https://drive.google.com/drive/folders/${testFolderId}`);
  }

  console.log('\nE2E test PASSED');
}

main().catch(err => {
  console.error('\nE2E test FAILED:', err.message);
  if (err.stack) {
    console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
  process.exit(1);
});
