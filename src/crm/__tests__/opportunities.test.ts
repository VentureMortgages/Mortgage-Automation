// ============================================================================
// Tests: CRM Opportunities Service
// ============================================================================
//
// Tests the opportunity search, get, update, and field value extraction functions
// with mocked fetch. Same mocking pattern as contacts.test.ts.

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock CRM config before imports
vi.mock('../config.js', () => ({
  crmConfig: {
    apiKey: 'test-api-key',
    baseUrl: 'https://test-api.example.com',
    locationId: 'test-location-id',
    isDev: false,
    stageIds: {
      collectingDocuments: 'stage-collecting',
      allDocsReceived: 'stage-all-docs',
    },
  },
  devPrefix: (text: string) => text,
}));

import {
  searchOpportunities,
  getOpportunity,
  updateOpportunityFields,
  updateOpportunityStage,
  findOpportunityByFinmoId,
  getOpportunityFieldValue,
} from '../opportunities.js';
import { CrmAuthError, CrmRateLimitError, CrmApiError } from '../errors.js';
import type { CrmOpportunity } from '../types/index.js';

// ============================================================================
// Shared Setup
// ============================================================================

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

// ============================================================================
// searchOpportunities
// ============================================================================

describe('searchOpportunities', () => {
  test('sends GET to /opportunities/search with underscore params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        opportunities: [
          { id: 'opp-1', name: 'Test Opportunity', contactId: 'contact-1' },
        ],
      }),
    });

    await searchOpportunities('contact-1', 'pipeline-abc');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/opportunities/search?');
    expect(url).toContain('location_id=test-location-id');
    expect(url).toContain('pipeline_id=pipeline-abc');
    expect(url).toContain('contact_id=contact-1');
    expect(url).toContain('limit=20');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-api-key');
    expect(init.headers.Version).toBe('2021-07-28');
  });

  test('returns parsed CrmOpportunity array', async () => {
    const opportunities = [
      {
        id: 'opp-1',
        name: 'John - BRXM-F050382',
        contactId: 'contact-1',
        pipelineId: 'pipeline-abc',
        pipelineStageId: 'stage-1',
        status: 'open',
        customFields: [
          { id: 'field-1', fieldValueString: 'some value', type: 'string' },
          { id: 'field-2', fieldValueNumber: 42, type: 'number' },
        ],
      },
      {
        id: 'opp-2',
        name: 'John - BRXM-F050383',
        contactId: 'contact-1',
        status: 'open',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunities }),
    });

    const result = await searchOpportunities('contact-1', 'pipeline-abc');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('opp-1');
    expect(result[0].customFields).toHaveLength(2);
    expect(result[1].id).toBe('opp-2');
  });

  test('returns empty array when no opportunities found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunities: [] }),
    });

    const result = await searchOpportunities('contact-1', 'pipeline-abc');
    expect(result).toEqual([]);
  });

  test('returns empty array when opportunities is undefined in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await searchOpportunities('contact-1', 'pipeline-abc');
    expect(result).toEqual([]);
  });
});

// ============================================================================
// getOpportunity
// ============================================================================

describe('getOpportunity', () => {
  test('sends GET to /opportunities/:id with auth headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        opportunity: {
          id: 'opp-123',
          name: 'Test Opp',
          contactId: 'contact-1',
          customFields: [],
        },
      }),
    });

    await getOpportunity('opp-123');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/opportunities/opp-123');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-api-key');
  });

  test('returns parsed CrmOpportunity with customFields', async () => {
    const opportunityData = {
      id: 'opp-456',
      name: 'John - Purchase',
      contactId: 'contact-abc',
      pipelineId: 'pipeline-live',
      pipelineStageId: 'stage-collecting',
      status: 'open',
      customFields: [
        { id: 'finmo-app-id', fieldValueString: '98f332e4-84aa-4571-a15b-03bb2af2610a', type: 'string' },
        { id: 'pre-total', fieldValueNumber: 8, type: 'number' },
        { id: 'last-doc-date', fieldValueDate: 1771482869576, type: 'date' },
      ],
      createdAt: '2026-02-15T10:00:00Z',
      updatedAt: '2026-02-20T14:30:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunity: opportunityData }),
    });

    const result = await getOpportunity('opp-456');

    expect(result.id).toBe('opp-456');
    expect(result.name).toBe('John - Purchase');
    expect(result.contactId).toBe('contact-abc');
    expect(result.customFields).toHaveLength(3);
    expect(result.customFields![0].fieldValueString).toBe('98f332e4-84aa-4571-a15b-03bb2af2610a');
    expect(result.customFields![1].fieldValueNumber).toBe(8);
    expect(result.customFields![2].fieldValueDate).toBe(1771482869576);
    expect(result.createdAt).toBe('2026-02-15T10:00:00Z');
  });
});

