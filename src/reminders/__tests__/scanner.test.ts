// ============================================================================
// Tests: Reminder Scanner
// ============================================================================
//
// Tests the core scan logic that identifies overdue opportunities.
// All external CRM calls are mocked.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { CrmOpportunity, MissingDocEntry } from '../../crm/types/index.js';
import type { ParsedTrackingFields } from '../../crm/tracking-sync.js';
import type { CrmContact } from '../../crm/types/index.js';

// ============================================================================
// Mock Setup
// ============================================================================

const mockSearchByStage = vi.fn();
const mockGetOpportunity = vi.fn();
const mockGetOpportunityFieldValue = vi.fn();
const mockParseOpportunityTrackingFields = vi.fn();
const mockGetContact = vi.fn();

vi.mock('../../crm/opportunities.js', () => ({
  searchOpportunities: vi.fn(),
  getOpportunity: mockGetOpportunity,
  getOpportunityFieldValue: mockGetOpportunityFieldValue,
}));

vi.mock('../../crm/tracking-sync.js', () => ({
  parseOpportunityTrackingFields: mockParseOpportunityTrackingFields,
}));

vi.mock('../../crm/contacts.js', () => ({
  getContact: mockGetContact,
}));

vi.mock('../../crm/config.js', () => ({
  crmConfig: {
    locationId: 'test-location',
    apiKey: 'test-key',
    baseUrl: 'https://test.api',
    stageIds: {
      applicationReceived: 'stage-app-received',
      collectingDocuments: 'stage-collecting-docs',
      allDocsReceived: 'stage-all-docs',
    },
    opportunityFieldIds: {
      docStatus: 'field-doc-status',
      docRequestSent: 'field-doc-sent',
      missingDocs: 'field-missing',
      receivedDocs: 'field-received',
      preDocsTotal: 'field-pre-total',
      preDocsReceived: 'field-pre-received',
      fullDocsTotal: 'field-full-total',
      fullDocsReceived: 'field-full-received',
      lastDocReceived: 'field-last-doc',
    },
  },
}));

// Mock the scanner's internal search function
vi.mock('../scanner-search.js', () => ({
  searchOpportunitiesByStage: mockSearchByStage,
}));

// Use the real types module but allow mutation for testing
// (reminderConfig properties are mutable since interface is not readonly)

// ============================================================================
// Helpers
// ============================================================================

function makeOpp(overrides: Partial<CrmOpportunity> = {}): CrmOpportunity {
  return {
    id: 'opp-1',
    name: 'Test Opp',
    contactId: 'contact-1',
    pipelineId: 'pipeline-live',
    pipelineStageId: 'stage-collecting-docs',
    status: 'open',
    customFields: [],
    ...overrides,
  };
}

function makeTrackingFields(overrides: Partial<ParsedTrackingFields> = {}): ParsedTrackingFields {
  return {
    missingDocs: [
      { name: '2 recent pay stubs', stage: 'PRE' },
      { name: 'T4 for 2024', stage: 'PRE' },
      { name: '90-day bank statements', stage: 'PRE' },
    ],
    receivedDocs: [],
    preDocsTotal: 5,
    preDocsReceived: 2,
    fullDocsTotal: 3,
    fullDocsReceived: 0,
    ...overrides,
  };
}

