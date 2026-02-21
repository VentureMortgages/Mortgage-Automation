/**
 * Original Email Store — Redis-backed storage for draft email bodies
 *
 * When a doc-request email draft is created, we store the original HTML body
 * and application context in Redis. When the BCC copy arrives (after Cat edits
 * and sends), we retrieve the original to diff against the sent version.
 *
 * TTL: 30 days (most drafts are sent within hours/days)
 *
 * Consumers: draft.ts (store), capture.ts (retrieve + delete)
 */

import { Redis as IORedis } from 'ioredis';
import { createRedisConnection } from '../webhook/queue.js';
import { feedbackConfig } from './config.js';
import type { ApplicationContext } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredOriginal {
  html: string;
  context: ApplicationContext;
}

// ---------------------------------------------------------------------------
// Redis Key
// ---------------------------------------------------------------------------

function redisKey(contactId: string): string {
  return `feedback:original:${contactId}`;
}

// ---------------------------------------------------------------------------
// Lazy Redis singleton
// ---------------------------------------------------------------------------

let _redis: IORedis | null = null;

function getRedis(): IORedis {
  if (_redis) return _redis;
  _redis = new IORedis(createRedisConnection());
  return _redis;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store the original email HTML and application context for later diffing.
 */
export async function storeOriginalEmail(
  contactId: string,
  data: StoredOriginal,
): Promise<void> {
  const redis = getRedis();
  await redis.set(
    redisKey(contactId),
    JSON.stringify(data),
    'EX',
    feedbackConfig.originalTtlSeconds,
  );
}

/**
 * Retrieve the stored original email for a contact.
 * Returns null if no original was stored or TTL expired.
 */
export async function getOriginalEmail(
  contactId: string,
): Promise<StoredOriginal | null> {
  const redis = getRedis();
  const raw = await redis.get(redisKey(contactId));
  if (!raw) return null;
  return JSON.parse(raw) as StoredOriginal;
}

/**
 * Delete the stored original after feedback has been captured.
 */
export async function deleteOriginalEmail(contactId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(redisKey(contactId));
}
