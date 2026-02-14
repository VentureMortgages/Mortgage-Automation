// ============================================================================
// Tests: CRM Checklist Sync Orchestrator
// ============================================================================
//
// Tests the syncChecklistToCrm orchestrator with mocked CRM service modules.
// Verifies correct call order, error handling, and partial failure behavior.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { GeneratedChecklist } from '../../checklist/types/index.js';

// ============================================================================
// Mock CRM service modules
// ============================================================================

vi.mock('../config.js', () => ({
  crmConfig: {
    isDev: false,
    fieldIds: {
      docStatus: 'f-status',
      docRequestSent: 'f-sent',
      missingDocs: 'f-missing',
      receivedDocs: 'f-received',
      preDocsTotal: 'f-pre-total',
      preDocsReceived: 'f-pre-received',
      fullDocsTotal: 'f-full-total',
      fullDocsReceived: 'f-full-received',
      lastDocReceived: 'f-last-doc',
    },
    userIds: { cat: 'cat-id', taylor: 'taylor-id' },
    stageIds: { collectingDocuments: 'stage-id' },
    locationId: 'loc-id',
    apiKey: 'test-key',
    baseUrl: 'https://test.example.com',
  },
  devPrefix: (text: string) => text,
}));

vi.mock('../contacts.js', () => ({
  upsertContact: vi.fn().mockResolvedValue({ contactId: 'test-contact-123', isNew: true }),
}));

vi.mock('../tasks.js', () => ({
  createReviewTask: vi.fn().mockResolvedValue('test-task-456'),
  createPreReadinessTask: vi.fn().mockResolvedValue('test-task-789'),
  addBusinessDays: vi.fn().mockImplementation((d: Date) => d),
}));

vi.mock('../opportunities.js', () => ({
  moveToCollectingDocs: vi.fn().mockResolvedValue('test-opp-101'),
}));

vi.mock('../checklist-mapper.js', () => ({
  mapChecklistToFields: vi.fn().mockReturnValue([
    { id: 'f1', field_value: 'In Progress' },
    { id: 'f2', field_value: 5 },
  ]),
  buildChecklistSummary: vi.fn().mockReturnValue('Test summary'),
}));

// Import AFTER mocks are set up
import { syncChecklistToCrm } from '../checklist-sync.js';
import { upsertContact } from '../contacts.js';
import { createReviewTask } from '../tasks.js';
import { moveToCollectingDocs } from '../opportunities.js';
import { mapChecklistToFields, buildChecklistSummary } from '../checklist-mapper.js';

// ============================================================================
// Shared test input
// ============================================================================

const mockChecklist: GeneratedChecklist = {
  applicationId: 'app-123',
  generatedAt: '2026-02-14T12:00:00Z',
  borrowerChecklists: [],
  propertyChecklists: [],
  sharedItems: [],
  internalFlags: [],
  warnings: [],
  stats: {
    totalItems: 10,
    preItems: 6,
    fullItems: 4,
    perBorrowerItems: 8,
    sharedItems: 2,
    internalFlags: 0,
    warnings: 0,
  },
};

const defaultInput = {
  checklist: mockChecklist,
  borrowerEmail: 'test@example.com',
  borrowerFirstName: 'John',
  borrowerLastName: 'Doe',
  borrowerPhone: '555-1234',
};

// ============================================================================
// Tests
// ============================================================================

describe('syncChecklistToCrm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('calls upsertContact with borrower details', async () => {
    await syncChecklistToCrm(defaultInput);

    expect(upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '555-1234',
      }),
    );
  });

  test('passes mapped field updates to contact upsert', async () => {
    await syncChecklistToCrm(defaultInput);

    expect(upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: [
          { id: 'f1', field_value: 'In Progress' },
          { id: 'f2', field_value: 5 },
        ],
      }),
    );
  });

  test('creates review task for Cat', async () => {
    await syncChecklistToCrm(defaultInput);

    expect(createReviewTask).toHaveBeenCalledWith(
      'test-contact-123',
      'John Doe',
      'Test summary',
    );
  });

  test('moves pipeline to Collecting Documents', async () => {
    await syncChecklistToCrm(defaultInput);

    expect(moveToCollectingDocs).toHaveBeenCalledWith('test-contact-123', 'John Doe');
  });

  test('returns complete result', async () => {
    const result = await syncChecklistToCrm(defaultInput);

    expect(result).toEqual({
      contactId: 'test-contact-123',
      taskId: 'test-task-456',
      opportunityId: 'test-opp-101',
      fieldsUpdated: 2,
      errors: [],
    });
  });

  test('handles contact upsert failure', async () => {
    vi.mocked(upsertContact).mockRejectedValueOnce(new Error('API error'));

    await expect(syncChecklistToCrm(defaultInput)).rejects.toThrow('API error');
  });

  test('handles task creation failure gracefully', async () => {
    vi.mocked(createReviewTask).mockRejectedValueOnce(new Error('Task API error'));

    const result = await syncChecklistToCrm(defaultInput);

    expect(result.contactId).toBe('test-contact-123');
    expect(result.taskId).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Task creation failed');
  });

  test('handles opportunity failure gracefully', async () => {
    vi.mocked(moveToCollectingDocs).mockRejectedValueOnce(
      new Error('Opportunity API error'),
    );

    const result = await syncChecklistToCrm(defaultInput);

    expect(result.contactId).toBe('test-contact-123');
    expect(result.opportunityId).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Opportunity upsert failed');
  });
});
