/**
 * Decision Log — Redis-backed matching decision storage (MATCH-06)
 *
 * Stores the complete matching decision for each document, including:
 * - All signals collected
 * - All candidate contacts considered
 * - Final chosen contact/opportunity/folder
 * - Confidence score and reasoning
 * - Outcome (auto_filed, needs_review, etc.)
 *
 * TTL: 90 days (per MATCH-06 requirement)
 * Key pattern: matching:decision:{intakeDocumentId}
 *
 * Consumers: matching agent (store), admin/debug endpoints (retrieve)
 */

import { Redis as IORedis } from 'ioredis';
import { createRedisConnection } from '../webhook/queue.js';
import { matchingConfig } from './config.js';
import type { MatchDecision } from './types.js';

// ---------------------------------------------------------------------------
// Redis Key
// ---------------------------------------------------------------------------

function redisKey(intakeDocumentId: string): string {
  return `matching:decision:${intakeDocumentId}`;
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
 * Store a matching decision in Redis with 90-day TTL.
 * Called by the matching agent after resolving a document's owner.
 *
 * @param decision - Complete matching decision record
 */
export async function logMatchDecision(decision: MatchDecision): Promise<void> {
  const redis = getRedis();
  await redis.set(
    redisKey(decision.intakeDocumentId),
    JSON.stringify(decision),
    'EX',
    matchingConfig.decisionLogTtlSeconds,
  );
}

/**
 * Retrieve a stored matching decision by intake document ID.
 * Returns null if no decision was stored or TTL expired.
 *
 * @param intakeDocumentId - The document's intake ID
 * @returns Stored decision or null
 */
export async function getMatchDecision(
  intakeDocumentId: string,
): Promise<MatchDecision | null> {
  const redis = getRedis();
  const raw = await redis.get(redisKey(intakeDocumentId));
  if (!raw) return null;
  return JSON.parse(raw) as MatchDecision;
}
