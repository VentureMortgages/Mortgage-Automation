/**
 * Tests for Original Store — Redis-backed storage for draft email bodies
 *
 * Tests cover:
 * - storeOriginalEmail: stores HTML + context with TTL
 * - getOriginalEmail: retrieves stored data
 * - getOriginalEmail: returns null for missing keys
 * - deleteOriginalEmail: removes stored data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const mockRedisSet = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisDel = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({
  Redis: class MockIORedis {
    set = mockRedisSet;
    get = mockRedisGet;
    del = mockRedisDel;
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

import { storeOriginalEmail, getOriginalEmail, deleteOriginalEmail } from '../original-store.js';
import type { ApplicationContext } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testContext: ApplicationContext = {
  goal: 'purchase',
  incomeTypes: ['employed/salaried'],
  propertyTypes: ['owner_occupied'],
  borrowerCount: 1,
  hasGiftDP: false,
  hasRentalIncome: false,
};

const testData = {
  html: '<div>Test email body</div>',
  context: testContext,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Original Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storeOriginalEmail', () => {
    it('stores HTML and context in Redis with TTL', async () => {
      mockRedisSet.mockResolvedValue('OK');

      await storeOriginalEmail('contact-123', testData);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'feedback:original:contact-123',
        JSON.stringify(testData),
        'EX',
        30 * 24 * 60 * 60,
      );
    });
  });

  describe('getOriginalEmail', () => {
    it('retrieves stored data', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(testData));

      const result = await getOriginalEmail('contact-123');

      expect(result).toEqual(testData);
      expect(mockRedisGet).toHaveBeenCalledWith('feedback:original:contact-123');
    });

    it('returns null when key does not exist', async () => {
      mockRedisGet.mockResolvedValue(null);

      const result = await getOriginalEmail('contact-missing');

      expect(result).toBeNull();
    });
  });

  describe('deleteOriginalEmail', () => {
    it('deletes the key from Redis', async () => {
      mockRedisDel.mockResolvedValue(1);

      await deleteOriginalEmail('contact-123');

      expect(mockRedisDel).toHaveBeenCalledWith('feedback:original:contact-123');
    });
  });
});
