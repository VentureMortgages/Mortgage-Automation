/**
 * Tests for Gmail Monitor — Job Scheduler and History ID Persistence
 *
 * Tests cover:
 * - getStoredHistoryId: returns null on first run, returns stored value on recovery
 * - storeHistoryId: writes historyId to Redis
 * - startGmailMonitor: calls upsertJobScheduler with correct config
 * - startGmailMonitor: skips scheduling when intake is disabled
 *
 * All Redis and BullMQ interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  quit: vi.fn(),
}));

// Mock ioredis — named import { Redis as IORedis } in gmail-monitor.ts
vi.mock('ioredis', () => {
  return {
    Redis: class MockIORedis {
      get = mockRedis.get;
      set = mockRedis.set;
      quit = mockRedis.quit;
      constructor() { /* no-op */ }
    },
  };
});

// Mock createRedisConnection from webhook/queue.ts
vi.mock('../../webhook/queue.js', () => ({
  createRedisConnection: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

// Mock bullmq Queue (prevent real connections)
vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({
    upsertJobScheduler: vi.fn(),
    close: vi.fn(),
  })),
}));

const mockIntakeConfig = vi.hoisted(() => ({
  intakeConfig: {
    pollIntervalMs: 120000,
    maxAttachmentBytes: 25 * 1024 * 1024,
    docsInbox: 'dev@venturemortgages.com',
    enabled: true,
  },
}));

vi.mock('../config.js', () => mockIntakeConfig);

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  getStoredHistoryId,
  storeHistoryId,
  startGmailMonitor,
} from '../gmail-monitor.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Gmail Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIntakeConfig.intakeConfig.enabled = true;
  });

  // -------------------------------------------------------------------------
  // getStoredHistoryId
  // -------------------------------------------------------------------------

  describe('getStoredHistoryId', () => {
    it('returns null when Redis key does not exist (first run)', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await getStoredHistoryId();

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('intake:gmail:historyId');
      expect(mockRedis.quit).toHaveBeenCalled();
    });

    it('returns stored value when Redis key exists (crash recovery)', async () => {
      mockRedis.get.mockResolvedValue('12345');

      const result = await getStoredHistoryId();

      expect(result).toBe('12345');
      expect(mockRedis.get).toHaveBeenCalledWith('intake:gmail:historyId');
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // storeHistoryId
  // -------------------------------------------------------------------------

  describe('storeHistoryId', () => {
    it('writes the historyId to Redis under HISTORY_ID_KEY', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await storeHistoryId('67890');

      expect(mockRedis.set).toHaveBeenCalledWith('intake:gmail:historyId', '67890');
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // startGmailMonitor
  // -------------------------------------------------------------------------

  describe('startGmailMonitor', () => {
    it('calls upsertJobScheduler with correct scheduler config', async () => {
      const mockUpsert = vi.fn().mockResolvedValue(undefined);
      const mockQueue = { upsertJobScheduler: mockUpsert } as unknown as import('bullmq').Queue;

      await startGmailMonitor(mockQueue);

      expect(mockUpsert).toHaveBeenCalledWith(
        'gmail-poll-docs',
        { every: 120000 },
        expect.objectContaining({
          name: 'poll-docs-inbox',
          data: expect.objectContaining({
            source: 'gmail',
            receivedAt: expect.any(String),
          }),
        }),
      );
    });

    it('skips scheduling when intakeConfig.enabled is false', async () => {
      mockIntakeConfig.intakeConfig.enabled = false;

      const mockUpsert = vi.fn();
      const mockQueue = { upsertJobScheduler: mockUpsert } as unknown as import('bullmq').Queue;

      await startGmailMonitor(mockQueue);

      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });
});
