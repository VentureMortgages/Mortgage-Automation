/**
 * Tests for Finmo Document Webhook Handler
 *
 * Tests cover:
 * - Accepts valid payload with applicationId + documentRequestId -> 202
 * - Rejects payload without documentRequestId -> 400
 * - Extracts from nested data.documentRequestId shape
 * - Dedup via jobId (verify queue.add called with correct jobId)
 *
 * Uses supertest with a minimal Express app wrapping the handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { finmoDocumentHandler } from '../finmo-docs.js';

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

function createTestApp(mockQueue: { add: ReturnType<typeof vi.fn> }) {
  const app = express();
  app.use(express.json());
  app.post(
    '/webhooks/finmo/documents',
    finmoDocumentHandler(mockQueue as unknown as import('bullmq').Queue),
  );
  return app;
}

describe('Finmo Document Handler', () => {
  let mockQueueAdd: ReturnType<typeof vi.fn>;
  let app: express.Express;

  beforeEach(() => {
    mockQueueAdd = vi.fn().mockResolvedValue(undefined);
    app = createTestApp({ add: mockQueueAdd });
  });

  it('accepts valid payload with applicationId + documentRequestId -> 202', async () => {
    const res = await request(app)
      .post('/webhooks/finmo/documents')
      .send({
        applicationId: 'app-123',
        documentRequestId: 'doc-456',
        status: 'submitted',
      });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'finmo-doc-upload',
      expect.objectContaining({
        source: 'finmo',
        applicationId: 'app-123',
        documentRequestId: 'doc-456',
        receivedAt: expect.any(String),
      }),
      { jobId: 'finmo-doc-doc-456' },
    );
  });

  it('rejects payload without documentRequestId -> 400', async () => {
    const res = await request(app)
      .post('/webhooks/finmo/documents')
      .send({
        applicationId: 'app-123',
        status: 'submitted',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing documentRequestId' });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('extracts from nested data.documentRequestId shape', async () => {
    const res = await request(app)
      .post('/webhooks/finmo/documents')
      .send({
        data: {
          applicationId: 'app-nested',
          documentRequestId: 'doc-nested-789',
        },
      });

    expect(res.status).toBe(202);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'finmo-doc-upload',
      expect.objectContaining({
        source: 'finmo',
        applicationId: 'app-nested',
        documentRequestId: 'doc-nested-789',
      }),
      { jobId: 'finmo-doc-doc-nested-789' },
    );
  });

  it('deduplicates via jobId using documentRequestId', async () => {
    await request(app)
      .post('/webhooks/finmo/documents')
      .send({ documentRequestId: 'dedup-test-001' });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'finmo-doc-upload',
      expect.objectContaining({
        documentRequestId: 'dedup-test-001',
      }),
      { jobId: 'finmo-doc-dedup-test-001' },
    );
  });

  it('accepts payload with only documentRequestId (no applicationId)', async () => {
    const res = await request(app)
      .post('/webhooks/finmo/documents')
      .send({ documentRequestId: 'doc-only-123' });

    expect(res.status).toBe(202);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'finmo-doc-upload',
      expect.objectContaining({
        source: 'finmo',
        applicationId: null,
        documentRequestId: 'doc-only-123',
      }),
      { jobId: 'finmo-doc-doc-only-123' },
    );
  });
});