// ============================================================================
// updateOpportunityFields
// ============================================================================

describe('updateOpportunityFields', () => {
  test('sends PUT to /opportunities/:id with customFields body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunity: { id: 'opp-123' } }),
    });

    await updateOpportunityFields('opp-123', [
      { id: 'field-status', field_value: 'In Progress' },
      { id: 'field-count', field_value: 5 },
    ]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/opportunities/opp-123');
    expect(init.method).toBe('PUT');

    const body = JSON.parse(init.body);
    expect(body.customFields).toEqual([
      { id: 'field-status', field_value: 'In Progress' },
      { id: 'field-count', field_value: 5 },
    ]);
  });

  test('sends empty customFields array when no fields to update', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunity: { id: 'opp-123' } }),
    });

    await updateOpportunityFields('opp-123', []);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.customFields).toEqual([]);
  });
});

// ============================================================================
// updateOpportunityStage
// ============================================================================

describe('updateOpportunityStage', () => {
  test('sends PUT to /opportunities/:id with pipelineStageId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunity: { id: 'opp-123' } }),
    });

    await updateOpportunityStage('opp-123', 'stage-all-docs');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/opportunities/opp-123');
    expect(init.method).toBe('PUT');

    const body = JSON.parse(init.body);
    expect(body.pipelineStageId).toBe('stage-all-docs');
    // Should NOT have customFields in the body
    expect(body.customFields).toBeUndefined();
  });
});

// ============================================================================
// findOpportunityByFinmoId
// ============================================================================

describe('findOpportunityByFinmoId', () => {
  const FINMO_APP_FIELD_ID = 'ezhN6WKQLzY7MvqIKSY9'; // EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID

  test('returns opportunity matching Finmo Application ID', async () => {
    const opportunities = [
      {
        id: 'opp-1',
        name: 'Wrong Deal',
        customFields: [
          { id: FINMO_APP_FIELD_ID, fieldValueString: 'other-app-id', type: 'string' },
        ],
      },
      {
        id: 'opp-2',
        name: 'Correct Deal',
        customFields: [
          { id: FINMO_APP_FIELD_ID, fieldValueString: 'target-app-id', type: 'string' },
        ],
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunities }),
    });

    const result = await findOpportunityByFinmoId('contact-1', 'pipeline-abc', 'target-app-id');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('opp-2');
    expect(result!.name).toBe('Correct Deal');
  });

  test('returns single opportunity as fallback when no Finmo ID match', async () => {
    const opportunities = [
      {
        id: 'opp-only',
        name: 'Only Deal',
        customFields: [
          { id: FINMO_APP_FIELD_ID, fieldValueString: 'different-app-id', type: 'string' },
        ],
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunities }),
    });

    const result = await findOpportunityByFinmoId('contact-1', 'pipeline-abc', 'target-app-id');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('opp-only');
  });

  test('returns null when multiple opportunities and no match', async () => {
    const opportunities = [
      {
        id: 'opp-1',
        customFields: [
          { id: FINMO_APP_FIELD_ID, fieldValueString: 'app-id-1', type: 'string' },
        ],
      },
      {
        id: 'opp-2',
        customFields: [
          { id: FINMO_APP_FIELD_ID, fieldValueString: 'app-id-2', type: 'string' },
        ],
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunities }),
    });

    const result = await findOpportunityByFinmoId('contact-1', 'pipeline-abc', 'app-id-3');

    expect(result).toBeNull();
  });

  test('returns null when no opportunities exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunities: [] }),
    });

    const result = await findOpportunityByFinmoId('contact-1', 'pipeline-abc', 'target-app-id');

    expect(result).toBeNull();
  });

  test('handles opportunity with no customFields gracefully', async () => {
    const opportunities = [
      { id: 'opp-1', name: 'No Custom Fields' },
      { id: 'opp-2', name: 'Also No Fields', customFields: [] },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunities }),
    });

    const result = await findOpportunityByFinmoId('contact-1', 'pipeline-abc', 'target-app-id');

    // Multiple opportunities, no match — ambiguous
    expect(result).toBeNull();
  });
});