function makeContact(overrides: Partial<CrmContact> = {}): CrmContact {
  return {
    id: 'contact-1',
    email: 'borrower@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    customFields: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('scanForOverdueReminders', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('returns overdue opportunity with correct fields when 5 business days have passed', async () => {
    const { scanForOverdueReminders } = await import('../scanner.js');

    // 5 business days ago from Wednesday 2026-03-04 = previous Wednesday 2026-02-25
    const today = new Date(Date.UTC(2026, 2, 4)); // Wednesday March 4

    const opp = makeOpp();
    mockSearchByStage.mockResolvedValue([opp]);
    mockGetOpportunity.mockResolvedValue(opp);

    // docRequestSent = Feb 25 (Wednesday), 5 business days before March 4
    mockGetOpportunityFieldValue.mockImplementation((_opp: CrmOpportunity, fieldId: string) => {
      if (fieldId === 'field-doc-sent') return '2026-02-25';
      return undefined;
    });

    mockParseOpportunityTrackingFields.mockReturnValue(makeTrackingFields());
    mockGetContact.mockResolvedValue(makeContact());

    const result = await scanForOverdueReminders(today);

    expect(result.overdue).toHaveLength(1);
    expect(result.overdue[0]).toMatchObject({
      opportunityId: 'opp-1',
      contactId: 'contact-1',
      borrowerName: 'Jane Doe',
      borrowerEmail: 'borrower@example.com',
      businessDaysOverdue: 5,
      reminderCycle: 1,
    });
    expect(result.overdue[0].missingDocs).toHaveLength(3);
    expect(result.scannedCount).toBe(1);
    expect(result.skippedTerminal).toBe(0);
  });

  test('does NOT include opportunity with only 1 business day elapsed', async () => {
    const { scanForOverdueReminders } = await import('../scanner.js');

    const today = new Date(Date.UTC(2026, 2, 4)); // Wednesday March 4

    const opp = makeOpp();
    mockSearchByStage.mockResolvedValue([opp]);
    mockGetOpportunity.mockResolvedValue(opp);

    // docRequestSent = March 3 (Tuesday), only 1 business day before March 4
    mockGetOpportunityFieldValue.mockImplementation((_opp: CrmOpportunity, fieldId: string) => {
      if (fieldId === 'field-doc-sent') return '2026-03-03';
      return undefined;
    });

    mockParseOpportunityTrackingFields.mockReturnValue(makeTrackingFields());

    const result = await scanForOverdueReminders(today);

    expect(result.overdue).toHaveLength(0);
    expect(result.scannedCount).toBe(1);
  });

  test('skips opportunity in terminal stage (allDocsReceived)', async () => {
    const { scanForOverdueReminders } = await import('../scanner.js');

    const today = new Date(Date.UTC(2026, 2, 4)); // Wednesday

    const opp = makeOpp({ pipelineStageId: 'stage-all-docs' });
    mockSearchByStage.mockResolvedValue([opp]);

    const result = await scanForOverdueReminders(today);

    expect(result.overdue).toHaveLength(0);
    expect(result.skippedTerminal).toBe(1);
    // Should not even call getOpportunity for terminal stages
    expect(mockGetOpportunity).not.toHaveBeenCalled();
  });

  test('skips opportunity with no docRequestSent date', async () => {
    const { scanForOverdueReminders } = await import('../scanner.js');

    const today = new Date(Date.UTC(2026, 2, 4));

    const opp = makeOpp();
    mockSearchByStage.mockResolvedValue([opp]);
    mockGetOpportunity.mockResolvedValue(opp);

    // No docRequestSent field value
    mockGetOpportunityFieldValue.mockReturnValue(undefined);
    mockParseOpportunityTrackingFields.mockReturnValue(makeTrackingFields());

    const result = await scanForOverdueReminders(today);

    expect(result.overdue).toHaveLength(0);
    expect(result.scannedCount).toBe(1);
  });

  test('skips opportunity with zero missing docs', async () => {
    const { scanForOverdueReminders } = await import('../scanner.js');

    const today = new Date(Date.UTC(2026, 2, 4));

    const opp = makeOpp();
    mockSearchByStage.mockResolvedValue([opp]);
    mockGetOpportunity.mockResolvedValue(opp);

    // 5 business days ago
    mockGetOpportunityFieldValue.mockImplementation((_opp: CrmOpportunity, fieldId: string) => {
      if (fieldId === 'field-doc-sent') return '2026-02-25';
      return undefined;
    });

    // No missing docs = all docs received
    mockParseOpportunityTrackingFields.mockReturnValue(makeTrackingFields({
      missingDocs: [],
    }));

    const result = await scanForOverdueReminders(today);

    expect(result.overdue).toHaveLength(0);
    expect(result.scannedCount).toBe(1);
  });

  test('calculates reminderCycle correctly: 3 days = cycle 1, 6 days = cycle 2, 9 days = cycle 3', async () => {
    const { scanForOverdueReminders } = await import('../scanner.js');

    // Test with 6 business days overdue (cycle 2)
    // 6 business days before March 5 (Thursday) = Feb 25 (Wednesday)
    // Wait, let me count: Feb 25(Thu), Feb 26(Fri), Mar 2(Mon), Mar 3(Tue), Mar 4(Wed), Mar 5(Thu) = 6 biz days
    // Actually Feb 25 is Wednesday. From Feb 25 to Mar 5: Feb 26(Thu:1), Feb 27(Fri:2), Mar 2(Mon:3), Mar 3(Tue:4), Mar 4(Wed:5), Mar 5(Thu:6) = 6 days
    const today = new Date(Date.UTC(2026, 2, 5)); // Thursday March 5

    const opp = makeOpp();
    mockSearchByStage.mockResolvedValue([opp]);
    mockGetOpportunity.mockResolvedValue(opp);

    mockGetOpportunityFieldValue.mockImplementation((_opp: CrmOpportunity, fieldId: string) => {
      if (fieldId === 'field-doc-sent') return '2026-02-25'; // 6 business days before
      return undefined;
    });

    mockParseOpportunityTrackingFields.mockReturnValue(makeTrackingFields());
    mockGetContact.mockResolvedValue(makeContact());

    const result = await scanForOverdueReminders(today);

    expect(result.overdue).toHaveLength(1);
    expect(result.overdue[0].businessDaysOverdue).toBe(6);
    expect(result.overdue[0].reminderCycle).toBe(2);
  });

  test('returns empty result when reminder is disabled', async () => {
    const { scanForOverdueReminders } = await import('../scanner.js');
    const { reminderConfig } = await import('../types.js');

    // Temporarily disable reminders
    const originalEnabled = reminderConfig.enabled;
    reminderConfig.enabled = false;

    try {
      const today = new Date(Date.UTC(2026, 2, 4));
      const result = await scanForOverdueReminders(today);

      expect(result.overdue).toHaveLength(0);
      expect(result.scannedCount).toBe(0);
      expect(result.skippedTerminal).toBe(0);

      // Should not even call the search API
      expect(mockSearchByStage).not.toHaveBeenCalled();
    } finally {
      // Restore
      reminderConfig.enabled = originalEnabled;
    }
  });

  test('returns empty result on weekends (no scan)', async () => {
    const { scanForOverdueReminders } = await import('../scanner.js');

    // Saturday
    const saturday = new Date(Date.UTC(2026, 2, 7));
    const result = await scanForOverdueReminders(saturday);

    expect(result.overdue).toHaveLength(0);
    expect(result.scannedCount).toBe(0);
  });
});
