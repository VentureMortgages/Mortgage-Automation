/**
 * Read budget sheets via Drive export (no Sheets API needed).
 * Run: npx tsx src/e2e/read-budget-sheet.ts
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

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

  // Find recent budget sheets
  const results = await drive.files.list({
    q: "mimeType = 'application/vnd.google-apps.spreadsheet' and name contains 'Budget'",
    fields: 'files(id, name, modifiedTime)',
    pageSize: 5,
    orderBy: 'modifiedTime desc',
  });

  console.log('Recent budget sheets:');
  for (const f of results.data.files ?? []) {
    console.log(`  ${f.name} — modified ${f.modifiedTime?.split('T')[0]}`);
  }
  console.log('');

  // Read the 2 most recent via Drive export as CSV
  for (const file of (results.data.files ?? []).slice(0, 2)) {
    console.log('='.repeat(70));
    console.log(`SHEET: ${file.name}`);
    console.log('='.repeat(70));

    try {
      const res = await drive.files.export({
        fileId: file.id!,
        mimeType: 'text/csv',
      });

      const csv = res.data as string;
      const lines = csv.split('\n');
      for (const line of lines.slice(0, 60)) {
        console.log(line);
      }
      if (lines.length > 60) {
        console.log(`... (${lines.length - 60} more rows)`);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
    }
    console.log('');
  }
}

main().catch(console.error);
