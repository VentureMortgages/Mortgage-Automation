/**
 * Budget Sheet Creator
 *
 * Core logic for auto-creating a Google Sheets budget from a Finmo application.
 * Copies the master template, selects the correct tab, and pre-fills cells
 * with Finmo data + sensible defaults from Taylor's historical patterns.
 *
 * Main export: createBudgetSheet(finmoApp, clientFolderId)
 *
 * Safety:
 * - Kill switch via BUDGET_SHEET_ENABLED=false
 * - Dedup check: skips if a "Budget" spreadsheet already exists in the client folder
 * - No PII in logs: only logs spreadsheetId and tab name
 */

import { budgetConfig } from './config.js';
import { getSheetsClient } from './sheets-client.js';
import { getDriveClient } from '../classification/drive-client.js';
import type { FinmoApplicationResponse, FinmoBorrower, FinmoProperty } from '../checklist/types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetSheetResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  tabName: string;
  prefilled: boolean;
}

export interface CellUpdate {
  range: string;
  values: (string | number)[][];
}

// ---------------------------------------------------------------------------
// Province Mapping
// ---------------------------------------------------------------------------

const PROVINCE_MAP: Record<string, string> = {
  BC: 'British Columbia',
  ON: 'Ontario',
  AB: 'Alberta',
  MB: 'Manitoba',
  SK: 'Saskatchewan',
  QC: 'Quebec',
  NL: 'Newfoundland',
  NB: 'New Brunswick',
  PE: 'P.E.I.',
  NS: 'Nova Scotia',
};

const TORONTO_CITIES = ['toronto', 'north york', 'scarborough', 'etobicoke', 'york'];
const MONTREAL_CITIES = ['montreal', 'montréal', 'laval', 'longueuil'];

/**
 * Maps a province code + optional city to the location string used in the budget sheet.
 */
export function mapProvinceToLocation(provinceCode: string | null, city?: string | null): string {
  if (!provinceCode) return '';

  const code = provinceCode.toUpperCase();
  const cityLower = city?.toLowerCase()?.trim() ?? '';

  // Special city-based overrides
  if (code === 'ON' && TORONTO_CITIES.some(c => cityLower.includes(c))) {
    return 'Toronto';
  }
  if (code === 'QC' && MONTREAL_CITIES.some(c => cityLower.includes(c))) {
    return 'Montreal';
  }

  return PROVINCE_MAP[code] ?? '';
}

// ---------------------------------------------------------------------------
// FTHB Status
// ---------------------------------------------------------------------------

/**
 * Derives First-Time Home Buyer status from borrower data.
 * - All borrowers firstTime=true → "all"
 * - Some firstTime=true → "co"
 * - None firstTime=true → "none"
 */
export function deriveFthbStatus(borrowers: FinmoBorrower[]): 'all' | 'co' | 'none' {
  if (borrowers.length === 0) return 'none';

  const firstTimeCount = borrowers.filter(b => b.firstTime).length;

  if (firstTimeCount === borrowers.length) return 'all';
  if (firstTimeCount > 0) return 'co';
  return 'none';
}

// ---------------------------------------------------------------------------
// Tab Selection
// ---------------------------------------------------------------------------

/** Budget tab names that match the template exactly */
export type BudgetTabName =
  | 'Purchase Budget'
  | 'Sell+Buy'
  | 'Buy Investment Property'
  | 'Refinance Budget'
  | 'Refinance Debt Consol Budget';

/**
 * Selects the correct budget tab based on application goal, use, and properties.
 */
export function selectBudgetTab(finmoApp: FinmoApplicationResponse): BudgetTabName {
  const { goal, use, intendedUseOfFunds } = finmoApp.application;

  if (goal === 'refinance') {
    if (intendedUseOfFunds?.includes('debt_consolidation')) {
      return 'Refinance Debt Consol Budget';
    }
    return 'Refinance Budget';
  }

  if (goal === 'purchase') {
    // Check if any property is being sold → Sell+Buy
    const hasSelling = finmoApp.properties.some(p => p.isSelling);
    if (hasSelling) return 'Sell+Buy';

    // Investment/rental property
    if (use === 'rental') return 'Buy Investment Property';

    return 'Purchase Budget';
  }

  // Default fallback
  return 'Purchase Budget';
}

// ---------------------------------------------------------------------------
// Sheet Naming
// ---------------------------------------------------------------------------

/**
 * Builds the sheet name from borrower names following Taylor's convention:
 * - Single borrower: "FirstName Budget"
 * - Two borrowers: "First1 & First2 Budget"
 * - 3+ borrowers: "LastName Family Budget"
 */
