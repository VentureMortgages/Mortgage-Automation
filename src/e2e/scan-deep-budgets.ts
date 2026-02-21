/**
 * Deep scan for budget sheets — search ALL spreadsheets in Drive.
 * Run: npx tsx src/e2e/scan-deep-budgets.ts
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

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
  const sheetsApi = google.sheets({ version: 'v4', auth });

  // 1. First, let's see the folder structure under Mortgage Clients
  const DRIVE_ROOT = process.env.DRIVE_ROOT_FOLDER_ID!;
  console.log('Top-level folders under Mortgage Clients:');
  const topFolders = await drive.files.list({
    q: `'${DRIVE_ROOT}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name)',
    pageSize: 50,
    orderBy: 'name',
  });
  for (const f of topFolders.data.files ?? []) {
    console.log(`  ${f.name} (${f.id})`);
    // Count children
    const children = await drive.files.list({
      q: `'${f.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
      pageSize: 5,
    });
    console.log(`    → ${children.data.files?.length ?? 0} subfolders`);
  }
  console.log('');

  // 2. Search ALL spreadsheets containing "budget" in name across entire Drive
  console.log('Searching ALL Drive for budget spreadsheets...');
  let allBudgets: Array<{ id: string; name: string; parents: string[] }> = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.spreadsheet' and name contains 'budget'",
      fields: 'nextPageToken, files(id, name, parents)',
      pageSize: 100,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      allBudgets.push({ id: f.id!, name: f.name!, parents: f.parents ?? [] });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  // Also search for "Budget" (capital)
  pageToken = undefined;
  do {
    const res = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.spreadsheet' and name contains 'Budget'",
      fields: 'nextPageToken, files(id, name, parents)',
      pageSize: 100,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      if (!allBudgets.find(b => b.id === f.id)) {
        allBudgets.push({ id: f.id!, name: f.name!, parents: f.parents ?? [] });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  // Also search for "master" spreadsheets
  pageToken = undefined;
  do {
    const res = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.spreadsheet' and name contains 'master'",
      fields: 'nextPageToken, files(id, name, parents)',
      pageSize: 100,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      if (!allBudgets.find(b => b.id === f.id)) {
        allBudgets.push({ id: f.id!, name: f.name!, parents: f.parents ?? [] });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  console.log(`Found ${allBudgets.length} budget/master spreadsheets in entire Drive.\n`);

  // Resolve parent folder names
  const parentCache: Record<string, string> = {};
  async function getParentPath(fileId: string): Promise<string> {
    if (parentCache[fileId]) return parentCache[fileId];
    try {
      const res = await drive.files.get({ fileId, fields: 'name, parents' });
      const name = res.data.name || '?';
      const grandParents = res.data.parents ?? [];
      if (grandParents.length > 0 && grandParents[0] !== DRIVE_ROOT) {
        const parentPath = await getParentPath(grandParents[0]);
        parentCache[fileId] = `${parentPath}/${name}`;
      } else {
        parentCache[fileId] = name;
      }
      return parentCache[fileId];
    } catch {
      return '(unknown)';
    }
  }

  // Print all found sheets with paths
  console.log('All budget spreadsheets found:');
  for (const s of allBudgets) {
    const parentPath = s.parents.length > 0 ? await getParentPath(s.parents[0]) : '(root)';
    console.log(`  ${parentPath} / ${s.name}`);
  }
  console.log('');

  // 3. Read key cells from sheets with "Purchase Budget" tab
  console.log('='.repeat(100));
  console.log('Scanning for filled-in budget data...');
  console.log('='.repeat(100));

  const tabsToCheck = ['Purchase Budget', 'Sell + Buy', 'Buy Investment Property', 'Refinance Budget', 'Refinance Debt Consol Budget'];

  const results: Array<{
    name: string;
    path: string;
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

  let scanned = 0;
  for (const sheet of allBudgets) {
    try {
      const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId: sheet.id,
        fields: 'sheets.properties.title',
      });
      const tabs = meta.data.sheets?.map(s => s.properties?.title!) ?? [];

      for (const tabName of tabsToCheck) {
        if (!tabs.includes(tabName)) continue;

        // Different cell layouts for different tabs
        let ranges: string[];
        if (tabName === 'Refinance Budget') {
          ranges = [
            `'${tabName}'!B3`,  // Amortization
            `'${tabName}'!B6`,  // Rate
            `'${tabName}'!B9`,  // Property Value
            `'${tabName}'!B7`,  // Property Taxes
            `'${tabName}'!B8`,  // Equity %
          ];
        } else if (tabName === 'Refinance Debt Consol Budget') {
          ranges = [
            `'${tabName}'!C3`,  // Amortization
            `'${tabName}'!C6`,  // Rate
            `'${tabName}'!C9`,  // Property Value
          ];
        } else {
          // Purchase-type tabs
          ranges = [
            `'${tabName}'!B4`, `'${tabName}'!E4`,
            `'${tabName}'!B7`, `'${tabName}'!E7`,
            `'${tabName}'!B8`,
            `'${tabName}'!B9`,
            `'${tabName}'!B10`, `'${tabName}'!E10`,
            `'${tabName}'!B13`,
            `'${tabName}'!B33`, `'${tabName}'!B34`, `'${tabName}'!B35`,
          ];
        }

        const data = await sheetsApi.spreadsheets.values.batchGet({
          spreadsheetId: sheet.id,
          ranges,
          valueRenderOption: 'FORMATTED_VALUE',
        });

        const vals = data.data.valueRanges?.map(r => r.values?.[0]?.[0] ?? '') ?? [];

        if (tabName === 'Refinance Budget' || tabName === 'Refinance Debt Consol Budget') {
          const propValue = tabName === 'Refinance Budget' ? vals[2] : vals[2];
          if (!propValue || propValue === '$0.00' || propValue === '') continue;
          const parentPath = sheet.parents.length > 0 ? await getParentPath(sheet.parents[0]) : '(root)';
          results.push({
            name: sheet.name,
            path: parentPath,
            tab: tabName,
            purchasePrice: propValue,
            rate: tabName === 'Refinance Budget' ? (vals[1] || '') : (vals[1] || ''),
            amortization: tabName === 'Refinance Budget' ? (vals[0] || '') : (vals[0] || ''),
            fthb: 'n/a',
            location: 'n/a',
            propertyTaxes: tabName === 'Refinance Budget' ? (vals[3] || '') : '',
            condoFees: '', insurance: '', utilities: '',
          });
        } else {
          const price = vals[8] || '$0.00';
          if (price === '$0.00' || price === '' || price === '$0') continue;
          const parentPath = sheet.parents.length > 0 ? await getParentPath(sheet.parents[0]) : '(root)';
          results.push({
            name: sheet.name,
            path: parentPath,
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
      }

      scanned++;
      if (scanned % 5 === 0) {
        console.log(`  Scanned ${scanned}/${allBudgets.length}...`);
      }
    } catch (err) {
      // Skip
    }
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`Found ${results.length} budget sheets with actual data:\n`);

  for (const r of results) {
    console.log(`${r.path} / ${r.name} [${r.tab}]`);
    console.log(`  Price/Value: ${r.purchasePrice} | Rate: ${r.rate} | Amort: ${r.amortization} | FTHB: ${r.fthb}`);
    console.log(`  Location: ${r.location} | Taxes: ${r.propertyTaxes}`);
    console.log(`  Condo: ${r.condoFees} | Insurance: ${r.insurance} | Utilities: ${r.utilities}`);
    console.log('');
  }

  // Aggregate
  console.log('='.repeat(100));
  console.log('AGGREGATE ANALYSIS:');
  console.log('='.repeat(100));

  const countFreq = (arr: string[]) => {
    const freq: Record<string, number> = {};
    for (const v of arr) freq[v] = (freq[v] || 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1]);
  };

  const rates = results.map(r => r.rate).filter(r => r && r !== '0.00%');
  const amorts = results.map(r => r.amortization).filter(a => a);
  const locations = results.map(r => r.location).filter(l => l && l !== 'n/a');
  const fthbs = results.map(r => r.fthb).filter(f => f && f !== 'n/a');
  const condos = results.map(r => r.condoFees).filter(c => c && c !== '$0.00' && c !== '');
  const insurances = results.map(r => r.insurance).filter(i => i && i !== '$0.00' && i !== '');
  const utilitiesArr = results.map(r => r.utilities).filter(u => u && u !== '$0.00' && u !== '');
  const taxes = results.map(r => r.propertyTaxes).filter(t => t && t !== '$0.00' && t !== '');

  console.log('\nRate frequency:');
  for (const [val, count] of countFreq(rates)) console.log(`  ${val}: ${count}x`);

  console.log('\nAmortization frequency:');
  for (const [val, count] of countFreq(amorts)) console.log(`  ${val}: ${count}x`);

  console.log('\nLocation frequency:');
  for (const [val, count] of countFreq(locations)) console.log(`  ${val}: ${count}x`);

  console.log('\nFTHB frequency:');
  for (const [val, count] of countFreq(fthbs)) console.log(`  ${val}: ${count}x`);

  console.log('\nCondo fees:');
  for (const [val, count] of countFreq(condos)) console.log(`  ${val}: ${count}x`);

  console.log('\nInsurance:');
  for (const [val, count] of countFreq(insurances)) console.log(`  ${val}: ${count}x`);

  console.log('\nUtilities:');
  for (const [val, count] of countFreq(utilitiesArr)) console.log(`  ${val}: ${count}x`);

  console.log('\nProperty taxes:');
  for (const [val, count] of countFreq(taxes)) console.log(`  ${val}: ${count}x`);
}

main().catch(console.error);
