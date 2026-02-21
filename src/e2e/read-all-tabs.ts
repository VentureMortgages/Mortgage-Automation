/**
 * Read all tabs from Taylor's master budget template via Sheets API.
 * Run: npx tsx src/e2e/read-all-tabs.ts
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

const TEMPLATE_ID = '1BlqpDhYHuKY0Cgz7GnDzpcTNvMUWyrzpS24A6njzqwo';

function getAuth() {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Get spreadsheet metadata — all tabs
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: TEMPLATE_ID,
    fields: 'properties.title,sheets.properties',
  });

  console.log(`Spreadsheet: "${meta.data.properties?.title}"`);
  console.log('');

  const tabs = meta.data.sheets ?? [];
  console.log(`Found ${tabs.length} tabs:`);
  for (const tab of tabs) {
    const p = tab.properties!;
    console.log(`  [gid=${p.sheetId}] "${p.title}" (${p.gridProperties?.rowCount} rows x ${p.gridProperties?.columnCount} cols)`);
  }
  console.log('');

  // 2. Read each tab — both values AND formulas
  for (const tab of tabs) {
    const title = tab.properties!.title!;
    console.log('='.repeat(70));
    console.log(`TAB: "${title}"`);
    console.log('='.repeat(70));

    // Get values
    const valRes = await sheets.spreadsheets.values.get({
      spreadsheetId: TEMPLATE_ID,
      range: `'${title}'`,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = valRes.data.values ?? [];
    console.log(`\n--- VALUES (${rows.length} rows) ---`);
    for (const row of rows.slice(0, 60)) {
      console.log(row.join('\t'));
    }
    if (rows.length > 60) {
      console.log(`... (${rows.length - 60} more rows)`);
    }

    // Get formulas (shows raw formulas where they exist)
    const fmtRes = await sheets.spreadsheets.values.get({
      spreadsheetId: TEMPLATE_ID,
      range: `'${title}'`,
      valueRenderOption: 'FORMULA',
    });

    const fRows = fmtRes.data.values ?? [];
    // Only show rows that have formulas (contain '=')
    const formulaRows: Array<{ row: number; cells: string[] }> = [];
    for (let i = 0; i < fRows.length; i++) {
      const hasFormula = fRows[i]?.some((c: string) => typeof c === 'string' && c.startsWith('='));
      if (hasFormula) {
        formulaRows.push({ row: i + 1, cells: fRows[i] });
      }
    }

    if (formulaRows.length > 0) {
      console.log(`\n--- FORMULAS (${formulaRows.length} rows with formulas) ---`);
      for (const fr of formulaRows.slice(0, 40)) {
        const formCells = fr.cells
          .map((c: string, ci: number) => (typeof c === 'string' && c.startsWith('=')) ? `[${String.fromCharCode(65 + ci)}${fr.row}] ${c}` : null)
          .filter(Boolean);
        if (formCells.length > 0) {
          console.log(`Row ${fr.row}: ${formCells.join('  |  ')}`);
        }
      }
      if (formulaRows.length > 40) {
        console.log(`... (${formulaRows.length - 40} more formula rows)`);
      }
    }

    console.log('');
  }
}

main().catch(console.error);
