/**
 * Feedback Store — Redis-backed persistence for feedback records
 *
 * Stores feedback records as individual entries in a Redis list.
 * Expected volume is <100 records over months — Redis list is sufficient.
 *
 * Moved from JSON file to Redis because Railway's filesystem is ephemeral
 * (data lost on every deploy).
 *
 * Consumers: capture.ts (append), retriever.ts (load)
 */

import { Redis as IORedis } from 'ioredis';
import { createRedisConnection } from '../webhook/queue.js';
import type { FeedbackRecord } from './types.js';

const RECORDS_KEY = 'feedback:records';

// ---------------------------------------------------------------------------
// Lazy Redis singleton
// ---------------------------------------------------------------------------

let _redis: IORedis | null = null;

function getRedis(): IORedis {
  if (_redis) return _redis;
  _redis = new IORedis(createRedisConnection());
  return _redis;
}

/**
 * Load all feedback records from Redis.
 * Returns an empty array if no records exist yet.
 */
export async function loadFeedbackRecords(): Promise<FeedbackRecord[]> {
  const redis = getRedis();
  const items = await redis.lrange(RECORDS_KEY, 0, -1);
  return items.map((raw) => JSON.parse(raw) as FeedbackRecord);
}

/**
 * Append a feedback record to Redis.
 */
export async function appendFeedbackRecord(record: FeedbackRecord): Promise<void> {
  const redis = getRedis();
  await redis.rpush(RECORDS_KEY, JSON.stringify(record));
}
