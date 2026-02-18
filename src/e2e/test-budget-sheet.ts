/**
 * E2E Test: Create a budget sheet from a real Finmo application
 *
 * Layer 2 integration test — bypasses BullMQ/Redis entirely.
 * Tests: Finmo API fetch → tab selection → template copy → cell pre-fill.
 *
 * Usage:
 *   npx tsx src/e2e/test-budget-sheet.ts                    # uses first active app
 *   npx tsx src/e2e/test-budget-sheet.ts <applicationId>    # specific app
 *   npx tsx src/e2e/test-budget-sheet.ts --dry-run           # preview without creating
 *   npx tsx src/e2e/test-budget-sheet.ts <appId> --cleanup   # create then delete
 *
 * What it does:
 *   1. Fetches a real Finmo application
 *   2. Resolves/creates a TEST client folder in Drive
 *   3. Selects the correct budget tab
 *   4. Copies the master template + pre-fills cells
 *   5. Reports the result with spreadsheet URL
 *   6. Optionally cleans up (--cleanup flag)
 *
 * Safety: Creates in a "TEST - ..." folder. Use --dry-run to preview only.
 *
 * Required env vars: FINMO_API_KEY, DRIVE_ROOT_FOLDER_ID, BUDGET_TEMPLATE_ID,
 * and either GOOGLE_REFRESH_TOKEN or GOOGLE_SERVICE_ACCOUNT_KEY.
 */

import 'dotenv/config';

// ---------------------------------------------------------------------------
// Env var checks
// ---------------------------------------------------------------------------

const REQUIRED_VARS = ['FINMO_API_KEY', 'DRIVE_ROOT_FOLDER_ID'];
const AUTH_VARS = ['GOOGLE_REFRESH_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_KEY'];

