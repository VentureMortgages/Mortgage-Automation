/**
 * Browse Google Drive to find Taylor's budget sheets.
 * Run: npx tsx src/e2e/browse-drive.ts
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

const DRIVE_ROOT = process.env.DRIVE_ROOT_FOLDER_ID!;

function getDrive() {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

async function main() {
  const drive = getDrive();

  // 1. List client folders
  const folders = await drive.files.list({
    q: `'${DRIVE_ROOT}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name)',
    pageSize: 50,
    orderBy: 'name',
  });

  console.log(`Client folders (${folders.data.files?.length ?? 0}):\n`);

  // 2. For each folder, look for Google Sheets
  for (const folder of (folders.data.files ?? []).slice(0, 20)) {
    const sheets = await drive.files.list({
      q: `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet'`,
      fields: 'files(id, name, modifiedTime)',
      pageSize: 10,
    });

    // Also check subfolders for sheets
    const subfolders = await drive.files.list({
      q: `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
      pageSize: 20,
    });

    let subSheets: Array<{ name: string; subfolder: string }> = [];
    for (const sub of subfolders.data.files ?? []) {
      const ss = await drive.files.list({
        q: `'${sub.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet'`,
        fields: 'files(id, name)',
        pageSize: 5,
      });
      for (const s of ss.data.files ?? []) {
        subSheets.push({ name: s.name!, subfolder: sub.name! });
      }
    }

    const sheetCount = (sheets.data.files?.length ?? 0) + subSheets.length;
    if (sheetCount > 0) {
      console.log(`${folder.name}/`);
      for (const s of sheets.data.files ?? []) {
        console.log(`  [Sheet] ${s.name}`);
      }
      for (const s of subSheets) {
        console.log(`  [Sheet in ${s.subfolder}/] ${s.name}`);
      }
      console.log('');
    }
  }
}

main().catch(console.error);
