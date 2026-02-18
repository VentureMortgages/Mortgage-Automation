/**
 * E2E Test: Scan a real client folder and preview what the Drive-aware
 * checklist filter would do
 *
 * Layer 2 integration test for the Drive scan feature. Runs against a real
 * client folder (or the TEST folder) to verify:
 *   - listClientFolderFiles finds all files
 *   - parseDocFromFilename correctly parses Cat's naming convention
 *   - resolveDocumentType maps to correct DocumentType
 *   - isDocStillValid correctly evaluates freshness/expiry
 *
 * Usage:
 *   npx tsx src/e2e/test-drive-scan.ts                          # scans TEST folder
 *   npx tsx src/e2e/test-drive-scan.ts "Smith, Jane"             # scans a specific client folder
 *   npx tsx src/e2e/test-drive-scan.ts --folder-id abc123        # scans by folder ID
 *
 * Safety: Read-only — only reads Drive metadata, does not modify anything.
 */

import 'dotenv/config';

// ---------------------------------------------------------------------------
// Env var checks
// ---------------------------------------------------------------------------

const AUTH_VARS = ['GOOGLE_REFRESH_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_KEY'];
if (!process.env.DRIVE_ROOT_FOLDER_ID) {
  console.error('Missing DRIVE_ROOT_FOLDER_ID env var.');
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
const folderIdFlag = args.indexOf('--folder-id');
let targetFolderId: string | null = folderIdFlag >= 0 ? args[folderIdFlag + 1] : null;
const clientFolderName = !targetFolderId ? (args.find(a => !a.startsWith('--')) ?? 'TEST - Doe, Jane') : null;

// ---------------------------------------------------------------------------
// Imports (after env checks)
// ---------------------------------------------------------------------------

import { getDriveClient } from '../classification/drive-client.js';
import { findFolder } from '../classification/filer.js';
import {
  listClientFolderFiles,
  parseDocFromFilename,
  resolveDocumentType,
  scanClientFolder,
} from '../drive/folder-scanner.js';
import { isDocStillValid, PROPERTY_SPECIFIC_TYPES } from '../drive/doc-expiry.js';
import { DOC_TYPE_LABELS } from '../classification/types.js';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== E2E Test: Drive Folder Scan ===\n');
  console.log('Safety: Read-only — no modifications to Drive or CRM.\n');

  const drive = getDriveClient();
  const driveRoot = process.env.DRIVE_ROOT_FOLDER_ID!;
  const now = new Date();

  // --- Step 1: Resolve folder ---
  console.log('--- Step 1: Resolving client folder ---');

  if (!targetFolderId && clientFolderName) {
    targetFolderId = await findFolder(drive, clientFolderName, driveRoot);
    if (!targetFolderId) {
      console.error(`  Folder "${clientFolderName}" not found under root.`);
      console.error('  Available folders:');
      const res = await drive.files.list({
        q: `'${driveRoot}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(name)',
        pageSize: 20,
        orderBy: 'name',
      });
      for (const f of res.data.files ?? []) {
        console.error(`    ${f.name}`);
      }
      process.exit(1);
    }
  }

  console.log(`  Folder:  ${clientFolderName ?? '(by ID)'}`);
  console.log(`  ID:      ${targetFolderId}`);
  console.log('');

  // --- Step 2: List all files ---
  console.log('--- Step 2: Listing files (root + 1 level of subfolders) ---');
  const files = await listClientFolderFiles(drive, targetFolderId!);
  console.log(`  Found ${files.length} files total\n`);

  if (files.length === 0) {
    console.log('  No files found. If testing, run test-classify-and-file.ts first to populate.');
    return;
  }

  // --- Step 3: Parse each filename ---
  console.log('--- Step 3: Parsing filenames ---\n');

  let parsedCount = 0;
  let resolvedCount = 0;
  let validCount = 0;
  let expiredCount = 0;
  let propertySpecificCount = 0;
  let unparsedCount = 0;

  const table: Array<{
    file: string;
    folder: string;
    parsed: string;
    docType: string;
    expiry: string;
  }> = [];

  for (const file of files) {
    const parsed = parseDocFromFilename(file.name);

    if (!parsed) {
      table.push({
        file: file.name,
        folder: file.parentFolderName,
        parsed: '(no match)',
        docType: '-',
        expiry: '-',
      });
      unparsedCount++;
      continue;
    }

    parsedCount++;
    const docType = resolveDocumentType(parsed.docTypeLabel);

    if (!docType || docType === 'other') {
      table.push({
        file: file.name,
        folder: file.parentFolderName,
        parsed: `${parsed.borrowerName} | ${parsed.docTypeLabel}`,
        docType: docType ?? '(unknown)',
        expiry: '-',
      });
      continue;
    }

    resolvedCount++;

    if (PROPERTY_SPECIFIC_TYPES.has(docType)) {
      table.push({
        file: file.name,
        folder: file.parentFolderName,
        parsed: `${parsed.borrowerName} | ${parsed.docTypeLabel}`,
        docType: `${docType} (${DOC_TYPE_LABELS[docType]})`,
        expiry: 'PROPERTY-SPECIFIC (skip)',
      });
      propertySpecificCount++;
      continue;
    }

    const existingDoc = {
      fileId: file.fileId,
      filename: file.name,
      documentType: docType,
      borrowerName: parsed.borrowerName,
      year: parsed.year,
      modifiedTime: file.modifiedTime,
    };

    const valid = isDocStillValid(existingDoc, now);
    if (valid) {
      validCount++;
    } else {
      expiredCount++;
    }

    const modDate = new Date(file.modifiedTime);
    const daysAgo = Math.floor((now.getTime() - modDate.getTime()) / (1000 * 60 * 60 * 24));

    table.push({
      file: file.name,
      folder: file.parentFolderName,
      parsed: `${parsed.borrowerName} | ${parsed.docTypeLabel}${parsed.year ? ` | ${parsed.year}` : ''}${parsed.institution ? ` | ${parsed.institution}` : ''}`,
      docType: `${docType} (${DOC_TYPE_LABELS[docType]})`,
      expiry: valid
        ? `VALID (modified ${daysAgo}d ago)`
        : `EXPIRED (modified ${daysAgo}d ago)`,
    });
  }

  // Print table
  for (const row of table) {
    const statusIcon = row.expiry.startsWith('VALID') ? '  '
      : row.expiry.startsWith('EXPIRED') ? '  '
      : row.expiry.startsWith('PROPERTY') ? '  '
      : '  ';
    console.log(`${statusIcon}${row.file}`);
    console.log(`     Folder:   ${row.folder}`);
    console.log(`     Parsed:   ${row.parsed}`);
    console.log(`     Type:     ${row.docType}`);
    console.log(`     Status:   ${row.expiry}`);
    console.log('');
  }

  // --- Step 4: Summary ---
  console.log('--- Summary ---');
  console.log(`  Total files:        ${files.length}`);
  console.log(`  Parsed:             ${parsedCount} (${unparsedCount} unparsed — no "Name - DocType" pattern)`);
  console.log(`  Resolved to type:   ${resolvedCount}`);
  console.log(`  Valid (on file):    ${validCount}`);
  console.log(`  Expired:            ${expiredCount}`);
  console.log(`  Property-specific:  ${propertySpecificCount} (never reusable)`);
  console.log('');

  // --- Step 5: Simulate scanClientFolder ---
  console.log('--- Step 5: Full scan simulation (scanClientFolder) ---');
  // Use all unique first names from parsed files as the "borrower list"
  const allNames = new Set<string>();
  for (const file of files) {
    const parsed = parseDocFromFilename(file.name);
    if (parsed) allNames.add(parsed.borrowerName);
  }
  const borrowerNames = [...allNames];
  console.log(`  Borrower names:     ${borrowerNames.join(', ') || '(none found)'}`);

  if (borrowerNames.length > 0) {
    const scanResults = await scanClientFolder(drive, targetFolderId!, borrowerNames);
    console.log(`  Scan returned:      ${scanResults.length} existing docs`);

    for (const doc of scanResults) {
      const valid = isDocStillValid(doc, now);
      console.log(`    ${valid ? 'VALID' : 'EXPIRED'}  ${doc.documentType} (${DOC_TYPE_LABELS[doc.documentType]}) — ${doc.borrowerName}${doc.year ? ` ${doc.year}` : ''}`);
    }
  }

  console.log('\nDrive scan test complete.');
}

main().catch(err => {
  console.error('\nTest FAILED:', err.message);
  if (err.stack) {
    console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
  process.exit(1);
});
