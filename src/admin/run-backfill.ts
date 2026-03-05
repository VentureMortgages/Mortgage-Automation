#!/usr/bin/env npx tsx
/**
 * Local runner for the Drive folder backfill spreadsheet.
 *
 * APPROACH: Folder-first. Lists Drive folders (real clients, ~50-200),
 * then searches CRM for matching contacts. This avoids paginating through
 * 17k+ GHL contacts (marketing leads, old inquiries, etc.).
 *
 * Usage: npx tsx src/admin/run-backfill.ts
 *
 * Requires .env with: GHL_API_KEY, GHL_LOCATION_ID, GHL_FIELD_DRIVE_FOLDER_ID,
 * DRIVE_ROOT_FOLDER_ID, and Google credentials.
 */

import 'dotenv/config';
import { extractDriveFolderId, getContact } from '../crm/contacts.js';
import { crmConfig } from '../crm/config.js';
import { getDriveClient } from '../classification/drive-client.js';
import { getSheetsClient } from '../budget/sheets-client.js';
import { CrmApiError, CrmRateLimitError } from '../crm/errors.js';

const SPREADSHEET_ID = '1ig365jSZqElHZeDKyWjkSohR3_uES3IxjfFHlCt7was';

interface DriveFolder {
  id: string;
  name: string;
}

interface BackfillRow {
  driveFolderName: string;
  driveFolderId: string;
  contactName: string;
  contactId: string;
  contactEmail: string;
  matchConfidence: number;
  alreadyLinked: boolean;
  notes: string;
}

// ---------------------------------------------------------------------------
// CRM search — uses POST /contacts/search (lightweight, no pagination needed)
// ---------------------------------------------------------------------------

interface SearchResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

