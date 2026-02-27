// ============================================================================
// Tests: CRM Checklist Sync Orchestrator
// ============================================================================
//
// Tests the syncChecklistToCrm orchestrator with mocked CRM service modules.
// Verifies opportunity-level doc tracking, contact fallback, error handling,
// and correct fieldIds usage.

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
    opportunityFieldIds: {
      docStatus: 'opp-status',
      docRequestSent: 'opp-sent',
      missingDocs: 'opp-missing',
      receivedDocs: 'opp-received',
      preDocsTotal: 'opp-pre-total',
      preDocsReceived: 'opp-pre-received',
      fullDocsTotal: 'opp-full-total',
      fullDocsReceived: 'opp-full-received',
      lastDocReceived: 'opp-last-doc',
    },
    userIds: { cat: 'cat-id', taylor: 'taylor-id' },
    stageIds: { collectingDocuments: 'stage-collecting' },
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
  createOrUpdateReviewTask: vi.fn().mockResolvedValue('test-task-456'),
  createPreReadinessTask: vi.fn().mockResolvedValue('test-task-789'),
  addBusinessDays: vi.fn().mockImplementation((d: Date) => d),
}));

vi.mock('../opportunities.js', () => ({
  findOpportunityByFinmoId: vi.fn().mockResolvedValue({ id: 'opp-123', name: 'Test Opp' }),
  updateOpportunityFields: vi.fn().mockResolvedValue(undefined),
  updateOpportunityStage: vi.fn().mockResolvedValue(undefined),
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
import { createReviewTask, createOrUpdateReviewTask } from '../tasks.js';
import { findOpportunityByFinmoId, updateOpportunityFields, updateOpportunityStage } from '../opportunities.js';
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
  finmoApplicationId: 'app-uuid-123',
};

// ============================================================================
// Tests
// ============================================================================

describe('syncChecklistToCrm', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-set default mock return values (clearAllMocks resets implementations in Vitest)
    vi.mocked(upsertContact).mockResolvedValue({ contactId: 'test-contact-123', isNew: true });
    vi.mocked(createReviewTask).mockResolvedValue('test-task-456');
    vi.mocked(createOrUpdateReviewTask).mockResolvedValue('test-task-456');
    vi.mocked(findOpportunityByFinmoId).mockResolvedValue({ id: 'opp-123', name: 'Test Opp' });
    vi.mocked(updateOpportunityFields).mockResolvedValue(undefined);
    vi.mocked(updateOpportunityStage).mockResolvedValue(undefined);
    vi.mocked(mapChecklistToFields).mockReturnValue([
      { id: 'f1', field_value: 'In Progress' },
      { id: 'f2', field_value: 5 },
    ]);
    vi.mocked(buildChecklistSummary).mockReturnValue('Test summary');
  });

  // --------------------------------------------------------------------------
  // Happy path: opportunity found
  // --------------------------------------------------------------------------

  describe('when opportunity is found', () => {
    test('calls findOpportunityByFinmoId with correct args', async () => {
      await syncChecklistToCrm(defaultInput);

      expect(findOpportunityByFinmoId).toHaveBeenCalledWith(
        'test-contact-123',
        expect.any(String), // PIPELINE_IDS.LIVE_DEALS
        'app-uuid-123',
      );
    });

    test('writes doc tracking fields to opportunity', async () => {
      await syncChecklistToCrm(defaultInput);

      expect(updateOpportunityFields).toHaveBeenCalledWith(
        'opp-123',
        [
          { id: 'f1', field_value: 'In Progress' },
          { id: 'f2', field_value: 5 },
        ],
      );
    });

    test('does NOT set stage at webhook time (stage moves on email send)', async () => {
      await syncChecklistToCrm(defaultInput);

      expect(updateOpportunityStage).not.toHaveBeenCalled();
    });

    test('upserts contact WITHOUT doc tracking custom fields', async () => {
      await syncChecklistToCrm(defaultInput);

      // First call is the initial upsert (borrower details only, no customFields)
      const firstCall = vi.mocked(upsertContact).mock.calls[0][0];
      expect(firstCall.customFields).toBeUndefined();
      expect(firstCall.email).toBe('test@example.com');
      expect(firstCall.firstName).toBe('John');
      expect(firstCall.lastName).toBe('Doe');
      expect(firstCall.phone).toBe('555-1234');
    });

    test('returns trackingTarget = "opportunity"', async () => {
      const result = await syncChecklistToCrm(defaultInput);

      expect(result.trackingTarget).toBe('opportunity');
    });

    test('returns opportunityId in result', async () => {
      const result = await syncChecklistToCrm(defaultInput);

      expect(result.opportunityId).toBe('opp-123');
    });

    test('returns complete result with all fields', async () => {
      const result = await syncChecklistToCrm(defaultInput);

      expect(result).toEqual({
        contactId: 'test-contact-123',
        taskId: 'test-task-456',
        opportunityId: 'opp-123',
        fieldsUpdated: 2,
        trackingTarget: 'opportunity',
        errors: [],
      });
    });

    test('calls mapChecklistToFields with opportunityFieldIds', async () => {
      await syncChecklistToCrm(defaultInput);

      // The first call should use opportunityFieldIds
      expect(mapChecklistToFields).toHaveBeenCalledWith(
        mockChecklist,
        {
          fieldIds: {
            docStatus: 'opp-status',
            docRequestSent: 'opp-sent',
            missingDocs: 'opp-missing',
            receivedDocs: 'opp-received',
            preDocsTotal: 'opp-pre-total',
            preDocsReceived: 'opp-pre-received',
            fullDocsTotal: 'opp-full-total',
            fullDocsReceived: 'opp-full-received',
            lastDocReceived: 'opp-last-doc',
          },
        },
        undefined,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Fallback: no opportunity found
  // --------------------------------------------------------------------------

  describe('when no opportunity is found', () => {
    beforeEach(() => {
      vi.mocked(findOpportunityByFinmoId).mockResolvedValue(null);
    });

    test('does NOT call updateOpportunityFields', async () => {
      await syncChecklistToCrm(defaultInput);

      expect(updateOpportunityFields).not.toHaveBeenCalled();
    });

    test('does NOT call updateOpportunityStage', async () => {
      await syncChecklistToCrm(defaultInput);

      expect(updateOpportunityStage).not.toHaveBeenCalled();
    });

    test('falls back to writing doc tracking to contact', async () => {
      await syncChecklistToCrm(defaultInput);

      // Second upsertContact call should include customFields (fallback)
      expect(upsertContact).toHaveBeenCalledTimes(2);
      const secondCall = vi.mocked(upsertContact).mock.calls[1][0];
      expect(secondCall.customFields).toBeDefined();
      expect(secondCall.customFields).toHaveLength(2);
    });

    test('returns trackingTarget = "contact"', async () => {
      const result = await syncChecklistToCrm(defaultInput);

      expect(result.trackingTarget).toBe('contact');
    });

    test('returns opportunityId as undefined', async () => {
      const result = await syncChecklistToCrm(defaultInput);

      expect(result.opportunityId).toBeUndefined();
    });

    test('logs warning about fallback', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await syncChecklistToCrm(defaultInput);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No Finmo opportunity found'),
      );

      warnSpy.mockRestore();
    });

    test('calls mapChecklistToFields with contact fieldIds for fallback', async () => {
      await syncChecklistToCrm(defaultInput);

      // Second call (for contact fallback) should use contact fieldIds
      expect(mapChecklistToFields).toHaveBeenCalledTimes(2);
      const secondCall = vi.mocked(mapChecklistToFields).mock.calls[1];
      expect(secondCall[1]).toEqual({
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
      });
    });
  });

  // --------------------------------------------------------------------------
  // No finmoApplicationId provided (backward compat)
  // --------------------------------------------------------------------------

  describe('when finmoApplicationId is not provided', () => {
    test('skips opportunity search and falls back to contact', async () => {
      const inputWithoutAppId = { ...defaultInput, finmoApplicationId: undefined };

      const result = await syncChecklistToCrm(inputWithoutAppId);

      expect(findOpportunityByFinmoId).not.toHaveBeenCalled();
      expect(result.trackingTarget).toBe('contact');
    });
  });

  // --------------------------------------------------------------------------
  // Contact upsert always gets borrower details
  // --------------------------------------------------------------------------

  describe('contact upsert gets borrower details in both paths', () => {
    test('includes borrower details when opportunity found', async () => {
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

    test('includes borrower details when falling back to contact', async () => {
      vi.mocked(findOpportunityByFinmoId).mockResolvedValue(null);

      await syncChecklistToCrm(defaultInput);

      // Both calls should have borrower details
      const calls = vi.mocked(upsertContact).mock.calls;
      for (const call of calls) {
        expect(call[0].email).toBe('test@example.com');
        expect(call[0].firstName).toBe('John');
        expect(call[0].lastName).toBe('Doe');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Review task still created on contact
  // --------------------------------------------------------------------------

  test('creates or updates review task on contact (not opportunity)', async () => {
    await syncChecklistToCrm(defaultInput);

    expect(createOrUpdateReviewTask).toHaveBeenCalledWith(
      'test-contact-123',
      'John Doe',
      'Test summary',
    );
  });

  test('creates or updates review task even when opportunity is found', async () => {
    await syncChecklistToCrm(defaultInput);

    expect(createOrUpdateReviewTask).toHaveBeenCalledTimes(1);
    expect(createOrUpdateReviewTask).toHaveBeenCalledWith(
      'test-contact-123',
      expect.any(String),
      expect.any(String),
    );
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    test('contact upsert failure aborts entire operation', async () => {
      vi.mocked(upsertContact).mockRejectedValueOnce(new Error('API error'));

      await expect(syncChecklistToCrm(defaultInput)).rejects.toThrow('API error');
    });

    test('opportunity search failure is non-fatal, falls back to contact', async () => {
      vi.mocked(findOpportunityByFinmoId).mockRejectedValueOnce(new Error('Search API error'));

      const result = await syncChecklistToCrm(defaultInput);

      expect(result.contactId).toBe('test-contact-123');
      expect(result.trackingTarget).toBe('contact');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Opportunity search failed');
    });

    test('opportunity field update failure is non-fatal, captured in errors', async () => {
      vi.mocked(updateOpportunityFields).mockRejectedValueOnce(new Error('Field API error'));

      const result = await syncChecklistToCrm(defaultInput);

      expect(result.contactId).toBe('test-contact-123');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Opportunity field update failed');
    });

    // Stage update removed from checklist-sync — happens on email send via sent-detector

    test('task creation failure is non-fatal, captured in errors', async () => {
      vi.mocked(createOrUpdateReviewTask).mockRejectedValueOnce(new Error('Task API error'));

      const result = await syncChecklistToCrm(defaultInput);

      expect(result.contactId).toBe('test-contact-123');
      expect(result.taskId).toBeUndefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Task creation failed');
    });

    test('falls back to contact when opportunity field update fails', async () => {
      vi.mocked(updateOpportunityFields).mockRejectedValueOnce(new Error('Field API error'));

      const result = await syncChecklistToCrm(defaultInput);

      // trackingTarget stays 'contact' because opportunity field write failed
      expect(result.trackingTarget).toBe('contact');

      // Should have called upsertContact a second time with customFields (fallback)
      expect(upsertContact).toHaveBeenCalledTimes(2);
    });
  });
});
