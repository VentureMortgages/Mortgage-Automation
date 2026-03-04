/**
 * Drive Folder Backfill Spreadsheet Generator
 *
 * Reads all CRM contacts and all Drive client folders, fuzzy-matches them
 * by name, and populates a Google Sheet with the best-guess pairings.
 *
 * IMPORTANT: This does NOT update any CRM contacts. It only writes to the
 * spreadsheet for human review. Taylor confirms matches, then we apply them.
 *
 * Columns: CRM Contact Name | CRM Contact ID | CRM Email | Drive Folder Name |
 *          Drive Folder ID | Match Confidence | Already Linked? | Notes
 */

import type { Request, Response } from 'express';
import { listAllContacts, extractDriveFolderId } from '../crm/contacts.js';
import type { ContactSummary } from '../crm/contacts.js';
import { crmConfig } from '../crm/config.js';
import { getDriveClient } from '../classification/drive-client.js';
import { getSheetsClient } from '../budget/sheets-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fuzzy Name Matching
// ---------------------------------------------------------------------------

/**
 * Normalizes a name for comparison: lowercase, trim, remove extra spaces.
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Computes a match confidence between a CRM contact name and a Drive folder name.
 *
 * Drive folder naming convention: "LastName, FirstName" or "Last1/Last2, First1/First2"
 *
 * Returns 0-1 confidence score.
 */
function matchContactToFolder(
  firstName: string,
  lastName: string,
  folderName: string,
): number {
  const normFirst = normalizeName(firstName);
  const normLast = normalizeName(lastName);
  const normFolder = normalizeName(folderName);

  // Exact match: "LastName, FirstName"
  if (normFolder === `${normLast}, ${normFirst}`) return 1.0;

  // Folder contains both first and last name (covers multi-borrower folders)
  const folderHasLast = normFolder.includes(normLast);
  const folderHasFirst = normFolder.includes(normFirst);

  if (folderHasLast && folderHasFirst) return 0.9;

  // Last name only match (e.g., "Smith, J" or folder just has last name)
  if (folderHasLast && normLast.length >= 3) return 0.6;

  // First name only match (less reliable)
  if (folderHasFirst && normFirst.length >= 3) return 0.3;

  return 0;
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Lists all top-level folders in the Drive root folder.
 */
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

/**
 * Builds the backfill spreadsheet rows.
 *
 * For each CRM contact:
 * - If already linked to a Drive folder, mark it and verify folder exists
 * - If not linked, find best-matching folder by name
 */
function buildBackfillRows(
  contacts: ContactSummary[],
  folders: DriveFolder[],
  driveFolderFieldId: string,
): BackfillRow[] {
  const rows: BackfillRow[] = [];

  for (const contact of contacts) {
    const contactName = `${contact.lastName}, ${contact.firstName}`.trim();
    if (!contact.firstName && !contact.lastName) continue; // Skip empty contacts

    // Check if contact already has a folder linked
    const folderField = contact.customFields.find(f => f.id === driveFolderFieldId);
    const existingFolderId = folderField && typeof folderField.value === 'string' && folderField.value
      ? extractDriveFolderId(folderField.value)
      : null;

    if (existingFolderId) {
      // Already linked — verify folder exists
      const matchingFolder = folders.find(f => f.id === existingFolderId);
      rows.push({
        contactName,
        contactId: contact.id,
        contactEmail: contact.email,
        driveFolderName: matchingFolder?.name ?? '(folder not found in root)',
        driveFolderId: existingFolderId,
        matchConfidence: matchingFolder ? 1.0 : 0,
        alreadyLinked: true,
        notes: matchingFolder ? 'Already linked' : 'WARNING: Linked folder not found in root (may be in subfolder or deleted)',
      });
      continue;
    }

    // Not linked — find best matching folder
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
        notes: bestScore >= 0.9 ? 'High confidence' : bestScore >= 0.6 ? 'Last name match' : 'Weak match — verify',
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
        notes: 'No matching folder found',
      });
    }
  }

  // Sort: already linked first, then by confidence descending
  rows.sort((a, b) => {
    if (a.alreadyLinked && !b.alreadyLinked) return -1;
    if (!a.alreadyLinked && b.alreadyLinked) return 1;
    return b.matchConfidence - a.matchConfidence;
  });

  return rows;
}

/**
 * Writes backfill rows to a Google Sheet.
 */
async function writeToSheet(spreadsheetId: string, rows: BackfillRow[]): Promise<void> {
  const sheets = getSheetsClient();

  // Header row
  const header = [
    'CRM Contact Name',
    'CRM Contact ID',
    'CRM Email',
    'Drive Folder Name',
    'Drive Folder ID',
    'Match Confidence',
    'Already Linked?',
    'Notes',
  ];

  // Data rows
  const dataRows = rows.map(r => [
    r.contactName,
    r.contactId,
    r.contactEmail,
    r.driveFolderName,
    r.driveFolderId,
    r.matchConfidence > 0 ? `${Math.round(r.matchConfidence * 100)}%` : '',
    r.alreadyLinked ? 'YES' : '',
    r.notes,
  ]);

  const allRows = [header, ...dataRows];

  // Clear existing data and write new
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Sheet1',
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: allRows,
    },
  });
}

// ---------------------------------------------------------------------------
// Express Handler
// ---------------------------------------------------------------------------

const BACKFILL_SPREADSHEET_ID = '1ig365jSZqElHZeDKyWjkSohR3_uES3IxjfFHlCt7was';

/**
 * POST /admin/backfill-spreadsheet
 *
 * Reads all CRM contacts and Drive folders, fuzzy-matches them, and
 * writes the results to the configured Google Sheet.
 *
 * Does NOT modify any CRM contacts.
 */
export async function backfillSpreadsheetHandler(_req: Request, res: Response): Promise<void> {
  try {
    const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
    if (!rootFolderId) {
      res.status(400).json({ error: 'DRIVE_ROOT_FOLDER_ID not set' });
      return;
    }

    if (!crmConfig.driveFolderIdFieldId) {
      res.status(400).json({ error: 'GHL_FIELD_DRIVE_FOLDER_ID not set' });
      return;
    }

    console.log('[backfill] Starting backfill spreadsheet generation...');

    // Fetch data in parallel
    const [contacts, folders] = await Promise.all([
      listAllContacts(),
      listDriveFolders(rootFolderId),
    ]);

    console.log('[backfill] Fetched data', {
      contacts: contacts.length,
      driveFolders: folders.length,
    });

    // Build rows
    const rows = buildBackfillRows(contacts, folders, crmConfig.driveFolderIdFieldId);

    // Write to sheet
    await writeToSheet(BACKFILL_SPREADSHEET_ID, rows);

    const alreadyLinked = rows.filter(r => r.alreadyLinked).length;
    const matched = rows.filter(r => !r.alreadyLinked && r.matchConfidence > 0).length;
    const unmatched = rows.filter(r => !r.alreadyLinked && r.matchConfidence === 0).length;

    console.log('[backfill] Spreadsheet populated', {
      totalContacts: contacts.length,
      totalFolders: folders.length,
      alreadyLinked,
      matched,
      unmatched,
    });

    res.json({
      success: true,
      totalContacts: contacts.length,
      totalFolders: folders.length,
      alreadyLinked,
      matched,
      unmatched,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${BACKFILL_SPREADSHEET_ID}/edit`,
    });
  } catch (err) {
    console.error('[backfill] Failed to generate backfill spreadsheet', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({
      error: 'Failed to generate backfill spreadsheet',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
