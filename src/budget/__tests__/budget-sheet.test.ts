/**
 * Budget Sheet Tests
 *
 * Tests for all budget sheet helpers and the main createBudgetSheet function.
 * External APIs (Drive, Sheets) are mocked at module level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Module-level mocks
// ============================================================================

const mockDriveFilesList = vi.fn();
const mockDriveFilesCopy = vi.fn();

vi.mock('../../classification/drive-client.js', () => ({
  getDriveClient: vi.fn(() => ({
    files: {
      list: mockDriveFilesList,
      copy: mockDriveFilesCopy,
    },
  })),
}));

const mockBatchUpdate = vi.fn();

vi.mock('../sheets-client.js', () => ({
  getSheetsClient: vi.fn(() => ({
    spreadsheets: {
      values: {
        batchUpdate: mockBatchUpdate,
      },
    },
  })),
}));

vi.mock('../config.js', () => ({
  budgetConfig: {
    templateId: 'template-123',
    enabled: true,
    defaults: {
      amortization: 30,
      insurance: 100,
      utilities: 200,
      equityToRemain: 0.2,
    },
  },
}));

import {
  selectBudgetTab,
  deriveFthbStatus,
  mapProvinceToLocation,
  buildSheetName,
  buildClientFolderName,
  buildCellUpdates,
  createBudgetSheet,
} from '../budget-sheet.js';
import { budgetConfig } from '../config.js';
import type { FinmoApplicationResponse, FinmoBorrower } from '../../checklist/types/index.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockFinmoApp(overrides?: {
  goal?: string;
  use?: string;
  intendedUseOfFunds?: string[];
  purchasePrice?: number;
  downPayment?: number;
  province?: string | null;
  borrowers?: Partial<FinmoBorrower>[];
  propertySelling?: boolean;
  propertyWorth?: number | null;
  propertyTaxes?: number | null;
  propertyMonthlyFees?: number | null;
}): FinmoApplicationResponse {
  const borrowers: FinmoBorrower[] = overrides?.borrowers?.map((b, i) => ({
    id: `b-${i + 1}`,
    applicationId: 'app-test',
    firstName: b.firstName ?? 'Jane',
    lastName: b.lastName ?? 'Doe',
    email: b.email ?? 'jane@test.com',
    phone: null,
    workPhone: null,
    firstTime: b.firstTime ?? true,
    sinNumber: '000000000',
    marital: 'single',
    birthDate: null,
    dependents: 0,
    isMainBorrower: b.isMainBorrower ?? i === 0,
    relationshipToMainBorrower: i === 0 ? null : 'spouse',
    incomes: [],
    addressSituations: [],
    addresses: [],
    creditReports: [],
    kycMethod: null,
    kycCompleted: null,
    isBusinessLegalEntity: false,
    pepAffiliated: false,
    createdAt: '2026-01-01T00:00:00Z',
  })) ?? [{
    id: 'b-1',
    applicationId: 'app-test',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@test.com',
    phone: null,
    workPhone: null,
    firstTime: true,
    sinNumber: '000000000',
    marital: 'single',
    birthDate: null,
    dependents: 0,
    isMainBorrower: true,
    relationshipToMainBorrower: null,
    incomes: [],
    addressSituations: [],
    addresses: [],
    creditReports: [],
    kycMethod: null,
    kycCompleted: null,
    isBusinessLegalEntity: false,
    pepAffiliated: false,
    createdAt: '2026-01-01T00:00:00Z',
  }];

  return {
    application: {
      id: 'app-test',
      goal: overrides?.goal ?? 'purchase',
      use: overrides?.use ?? 'owner_occupied',
      process: 'found_property',
      propertyId: 'prop-1',
      downPayment: overrides?.downPayment ?? 50000,
      closingDate: '2026-06-01',
      status: 'submitted',
      purchasePrice: overrides?.purchasePrice ?? 500000,
      mortgageAmountRequested: 450000,
      subjectPropertyProvince: overrides?.province !== undefined ? overrides.province : 'BC',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      comments: null,
      lenderSubmitStatus: null,
      applicationStatus: 'pre_qualified',
      mortgageClassifications: ['residential'],
      productType: null,
      intendedUseOfFunds: overrides?.intendedUseOfFunds ?? [],
      mortgageInfoType: null,
      esignStatus: null,
      creditConsentStatus: null,
    },
    applicant: {
      id: 'applicant-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@test.com',
      phoneNumber: null,
      city: null,
      state: null,
      country: null,
    },
    borrowers,
    incomes: [],
    properties: overrides?.propertySelling !== undefined || overrides?.propertyWorth !== undefined
      || overrides?.propertyTaxes !== undefined || overrides?.propertyMonthlyFees !== undefined
      ? [{
          id: 'prop-1',
          applicationId: 'app-test',
          createdAt: '2026-01-01T00:00:00Z',
          addressId: null,
          isSelling: overrides?.propertySelling ?? false,
          saleDownpaymentAmount: null,
          worth: overrides?.propertyWorth ?? null,
          annualTaxes: overrides?.propertyTaxes ?? null,
          monthlyFees: overrides?.propertyMonthlyFees ?? null,
          monthlyFeesOffset: null,
          use: 'owner_occupied',
          mortgaged: null,
          rentalIncome: 0,
          type: 'detached',
          tenure: 'freehold',
          numberOfUnits: null,
          purchasePrice: null,
          mortgages: [],
          owners: ['b-1'],
          constructionType: null,
          style: null,
          age: null,
          livingSpace: null,
          livingSpaceUnits: null,
          lotSize: null,
          lotSizeUnits: null,
          heat: null,
          waterInfo: null,
          sewageInfo: null,
          taxYear: null,
          paidBy: null,
          monthlyHeatingCosts: null,
          mlsListing: false,
          appraisedValue: null,
          appraisalDate: null,
          environmentalHazard: false,
          includeExpensesTdsCalculation: false,
        }]
      : [],
    assets: [],
    liabilities: [],
    addresses: [],
    addressSituations: [],
    creditReports: [],
    activities: [],
    agents: [],
    fees: [],
    teamMembers: [],
    users: [],
    referralLink: null,
    idVerificationRequests: [],
  };
}

// ============================================================================
// selectBudgetTab
// ============================================================================

describe('selectBudgetTab', () => {
  it('should return "Purchase Budget" for purchase + owner_occupied', () => {
    const app = createMockFinmoApp({ goal: 'purchase', use: 'owner_occupied' });
    expect(selectBudgetTab(app)).toBe('Purchase Budget');
  });

  it('should return "Sell+Buy" when a property isSelling', () => {
    const app = createMockFinmoApp({ goal: 'purchase', propertySelling: true });
    expect(selectBudgetTab(app)).toBe('Sell+Buy');
  });

  it('should return "Buy Investment Property" for purchase + rental', () => {
    const app = createMockFinmoApp({ goal: 'purchase', use: 'rental' });
    expect(selectBudgetTab(app)).toBe('Buy Investment Property');
  });

  it('should return "Refinance Budget" for refinance', () => {
    const app = createMockFinmoApp({ goal: 'refinance' });
    expect(selectBudgetTab(app)).toBe('Refinance Budget');
  });

  it('should return "Refinance Debt Consol Budget" for refinance + debt_consolidation', () => {
    const app = createMockFinmoApp({
      goal: 'refinance',
      intendedUseOfFunds: ['debt_consolidation'],
    });
    expect(selectBudgetTab(app)).toBe('Refinance Debt Consol Budget');
  });

  it('should default to "Purchase Budget" for unknown goal', () => {
    const app = createMockFinmoApp({ goal: 'unknown_goal' });
    expect(selectBudgetTab(app)).toBe('Purchase Budget');
  });
});

// ============================================================================
// deriveFthbStatus
// ============================================================================

describe('deriveFthbStatus', () => {
  it('should return "all" when all borrowers are first-time', () => {
    const borrowers = [
      { firstTime: true },
      { firstTime: true },
    ] as FinmoBorrower[];
    expect(deriveFthbStatus(borrowers)).toBe('all');
  });

  it('should return "co" when some borrowers are first-time', () => {
    const borrowers = [
      { firstTime: true },
      { firstTime: false },
    ] as FinmoBorrower[];
    expect(deriveFthbStatus(borrowers)).toBe('co');
  });

  it('should return "none" when no borrowers are first-time', () => {
    const borrowers = [
      { firstTime: false },
      { firstTime: false },
    ] as FinmoBorrower[];
    expect(deriveFthbStatus(borrowers)).toBe('none');
  });

  it('should return "none" for empty borrowers array', () => {
    expect(deriveFthbStatus([])).toBe('none');
  });
});

// ============================================================================
// mapProvinceToLocation
// ============================================================================

describe('mapProvinceToLocation', () => {
  it('should map BC to "British Columbia"', () => {
    expect(mapProvinceToLocation('BC')).toBe('British Columbia');
  });

  it('should map ON to "Ontario"', () => {
    expect(mapProvinceToLocation('ON')).toBe('Ontario');
  });

  it('should map ON + Toronto city to "Toronto"', () => {
    expect(mapProvinceToLocation('ON', 'Toronto')).toBe('Toronto');
  });

  it('should map QC + Montreal city to "Montreal"', () => {
    expect(mapProvinceToLocation('QC', 'Montreal')).toBe('Montreal');
  });

  it('should map AB to "Alberta"', () => {
    expect(mapProvinceToLocation('AB')).toBe('Alberta');
  });

  it('should return empty string for null province', () => {
    expect(mapProvinceToLocation(null)).toBe('');
  });

  it('should return empty string for unknown province code', () => {
    expect(mapProvinceToLocation('XX')).toBe('');
  });

  it('should be case-insensitive for province code', () => {
    expect(mapProvinceToLocation('bc')).toBe('British Columbia');
  });
});

// ============================================================================
// buildSheetName
// ============================================================================

describe('buildSheetName', () => {
  it('should return "FirstName Budget" for single borrower', () => {
    const app = createMockFinmoApp({
      borrowers: [{ firstName: 'Megan', lastName: 'Smith' }],
    });
    expect(buildSheetName(app.borrowers)).toBe('Megan Budget');
  });

  it('should return "First1 & First2 Budget" for two borrowers', () => {
    const app = createMockFinmoApp({
      borrowers: [
        { firstName: 'Kevin', lastName: 'Jones' },
        { firstName: 'Randi', lastName: 'Jones' },
      ],
    });
    expect(buildSheetName(app.borrowers)).toBe('Kevin & Randi Budget');
  });

  it('should return "LastName Family Budget" for 3+ borrowers', () => {
    const app = createMockFinmoApp({
      borrowers: [
        { firstName: 'Marco', lastName: 'Malito', isMainBorrower: true },
        { firstName: 'Sofia', lastName: 'Malito' },
        { firstName: 'Luca', lastName: 'Malito' },
      ],
    });
    expect(buildSheetName(app.borrowers)).toBe('Malito Family Budget');
  });

  it('should return "Budget" for empty borrowers', () => {
    expect(buildSheetName([])).toBe('Budget');
  });
});

// ============================================================================
// buildClientFolderName
// ============================================================================

describe('buildClientFolderName', () => {
  it('should return "LastName, FirstName" for single borrower', () => {
    const app = createMockFinmoApp({
      borrowers: [{ firstName: 'Jane', lastName: 'Doe' }],
    });
    expect(buildClientFolderName(app.borrowers)).toBe('Doe, Jane');
  });

  it('should return "LastName, First1/First2" for couple with same last name', () => {
    const app = createMockFinmoApp({
      borrowers: [
        { firstName: 'Kevin', lastName: 'Jones' },
        { firstName: 'Randi', lastName: 'Jones' },
      ],
    });
    expect(buildClientFolderName(app.borrowers)).toBe('Jones, Kevin/Randi');
  });

  it('should return "Last1/Last2, First1/First2" for couple with different last names', () => {
    const app = createMockFinmoApp({
      borrowers: [
        { firstName: 'John', lastName: 'Smith' },
        { firstName: 'Jane', lastName: 'Doe' },
      ],
    });
    expect(buildClientFolderName(app.borrowers)).toBe('Smith/Doe, John/Jane');
  });
});

// ============================================================================
// buildCellUpdates
// ============================================================================

describe('buildCellUpdates', () => {
  it('should build correct updates for Purchase Budget tab', () => {
    const app = createMockFinmoApp({
      purchasePrice: 600000,
      downPayment: 120000,
      province: 'BC',
    });
    const updates = buildCellUpdates(app, 'Purchase Budget');

    // Purchase price
    const priceUpdate = updates.find(u => u.range.includes('B13'));
    expect(priceUpdate).toBeDefined();
    expect(priceUpdate!.values[0]).toEqual([600000, 600000, 600000, 600000]);

    // Down payment
    const dpUpdate = updates.find(u => u.range.includes('B14'));
    expect(dpUpdate).toBeDefined();
    expect(dpUpdate!.values[0]).toEqual([120000, 120000, 120000, 120000]);

    // Amortization
    const amortUpdate = updates.find(u => u.range.includes('B4'));
    expect(amortUpdate).toBeDefined();
    expect(amortUpdate!.values[0]).toEqual([30, 30, 30, 30]);

    // FTHB
    const fthbUpdate = updates.find(u => u.range.includes('B8'));
    expect(fthbUpdate).toBeDefined();
    expect(fthbUpdate!.values[0]).toEqual(['all', 'all', 'all', 'all']);

    // Location
    const locationUpdate = updates.find(u => u.range.includes('B10'));
    expect(locationUpdate).toBeDefined();
    expect(locationUpdate!.values[0]).toEqual([
      'British Columbia', 'British Columbia', 'British Columbia', 'British Columbia',
    ]);
  });

  it('should build correct updates for Refinance Budget tab', () => {
    const app = createMockFinmoApp({
      goal: 'refinance',
      propertyWorth: 800000,
      propertyTaxes: 5000,
    });
    const updates = buildCellUpdates(app, 'Refinance Budget');

    // Amortization
    const amortUpdate = updates.find(u => u.range.includes('B3'));
    expect(amortUpdate).toBeDefined();
    expect(amortUpdate!.values[0]).toEqual([30]);

    // Property Value
    const worthUpdate = updates.find(u => u.range.includes('B9'));
    expect(worthUpdate).toBeDefined();
    expect(worthUpdate!.values[0]).toEqual([800000]);

    // Annual Taxes
    const taxUpdate = updates.find(u => u.range.includes('B7'));
    expect(taxUpdate).toBeDefined();
    expect(taxUpdate!.values[0]).toEqual([5000]);

    // Equity to remain
    const equityUpdate = updates.find(u => u.range.includes('B8'));
    expect(equityUpdate).toBeDefined();
    expect(equityUpdate!.values[0]).toEqual([0.2]);
  });

  it('should default to 0 for missing refinance property data', () => {
    const app = createMockFinmoApp({ goal: 'refinance' });
    const updates = buildCellUpdates(app, 'Refinance Budget');

    const worthUpdate = updates.find(u => u.range.includes('B9'));
    expect(worthUpdate!.values[0]).toEqual([0]);
  });

  it('should include monthly fees from property data', () => {
    const app = createMockFinmoApp({ propertyMonthlyFees: 350 });
    const updates = buildCellUpdates(app, 'Purchase Budget');

    const condoUpdate = updates.find(u => u.range.includes('B33'));
    expect(condoUpdate!.values[0]).toEqual([350, 350, 350, 350]);
  });

  it('should use property annualTaxes in E9 when available', () => {
    const app = createMockFinmoApp({ propertyTaxes: 4500 });
    const updates = buildCellUpdates(app, 'Purchase Budget');

    const taxUpdate = updates.find(u => u.range.includes('E9'));
    expect(taxUpdate).toBeDefined();
    expect(taxUpdate!.values[0]).toEqual([4500]);
  });
});

// ============================================================================
// createBudgetSheet
// ============================================================================

describe('createBudgetSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should copy template, select tab, and write cell updates (happy path)', async () => {
    mockDriveFilesList.mockResolvedValue({ data: { files: [] } });
    mockDriveFilesCopy.mockResolvedValue({ data: { id: 'new-sheet-123' } });
    mockBatchUpdate.mockResolvedValue({});

    const app = createMockFinmoApp({ purchasePrice: 500000, downPayment: 100000 });
    const result = await createBudgetSheet(app, 'folder-abc');

    expect(result).toEqual({
      spreadsheetId: 'new-sheet-123',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-sheet-123',
      tabName: 'Purchase Budget',
      prefilled: true,
    });

    // Verify template was copied to client folder
    expect(mockDriveFilesCopy).toHaveBeenCalledWith({
      fileId: 'template-123',
      requestBody: {
        name: 'Jane Budget',
        parents: ['folder-abc'],
      },
      fields: 'id',
    });

    // Verify cell updates were written
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'new-sheet-123',
        requestBody: expect.objectContaining({
          valueInputOption: 'USER_ENTERED',
        }),
      }),
    );
  });

  it('should skip creation when existing budget sheet found (dedup)', async () => {
    mockDriveFilesList.mockResolvedValue({
      data: { files: [{ id: 'existing-sheet-456', name: 'Jane Budget' }] },
    });

    const app = createMockFinmoApp();
    const result = await createBudgetSheet(app, 'folder-abc');

    expect(result).toEqual({
      spreadsheetId: 'existing-sheet-456',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/existing-sheet-456',
      tabName: 'existing',
      prefilled: false,
    });

    // Should NOT copy template or write cells
    expect(mockDriveFilesCopy).not.toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('should throw when kill switch is disabled', async () => {
    const originalEnabled = budgetConfig.enabled;
    (budgetConfig as any).enabled = false;

    const app = createMockFinmoApp();
    await expect(createBudgetSheet(app, 'folder-abc')).rejects.toThrow(
      'Budget sheet creation is disabled',
    );

    (budgetConfig as any).enabled = originalEnabled;
  });

  it('should handle missing purchasePrice gracefully', async () => {
    mockDriveFilesList.mockResolvedValue({ data: { files: [] } });
    mockDriveFilesCopy.mockResolvedValue({ data: { id: 'new-sheet-789' } });
    mockBatchUpdate.mockResolvedValue({});

    const app = createMockFinmoApp({ purchasePrice: 0, downPayment: 0 });
    const result = await createBudgetSheet(app, 'folder-abc');

    expect(result.prefilled).toBe(true);
    // Should still have default updates (amortization, FTHB, etc.) but no price/DP updates
    const batchCall = mockBatchUpdate.mock.calls[0][0];
    const ranges = batchCall.requestBody.data.map((d: any) => d.range);
    expect(ranges).not.toContain(expect.stringContaining('B13'));
    expect(ranges).not.toContain(expect.stringContaining('B14'));
  });
});