export function buildSheetName(borrowers: FinmoBorrower[]): string {
  if (borrowers.length === 0) return 'Budget';

  if (borrowers.length === 1) {
    return `${borrowers[0].firstName} Budget`;
  }

  if (borrowers.length === 2) {
    return `${borrowers[0].firstName} & ${borrowers[1].firstName} Budget`;
  }

  // 3+ borrowers: use main borrower's last name
  const main = borrowers.find(b => b.isMainBorrower) ?? borrowers[0];
  return `${main.lastName} Family Budget`;
}

// ---------------------------------------------------------------------------
// Client Folder Name
// ---------------------------------------------------------------------------

/**
 * Builds client folder name from borrower data (matches Drive convention).
 * - Single: "LastName, FirstName"
 * - Two, same last name: "LastName, First1/First2"
 * - Two, different last names: "Last1/Last2, First1/First2"
 */
export function buildClientFolderName(borrowers: FinmoBorrower[]): string {
  if (borrowers.length === 0) return 'Unknown Client';

  if (borrowers.length === 1) {
    return `${borrowers[0].lastName}, ${borrowers[0].firstName}`;
  }

  const firstNames = borrowers.map(b => b.firstName).join('/');

  const uniqueLastNames = [...new Set(borrowers.map(b => b.lastName))];
  if (uniqueLastNames.length === 1) {
    return `${uniqueLastNames[0]}, ${firstNames}`;
  }

  const lastNames = borrowers.map(b => b.lastName).join('/');
  return `${lastNames}, ${firstNames}`;
}

// ---------------------------------------------------------------------------
// Cell Updates
// ---------------------------------------------------------------------------

const PURCHASE_TABS = new Set<BudgetTabName>([
  'Purchase Budget',
  'Sell+Buy',
  'Buy Investment Property',
]);

/**
 * Builds cell updates for the selected budget tab.
 * Returns an array of {range, values} for sheets.spreadsheets.values.batchUpdate.
 */
export function buildCellUpdates(
  finmoApp: FinmoApplicationResponse,
  tabName: BudgetTabName,
): CellUpdate[] {
  const updates: CellUpdate[] = [];
  const app = finmoApp.application;
  const borrowers = finmoApp.borrowers;
  const property = finmoApp.properties[0] as FinmoProperty | undefined;

  if (tabName === 'Refinance Budget' || tabName === 'Refinance Debt Consol Budget') {
    return buildRefinanceUpdates(tabName, app, property);
  }

  // Purchase-type tabs (Purchase Budget, Sell+Buy, Buy Investment Property)
  if (PURCHASE_TABS.has(tabName)) {
    return buildPurchaseUpdates(tabName, app, borrowers, property);
  }

  return updates;
}

function buildPurchaseUpdates(
  tabName: BudgetTabName,
  app: FinmoApplicationResponse['application'],
  borrowers: FinmoBorrower[],
  property: FinmoProperty | undefined,
): CellUpdate[] {
  const updates: CellUpdate[] = [];
  const t = escapeTabName(tabName);

  // Purchase Price (B13:E13)
  if (app.purchasePrice) {
    updates.push({
      range: `'${t}'!B13:E13`,
      values: [[app.purchasePrice, app.purchasePrice, app.purchasePrice, app.purchasePrice]],
    });
  }

  // Deposit / Down Payment (B14:E14)
  if (app.downPayment) {
    updates.push({
      range: `'${t}'!B14:E14`,
      values: [[app.downPayment, app.downPayment, app.downPayment, app.downPayment]],
    });
  }

  // Amortization (B4:E4)
  updates.push({
    range: `'${t}'!B4:E4`,
    values: [[
      budgetConfig.defaults.amortization,
      budgetConfig.defaults.amortization,
      budgetConfig.defaults.amortization,
      budgetConfig.defaults.amortization,
    ]],
  });

  // FTHB status (B8:E8)
  const fthb = deriveFthbStatus(borrowers);
  updates.push({
    range: `'${t}'!B8:E8`,
    values: [[fthb, fthb, fthb, fthb]],
  });

  // Location (B10:E10)
  const city = getCity(borrowers, property);
  const location = mapProvinceToLocation(app.subjectPropertyProvince, city);
  if (location) {
    updates.push({
      range: `'${t}'!B10:E10`,
      values: [[location, location, location, location]],
    });
  }

  // Condo Fees (B33:E33)
  const condoFees = property?.monthlyFees ?? 0;
  updates.push({
    range: `'${t}'!B33:E33`,
    values: [[condoFees, condoFees, condoFees, condoFees]],
  });

  // Insurance (B34:E34)
  updates.push({
    range: `'${t}'!B34:E34`,
    values: [[
      budgetConfig.defaults.insurance,
      budgetConfig.defaults.insurance,
      budgetConfig.defaults.insurance,
      budgetConfig.defaults.insurance,
    ]],
  });

  // Utilities (B35:E35)
  updates.push({
    range: `'${t}'!B35:E35`,
    values: [[
      budgetConfig.defaults.utilities,
      budgetConfig.defaults.utilities,
      budgetConfig.defaults.utilities,
      budgetConfig.defaults.utilities,
    ]],
  });

  // Property Taxes col E: use annualTaxes if available (B9:D9 has formula, E9 is manual)
  if (property?.annualTaxes) {
    updates.push({
      range: `'${t}'!E9`,
      values: [[property.annualTaxes]],
    });
  }

  return updates;
}

