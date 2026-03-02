/**
 * Tests for Thread Store — Redis-backed threadId->contactId mapping
 *
 * Tests cover:
 * - storeThreadMapping stores threadId->contactId in Redis with TTL
 * - storeThreadMapping also stores opportunityId when provided
 * - getThreadContactId retrieves contactId by threadId
 * - getThreadContactId returns null when no mapping exists
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

import { storeThreadMapping, getThreadContactId } from '../thread-store.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Thread Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storeThreadMapping', () => {
    it('stores threadId->contactId in Redis with TTL', async () => {
      mockRedisSet.mockResolvedValue('OK');

      await storeThreadMapping('thread-abc', 'contact-123');

      expect(mockRedisSet).toHaveBeenCalledWith(
        'matching:thread:thread-abc',
        JSON.stringify({ contactId: 'contact-123' }),
        'EX',
        30 * 24 * 60 * 60,
      );
    });

    it('stores opportunityId when provided', async () => {
      mockRedisSet.mockResolvedValue('OK');

      await storeThreadMapping('thread-abc', 'contact-123', 'opp-456');

      expect(mockRedisSet).toHaveBeenCalledWith(
        'matching:thread:thread-abc',
        JSON.stringify({ contactId: 'contact-123', opportunityId: 'opp-456' }),
        'EX',
        30 * 24 * 60 * 60,
      );
    });
  });

  describe('getThreadContactId', () => {
    it('retrieves contactId and opportunityId by threadId', async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ contactId: 'contact-123', opportunityId: 'opp-456' }),
      );

      const result = await getThreadContactId('thread-abc');

      expect(result).toEqual({ contactId: 'contact-123', opportunityId: 'opp-456' });
      expect(mockRedisGet).toHaveBeenCalledWith('matching:thread:thread-abc');
    });

    it('returns null when no mapping exists', async () => {
      mockRedisGet.mockResolvedValue(null);

      const result = await getThreadContactId('thread-missing');

      expect(result).toBeNull();
    });
  });
});
