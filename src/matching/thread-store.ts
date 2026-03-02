/**
 * Thread Store — Redis-backed threadId->contactId mapping
 *
 * When a doc-request email draft is created, the Gmail threadId is mapped
 * to the CRM contactId (and optionally opportunityId). When a reply arrives
 * in the same thread, the matching agent looks up the contactId via threadId
 * for instant matching (Tier 1 signal).
 *
 * TTL: 30 days (drafts are typically sent within hours/days)
 * Key pattern: matching:thread:{threadId}
 *
 * Consumers: draft.ts (store), matching agent (retrieve)
 */

import { Redis as IORedis } from 'ioredis';
import { createRedisConnection } from '../webhook/queue.js';
import { matchingConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThreadMapping {
  contactId: string;
  opportunityId?: string;
}

// ---------------------------------------------------------------------------
// Redis Key
// ---------------------------------------------------------------------------

function redisKey(threadId: string): string {
  return `matching:thread:${threadId}`;
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
 * Store a threadId->contactId mapping in Redis.
 * Called after creating a doc-request email draft.
 *
 * @param threadId - Gmail thread ID from the created draft
 * @param contactId - CRM contact ID the email was sent to
 * @param opportunityId - Optional CRM opportunity ID
 */
export async function storeThreadMapping(
  threadId: string,
  contactId: string,
  opportunityId?: string,
): Promise<void> {
  const redis = getRedis();
  const data: ThreadMapping = { contactId };
  if (opportunityId) {
    data.opportunityId = opportunityId;
  }
  await redis.set(
    redisKey(threadId),
    JSON.stringify(data),
    'EX',
    matchingConfig.threadMappingTtlSeconds,
  );
}

/**
 * Look up the contactId (and optional opportunityId) for a Gmail thread.
 * Returns null if no mapping exists or TTL expired.
 *
 * @param threadId - Gmail thread ID to look up
 * @returns Thread mapping or null
 */
export async function getThreadContactId(
  threadId: string,
): Promise<ThreadMapping | null> {
  const redis = getRedis();
  const raw = await redis.get(redisKey(threadId));
  if (!raw) return null;
  return JSON.parse(raw) as ThreadMapping;
}
