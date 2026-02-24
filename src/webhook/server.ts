/**
 * Express Webhook Server
 *
 * HTTP layer for receiving Finmo resthook callbacks. Routes:
 * - POST /webhooks/finmo — Accept webhook, extract applicationId, enqueue to BullMQ
 * - GET /health — Server status and kill switch state
 *
 * The webhook endpoint:
 * 1. Checks kill switch (returns 503 if active)
 * 2. Extracts applicationId from multiple payload shapes (Finmo format TBD)
 * 3. Enqueues job with dedup key (jobId = finmo-app-{applicationId})
 * 4. Returns 202 Accepted
 *
 * No PII is logged — payload is sanitized before any console output.
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { appConfig } from '../config.js';
import { getWebhookQueue } from './queue.js';
import { sanitizeForLog } from './sanitize.js';
import { healthHandler } from './health.js';
import { getIntakeQueue } from '../intake/gmail-monitor.js';
import type { WebhookPayload, JobData } from './types.js';

/**
 * Extract applicationId from a webhook payload.
 *
 * Tries multiple payload shapes since Finmo's exact resthook format
 * is not yet documented. Supports:
 * - { applicationId: "abc-123" } — direct field
 * - { data: { applicationId: "abc-123" } } — nested in data
 * - { application: { id: "abc-123" } } — nested in application object
 * - { id: "abc-123" } — top-level id (if it contains a hyphen, likely a UUID)
 */
export function extractApplicationId(payload: WebhookPayload): string | undefined {
  // Direct field
  if (typeof payload.applicationId === 'string') {
    return payload.applicationId;
  }

  // Nested in data object
  if (
    payload.data &&
    typeof payload.data === 'object' &&
    typeof (payload.data as Record<string, unknown>).applicationId === 'string'
  ) {
    return (payload.data as Record<string, unknown>).applicationId as string;
  }

  // Nested in application object
  if (
    payload.application &&
    typeof payload.application === 'object' &&
    typeof (payload.application as Record<string, unknown>).id === 'string'
  ) {
    return (payload.application as Record<string, unknown>).id as string;
  }

  // Top-level id with hyphen (likely a UUID, not a simple numeric id)
  if (typeof payload.id === 'string' && payload.id.includes('-')) {
    return payload.id;
  }

  return undefined;
}

/**
 * Create the Express application with all routes configured.
 *
 * Exported as a factory function so tests can create fresh app instances
 * without shared state between test cases.
 */
export function createApp() {
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', healthHandler);

  // Finmo webhook endpoint
  app.post('/webhooks/finmo', async (req: Request, res: Response) => {
    // Kill switch check — return 503 so Finmo retries later
    if (appConfig.killSwitch) {
      console.log('[webhook] Kill switch active — rejecting webhook');
      res.status(503).json({ message: 'Automation disabled' });
      return;
    }

    const payload = req.body as WebhookPayload;

    // Extract applicationId from payload (multiple shapes supported)
    const applicationId = extractApplicationId(payload);
    if (!applicationId) {
      console.warn('[webhook] No applicationId found in payload', sanitizeForLog(payload));
      res.status(400).json({ error: 'Missing applicationId' });
      return;
    }

    // Extract finmoDealId from payload (e.g. "BRXM-F050746")
    const finmoDealId = typeof payload.finmoDealId === 'string' ? payload.finmoDealId : undefined;

    // Enqueue with dedup via jobId — same applicationId = same job
    const jobData: JobData = {
      applicationId,
      receivedAt: new Date().toISOString(),
      ...(finmoDealId && { finmoDealId }),
    };

    const queue = getWebhookQueue();
    await queue.add('process-application', jobData, {
      jobId: `finmo-app-${applicationId}`, // Deduplication key
      delay: 5 * 60 * 1000, // 5 min — wait for Finmo to create MBP opportunity
    });

    console.log('[webhook] Enqueued', { applicationId, finmoDealId: finmoDealId ?? null, jobId: `finmo-app-${applicationId}` });
    res.status(202).json({ accepted: true, applicationId });
  });

  // Admin: reprocess a Gmail message (bypasses history.list + BullMQ dedup)
  app.post('/admin/reprocess-message', async (req: Request, res: Response) => {
    const { messageId } = req.body as { messageId?: string };
    if (!messageId) {
      res.status(400).json({ error: 'Missing messageId' });
      return;
    }

    const queue = getIntakeQueue();
    const jobId = `gmail-${messageId}`;

    // Remove existing completed/failed job if present (clears dedup)
    const existing = await queue.getJob(jobId);
    if (existing) {
      await existing.remove();
      console.log('[admin] Removed existing job', { jobId });
    }

    // Enqueue for reprocessing
    await queue.add('process-gmail-message', {
      source: 'gmail' as const,
      gmailMessageId: messageId,
      receivedAt: new Date().toISOString(),
    }, { jobId });

    console.log('[admin] Reprocessing message', { messageId, jobId });
    res.json({ success: true, jobId });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
