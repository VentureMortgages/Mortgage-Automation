/**
 * Tests for Signal Collectors and Agent Tools
 *
 * Signal collector tests:
 * - collectThreadSignal: returns Tier 1 signal when threadId has Redis mapping
 * - collectThreadSignal: returns null when no mapping or threadId undefined
 * - collectSenderSignal: returns Tier 1 signal when sender matches CRM contact
 * - collectSenderSignal: returns null when no match or null email
 * - collectEmailMetadataSignals: returns Tier 3 signals from CC addresses matching CRM
 * - collectEmailMetadataSignals: returns Tier 3 signal from subject name patterns
 *
 * Agent tools tests:
 * - executeToolCall dispatches to correct CRM/Finmo functions
 * - executeToolCall returns error for unknown tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Redis (thread-store dependency)
// ---------------------------------------------------------------------------

const mockRedisSet = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({
  Redis: class MockIORedis {
    set = mockRedisSet;
    get = mockRedisGet;
    constructor() { /* no-op */ }
  },
}));

vi.mock('../../webhook/queue.js', () => ({
  createRedisConnection: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

// ---------------------------------------------------------------------------
// Mock CRM functions
// ---------------------------------------------------------------------------

const mockFindContactByEmail = vi.hoisted(() => vi.fn());
const mockFindContactByName = vi.hoisted(() => vi.fn());
const mockFindContactByPhone = vi.hoisted(() => vi.fn());
const mockGetContact = vi.hoisted(() => vi.fn());
const mockSearchOpportunities = vi.hoisted(() => vi.fn());
const mockGetOpportunityFieldValue = vi.hoisted(() => vi.fn());

vi.mock('../../crm/contacts.js', () => ({
  findContactByEmail: mockFindContactByEmail,
  findContactByName: mockFindContactByName,
  findContactByPhone: mockFindContactByPhone,
  getContact: mockGetContact,
}));

vi.mock('../../crm/opportunities.js', () => ({
  searchOpportunities: mockSearchOpportunities,
  getOpportunityFieldValue: mockGetOpportunityFieldValue,
}));

// ---------------------------------------------------------------------------
// Mock Finmo client
// ---------------------------------------------------------------------------

const mockFetchFinmoApplication = vi.hoisted(() => vi.fn());

vi.mock('../../webhook/finmo-client.js', () => ({
  fetchFinmoApplication: mockFetchFinmoApplication,
}));

// ---------------------------------------------------------------------------
// Mock CRM config
// ---------------------------------------------------------------------------

vi.mock('../../crm/config.js', () => ({
  crmConfig: {
    locationId: 'loc-123',
    driveFolderIdFieldId: 'drive-folder-field-id',
    oppDealSubfolderIdFieldId: 'deal-subfolder-field-id',
  },
  devPrefix: (s: string) => s,
}));

vi.mock('../../crm/types/index.js', () => ({
  PIPELINE_IDS: { LIVE_DEALS: 'pipeline-live', FINMO_LEADS: 'pipeline-leads' },
  EXISTING_OPP_FIELDS: { FINMO_APPLICATION_ID: 'finmo-app-field', FINMO_DEAL_ID: 'finmo-deal-field' },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { collectThreadSignal, collectSenderSignal, collectEmailMetadataSignals } from '../signal-collectors.js';
import { executeToolCall, MATCHING_TOOLS } from '../agent-tools.js';

// ---------------------------------------------------------------------------
// Signal Collector Tests
// ---------------------------------------------------------------------------

describe('Signal Collectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('collectThreadSignal', () => {
    it('returns Tier 1 signal with contactId when threadId has a Redis mapping', async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ contactId: 'contact-abc', opportunityId: 'opp-123' }),
      );

      const signal = await collectThreadSignal('thread-xyz');

      expect(signal).not.toBeNull();
      expect(signal!.type).toBe('thread_match');
      expect(signal!.tier).toBe(1);
      expect(signal!.confidence).toBe(0.95);
      expect(signal!.contactId).toBe('contact-abc');
      expect(signal!.opportunityId).toBe('opp-123');
      expect(signal!.value).toBe('thread-xyz');
    });

    it('returns null when no mapping exists', async () => {
      mockRedisGet.mockResolvedValue(null);

      const signal = await collectThreadSignal('thread-missing');

      expect(signal).toBeNull();
    });

    it('returns null when threadId is undefined', async () => {
      const signal = await collectThreadSignal(undefined);

      expect(signal).toBeNull();
      expect(mockRedisGet).not.toHaveBeenCalled();
    });
  });

  describe('collectSenderSignal', () => {
    it('returns Tier 1 signal with contactId when sender email matches CRM contact', async () => {
      mockFindContactByEmail.mockResolvedValue('contact-456');

      const signal = await collectSenderSignal('client@example.com');

      expect(signal).not.toBeNull();
      expect(signal!.type).toBe('sender_email');
      expect(signal!.tier).toBe(1);
      expect(signal!.confidence).toBe(0.9);
      expect(signal!.contactId).toBe('contact-456');
      expect(signal!.value).toBe('client@example.com');
    });

    it('returns null when sender email has no CRM match', async () => {
      mockFindContactByEmail.mockResolvedValue(null);

      const signal = await collectSenderSignal('unknown@example.com');

      expect(signal).toBeNull();
    });

    it('returns null when sender email is null', async () => {
      const signal = await collectSenderSignal(null);

      expect(signal).toBeNull();
      expect(mockFindContactByEmail).not.toHaveBeenCalled();
    });
  });

  describe('collectEmailMetadataSignals', () => {
    it('returns Tier 3 signals from CC addresses matching CRM contacts', async () => {
      mockFindContactByEmail
        .mockResolvedValueOnce('contact-cc1')
        .mockResolvedValueOnce(null);

      const signals = await collectEmailMetadataSignals(
        ['cc1@example.com', 'cc2@example.com'],
        undefined,
      );

      expect(signals).toHaveLength(1);
      expect(signals[0].type).toBe('cc_email');
      expect(signals[0].tier).toBe(3);
      expect(signals[0].contactId).toBe('contact-cc1');
      expect(signals[0].value).toBe('cc1@example.com');
    });

    it('returns Tier 3 signal from subject containing client name patterns', async () => {
      const signals = await collectEmailMetadataSignals(
        [],
        'Documents for John Smith',
      );

      expect(signals.length).toBeGreaterThanOrEqual(1);
      const subjectSignal = signals.find(s => s.type === 'email_subject');
      expect(subjectSignal).toBeDefined();
      expect(subjectSignal!.tier).toBe(3);
      expect(subjectSignal!.value).toContain('John Smith');
    });

    it('returns empty array when no CC matches and no subject patterns', async () => {
      const signals = await collectEmailMetadataSignals([], 'Hello');

      expect(signals).toEqual([]);
    });

    it('returns empty array when both args are undefined', async () => {
      const signals = await collectEmailMetadataSignals(undefined, undefined);

      expect(signals).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Agent Tools Tests
// ---------------------------------------------------------------------------

describe('Agent Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports MATCHING_TOOLS array with function declarations', () => {
    expect(MATCHING_TOOLS).toBeDefined();
    expect(Array.isArray(MATCHING_TOOLS)).toBe(true);
    expect(MATCHING_TOOLS.length).toBeGreaterThanOrEqual(6);
  });

  describe('executeToolCall', () => {
    it('dispatches search_contact_by_email to findContactByEmail', async () => {
      mockFindContactByEmail.mockResolvedValue('contact-abc');

      const result = await executeToolCall('search_contact_by_email', { email: 'test@example.com' });
      const parsed = JSON.parse(result);

      expect(mockFindContactByEmail).toHaveBeenCalledWith('test@example.com');
      expect(parsed.contactId).toBe('contact-abc');
    });

    it('dispatches search_contact_by_name to findContactByName', async () => {
      mockFindContactByName.mockResolvedValue('contact-def');

      const result = await executeToolCall('search_contact_by_name', { firstName: 'John', lastName: 'Smith' });
      const parsed = JSON.parse(result);

      expect(mockFindContactByName).toHaveBeenCalledWith('John', 'Smith');
      expect(parsed.contactId).toBe('contact-def');
    });

    it('dispatches search_contact_by_phone to findContactByPhone (FOLD-02)', async () => {
      mockFindContactByPhone.mockResolvedValue('contact-ghi');

      const result = await executeToolCall('search_contact_by_phone', { phone: '416-555-1234' });
      const parsed = JSON.parse(result);

      expect(mockFindContactByPhone).toHaveBeenCalledWith('416-555-1234');
      expect(parsed.contactId).toBe('contact-ghi');
    });

    it('dispatches get_contact_details to getContact', async () => {
      mockGetContact.mockResolvedValue({
        id: 'contact-abc',
        firstName: 'John',
        lastName: 'Smith',
        email: 'john@example.com',
        customFields: [{ id: 'drive-folder-field-id', value: 'folder-xyz' }],
      });

      const result = await executeToolCall('get_contact_details', { contactId: 'contact-abc' });
      const parsed = JSON.parse(result);

      expect(mockGetContact).toHaveBeenCalledWith('contact-abc');
      expect(parsed.contactId).toBe('contact-abc');
      expect(parsed.firstName).toBe('John');
      expect(parsed.driveFolderId).toBe('folder-xyz');
    });

    it('dispatches search_opportunities to searchOpportunities', async () => {
      mockSearchOpportunities.mockResolvedValue([
        { id: 'opp-1', name: 'Deal 1', pipelineStageId: 'stage-1', customFields: [] },
      ]);

      const result = await executeToolCall('search_opportunities', { contactId: 'contact-abc' });
      const parsed = JSON.parse(result);

      expect(mockSearchOpportunities).toHaveBeenCalledWith('contact-abc', 'pipeline-live');
      expect(parsed.opportunities).toHaveLength(1);
      expect(parsed.opportunities[0].opportunityId).toBe('opp-1');
    });

    it('dispatches lookup_co_borrowers to fetch Finmo borrowers (FOLD-03)', async () => {
      mockSearchOpportunities.mockResolvedValue([
        { id: 'opp-1', name: 'Deal 1', customFields: [{ id: 'finmo-app-field', fieldValueString: 'app-xyz' }] },
      ]);
      mockGetOpportunityFieldValue.mockReturnValue('app-xyz');
      mockFetchFinmoApplication.mockResolvedValue({
        borrowers: [
          { firstName: 'John', lastName: 'Smith', email: 'john@example.com', phone: '416-555-1234', isMainBorrower: true },
          { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '416-555-5678', isMainBorrower: false },
        ],
      });

      const result = await executeToolCall('lookup_co_borrowers', { contactId: 'contact-abc' });
      const parsed = JSON.parse(result);

      expect(parsed.borrowers).toHaveLength(2);
      expect(parsed.borrowers[0].isMainBorrower).toBe(true);
      expect(parsed.borrowers[1].isMainBorrower).toBe(false);
    });

    it('returns error string for unknown tool names', async () => {
      const result = await executeToolCall('nonexistent_tool', {});
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('Unknown tool');
    });

    it('returns error when CRM call fails', async () => {
      mockFindContactByEmail.mockRejectedValue(new Error('CRM unavailable'));

      const result = await executeToolCall('search_contact_by_email', { email: 'test@example.com' });
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('CRM unavailable');
    });
  });
});
