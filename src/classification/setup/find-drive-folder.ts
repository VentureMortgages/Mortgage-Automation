/**
 * Utility: Find the Google Drive folder ID for "Mortgage Clients"
 *
 * Usage: npx tsx src/classification/setup/find-drive-folder.ts
 */

import 'dotenv/config';
import { getDriveClient } from '../drive-client.js';

async function main() {
  const drive = getDriveClient();

  console.log('Searching for "Mortgage Clients" folder in Google Drive...\n');

  const res = await drive.files.list({
    q: "name = 'Mortgage Clients' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name, parents, createdTime)',
    spaces: 'drive',
  });

  const folders = res.data.files ?? [];

  if (folders.length === 0) {
    console.log('No folder named "Mortgage Clients" found.');
    console.log('Make sure the OAuth credentials have access to the Drive.');
    return;
  }

  console.log(`Found ${folders.length} folder(s):\n`);
  for (const folder of folders) {
    console.log(`  Name:    ${folder.name}`);
    console.log(`  ID:      ${folder.id}`);
    console.log(`  Parents: ${folder.parents?.join(', ') ?? 'root'}`);
    console.log(`  Created: ${folder.createdTime}`);
    console.log();
  }

  if (folders.length === 1) {
    console.log(`Add this to your .env file:`);
    console.log(`DRIVE_ROOT_FOLDER_ID=${folders[0].id}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
