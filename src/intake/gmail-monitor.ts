/**
 * Gmail Monitor — BullMQ Job Scheduler for Periodic Inbox Polling
 *
 * Manages periodic polling of the docs@ inbox for new document emails.
 * Uses BullMQ's upsertJobScheduler (not deprecated `add` with `repeat`)
 * to create a repeating poll job at a configurable interval.
 *
 * History ID persistence:
 * - The last successfully processed Gmail historyId is stored in Redis
 * - On startup/restart, the stored historyId is used to resume polling
 *   from where the process left off (crash recovery)
 * - If no stored historyId exists (first run), getInitialHistoryId seeds it
 *
 * Queue management:
 * - Lazy singleton Queue instance (same pattern as webhook/queue.ts)
 * - Default job options: 3 attempts, exponential backoff, 24h retention
 *
 * Consumers: src/index.ts (startup), intake-worker.ts (processes enqueued jobs)
 */

import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { createRedisConnection } from '../webhook/queue.js';
import { intakeConfig } from './config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INTAKE_QUEUE_NAME = 'doc-intake';
const HISTORY_ID_KEY = 'intake:gmail:historyId';

// ---------------------------------------------------------------------------
// History ID Persistence (Redis)
// ---------------------------------------------------------------------------

/**
 * Reads the stored Gmail historyId from Redis.
 * Returns null on first run (key does not exist).
 *
 * Creates and closes a Redis connection per call to avoid
 * keeping long-lived connections open between polls.
 */
export async function getStoredHistoryId(): Promise<string | null> {
  const conn = createRedisConnection();
  const redis = new IORedis(conn);

  try {
    const value = await redis.get(HISTORY_ID_KEY);
    return value ?? null;
  } finally {
    await redis.quit();
  }
}

/**
 * Writes the Gmail historyId to Redis for crash recovery.
 * Called after each successful poll to persist the checkpoint.
 */
export async function storeHistoryId(historyId: string): Promise<void> {
  const conn = createRedisConnection();
  const redis = new IORedis(conn);

  try {
    await redis.set(HISTORY_ID_KEY, historyId);
  } finally {
    await redis.quit();
  }
}

// ---------------------------------------------------------------------------
// Intake Queue (Lazy Singleton)
// ---------------------------------------------------------------------------

let _queue: Queue | null = null;

/**
 * Get the singleton BullMQ intake queue instance.
 *
 * Creates the queue on first call with:
 * - 3 retry attempts with exponential backoff (10s base)
 * - 24h completed job retention
 * - Failed jobs preserved indefinitely (dead-letter for manual review)
 */
export function getIntakeQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(INTAKE_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10000, // 10s, 20s, 40s
        },
        removeOnComplete: { age: 86400 }, // Keep 24h for dedup window
        removeOnFail: false, // Dead-letter: keep failed jobs for manual review
      },
    });
  }
  return _queue;
}

/**
 * Close the intake queue connection for graceful shutdown.
 * Resets the singleton so a new connection can be created if needed.
 */
export async function closeIntakeQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}

// ---------------------------------------------------------------------------
// Gmail Monitor Scheduler
// ---------------------------------------------------------------------------

/**
 * Starts the Gmail monitor by creating a BullMQ job scheduler.
 *
 * Uses `upsertJobScheduler` to schedule periodic polling at the configured interval.
 * If intake is disabled (INTAKE_ENABLED=false), logs a warning and returns.
 *
 * @param queue - The BullMQ Queue to schedule jobs on
 */
export async function startGmailMonitor(queue: Queue): Promise<void> {
  if (!intakeConfig.enabled) {
    console.log('[intake] Gmail monitor disabled (INTAKE_ENABLED=false)');
    return;
  }

  await queue.upsertJobScheduler(
    'gmail-poll-docs',
    { every: intakeConfig.pollIntervalMs },
    {
      name: 'poll-docs-inbox',
      data: {
        source: 'gmail',
        receivedAt: new Date().toISOString(),
      },
    },
  );

  console.log(
    `[intake] Gmail monitor started, polling every ${intakeConfig.pollIntervalMs / 1000}s`,
  );
}