const missing = REQUIRED_VARS.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
if (!AUTH_VARS.some(k => process.env[k])) {
  console.error(`Need at least one of: ${AUTH_VARS.join(' or ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const cleanupFlag = args.includes('--cleanup');
const appIdArg = args.find(a => !a.startsWith('--'));

// ---------------------------------------------------------------------------
// Imports (after env checks)
// ---------------------------------------------------------------------------

import { fetchFinmoApplication } from '../webhook/finmo-client.js';
import { getDriveClient } from '../classification/drive-client.js';
import { findOrCreateFolder } from '../classification/filer.js';
import { budgetConfig } from '../budget/config.js';
import {
  createBudgetSheet,
  buildSheetName,
  buildClientFolderName,
  selectBudgetTab,
  buildCellUpdates,
  deriveFthbStatus,
  mapProvinceToLocation,
} from '../budget/budget-sheet.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findRecentApp(): Promise<string> {
  const teamId = process.env.FINMO_TEAM_ID;
  if (!teamId) {
    console.error('No applicationId provided and FINMO_TEAM_ID not set.');
    console.error('Usage: npx tsx src/e2e/test-budget-sheet.ts <applicationId>');
    process.exit(1);
  }

  const res = await fetch(
    `https://app.finmo.ca/api/v1/applications?teamId=${teamId}&page=1&pageSize=10`,
    { headers: { Authorization: `Bearer ${process.env.FINMO_API_KEY}` } },
  );

  if (!res.ok) {
    console.error(`Finmo API error: ${res.status}`);
    process.exit(1);
  }

  const apps = (await res.json()) as Array<{ id: string; applicationStatus: string; goal: string | null }>;
  const active = apps.find(a => a.applicationStatus === 'active' && a.goal);
  if (!active) {
    console.error('No active application with a goal found. Provide an applicationId manually.');
    process.exit(1);
  }

  return active.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== E2E Test: Budget Sheet Creation ===\n');

  if (dryRun) {
    console.log('Mode: DRY RUN — will preview but NOT create the spreadsheet.\n');
  }

  // --- Step 1: Resolve application ID ---
  console.log('--- Step 1: Resolving application ---');
  const applicationId = appIdArg ?? await findRecentApp();
  console.log(`  Application ID:  ${applicationId}\n`);

  // --- Step 2: Fetch from Finmo ---
  console.log('--- Step 2: Fetching Finmo application ---');
  const finmoApp = await fetchFinmoApplication(applicationId);

  const mainBorrower = finmoApp.borrowers.find(b => b.isMainBorrower) ?? finmoApp.borrowers[0];
  console.log(`  Goal:            ${finmoApp.application.goal}`);
  console.log(`  Use:             ${finmoApp.application.use ?? 'N/A'}`);
  console.log(`  Status:          ${finmoApp.application.applicationStatus}`);
  console.log(`  Borrowers:       ${finmoApp.borrowers.length}`);
  if (mainBorrower) {
    console.log(`  Main borrower:   ${mainBorrower.firstName} ${mainBorrower.lastName}`);
  }
  console.log(`  Purchase price:  ${finmoApp.application.purchasePrice ?? 'N/A'}`);
  console.log(`  Down payment:    ${finmoApp.application.downPayment ?? 'N/A'}`);
  console.log(`  Province:        ${finmoApp.application.subjectPropertyProvince ?? 'N/A'}`);
  console.log(`  Properties:      ${finmoApp.properties.length}`);
  console.log('');

  // --- Step 3: Preview budget configuration ---
  console.log('--- Step 3: Budget configuration preview ---');

  const sheetName = buildSheetName(finmoApp.borrowers);
  const folderName = buildClientFolderName(finmoApp.borrowers);
  const tabName = selectBudgetTab(finmoApp);
  const fthb = deriveFthbStatus(finmoApp.borrowers);
  const location = mapProvinceToLocation(finmoApp.application.subjectPropertyProvince);
  const cellUpdates = buildCellUpdates(finmoApp, tabName);

  console.log(`  Sheet name:      ${sheetName}`);
  console.log(`  Folder name:     ${folderName}`);
  console.log(`  Tab:             ${tabName}`);
  console.log(`  FTHB:            ${fthb}`);
  console.log(`  Location:        ${location || '(empty — no province)'}`);
  console.log(`  Template ID:     ${budgetConfig.templateId}`);
  console.log(`  Cell updates:    ${cellUpdates.length}`);
  console.log('');

  // Show cell updates detail
  console.log('  Cell updates detail:');
  for (const update of cellUpdates) {
    console.log(`    ${update.range} = ${JSON.stringify(update.values[0])}`);
  }
  console.log('');

  if (dryRun) {
    console.log('--- DRY RUN complete — no spreadsheet created. ---');
    console.log('Remove --dry-run to actually create the budget sheet.');
    return;
  }

  // --- Step 4: Create test folder ---
  console.log('--- Step 4: Creating test folder ---');
  const drive = getDriveClient();
  const driveRoot = process.env.DRIVE_ROOT_FOLDER_ID!;
  const testFolderName = `TEST - ${folderName}`;
  const testFolderId = await findOrCreateFolder(drive, testFolderName, driveRoot);
  console.log(`  Test folder:     ${testFolderName} (${testFolderId})`);
  console.log('');

  // --- Step 5: Create budget sheet ---
  console.log('--- Step 5: Creating budget sheet ---');
  const result = await createBudgetSheet(finmoApp, testFolderId);

  console.log(`  Spreadsheet ID:  ${result.spreadsheetId}`);
  console.log(`  Tab:             ${result.tabName}`);
  console.log(`  Pre-filled:      ${result.prefilled}`);
  console.log(`  URL:             ${result.spreadsheetUrl}`);
  console.log('');

  // --- Step 6: Cleanup (optional) ---
  if (cleanupFlag) {
    console.log('--- Step 6: Cleaning up ---');
    try {
      // Delete the spreadsheet
      await drive.files.delete({ fileId: result.spreadsheetId });
      console.log(`  Deleted sheet:   ${result.spreadsheetId}`);
      // Delete the test folder
      await drive.files.delete({ fileId: testFolderId });
      console.log(`  Deleted folder:  ${testFolderId}`);
    } catch (err) {
      console.error(`  Cleanup failed:  ${err instanceof Error ? err.message : err}`);
      console.error(`  Manual cleanup:  ${result.spreadsheetUrl}`);
    }
  } else {
    console.log(`Open the sheet:    ${result.spreadsheetUrl}`);
    console.log(`To clean up, run again with --cleanup`);
    console.log(`Or delete manually: https://drive.google.com/drive/folders/${testFolderId}`);
  }

  console.log('\nE2E test PASSED');
}

main().catch(err => {
  console.error('\nE2E test FAILED:', err.message);
  if (err.stack) {
    console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
  process.exit(1);
});
