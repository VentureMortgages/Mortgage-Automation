/**
 * Tests for Decision Log — Redis-backed matching decision storage
 *
 * Tests cover:
 * - logMatchDecision stores a MatchDecision in Redis with 90-day TTL
 * - getMatchDecision retrieves a stored decision by intakeDocumentId
 * - getMatchDecision returns null when no decision exists
 * - MatchDecision includes signals, candidates, chosen IDs, confidence, reasoning, outcome
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Redis
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
// Import after mocks
// ---------------------------------------------------------------------------

import { logMatchDecision, getMatchDecision } from '../decision-log.js';
import type { MatchDecision } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testDecision: MatchDecision = {
  intakeDocumentId: 'gmail-msg-001-0',
  signals: [
    {
      type: 'thread_match',
      value: 'thread-abc',
      contactId: 'contact-123',
      confidence: 0.95,
      tier: 1,
    },
  ],
  candidates: [
    {
      contactId: 'contact-123',
      contactName: 'Megan Smith',
      opportunityId: 'opp-456',
      signals: [
        {
          type: 'thread_match',
          value: 'thread-abc',
          contactId: 'contact-123',
          confidence: 0.95,
          tier: 1,
        },
      ],
      confidence: 0.95,
    },
  ],
  chosenContactId: 'contact-123',
  chosenOpportunityId: 'opp-456',
  chosenDriveFolderId: 'folder-789',
  confidence: 0.95,
  reasoning: 'Thread match with high confidence',
  outcome: 'auto_filed',
  timestamp: '2026-03-02T12:00:00Z',
  durationMs: 250,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Decision Log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logMatchDecision', () => {
    it('stores a MatchDecision in Redis with 90-day TTL', async () => {
      mockRedisSet.mockResolvedValue('OK');

      await logMatchDecision(testDecision);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'matching:decision:gmail-msg-001-0',
        JSON.stringify(testDecision),
        'EX',
        90 * 24 * 60 * 60,
      );
    });
  });

  describe('getMatchDecision', () => {
    it('retrieves a stored decision by intakeDocumentId', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(testDecision));

      const result = await getMatchDecision('gmail-msg-001-0');

      expect(result).toEqual(testDecision);
      expect(mockRedisGet).toHaveBeenCalledWith('matching:decision:gmail-msg-001-0');
    });

    it('returns null when no decision exists', async () => {
      mockRedisGet.mockResolvedValue(null);

      const result = await getMatchDecision('gmail-msg-missing-0');

      expect(result).toBeNull();
    });
  });
});
