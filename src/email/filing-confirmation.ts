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
 * filing outcome. Written in a human, professional tone (as if from an assistant).
 *
 * @param results - Array of filing results for all docs in the message
 * @returns Plain text body
 */
export function buildConfirmationBody(results: FilingResult[]): string {
  const filed = results.filter(r => r.filed);
  const needsReview = results.filter(r => r.manualReview);
  const errors = results.filter(r => !r.filed && !r.manualReview);

  const lines: string[] = [];

  // Opening line
  const total = results.length;
  const docWord = total === 1 ? 'document' : 'documents';

  if (filed.length === total) {
    lines.push(`Got it — filed ${total} ${docWord}.`);
  } else if (filed.length > 0) {
    lines.push(`Got ${total} ${docWord}. Here's what happened:`);
  } else {
    lines.push(`Received ${total} ${docWord}, but couldn't file automatically:`);
  }

  lines.push('');

  // Filed docs
  for (const r of filed) {
    const name = r.borrowerName ?? 'Unknown client';
    lines.push(`  Filed: ${name} — ${r.docTypeLabel}`);
  }

  // Needs review
  for (const r of needsReview) {
    const name = r.borrowerName ?? 'Unknown client';
    const reason = r.reason ? ` — ${r.reason}` : '';
    lines.push(`  Needs review: ${name} — ${r.docTypeLabel}${reason}`);
  }

  // Errors
  for (const r of errors) {
    lines.push(`  Could not process: ${r.originalFilename}`);
  }

  // Footer note if anything needs attention
  if (needsReview.length > 0 || errors.length > 0) {
    lines.push('');
    const reviewCount = needsReview.length + errors.length;
    const itemWord = reviewCount === 1 ? 'item' : 'items';
    lines.push(`${reviewCount} ${itemWord} moved to Needs Review for you to check.`);
  }

  return lines.join('\n');
}
