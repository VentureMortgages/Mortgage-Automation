/**
 * BullMQ Queue Configuration
 *
 * Manages the Finmo webhook processing queue with:
 * - Deduplication via BullMQ jobId (same applicationId = same job)
 * - Exponential backoff retry (5 attempts: 5s, 10s, 20s, 40s, 80s)
 * - 24h job retention for dedup window
 * - Failed job preservation for manual review (dead-letter pattern)
 *
 * Uses lazy singleton pattern — queue is not created until first access.
 * This prevents Redis connections during module import (breaks tests).
 */

import { Queue } from 'bullmq';
import { appConfig } from '../config.js';

export const QUEUE_NAME = 'finmo-webhooks';

/** Redis connection config shape for BullMQ */
interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
}

/**
 * Parse a Redis URL into a connection config object.
 *
 * Supports redis:// and rediss:// (TLS) URL formats.
 * Used when REDIS_URL is set (e.g., Railway/Render provides this).
 */
function parseRedisUrl(url: string): RedisConnectionConfig {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Create a Redis connection config for BullMQ.
 *
 * If REDIS_URL is set, parses it into host/port/password components.
 * Otherwise uses individual REDIS_HOST/PORT/PASSWORD env vars.
 *
 * maxRetriesPerRequest: null is required by BullMQ for blocking commands.
 */
export function createRedisConnection(): RedisConnectionConfig {
  if (appConfig.redis.url) {
    return parseRedisUrl(appConfig.redis.url);
  }

  return {
    host: appConfig.redis.host,
    port: appConfig.redis.port,
    password: appConfig.redis.password,
    maxRetriesPerRequest: null,
  };
}

// Lazy singleton — don't connect at import time
let _queue: Queue | null = null;

/**
 * Get the singleton BullMQ queue instance.
 *
 * Creates the queue on first call with:
 * - 5 retry attempts with exponential backoff (5s base)
 * - 24h completed job retention (supports dedup window)
 * - Failed jobs preserved indefinitely (dead-letter for manual review)
 */
export function getWebhookQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s, 10s, 20s, 40s, 80s
        },
        removeOnComplete: { age: 86400 }, // Keep 24h for dedup window
        removeOnFail: false, // Dead-letter: keep failed jobs for manual review
      },
    });
  }
  return _queue;
}

/**
 * Close the queue connection for graceful shutdown.
 * Resets the singleton so a new connection can be created if needed.
 */
export async function closeQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
