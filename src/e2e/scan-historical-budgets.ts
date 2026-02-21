/**
 * Scan historical budget sheets to find Taylor's typical input values.
 * Run: npx tsx src/e2e/scan-historical-budgets.ts
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

const DRIVE_ROOT = process.env.DRIVE_ROOT_FOLDER_ID!;

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
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Find all spreadsheets under Mortgage Clients recursively
  console.log('Searching for budget sheets across all client folders...\n');

  const allSheets: Array<{ id: string; name: string; folder: string }> = [];

  // Get all client folders
  const folders = await drive.files.list({
    q: `'${DRIVE_ROOT}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name)',
    pageSize: 100,
    orderBy: 'name',
  });

  for (const folder of folders.data.files ?? []) {
    // Direct spreadsheets in client folder
    const directSheets = await drive.files.list({
      q: `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet'`,
      fields: 'files(id, name)',
      pageSize: 10,
    });
    for (const s of directSheets.data.files ?? []) {
      allSheets.push({ id: s.id!, name: s.name!, folder: folder.name! });
    }

    // Also check subfolders
    const subfolders = await drive.files.list({
      q: `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
      pageSize: 20,
    });
    for (const sub of subfolders.data.files ?? []) {
      const subSheets = await drive.files.list({
        q: `'${sub.id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet'`,
        fields: 'files(id, name)',
        pageSize: 10,
      });
      for (const s of subSheets.data.files ?? []) {
        allSheets.push({ id: s.id!, name: s.name!, folder: `${folder.name}/${sub.name}` });
      }
    }
  }

  console.log(`Found ${allSheets.length} spreadsheets total.\n`);

  // Filter for likely budget sheets
  const budgetSheets = allSheets.filter(s =>
    s.name.toLowerCase().includes('budget') ||
    s.name.toLowerCase().includes('master')
  );
  console.log(`Budget-related sheets: ${budgetSheets.length}\n`);

  // 2. Read key input cells from each budget sheet
  const results: Array<{
    name: string;
    folder: string;
    tab: string;
    purchasePrice: string;
    rate: string;
    amortization: string;
    fthb: string;
    location: string;
    propertyTaxes: string;
    condoFees: string;
    insurance: string;
    utilities: string;
  }> = [];

  // Cell ranges to read from "Purchase Budget" or first tab
  // Row 4: Amortization, Row 7: Rate, Row 8: FTHB, Row 9: Property Taxes,
  // Row 10: Location, Row 13: Purchase Price, Row 33: Condo, Row 34: Insurance, Row 35: Utilities
  const purchaseBudgetRanges = [
    'B4', 'E4',   // Amortization (fixed col, variable col)
    'B7', 'E7',   // Rate
    'B8', 'E8',   // FTHB
    'B9',         // Property taxes
    'B10', 'E10', // Location
    'B13',        // Purchase price
    'B33', 'B34', 'B35', // Condo, Insurance, Utilities
  ];

  // Try known tab names
  const tabNames = ['Purchase Budget', 'Sell + Buy', 'Buy Investment Property', 'Refinance Budget'];

  let scanned = 0;
  for (const sheet of budgetSheets.slice(0, 30)) {
    try {
      // First get tab list
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: sheet.id,
        fields: 'sheets.properties.title',
      });
      const tabs = meta.data.sheets?.map(s => s.properties?.title!) ?? [];

      for (const tabName of tabNames) {
        if (!tabs.includes(tabName)) continue;

        // Read the key cells
        const ranges = [
          `'${tabName}'!B4`, `'${tabName}'!E4`,
          `'${tabName}'!B7`, `'${tabName}'!E7`,
          `'${tabName}'!B8`,
          `'${tabName}'!B9`,
          `'${tabName}'!B10`, `'${tabName}'!E10`,
          `'${tabName}'!B13`,
          `'${tabName}'!B33`, `'${tabName}'!B34`, `'${tabName}'!B35`,
        ];

        const data = await sheets.spreadsheets.values.batchGet({
          spreadsheetId: sheet.id,
          ranges,
          valueRenderOption: 'FORMATTED_VALUE',
        });

        const vals = data.data.valueRanges?.map(r => r.values?.[0]?.[0] ?? '') ?? [];

        // Only include if purchase price is non-zero (i.e., sheet was actually used)
        const price = vals[8] || '$0.00';
        if (price === '$0.00' || price === '' || price === '$0') continue;

        results.push({
          name: sheet.name,
          folder: sheet.folder,
          tab: tabName,
          amortization: vals[0] || vals[1] || '',
          rate: vals[2] || vals[3] || '',
          fthb: vals[4] || '',
          propertyTaxes: vals[5] || '',
          location: vals[6] || vals[7] || '',
          purchasePrice: price,
          condoFees: vals[9] || '',
          insurance: vals[10] || '',
          utilities: vals[11] || '',
        });
      }

      scanned++;
      if (scanned % 5 === 0) {
        console.log(`  Scanned ${scanned}/${budgetSheets.length}...`);
      }
    } catch (err) {
      // Skip sheets we can't read
    }
  }

  console.log(`\nFound ${results.length} budget sheets with actual data:\n`);

  // 3. Print results
  console.log('='.repeat(100));
  for (const r of results) {
    console.log(`${r.folder} / ${r.name} [${r.tab}]`);
    console.log(`  Purchase: ${r.purchasePrice} | Rate: ${r.rate} | Amort: ${r.amortization} | FTHB: ${r.fthb}`);
    console.log(`  Location: ${r.location} | Taxes: ${r.propertyTaxes}`);
    console.log(`  Condo: ${r.condoFees} | Insurance: ${r.insurance} | Utilities: ${r.utilities}`);
    console.log('');
  }

  // 4. Aggregate stats
  console.log('='.repeat(100));
  console.log('AGGREGATE ANALYSIS:');
  console.log('='.repeat(100));

  const rates = results.map(r => r.rate).filter(r => r && r !== '0.00%' && r !== '$0.00');
  const amorts = results.map(r => r.amortization).filter(a => a);
  const locations = results.map(r => r.location).filter(l => l);
  const fthbs = results.map(r => r.fthb).filter(f => f);
  const condos = results.map(r => r.condoFees).filter(c => c && c !== '$0.00');
  const insurances = results.map(r => r.insurance).filter(i => i && i !== '$0.00');
  const utilities = results.map(r => r.utilities).filter(u => u && u !== '$0.00');
  const taxes = results.map(r => r.propertyTaxes).filter(t => t && t !== '$0.00');

  console.log(`\nRates used (${rates.length}): ${[...new Set(rates)].sort().join(', ')}`);
  console.log(`Amortizations (${amorts.length}): ${[...new Set(amorts)].sort().join(', ')}`);
  console.log(`Locations (${locations.length}): ${[...new Set(locations)].sort().join(', ')}`);
  console.log(`FTHB values (${fthbs.length}): ${[...new Set(fthbs)].sort().join(', ')}`);
  console.log(`Condo fees (${condos.length}): ${[...new Set(condos)].sort().join(', ')}`);
  console.log(`Insurance (${insurances.length}): ${[...new Set(insurances)].sort().join(', ')}`);
  console.log(`Utilities (${utilities.length}): ${[...new Set(utilities)].sort().join(', ')}`);
  console.log(`Property taxes (${taxes.length}): ${[...new Set(taxes)].sort().join(', ')}`);

  // Frequency counts
  const countFreq = (arr: string[]) => {
    const freq: Record<string, number> = {};
    for (const v of arr) freq[v] = (freq[v] || 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1]);
  };

  console.log('\nRate frequency:');
  for (const [val, count] of countFreq(rates)) console.log(`  ${val}: ${count}x`);

  console.log('\nAmortization frequency:');
  for (const [val, count] of countFreq(amorts)) console.log(`  ${val}: ${count}x`);

  console.log('\nLocation frequency:');
  for (const [val, count] of countFreq(locations)) console.log(`  ${val}: ${count}x`);

  console.log('\nFTHB frequency:');
  for (const [val, count] of countFreq(fthbs)) console.log(`  ${val}: ${count}x`);
}

main().catch(console.error);
