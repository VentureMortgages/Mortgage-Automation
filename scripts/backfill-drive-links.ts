/**
 * Interactive Backfill Script — Link CRM Contacts to Drive Folders (FOLD-05)
 *
 * One-time utility for Cat to match unlinked CRM contacts to their Google Drive
 * client folders. Lists all contacts missing a driveFolderId, searches Drive root
 * for best-match folders, and prompts for confirmation.
 *
 * Usage:
 *   npx tsx scripts/backfill-drive-links.ts
 *   npx tsx scripts/backfill-drive-links.ts --dry-run   (list only, no changes)
 *
 * Requires same .env file as the main application.
 *
 * Idempotent: running twice skips already-linked contacts.
 */

import 'dotenv/config';
import * as readline from 'node:readline';
import { crmConfig } from '../src/crm/config.js';
import { getContact, getContactDriveFolderId, upsertContact } from '../src/crm/contacts.js';
import { getDriveClient } from '../src/classification/drive-client.js';
import { classificationConfig } from '../src/classification/config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrmContactSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface DriveFolder {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// CRM: Fetch all contacts (paginated)
// ---------------------------------------------------------------------------

async function fetchAllContacts(): Promise<CrmContactSummary[]> {
  const contacts: CrmContactSummary[] = [];
  let hasMore = true;
  let startAfterId: string | undefined;

  while (hasMore) {
    const params = new URLSearchParams({
      locationId: crmConfig.locationId,
      limit: '100',
    });
    if (startAfterId) params.set('startAfterId', startAfterId);

    const url = `${crmConfig.baseUrl}/contacts/?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${crmConfig.apiKey}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`CRM API error: ${response.status} — ${body}`);
    }

    const data = (await response.json()) as {
      contacts: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
      meta?: { startAfterId?: string; total?: number };
    };

    for (const c of data.contacts) {
      contacts.push({
        id: c.id,
        firstName: c.firstName ?? '',
        lastName: c.lastName ?? '',
        email: c.email ?? '',
      });
    }

    if (data.meta?.startAfterId && data.contacts.length > 0) {
      startAfterId = data.meta.startAfterId;
    } else {
      hasMore = false;
    }
  }

  return contacts;
}

// ---------------------------------------------------------------------------
// Drive: List root folders
// ---------------------------------------------------------------------------

async function listDriveRootFolders(): Promise<DriveFolder[]> {
  const drive = getDriveClient();
  const rootFolderId = classificationConfig.driveRootFolderId;
  const folders: DriveFolder[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 100,
      pageToken,
    });

    for (const f of res.data.files ?? []) {
      if (f.id && f.name) {
        folders.push({ id: f.id, name: f.name });
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return folders;
}

// ---------------------------------------------------------------------------
// Matching Logic
// ---------------------------------------------------------------------------

function findBestMatchFolder(
  contact: CrmContactSummary,
  folders: DriveFolder[],
): DriveFolder[] {
  const lastName = contact.lastName.toLowerCase();
  const firstName = contact.firstName.toLowerCase();

  // Exact match: "LastName, FirstName"
  const exact = folders.filter(
    f => f.name.toLowerCase() === `${lastName}, ${firstName}`,
  );
  if (exact.length > 0) return exact;

  // Fuzzy: folder name contains lastName
  if (lastName.length >= 2) {
    const fuzzy = folders.filter(
      f => f.name.toLowerCase().includes(lastName),
    );
    if (fuzzy.length > 0) return fuzzy;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Interactive Prompt
// ---------------------------------------------------------------------------

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim().toLowerCase()));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('=== DRY RUN MODE — no changes will be made ===\n');
  }

  console.log('Fetching all CRM contacts...');
  const allContacts = await fetchAllContacts();
  console.log(`Found ${allContacts.length} total contacts.\n`);

  // Filter to unlinked contacts
  console.log('Checking which contacts have no Drive folder linked...');
  const unlinked: CrmContactSummary[] = [];

  for (const c of allContacts) {
    try {
      const full = await getContact(c.id);
      const folderId = getContactDriveFolderId(full, crmConfig.driveFolderIdFieldId);
      if (!folderId) {
        unlinked.push(c);
      }
    } catch (err) {
      console.warn(`  Warning: Could not check contact ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`Found ${unlinked.length} unlinked contacts.\n`);

  if (unlinked.length === 0) {
    console.log('All contacts already have Drive folders linked. Nothing to do.');
    return;
  }

  console.log('Listing Drive root folders...');
  const folders = await listDriveRootFolders();
  console.log(`Found ${folders.length} folders in Drive root.\n`);

  // Interactive loop
  const rl = createPrompt();
  let linked = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const contact of unlinked) {
    console.log(`\n--- Contact: ${contact.firstName} ${contact.lastName} (${contact.email || 'no email'}) ---`);

    const matches = findBestMatchFolder(contact, folders);

    if (matches.length === 0) {
      console.log('  No matching Drive folder found.');
      noMatch++;

      const showAll = await ask(rl, '  Show all folders? [y/N] ');
      if (showAll === 'y') {
        folders.forEach((f, i) => console.log(`    ${i + 1}. ${f.name} (${f.id})`));
        const choice = await ask(rl, '  Enter folder number (or "skip"): ');
        if (choice === 'skip' || choice === '') {
          skipped++;
          continue;
        }
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < folders.length) {
          if (!dryRun) {
            await linkFolder(contact, folders[idx]);
          }
          console.log(`  ${dryRun ? '[DRY RUN] Would link' : 'Linked'}: ${contact.firstName} ${contact.lastName} -> ${folders[idx].name}`);
          linked++;
          noMatch--; // Undo the noMatch increment since user found a match
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
      continue;
    }

    if (matches.length === 1) {
      console.log(`  Best match: "${matches[0].name}" (${matches[0].id})`);
      const answer = await ask(rl, '  Link this folder? [Y/n/skip] ');

      if (answer === '' || answer === 'y') {
        if (!dryRun) {
          await linkFolder(contact, matches[0]);
        }
        console.log(`  ${dryRun ? '[DRY RUN] Would link' : 'Linked'}: ${contact.firstName} ${contact.lastName} -> ${matches[0].name}`);
        linked++;
      } else if (answer === 'n') {
        // Show all folders for manual selection
        folders.forEach((f, i) => console.log(`    ${i + 1}. ${f.name} (${f.id})`));
        const choice = await ask(rl, '  Enter folder number (or "skip"): ');
        if (choice === 'skip' || choice === '') {
          skipped++;
        } else {
          const idx = parseInt(choice, 10) - 1;
          if (idx >= 0 && idx < folders.length) {
            if (!dryRun) {
              await linkFolder(contact, folders[idx]);
            }
            console.log(`  ${dryRun ? '[DRY RUN] Would link' : 'Linked'}: ${contact.firstName} ${contact.lastName} -> ${folders[idx].name}`);
            linked++;
          } else {
            skipped++;
          }
        }
      } else {
        skipped++;
      }
    } else {
      // Multiple matches
      console.log('  Multiple possible matches:');
      matches.forEach((f, i) => console.log(`    ${i + 1}. ${f.name} (${f.id})`));
      const choice = await ask(rl, '  Enter folder number (or "skip"): ');

      if (choice === 'skip' || choice === '') {
        skipped++;
      } else {
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < matches.length) {
          if (!dryRun) {
            await linkFolder(contact, matches[idx]);
          }
          console.log(`  ${dryRun ? '[DRY RUN] Would link' : 'Linked'}: ${contact.firstName} ${contact.lastName} -> ${matches[idx].name}`);
          linked++;
        } else {
          skipped++;
        }
      }
    }
  }

  rl.close();

  console.log('\n=== Summary ===');
  console.log(`  Linked: ${linked}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  No match: ${noMatch}`);
  if (dryRun) {
    console.log('\n  (Dry run — no changes were made)');
  }
}

async function linkFolder(contact: CrmContactSummary, folder: DriveFolder): Promise<void> {
  await upsertContact({
    email: contact.email || `unknown-${contact.id}@placeholder.venturemortgages.com`,
    firstName: contact.firstName,
    lastName: contact.lastName,
    customFields: [{ id: crmConfig.driveFolderIdFieldId, field_value: folder.id }],
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
