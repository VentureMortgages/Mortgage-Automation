#!/usr/bin/env npx tsx
/**
 * Local runner for the Drive folder backfill spreadsheet.
 *
 * Runs the same logic as POST /admin/backfill-spreadsheet but locally,
 * avoiding Railway HTTP timeout issues with large contact lists.
 *
 * Usage: npx tsx src/admin/run-backfill.ts
 *
 * Requires .env with: GHL_API_KEY, GHL_LOCATION_ID, GHL_FIELD_DRIVE_FOLDER_ID,
 * DRIVE_ROOT_FOLDER_ID, and Google credentials.
 */

import 'dotenv/config';
import { listAllContacts, extractDriveFolderId } from '../crm/contacts.js';
import type { ContactSummary } from '../crm/contacts.js';
import { crmConfig } from '../crm/config.js';
import { getDriveClient } from '../classification/drive-client.js';
import { getSheetsClient } from '../budget/sheets-client.js';

const SPREADSHEET_ID = '1ig365jSZqElHZeDKyWjkSohR3_uES3IxjfFHlCt7was';

interface DriveFolder {
  id: string;
  name: string;
}

interface BackfillRow {
  contactName: string;
  contactId: string;
  contactEmail: string;
  driveFolderName: string;
  driveFolderId: string;
  matchConfidence: number;
  alreadyLinked: boolean;
  notes: string;
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function matchContactToFolder(firstName: string, lastName: string, folderName: string): number {
  const normFirst = normalizeName(firstName);
  const normLast = normalizeName(lastName);
  const normFolder = normalizeName(folderName);

  if (normFolder === `${normLast}, ${normFirst}`) return 1.0;

  const folderHasLast = normFolder.includes(normLast);
  const folderHasFirst = normFolder.includes(normFirst);

  if (folderHasLast && folderHasFirst) return 0.9;
  if (folderHasLast && normLast.length >= 3) return 0.6;
  if (folderHasFirst && normFirst.length >= 3) return 0.3;

  return 0;
}

async function listDriveFolders(rootFolderId: string): Promise<DriveFolder[]> {
  const drive = getDriveClient();
  const folders: DriveFolder[] = [];
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 200,
      pageToken,
    });

    for (const file of response.data.files ?? []) {
      if (file.id && file.name) {
        folders.push({ id: file.id, name: file.name });
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return folders;
}

function buildRows(contacts: ContactSummary[], folders: DriveFolder[], fieldId: string): BackfillRow[] {
  const rows: BackfillRow[] = [];

  for (const contact of contacts) {
    const contactName = `${contact.lastName}, ${contact.firstName}`.trim();
    if (!contact.firstName && !contact.lastName) continue;

    const folderField = contact.customFields.find(f => f.id === fieldId);
    const existingFolderId = folderField && typeof folderField.value === 'string' && folderField.value
      ? extractDriveFolderId(folderField.value)
      : null;

    if (existingFolderId) {
      const matchingFolder = folders.find(f => f.id === existingFolderId);
      rows.push({
        contactName,
        contactId: contact.id,
        contactEmail: contact.email,
        driveFolderName: matchingFolder?.name ?? '(not in root)',
        driveFolderId: existingFolderId,
        matchConfidence: matchingFolder ? 1.0 : 0,
        alreadyLinked: true,
        notes: matchingFolder ? 'Already linked' : 'WARNING: folder not found in root',
      });
      continue;
    }

    let bestMatch: DriveFolder | null = null;
    let bestScore = 0;

    for (const folder of folders) {
      const score = matchContactToFolder(contact.firstName, contact.lastName, folder.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = folder;
      }
    }

    if (bestMatch && bestScore >= 0.3) {
      rows.push({
        contactName,
        contactId: contact.id,
        contactEmail: contact.email,
        driveFolderName: bestMatch.name,
        driveFolderId: bestMatch.id,
        matchConfidence: bestScore,
        alreadyLinked: false,
        notes: bestScore >= 0.9 ? 'High confidence' : bestScore >= 0.6 ? 'Last name match' : 'Weak — verify',
      });
    } else {
      rows.push({
        contactName,
        contactId: contact.id,
        contactEmail: contact.email,
        driveFolderName: '',
        driveFolderId: '',
        matchConfidence: 0,
        alreadyLinked: false,
        notes: 'No match found',
      });
    }
  }

  rows.sort((a, b) => {
    if (a.alreadyLinked && !b.alreadyLinked) return -1;
    if (!a.alreadyLinked && b.alreadyLinked) return 1;
    return b.matchConfidence - a.matchConfidence;
  });

  return rows;
}

async function writeToSheet(rows: BackfillRow[]): Promise<void> {
  const sheets = getSheetsClient();

  const header = [
    'CRM Contact Name', 'CRM Contact ID', 'CRM Email',
    'Drive Folder Name', 'Drive Folder ID', 'Match Confidence',
    'Already Linked?', 'Notes',
  ];

  const dataRows = rows.map(r => [
    r.contactName, r.contactId, r.contactEmail,
    r.driveFolderName, r.driveFolderId,
    r.matchConfidence > 0 ? `${Math.round(r.matchConfidence * 100)}%` : '',
    r.alreadyLinked ? 'YES' : '',
    r.notes,
  ]);

  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: 'Sheet1' });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [header, ...dataRows] },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) { console.error('Missing DRIVE_ROOT_FOLDER_ID'); process.exit(1); }
  if (!crmConfig.driveFolderIdFieldId) { console.error('Missing GHL_FIELD_DRIVE_FOLDER_ID'); process.exit(1); }

  console.log('Fetching CRM contacts...');
  const contacts = await listAllContacts();
  console.log(`  → ${contacts.length} contacts`);

  console.log('Fetching Drive folders...');
  const folders = await listDriveFolders(rootFolderId);
  console.log(`  → ${folders.length} folders`);

  console.log('Matching...');
  const rows = buildRows(contacts, folders, crmConfig.driveFolderIdFieldId);

  const linked = rows.filter(r => r.alreadyLinked).length;
  const matched = rows.filter(r => !r.alreadyLinked && r.matchConfidence > 0).length;
  const unmatched = rows.filter(r => !r.alreadyLinked && r.matchConfidence === 0).length;

  console.log(`  → ${linked} already linked, ${matched} matched, ${unmatched} no match`);

  console.log('Writing to Google Sheet...');
  await writeToSheet(rows);

  console.log(`\nDone! Review at: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
  console.log(`\nSummary: ${contacts.length} contacts, ${folders.length} folders`);
  console.log(`  Already linked: ${linked}`);
  console.log(`  Best-guess match: ${matched}`);
  console.log(`  No match: ${unmatched}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
