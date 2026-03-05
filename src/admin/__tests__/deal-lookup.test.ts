/**
 * Tests for Deal Lookup — BRXM ID Resolution (Phase 23)
 *
 * Tests:
 * - detectInputType: recognizes Finmo URLs
 * - detectInputType: recognizes raw UUIDs
 * - detectInputType: recognizes BRXM deal IDs
 * - detectInputType: returns unknown for invalid input
 * - lookupApplicationIdByDealRef: returns UUID when CRM opportunity found
 * - lookupApplicationIdByDealRef: returns null when no opportunity found
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock CRM dependencies
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../crm/config.js', () => ({
  crmConfig: {
    baseUrl: 'https://rest.gohighlevel.com/v1',
    apiKey: 'test-key',
    locationId: 'test-location',
  },
}));

vi.mock('../../crm/types/index.js', () => ({
  PIPELINE_IDS: { LIVE_DEALS: 'test-pipeline' },
  EXISTING_OPP_FIELDS: { FINMO_APPLICATION_ID: 'field-finmo-app-id' },
}));

vi.mock('../../crm/opportunities.js', () => ({
  getOpportunityFieldValue: vi.fn((opp: { customFields?: Array<{ id: string; fieldValueString?: string }> }, fieldId: string) => {
    const field = opp.customFields?.find((f: { id: string }) => f.id === fieldId);
    return field?.fieldValueString ?? undefined;
  }),
}));

import { detectInputType, lookupApplicationIdByDealRef } from '../deal-lookup.js';

describe('detectInputType', () => {
  it('recognizes Finmo URL with UUID', () => {
    const result = detectInputType('https://app.finmo.ca/applications/12345678-1234-1234-1234-123456789abc');
    expect(result.type).toBe('url');
    expect(result.applicationId).toBe('12345678-1234-1234-1234-123456789abc');
  });

  it('extracts last UUID from Finmo deal URL (teams/teamId/deals/appId)', () => {
    const result = detectInputType('https://app.finmo.ca/teams/4a9c7b8d-d026-4a0e-b444-968708e62159/deals/b5a92d8b-5f13-4a1a-a8e6-87564c7ee377');
    expect(result.type).toBe('url');
    expect(result.applicationId).toBe('b5a92d8b-5f13-4a1a-a8e6-87564c7ee377');
  });

  it('recognizes raw UUID', () => {
    const result = detectInputType('12345678-1234-1234-1234-123456789abc');
    expect(result.type).toBe('uuid');
    expect(result.applicationId).toBe('12345678-1234-1234-1234-123456789abc');
  });

  it('recognizes BRXM deal ID', () => {
    const result = detectInputType('BRXM-F051356');
    expect(result.type).toBe('brxm');
    expect(result.dealRef).toBe('BRXM-F051356');
  });

  it('recognizes lowercase BRXM deal ID', () => {
    const result = detectInputType('brxm-f051356');
    expect(result.type).toBe('brxm');
    expect(result.dealRef).toBe('BRXM-F051356');
  });

  it('returns unknown for invalid input', () => {
    const result = detectInputType('just some text');
    expect(result.type).toBe('unknown');
  });

  it('returns unknown for empty string', () => {
    const result = detectInputType('');
    expect(result.type).toBe('unknown');
  });

  it('handles UUID with whitespace', () => {
    const result = detectInputType('  12345678-1234-1234-1234-123456789abc  ');
    expect(result.type).toBe('uuid');
    expect(result.applicationId).toBe('12345678-1234-1234-1234-123456789abc');
  });
});

describe('lookupApplicationIdByDealRef', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns application UUID when opportunity found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        opportunities: [{
          id: 'opp-1',
          name: 'BRXM-F051356 — John Smith',
          customFields: [
            { id: 'field-finmo-app-id', fieldValueString: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
          ],
        }],
      }),
    });

    const result = await lookupApplicationIdByDealRef('BRXM-F051356');
    expect(result).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('returns null when no opportunities found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ opportunities: [] }),
    });

    const result = await lookupApplicationIdByDealRef('BRXM-X999999');
    expect(result).toBeNull();
  });

  it('returns null when opportunity has no finmo app ID field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        opportunities: [{
          id: 'opp-2',
          name: 'BRXM-F051356 — Jane Doe',
          customFields: [],
        }],
      }),
    });

    const result = await lookupApplicationIdByDealRef('BRXM-F051356');
    expect(result).toBeNull();
  });

  it('returns null when CRM search fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await lookupApplicationIdByDealRef('BRXM-F051356');
    expect(result).toBeNull();
  });
});
