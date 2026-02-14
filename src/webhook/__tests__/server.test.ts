/**
 * Tests for Webhook Server and Health Check
 *
 * All tests use mocked BullMQ queue (no Redis connection required).
 * Tests verify HTTP layer behavior: status codes, response shapes,
 * kill switch enforcement, applicationId extraction from multiple
 * payload shapes, and dedup jobId generation.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting — safe for mock variables
const { mockQueueAdd, mockConfig } = vi.hoisted(() => {
  const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'test-job-id' });
  const mockConfig = {
    killSwitch: false,
    redis: { url: undefined, host: 'localhost', port: 6379, password: undefined },
    finmo: { apiKey: 'test-key', apiBase: 'https://test.finmo.ca', resthookPublicKey: undefined },
    server: { port: 3000 },
    isDev: true,
  };
  return { mockQueueAdd, mockConfig };
});

// Mock queue module — no real Redis needed
vi.mock('../queue.js', () => ({
  getWebhookQueue: vi.fn(() => ({
    add: mockQueueAdd,
  })),
  QUEUE_NAME: 'finmo-webhooks',
}));

// Mock config module to control killSwitch in tests
vi.mock('../../config.js', () => ({
  appConfig: mockConfig,
}));

import request from 'supertest';
import { createApp, extractApplicationId } from '../server.js';

describe('Webhook Server', () => {
  beforeEach(() => {
    mockQueueAdd.mockClear();
    mockConfig.killSwitch = false;
  });

  describe('POST /webhooks/finmo', () => {
    it('returns 202 with accepted payload for direct applicationId', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/webhooks/finmo')
        .send({ applicationId: 'abc-123' })
        .expect(202);

      expect(res.body).toEqual({ accepted: true, applicationId: 'abc-123' });
    });

    it('returns 202 for nested data.applicationId', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/webhooks/finmo')
        .send({ data: { applicationId: 'abc-123' } })
        .expect(202);

      expect(res.body).toEqual({ accepted: true, applicationId: 'abc-123' });
    });

    it('returns 202 for nested application.id', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/webhooks/finmo')
        .send({ application: { id: 'abc-123' } })
        .expect(202);

      expect(res.body).toEqual({ accepted: true, applicationId: 'abc-123' });
    });

    it('returns 400 when no applicationId is extractable', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/webhooks/finmo')
        .send({ someOtherField: 'value' })
        .expect(400);

      expect(res.body).toEqual({ error: 'Missing applicationId' });
    });

    it('returns 503 when kill switch is active', async () => {
      mockConfig.killSwitch = true;
      const app = createApp();
      const res = await request(app)
        .post('/webhooks/finmo')
        .send({ applicationId: 'abc-123' })
        .expect(503);

      expect(res.body).toEqual({ message: 'Automation disabled' });
      // Queue should NOT have been called
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it('enqueues job with correct dedup jobId pattern', async () => {
      const app = createApp();
      await request(app)
        .post('/webhooks/finmo')
        .send({ applicationId: 'abc-123' })
        .expect(202);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'process-application',
        expect.objectContaining({ applicationId: 'abc-123' }),
        { jobId: 'finmo-app-abc-123' },
      );
    });

    it('includes receivedAt timestamp in job data', async () => {
      const app = createApp();
      await request(app)
        .post('/webhooks/finmo')
        .send({ applicationId: 'abc-123' })
        .expect(202);

      const jobData = mockQueueAdd.mock.calls[0][1];
      expect(jobData.receivedAt).toBeDefined();
      // Should be a valid ISO timestamp
      expect(new Date(jobData.receivedAt).toISOString()).toBe(jobData.receivedAt);
    });
  });

  describe('GET /health', () => {
    it('returns 200 with status ok and killSwitch state', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.killSwitch).toBe(false);
      expect(res.body.timestamp).toBeDefined();
      // Timestamp should be a valid ISO string
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    it('reflects killSwitch state when active', async () => {
      mockConfig.killSwitch = true;
      const app = createApp();
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.body.killSwitch).toBe(true);
      // Health check should still return 200 even with kill switch active
      expect(res.body.status).toBe('ok');
    });
  });

  describe('extractApplicationId', () => {
    it('extracts direct applicationId', () => {
      expect(extractApplicationId({ applicationId: 'abc-123' })).toBe('abc-123');
    });

    it('extracts from data.applicationId', () => {
      expect(extractApplicationId({ data: { applicationId: 'abc-123' } })).toBe('abc-123');
    });

    it('extracts from application.id', () => {
      expect(extractApplicationId({ application: { id: 'abc-123' } })).toBe('abc-123');
    });

    it('extracts top-level id with hyphen (UUID-like)', () => {
      expect(extractApplicationId({ id: 'a1b2c3-d4e5-f6g7' })).toBe('a1b2c3-d4e5-f6g7');
    });

    it('rejects top-level id without hyphen (not UUID-like)', () => {
      expect(extractApplicationId({ id: '12345' })).toBeUndefined();
    });

    it('returns undefined for empty payload', () => {
      expect(extractApplicationId({})).toBeUndefined();
    });

    it('returns undefined when nested fields are wrong type', () => {
      expect(extractApplicationId({ applicationId: 42 as unknown as string })).toBeUndefined();
      expect(extractApplicationId({ data: { applicationId: 42 } })).toBeUndefined();
      expect(extractApplicationId({ application: { id: 42 } })).toBeUndefined();
    });
  });
});
