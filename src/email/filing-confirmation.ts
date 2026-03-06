/**
 * Filing Confirmation Email
 *
 * After all documents from a forwarded email have been classified and filed,
 * sends a confirmation email back to the sender (Cat) as an in-thread reply.
 *
 * Features:
 * - Tracks filing results per Gmail message in Redis
 * - Detects batch completion (all attachments processed)
 * - Sends plain-text confirmation listing each doc with OK/!!/XX status
 * - In-thread reply (In-Reply-To + References + threadId) so it appears
 *   in the same Gmail conversation as the forwarded email
 * - Sent from docs@ (not admin@) using gmail.compose scope
 * - Entirely non-fatal: confirmation failure never crashes the pipeline
 *
 * Phase 25 Plan 03
 */

import { Redis } from 'ioredis';
import { createRedisConnection } from '../webhook/queue.js';
import { encodeMimeMessage } from './mime.js';
import { getGmailComposeClient } from './gmail-client.js';
import { intakeConfig } from '../intake/config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilingResult {
  intakeDocumentId: string;
  originalFilename: string;
  borrowerName: string | null;
  docTypeLabel: string;
  filed: boolean;
  folderPath: string | null;
  manualReview: boolean;
  reason: string | null;
}

export interface MessageContext {
  gmailMessageId: string;
  gmailThreadId: string;
  gmailMessageRfc822Id: string | null;
  senderEmail: string;
  emailSubject: string;
  totalExpected: number;
}

// ---------------------------------------------------------------------------
// Redis Client (Lazy Singleton)
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (_redis) return _redis;
  const connConfig = createRedisConnection();
  _redis = new Redis(connConfig);
  return _redis;
}

// ---------------------------------------------------------------------------
// Redis Key Helpers
// ---------------------------------------------------------------------------

const RESULTS_PREFIX = 'filing-results:';
const CONTEXT_PREFIX = 'filing-context:';
const TTL_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// recordFilingResult
// ---------------------------------------------------------------------------

/**
 * Records a single filing result and checks if all results for the message
 * have been collected. If so, triggers the confirmation email.
 *
 * @param result - The filing outcome for one document
 * @param context - Gmail message context for threading
 */
export async function recordFilingResult(
  result: FilingResult,
  context: MessageContext,
): Promise<void> {
  const redis = getRedis();
  const resultsKey = `${RESULTS_PREFIX}${context.gmailMessageId}`;
  const contextKey = `${CONTEXT_PREFIX}${context.gmailMessageId}`;

  // Store result in Redis hash (field = intakeDocumentId, value = JSON)
  await redis.hset(resultsKey, result.intakeDocumentId, JSON.stringify(result));
  await redis.expire(resultsKey, TTL_SECONDS);

  // Store context once (NX = only if not exists)
  await redis.set(contextKey, JSON.stringify(context), 'EX', TTL_SECONDS, 'NX');

  // Check if all results are collected
  const count = await redis.hlen(resultsKey);
  if (count >= context.totalExpected) {
    await maybeSendConfirmation(context.gmailMessageId);
  }
}

// ---------------------------------------------------------------------------
// maybeSendConfirmation
// ---------------------------------------------------------------------------

/**
 * Checks if all filing results for a message are collected, and if so,
 * sends a confirmation email as an in-thread reply.
 *
 * Non-fatal: catches all errors and logs them.
 */
export async function maybeSendConfirmation(gmailMessageId: string): Promise<void> {
  try {
    const redis = getRedis();
    const resultsKey = `${RESULTS_PREFIX}${gmailMessageId}`;
    const contextKey = `${CONTEXT_PREFIX}${gmailMessageId}`;

    // Read all results
    const rawResults = await redis.hgetall(resultsKey);
    const rawContext = await redis.get(contextKey);

    if (!rawContext) {
      console.warn('[filing-confirmation] No context found for message:', gmailMessageId);
      return;
    }

    const context: MessageContext = JSON.parse(rawContext);
    const results: FilingResult[] = Object.values(rawResults).map(v => JSON.parse(v));

    // Check if batch is complete
    if (results.length < context.totalExpected) {
      return;
    }

    // Build confirmation body
    const body = buildConfirmationBody(results);

    // Build MIME message with threading support
    const raw = encodeMimeMessage({
      from: intakeConfig.docsInbox,
      to: context.senderEmail,
      subject: `Re: ${context.emailSubject}`,
      body,
      contentType: 'text/plain',
      ...(context.gmailMessageRfc822Id ? {
        inReplyTo: context.gmailMessageRfc822Id,
        references: context.gmailMessageRfc822Id,
      } : {}),
    });

    // Send via Gmail API as in-thread reply
    const gmail = getGmailComposeClient(intakeConfig.docsInbox);
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        threadId: context.gmailThreadId,
      },
    });

    console.log('[filing-confirmation] Confirmation sent:', {
      gmailMessageId,
      threadId: context.gmailThreadId,
      resultsCount: results.length,
    });

    // Clean up Redis keys
    await redis.del(resultsKey);
    await redis.del(contextKey);
  } catch (err) {
    // Confirmation failure is NON-FATAL — never crash the pipeline
    console.error('[filing-confirmation] Failed to send confirmation (non-fatal):', {
      gmailMessageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// buildConfirmationBody
// ---------------------------------------------------------------------------

/**
 * Builds a plain-text confirmation email body listing each document's
 * filing outcome.
 *
 * Uses simple ASCII indicators:
 * - OK: filed successfully
 * - !!: needs manual review
 * - XX: error (no classification)
 *
 * @param results - Array of filing results for all docs in the message
 * @returns Plain text body
 */
export function buildConfirmationBody(results: FilingResult[]): string {
  const lines: string[] = [
    'Filing confirmation:',
    '',
  ];

  for (const r of results) {
    if (r.filed) {
      const name = r.borrowerName ?? 'Unknown';
      lines.push(`  OK  ${name} - ${r.docTypeLabel} -> ${r.folderPath ?? 'Filed'}`);
    } else if (r.manualReview) {
      const name = r.borrowerName ?? 'Unknown';
      const reason = r.reason ? ` (${r.reason})` : '';
      lines.push(`  !!  ${name} - ${r.docTypeLabel} -> Needs Review${reason}`);
    } else {
      lines.push(`  XX  ${r.originalFilename} -> Error`);
    }
  }

  lines.push('');
  lines.push('-- Venture Mortgages Doc System');

  return lines.join('\n');
}