async function crmFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${crmConfig.baseUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${crmConfig.apiKey}`,
      Version: '2021-07-28',
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 429) {
    throw new CrmRateLimitError('Rate limited');
  }
  if (!response.ok) {
    throw new CrmApiError(`CRM API ${response.status}: ${response.statusText}`, response.status, '');
  }
  return response;
}

async function searchContacts(query: string): Promise<SearchResult[]> {
  const body = {
    locationId: crmConfig.locationId,
    query,
    pageLimit: 10,
  };

  const response = await crmFetch('/contacts/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as {
    contacts: Array<{
      id: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    }>;
  };

  if (!data.contacts) return [];

  return data.contacts.map(c => ({
    id: c.id,
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    email: c.email ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Drive folder listing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Name parsing — Drive folders are "LastName, FirstName" or variations
// Joint folders use "/" to separate people:
//   "Bennett, Andrew/Tabitha"          → Bennett Andrew + Bennett Tabitha
//   "Wing/Jennerman, Megan/Cory"       → Wing Megan + Jennerman Cory
//   "Trischuk/Calder, Andrea/Robert"   → Trischuk Andrea + Calder Robert
//   "Wong-Ranasinghe, Carolyn/Srimal"  → Wong-Ranasinghe Carolyn + Wong-Ranasinghe Srimal
// ---------------------------------------------------------------------------

interface ParsedPerson { firstName: string; lastName: string }

function parseFolderName(folderName: string): ParsedPerson[] {
  // Must have "LastName(s), FirstName(s)" format
  const commaMatch = folderName.match(/^([^,]+),\s*(.+)$/);
  if (!commaMatch) {
    // Fallback: "FirstName LastName"
    const parts = folderName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return [{ firstName: parts[0], lastName: parts[parts.length - 1] }];
    }
    return [];
  }

  const lastPart = commaMatch[1].trim();
  const firstPart = commaMatch[2].trim();

  const lastNames = lastPart.split('/').map(s => s.trim()).filter(Boolean);
  const firstNames = firstPart.split('/').map(s => s.trim()).filter(Boolean);

  const people: ParsedPerson[] = [];

  if (lastNames.length === 1) {
    // Single last name, possibly multiple first names: "Bennett, Andrew/Tabitha"
    for (const first of firstNames) {
      people.push({ firstName: first, lastName: lastNames[0] });
    }
  } else if (lastNames.length === firstNames.length) {
    // Paired: "Wing/Jennerman, Megan/Cory" → Wing Megan + Jennerman Cory
    for (let i = 0; i < lastNames.length; i++) {
      people.push({ firstName: firstNames[i], lastName: lastNames[i] });
    }
  } else {
    // Mismatch — try each combination
    for (const last of lastNames) {
      for (const first of firstNames) {
        people.push({ firstName: first, lastName: last });
      }
    }
  }

  return people;
}

function nameMatch(
  contactFirst: string,
  contactLast: string,
  folderFirst: string,
  folderLast: string,
): number {
  const cf = contactFirst.toLowerCase().trim();
  const cl = contactLast.toLowerCase().trim();
  const ff = folderFirst.toLowerCase().trim();
  const fl = folderLast.toLowerCase().trim();

  if (cl === fl && cf === ff) return 1.0;
  if (cl === fl && (cf.startsWith(ff) || ff.startsWith(cf))) return 0.9;
  if (cl === fl) return 0.6;
  return 0;
}

// ---------------------------------------------------------------------------
// Rate-limit-aware delay
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main matching logic (folder-first)
// ---------------------------------------------------------------------------

async function searchWithRetry(query: string): Promise<SearchResult[]> {
  try {
    return await searchContacts(query);
  } catch (err) {
    if (err instanceof CrmRateLimitError) {
      console.log('    Rate limited, waiting 10s...');
      await delay(10000);
      return await searchContacts(query);
    }
    throw err;
  }
}

async function buildRows(
  folders: DriveFolder[],
  fieldId: string,
): Promise<BackfillRow[]> {
  const rows: BackfillRow[] = [];

  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    console.log(`  [${i + 1}/${folders.length}] ${folder.name}`);

    const people = parseFolderName(folder.name);
    if (people.length === 0) {
      rows.push({
        driveFolderName: folder.name,
        driveFolderId: folder.id,
        contactName: '',
        contactId: '',
        contactEmail: '',
        matchConfidence: 0,
        alreadyLinked: false,
        notes: 'Could not parse folder name',
      });
      continue;
    }

    console.log(`    Parsed: ${people.map(p => `${p.firstName} ${p.lastName}`).join(' + ')}`);

    // Search CRM for each person in the folder
    let folderHasMatch = false;

    for (const person of people) {
      await delay(700);
      const searchQuery = `${person.firstName} ${person.lastName}`;
      const results = await searchWithRetry(searchQuery);

      // Score each result against this person
      const scored = results
        .map(r => ({
          ...r,
          score: nameMatch(r.firstName, r.lastName, person.firstName, person.lastName),
        }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        rows.push({
          driveFolderName: folderHasMatch ? `  ↳ co-borrower: ${folder.name}` : folder.name,
          driveFolderId: folder.id,
          contactName: '',
          contactId: '',
          contactEmail: '',
          matchConfidence: 0,
          alreadyLinked: false,
          notes: `No CRM match for "${person.firstName} ${person.lastName}"`,
        });
        continue;
      }

      // Check best match — is it already linked?
      const best = scored[0];
      await delay(700);
      let alreadyLinked = false;
      let linkedFolderId: string | null = null;

      try {
        const fullContact = await getContact(best.id);
        const folderField = fullContact.customFields?.find(
          (f: { id: string }) => f.id === fieldId,
        );
        if (folderField && typeof folderField.value === 'string' && folderField.value) {
          linkedFolderId = extractDriveFolderId(folderField.value);
          alreadyLinked = true;
        }
      } catch {
        // If contact fetch fails, just note it
      }

      let notes: string;
      if (alreadyLinked && linkedFolderId === folder.id) {
        notes = 'Already linked (correct)';
      } else if (alreadyLinked) {
        notes = `Already linked to DIFFERENT folder: ${linkedFolderId}`;
      } else if (best.score >= 0.9) {
        notes = scored.length > 1 ? `High confidence (${scored.length} candidates)` : 'High confidence';
      } else if (best.score >= 0.6) {
        notes = 'Last name match — verify first name';
      } else {
        notes = 'Weak — verify manually';
      }

      const label = folderHasMatch ? `  ↳ co-borrower: ${folder.name}` : folder.name;
      rows.push({
        driveFolderName: label,
        driveFolderId: folder.id,
        contactName: `${best.lastName}, ${best.firstName}`,
        contactId: best.id,
        contactEmail: best.email,
        matchConfidence: best.score,
        alreadyLinked,
        notes,
      });

      folderHasMatch = true;
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

// ---------------------------------------------------------------------------
// Sheet writer
// ---------------------------------------------------------------------------

async function writeToSheet(rows: BackfillRow[]): Promise<void> {
  const sheets = getSheetsClient();

  const header = [
    'Drive Folder Name', 'Drive Folder ID',
    'CRM Contact Name', 'CRM Contact ID', 'CRM Email',
    'Match Confidence', 'Already Linked?', 'Notes',
  ];

  const dataRows = rows.map(r => [
    r.driveFolderName, r.driveFolderId,
    r.contactName, r.contactId, r.contactEmail,
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

  console.log('Fetching Drive folders...');
  const folders = await listDriveFolders(rootFolderId);
  console.log(`  → ${folders.length} folders\n`);

  console.log('Matching folders to CRM contacts...');
  const rows = await buildRows(folders, crmConfig.driveFolderIdFieldId);

  const linked = rows.filter(r => r.alreadyLinked).length;
  const matched = rows.filter(r => !r.alreadyLinked && r.matchConfidence > 0 && !r.driveFolderName.startsWith('  ↳')).length;
  const unmatched = rows.filter(r => r.matchConfidence === 0).length;

  console.log(`\nWriting to Google Sheet...`);
  await writeToSheet(rows);

  console.log(`\nDone! Review at: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
  console.log(`\nSummary: ${folders.length} Drive folders`);
  console.log(`  Already linked: ${linked}`);
  console.log(`  Best-guess match: ${matched}`);
  console.log(`  No match: ${unmatched}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
