/**
 * Read Taylor's master budget template via Drive export.
 * Run: npx tsx src/e2e/read-template-sheet.ts
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

const TEMPLATE_ID = '1BlqpDhYHuKY0Cgz7GnDzpcTNvMUWyrzpS24A6njzqwo';

// Known gids from the URL — we'll try to export each tab
const GIDS = [128943964];

function getDrive() {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return { drive: google.drive({ version: 'v3', auth: oauth2 }), auth: oauth2 };
}

async function main() {
  const { drive, auth } = getDrive();

  // 1. Get file metadata
  const meta = await drive.files.get({
    fileId: TEMPLATE_ID,
    fields: 'id, name, mimeType, modifiedTime, owners',
  });
  console.log('File metadata:');
  console.log(`  Name: ${meta.data.name}`);
  console.log(`  Type: ${meta.data.mimeType}`);
  console.log(`  Modified: ${meta.data.modifiedTime}`);
  console.log('');

  // 2. Export default (first) sheet as CSV
  console.log('='.repeat(70));
  console.log('DEFAULT SHEET (first tab):');
  console.log('='.repeat(70));
  try {
    const res = await drive.files.export({
      fileId: TEMPLATE_ID,
      mimeType: 'text/csv',
    });
    const csv = res.data as string;
    const lines = csv.split('\n');
    for (const line of lines.slice(0, 80)) {
      console.log(line);
    }
    if (lines.length > 80) {
      console.log(`... (${lines.length - 80} more rows)`);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
  }
  console.log('');

  // 3. Try exporting the specific gid tab via direct HTTP
  // Drive API export doesn't support gid, so use direct URL with auth token
  const token = await auth.getAccessToken();
  for (const gid of GIDS) {
    console.log('='.repeat(70));
    console.log(`SHEET gid=${gid}:`);
    console.log('='.repeat(70));
    try {
      const url = `https://docs.google.com/spreadsheets/d/${TEMPLATE_ID}/export?format=csv&gid=${gid}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token.token}` },
      });
      if (!res.ok) {
        console.error(`HTTP ${res.status}: ${await res.text()}`);
        continue;
      }
      const csv = await res.text();
      const lines = csv.split('\n');
      for (const line of lines.slice(0, 80)) {
        console.log(line);
      }
      if (lines.length > 80) {
        console.log(`... (${lines.length - 80} more rows)`);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
    }
    console.log('');
  }

  // 4. Try to list all sheet tabs via Sheets API (may fail if not enabled)
  try {
    const sheets = google.sheets({ version: 'v4', auth: getDrive().auth as any });
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: TEMPLATE_ID,
      fields: 'sheets.properties',
    });
    console.log('Sheet tabs:');
    for (const s of spreadsheet.data.sheets ?? []) {
      console.log(`  [gid=${s.properties?.sheetId}] ${s.properties?.title}`);
    }
  } catch (err) {
    // Sheets API likely not enabled — try alternative approach
    console.log('Sheets API not available, trying HTML parse for tab names...');
    try {
      const url = `https://docs.google.com/spreadsheets/d/${TEMPLATE_ID}/edit`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token.token}` },
      });
      const html = await res.text();
      // Look for sheet names in the HTML
      const tabMatches = html.matchAll(/\"gid\":(\d+).*?\"name\":\"([^\"]+)\"/g);
      for (const m of tabMatches) {
        console.log(`  [gid=${m[1]}] ${m[2]}`);
      }
    } catch {
      console.log('  Could not determine tab names');
    }
  }
}

main().catch(console.error);
