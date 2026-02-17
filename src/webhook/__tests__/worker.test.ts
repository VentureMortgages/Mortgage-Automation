/**
 * Worker Orchestration Tests
 *
 * Tests the processJob function that orchestrates the full pipeline:
 * Finmo fetch -> checklist generation -> CRM sync -> email draft.
 *
 * All external dependencies are mocked:
 * - Finmo API client (finmo-client.ts)
 * - Checklist engine (checklist/engine/index.ts)
 * - CRM orchestrator (crm/index.ts)
 * - Email drafting (email/index.ts)
 * - Application config (config.ts)
 * - Redis/queue (queue.ts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Module-level mocks
// ============================================================================

const mockConfig = vi.hoisted(() => ({
  appConfig: {
    killSwitch: false,
    isDev: true,
    finmo: { apiKey: 'test-key', apiBase: 'https://test.finmo.ca/api/v1' },
    redis: { host: 'localhost', port: 6379 },
    server: { port: 3000 },
  },
}));

vi.mock('../../config.js', () => mockConfig);

vi.mock('../queue.js', () => ({
  createRedisConnection: vi.fn(() => ({})),
  QUEUE_NAME: 'finmo-webhooks',
}));

vi.mock('../finmo-client.js', () => ({
  fetchFinmoApplication: vi.fn(),
}));

vi.mock('../../checklist/engine/index.js', () => ({
  generateChecklist: vi.fn(),
}));

vi.mock('../../crm/index.js', () => ({
  syncChecklistToCrm: vi.fn(),
}));

vi.mock('../../email/index.js', () => ({
  createEmailDraft: vi.fn(),
}));

const mockBudgetConfig = vi.hoisted(() => ({
  budgetConfig: { enabled: false },
}));

vi.mock('../../budget/index.js', () => ({
  createBudgetSheet: vi.fn(),
  buildClientFolderName: vi.fn(() => 'Doe, Jane'),
  ...mockBudgetConfig,
}));

vi.mock('../../classification/drive-client.js', () => ({
  getDriveClient: vi.fn(() => ({})),
}));

vi.mock('../../classification/filer.js', () => ({
  findOrCreateFolder: vi.fn(() => Promise.resolve('folder-123')),
}));

// Prevent BullMQ from creating real connections
vi.mock('bullmq', () => ({
  Worker: vi.fn(),
  Job: vi.fn(),
}));

import { processJob } from '../worker.js';
import { fetchFinmoApplication } from '../finmo-client.js';
import { generateChecklist } from '../../checklist/engine/index.js';
import { syncChecklistToCrm } from '../../crm/index.js';
import { createEmailDraft } from '../../email/index.js';
import { createBudgetSheet } from '../../budget/index.js';
import type { FinmoApplicationResponse } from '../../checklist/types/index.js';
import type { GeneratedChecklist } from '../../checklist/types/index.js';
import type { SyncChecklistResult } from '../../crm/index.js';
import type { CreateEmailDraftResult } from '../../email/index.js';
import type { Job } from 'bullmq';
import type { JobData, ProcessingResult } from '../types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockFinmoApp(): FinmoApplicationResponse {
  return {
    application: {
      id: 'app-123',
      goal: 'purchase',
      use: 'owner_occupied',
      process: 'found_property',
      propertyId: 'prop-1',
      downPayment: 50000,
      closingDate: '2026-04-01',
      status: 'submitted',
      purchasePrice: 500000,
      mortgageAmountRequested: 450000,
      subjectPropertyProvince: 'BC',
      createdAt: '2026-01-15T00:00:00Z',
      updatedAt: '2026-01-16T00:00:00Z',
      comments: null,
      lenderSubmitStatus: null,
      applicationStatus: 'pre_qualified',
      mortgageClassifications: ['residential'],
      productType: 'type_a',
      intendedUseOfFunds: [],
      mortgageInfoType: null,
      esignStatus: null,
      creditConsentStatus: null,
    },
    applicant: {
      id: 'applicant-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phoneNumber: '555-0100',
      city: 'Vancouver',
      state: 'BC',
      country: 'CA',
    },
    borrowers: [
      {
        id: 'b-1',
        applicationId: 'app-123',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '555-0100',
        workPhone: null,
        firstTime: true,
        sinNumber: '123456789',
        marital: 'single',
        birthDate: '1990-01-01',
        dependents: 0,
        isMainBorrower: true,
        relationshipToMainBorrower: null,
        incomes: ['inc-1'],
        addressSituations: [],
        addresses: [],
        creditReports: [],
        kycMethod: null,
        kycCompleted: null,
        isBusinessLegalEntity: false,
        pepAffiliated: false,
        createdAt: '2026-01-15T00:00:00Z',
      },
    ],
    incomes: [
      {
        id: 'inc-1',
        applicationId: 'app-123',
        borrowerId: 'b-1',
        source: 'employed',
        income: 80000,
        incomeFrequency: 'annually',
        payType: 'salaried',
        business: 'Acme Corp',
        title: 'Developer',
        startDate: '2020-01-01',
        endDate: null,
        jobType: 'full_time',
        bonuses: false,
        selfPayType: null,
        active: true,
        businessType: null,
        industrySector: null,
        occupation: null,
        businessLine1: null,
        businessLine2: null,
        businessCity: null,
        businessState: null,
        businessCountry: null,
        businessPostCode: null,
        businessPhone: null,
        businessEmail: null,
        incomePeriodAmount: null,
        description: null,
        visibility: null,
      },
    ],
    properties: [],
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

function createMockChecklist(): GeneratedChecklist {
  return {
    applicationId: 'app-123',
    generatedAt: '2026-01-16T00:00:00Z',
    borrowerChecklists: [
      {
        borrowerId: 'b-1',
        borrowerName: 'Jane Doe',
        isMainBorrower: true,
        items: [
          {
            ruleId: 's1_employed_paystub',
            document: 'Recent paystub',
            displayName: '2 recent pay stubs (must show YTD earnings)',
            stage: 'PRE',
            forEmail: true,
            section: '1_income_employed_salary',
          },
        ],
      },
    ],
    propertyChecklists: [],
    sharedItems: [],
    internalFlags: [],
    warnings: ['Unknown field value: payType=commission_plus'],
    stats: {
      totalItems: 1,
      preItems: 1,
      fullItems: 0,
      perBorrowerItems: 1,
      sharedItems: 0,
      internalFlags: 0,
      warnings: 1,
    },
  };
}

function createMockCrmResult(): SyncChecklistResult {
  return {
    contactId: 'crm-contact-456',
    taskId: 'task-789',
    opportunityId: 'opp-101',
    fieldsUpdated: 5,
    errors: [],
  };
}

function createMockEmailResult(): CreateEmailDraftResult {
  return {
    draftId: 'draft-abc',
    subject: 'Documents Needed — Jane',
    recipientEmail: 'jane@example.com',
    bodyPreview: 'Hi Jane, here are the documents...',
  };
}

function createMockJob(overrides?: Partial<Job<JobData>>): Job<JobData> {
  return {
    id: 'job-1',
    data: { applicationId: 'app-123', receivedAt: '2026-01-16T00:00:00Z' },
    attemptsMade: 0,
    opts: { attempts: 5 },
    ...overrides,
  } as Job<JobData>;
}

// ============================================================================
// Tests
// ============================================================================

describe('processJob', () => {
  const mockFetch = vi.mocked(fetchFinmoApplication);
  const mockGenerate = vi.mocked(generateChecklist);
  const mockCrm = vi.mocked(syncChecklistToCrm);
  const mockEmail = vi.mocked(createEmailDraft);

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.appConfig.killSwitch = false;
  });

  it('should execute the full pipeline and return ProcessingResult', async () => {
    const finmoApp = createMockFinmoApp();
    const checklist = createMockChecklist();
    const crmResult = createMockCrmResult();
    const emailResult = createMockEmailResult();

    mockFetch.mockResolvedValue(finmoApp);
    mockGenerate.mockReturnValue(checklist);
    mockCrm.mockResolvedValue(crmResult);
    mockEmail.mockResolvedValue(emailResult);

    const job = createMockJob();
    const result = await processJob(job);

    expect(result).toEqual<ProcessingResult>({
      applicationId: 'app-123',
      contactId: 'crm-contact-456',
      draftId: 'draft-abc',
      budgetSheetId: null,
      warnings: ['Unknown field value: payType=commission_plus'],
      errors: [],
    });
  });

  it('should call fetchFinmoApplication with the correct applicationId', async () => {
    mockFetch.mockResolvedValue(createMockFinmoApp());
    mockGenerate.mockReturnValue(createMockChecklist());
    mockCrm.mockResolvedValue(createMockCrmResult());
    mockEmail.mockResolvedValue(createMockEmailResult());

    const job = createMockJob();
    await processJob(job);

    expect(mockFetch).toHaveBeenCalledWith('app-123');
  });

  it('should pass Finmo response to generateChecklist', async () => {
    const finmoApp = createMockFinmoApp();
    mockFetch.mockResolvedValue(finmoApp);
    mockGenerate.mockReturnValue(createMockChecklist());
    mockCrm.mockResolvedValue(createMockCrmResult());
    mockEmail.mockResolvedValue(createMockEmailResult());

    await processJob(createMockJob());

    expect(mockGenerate).toHaveBeenCalledWith(finmoApp);
  });

  it('should pass correct SyncChecklistInput to CRM', async () => {
    const finmoApp = createMockFinmoApp();
    const checklist = createMockChecklist();
    mockFetch.mockResolvedValue(finmoApp);
    mockGenerate.mockReturnValue(checklist);
    mockCrm.mockResolvedValue(createMockCrmResult());
    mockEmail.mockResolvedValue(createMockEmailResult());

    await processJob(createMockJob());

    expect(mockCrm).toHaveBeenCalledWith({
      checklist,
      borrowerEmail: 'jane@example.com',
      borrowerFirstName: 'Jane',
      borrowerLastName: 'Doe',
      borrowerPhone: '555-0100',
      finmoDealId: 'app-123',
    });
  });

  it('should pass correct CreateEmailDraftInput to email', async () => {
    const checklist = createMockChecklist();
    mockFetch.mockResolvedValue(createMockFinmoApp());
    mockGenerate.mockReturnValue(checklist);
    const crmResult = createMockCrmResult();
    mockCrm.mockResolvedValue(crmResult);
    mockEmail.mockResolvedValue(createMockEmailResult());

    await processJob(createMockJob());

    expect(mockEmail).toHaveBeenCalledWith({
      checklist,
      recipientEmail: 'jane@example.com',
      borrowerFirstNames: ['Jane'],
      contactId: 'crm-contact-456',
    });
  });

  it('should propagate Finmo API failure for BullMQ retry', async () => {
    mockFetch.mockRejectedValue(new Error('Finmo API error: 500 Internal Server Error for application app-123'));

    const job = createMockJob();
    await expect(processJob(job)).rejects.toThrow('Finmo API error: 500');

    // Downstream steps should NOT have been called
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockCrm).not.toHaveBeenCalled();
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('should throw descriptive error when no main borrower found', async () => {
    const finmoApp = createMockFinmoApp();
    finmoApp.borrowers = [
      { ...finmoApp.borrowers[0], isMainBorrower: false },
    ];
    mockFetch.mockResolvedValue(finmoApp);
    mockGenerate.mockReturnValue(createMockChecklist());

    const job = createMockJob();
    await expect(processJob(job)).rejects.toThrow('No main borrower found for application app-123');

    // CRM and email should NOT have been called
    expect(mockCrm).not.toHaveBeenCalled();
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('should propagate CRM sync failure for BullMQ retry', async () => {
    mockFetch.mockResolvedValue(createMockFinmoApp());
    mockGenerate.mockReturnValue(createMockChecklist());
    mockCrm.mockRejectedValue(new Error('CRM API timeout'));

    const job = createMockJob();
    await expect(processJob(job)).rejects.toThrow('CRM API timeout');

    // Email should NOT have been called
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('should propagate email draft failure for BullMQ retry', async () => {
    mockFetch.mockResolvedValue(createMockFinmoApp());
    mockGenerate.mockReturnValue(createMockChecklist());
    mockCrm.mockResolvedValue(createMockCrmResult());
    mockEmail.mockRejectedValue(new Error('Gmail API authentication failed'));

    const job = createMockJob();
    await expect(processJob(job)).rejects.toThrow('Gmail API authentication failed');
  });

  it('should throw when kill switch is active', async () => {
    mockConfig.appConfig.killSwitch = true;

    const job = createMockJob();
    await expect(processJob(job)).rejects.toThrow('Automation disabled by kill switch');

    // No pipeline steps should have been called
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockCrm).not.toHaveBeenCalled();
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('should execute pipeline steps in correct order', async () => {
    const callOrder: string[] = [];

    mockFetch.mockImplementation(async () => {
      callOrder.push('fetch');
      return createMockFinmoApp();
    });
    mockGenerate.mockImplementation(() => {
      callOrder.push('checklist');
      return createMockChecklist();
    });
    mockCrm.mockImplementation(async () => {
      callOrder.push('crm');
      return createMockCrmResult();
    });
    mockEmail.mockImplementation(async () => {
      callOrder.push('email');
      return createMockEmailResult();
    });

    await processJob(createMockJob());

    expect(callOrder).toEqual(['fetch', 'checklist', 'crm', 'email']);
  });

  it('should handle borrower with null phone (pass undefined to CRM)', async () => {
    const finmoApp = createMockFinmoApp();
    finmoApp.borrowers[0].phone = null;
    mockFetch.mockResolvedValue(finmoApp);
    mockGenerate.mockReturnValue(createMockChecklist());
    mockCrm.mockResolvedValue(createMockCrmResult());
    mockEmail.mockResolvedValue(createMockEmailResult());

    await processJob(createMockJob());

    expect(mockCrm).toHaveBeenCalledWith(
      expect.objectContaining({
        borrowerPhone: undefined,
      }),
    );
  });

  it('should include multiple borrower first names in email input', async () => {
    const finmoApp = createMockFinmoApp();
    finmoApp.borrowers.push({
      ...finmoApp.borrowers[0],
      id: 'b-2',
      firstName: 'John',
      lastName: 'Doe',
      isMainBorrower: false,
      relationshipToMainBorrower: 'spouse',
    });
    mockFetch.mockResolvedValue(finmoApp);
    mockGenerate.mockReturnValue(createMockChecklist());
    mockCrm.mockResolvedValue(createMockCrmResult());
    mockEmail.mockResolvedValue(createMockEmailResult());

    await processJob(createMockJob());

    expect(mockEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        borrowerFirstNames: ['Jane', 'John'],
      }),
    );
  });

  it('should include CRM errors in ProcessingResult', async () => {
    mockFetch.mockResolvedValue(createMockFinmoApp());
    mockGenerate.mockReturnValue(createMockChecklist());
    mockCrm.mockResolvedValue({
      ...createMockCrmResult(),
      errors: ['Task creation failed: timeout', 'Opportunity upsert failed: 500'],
    });
    mockEmail.mockResolvedValue(createMockEmailResult());

    const result = await processJob(createMockJob());

    expect(result.errors).toEqual([
      'Task creation failed: timeout',
      'Opportunity upsert failed: 500',
    ]);
  });

  describe('budget sheet step (step 5)', () => {
    const mockBudget = vi.mocked(createBudgetSheet);

    beforeEach(() => {
      mockFetch.mockResolvedValue(createMockFinmoApp());
      mockGenerate.mockReturnValue(createMockChecklist());
      mockCrm.mockResolvedValue(createMockCrmResult());
      mockEmail.mockResolvedValue(createMockEmailResult());
    });

    it('should create budget sheet when enabled and DRIVE_ROOT_FOLDER_ID set', async () => {
      mockBudgetConfig.budgetConfig.enabled = true;
      process.env.DRIVE_ROOT_FOLDER_ID = 'root-folder-id';
      mockBudget.mockResolvedValue({
        spreadsheetId: 'budget-sheet-001',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/budget-sheet-001',
        tabName: 'Purchase Budget',
        prefilled: true,
      });

      const result = await processJob(createMockJob());

      expect(result.budgetSheetId).toBe('budget-sheet-001');
      expect(mockBudget).toHaveBeenCalled();

      delete process.env.DRIVE_ROOT_FOLDER_ID;
      mockBudgetConfig.budgetConfig.enabled = false;
    });

    it('should not fail the job when budget sheet creation throws', async () => {
      mockBudgetConfig.budgetConfig.enabled = true;
      process.env.DRIVE_ROOT_FOLDER_ID = 'root-folder-id';
      mockBudget.mockRejectedValue(new Error('Sheets API quota exceeded'));

      const result = await processJob(createMockJob());

      // Job still succeeds — budget error is non-fatal
      expect(result.applicationId).toBe('app-123');
      expect(result.contactId).toBe('crm-contact-456');
      expect(result.draftId).toBe('draft-abc');
      expect(result.budgetSheetId).toBeNull();

      delete process.env.DRIVE_ROOT_FOLDER_ID;
      mockBudgetConfig.budgetConfig.enabled = false;
    });
  });
});