// ============================================================================
// getOpportunityFieldValue
// ============================================================================

describe('getOpportunityFieldValue', () => {
  test('extracts string field value', () => {
    const opp: CrmOpportunity = {
      id: 'opp-1',
      customFields: [
        { id: 'field-a', fieldValueString: 'hello', type: 'string' },
      ],
    };

    expect(getOpportunityFieldValue(opp, 'field-a')).toBe('hello');
  });

  test('extracts number field value', () => {
    const opp: CrmOpportunity = {
      id: 'opp-1',
      customFields: [
        { id: 'field-b', fieldValueNumber: 42, type: 'number' },
      ],
    };

    expect(getOpportunityFieldValue(opp, 'field-b')).toBe(42);
  });

  test('extracts date field value (epoch number)', () => {
    const opp: CrmOpportunity = {
      id: 'opp-1',
      customFields: [
        { id: 'field-c', fieldValueDate: 1771482869576, type: 'date' },
      ],
    };

    expect(getOpportunityFieldValue(opp, 'field-c')).toBe(1771482869576);
  });

  test('returns undefined for missing field', () => {
    const opp: CrmOpportunity = {
      id: 'opp-1',
      customFields: [
        { id: 'field-a', fieldValueString: 'hello', type: 'string' },
      ],
    };

    expect(getOpportunityFieldValue(opp, 'nonexistent-field')).toBeUndefined();
  });

  test('returns undefined when customFields is undefined', () => {
    const opp: CrmOpportunity = { id: 'opp-1' };

    expect(getOpportunityFieldValue(opp, 'field-a')).toBeUndefined();
  });

  test('returns undefined when field exists but has no typed value', () => {
    const opp: CrmOpportunity = {
      id: 'opp-1',
      customFields: [
        { id: 'field-empty', type: 'string' },
      ],
    };

    expect(getOpportunityFieldValue(opp, 'field-empty')).toBeUndefined();
  });

  test('prefers fieldValueString over fieldValueNumber when both present', () => {
    const opp: CrmOpportunity = {
      id: 'opp-1',
      customFields: [
        { id: 'field-both', fieldValueString: 'text', fieldValueNumber: 99, type: 'string' },
      ],
    };

    // String takes precedence
    expect(getOpportunityFieldValue(opp, 'field-both')).toBe('text');
  });

  test('handles fieldValueNumber of 0 correctly', () => {
    const opp: CrmOpportunity = {
      id: 'opp-1',
      customFields: [
        { id: 'field-zero', fieldValueNumber: 0, type: 'number' },
      ],
    };

    expect(getOpportunityFieldValue(opp, 'field-zero')).toBe(0);
  });

  test('handles empty string fieldValueString correctly', () => {
    const opp: CrmOpportunity = {
      id: 'opp-1',
      customFields: [
        { id: 'field-empty-str', fieldValueString: '', type: 'string' },
      ],
    };

    expect(getOpportunityFieldValue(opp, 'field-empty-str')).toBe('');
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe('error handling', () => {
  test('throws CrmRateLimitError on 429', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'Rate limit exceeded',
    });

    await expect(searchOpportunities('contact-1', 'pipeline-1')).rejects.toThrow(CrmRateLimitError);
  });

  test('throws CrmAuthError on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key',
    });

    await expect(getOpportunity('opp-1')).rejects.toThrow(CrmAuthError);
  });

  test('throws CrmApiError on other HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server error',
    });

    await expect(updateOpportunityFields('opp-1', [])).rejects.toThrow(CrmApiError);
  });

  test('throws CrmApiError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(updateOpportunityStage('opp-1', 'stage-1')).rejects.toThrow(CrmApiError);
  });
});
