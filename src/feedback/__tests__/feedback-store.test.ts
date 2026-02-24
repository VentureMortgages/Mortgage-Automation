/**
 * Tests for Feedback Store — Redis-backed persistence
 *
 * Tests cover:
 * - loadFeedbackRecords: returns records from Redis list
 * - loadFeedbackRecords: returns empty array when no records exist
 * - appendFeedbackRecord: appends to Redis list
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedbackRecord } from '../types.js';

// ---------------------------------------------------------------------------
// Mock Redis + queue (must be before imports)
// ---------------------------------------------------------------------------

const mockLrange = vi.fn();
const mockRpush = vi.fn();

vi.mock('ioredis', () => ({
  Redis: class MockIORedis {
    lrange = mockLrange;
    rpush = mockRpush;
    constructor() { /* no-op */ }
  },
}));

vi.mock('../../webhook/queue.js', () => ({
  createRedisConnection: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { loadFeedbackRecords, appendFeedbackRecord } from '../feedback-store.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testRecord: FeedbackRecord = {
  id: 'rec-1',
  contactId: 'contact-123',
  createdAt: '2026-02-20T00:00:00Z',
  context: {
    goal: 'purchase',
    incomeTypes: ['employed/salaried'],
    propertyTypes: ['owner_occupied'],
    borrowerCount: 1,
    hasGiftDP: false,
    hasRentalIncome: false,
  },
  contextText: 'Single purchase, salaried, owner-occupied',
  embedding: null,
  edits: {
    itemsRemoved: ['Void Cheque'],
    itemsAdded: [],
    itemsReworded: [],
    sectionsReordered: false,
    otherChanges: null,
    noChanges: false,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feedback Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadFeedbackRecords', () => {
    it('returns records from Redis list', async () => {
      mockLrange.mockResolvedValue([JSON.stringify(testRecord)]);

      const records = await loadFeedbackRecords();

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('rec-1');
      expect(mockLrange).toHaveBeenCalledWith('feedback:records', 0, -1);
    });

    it('returns empty array when no records exist', async () => {
      mockLrange.mockResolvedValue([]);

      const records = await loadFeedbackRecords();

      expect(records).toEqual([]);
    });
  });

  describe('appendFeedbackRecord', () => {
    it('appends serialized record to Redis list', async () => {
      mockRpush.mockResolvedValue(1);

      await appendFeedbackRecord(testRecord);

      expect(mockRpush).toHaveBeenCalledOnce();
      expect(mockRpush).toHaveBeenCalledWith(
        'feedback:records',
        expect.any(String),
      );
      const pushed = JSON.parse(mockRpush.mock.calls[0][1]);
      expect(pushed.id).toBe('rec-1');
    });
  });
});