function buildRefinanceUpdates(
  tabName: BudgetTabName,
  app: FinmoApplicationResponse['application'],
  property: FinmoProperty | undefined,
): CellUpdate[] {
  const updates: CellUpdate[] = [];
  const t = escapeTabName(tabName);

  // Amortization (B3)
  updates.push({
    range: `'${t}'!B3`,
    values: [[budgetConfig.defaults.amortization]],
  });

  // Property Value (B9)
  const propertyValue = property?.worth ?? 0;
  updates.push({
    range: `'${t}'!B9`,
    values: [[propertyValue]],
  });

  // Annual Property Taxes (B7)
  const annualTaxes = property?.annualTaxes ?? 0;
  updates.push({
    range: `'${t}'!B7`,
    values: [[annualTaxes]],
  });

  // Equity to Remain % (B8)
  updates.push({
    range: `'${t}'!B8`,
    values: [[budgetConfig.defaults.equityToRemain]],
  });

  return updates;
}

/**
 * Escapes tab names for use in A1 notation (single quotes around tab name).
 * The surrounding quotes are added by the caller; this escapes internal quotes.
 */
function escapeTabName(name: string): string {
  return name.replace(/'/g, "''");
}

/**
 * Tries to derive the city from property address or borrower address.
 */
function getCity(
  borrowers: FinmoBorrower[],
  property: FinmoProperty | undefined,
): string | null {
  // We don't have direct access to addresses from the property here,
  // but the applicant city is often available. For now, return null
  // and let the province mapping handle it.
  // In the future, we could look up the address from finmoApp.addresses.
  return null;
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Creates a budget sheet from the master template for a new Finmo application.
 *
 * Steps:
 * 1. Check kill switch
 * 2. Derive sheet name from borrower names
 * 3. Dedup check: skip if "Budget" spreadsheet already exists in folder
 * 4. Copy template to client folder
 * 5. Select correct tab
 * 6. Build and write cell updates
 * 7. Return result with spreadsheet ID and URL
 *
 * @param finmoApp - Full Finmo application response
 * @param clientFolderId - Google Drive folder ID for the client
 * @returns BudgetSheetResult with spreadsheet metadata
 * @throws Error if budget creation is disabled or API calls fail
 */
export async function createBudgetSheet(
  finmoApp: FinmoApplicationResponse,
  clientFolderId: string,
): Promise<BudgetSheetResult> {
  // 1. Kill switch
  if (!budgetConfig.enabled) {
    throw new Error('Budget sheet creation is disabled (BUDGET_SHEET_ENABLED=false)');
  }

  const drive = getDriveClient();
  const sheets = getSheetsClient();

  // 2. Derive sheet name
  const sheetName = buildSheetName(finmoApp.borrowers);

  // 3. Dedup check — look for existing spreadsheet with "Budget" in name
  const existing = await drive.files.list({
    q:
      `name contains 'Budget' ` +
      `and '${clientFolderId}' in parents ` +
      `and mimeType = 'application/vnd.google-apps.spreadsheet' ` +
      `and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    const existingFile = existing.data.files[0];
    console.log('[budget] Existing budget sheet found, skipping creation', {
      existingId: existingFile.id,
    });
    return {
      spreadsheetId: existingFile.id!,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${existingFile.id}`,
      tabName: 'existing',
      prefilled: false,
    };
  }

  // 4. Copy template
  const copyResponse = await drive.files.copy({
    fileId: budgetConfig.templateId,
    requestBody: {
      name: sheetName,
      parents: [clientFolderId],
    },
    fields: 'id',
  });

  const spreadsheetId = copyResponse.data.id;
  if (!spreadsheetId) {
    throw new Error('Drive API returned no ID after copying budget template');
  }

  // 5. Select tab
  const tabName = selectBudgetTab(finmoApp);

  // 6. Build cell updates
  const cellUpdates = buildCellUpdates(finmoApp, tabName);

  // 7. Batch write
  if (cellUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: cellUpdates.map(u => ({
          range: u.range,
          values: u.values,
        })),
      },
    });
  }

  console.log('[budget] Budget sheet created', {
    spreadsheetId,
    tabName,
    cellsUpdated: cellUpdates.length,
  });

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    tabName,
    prefilled: true,
  };
}
