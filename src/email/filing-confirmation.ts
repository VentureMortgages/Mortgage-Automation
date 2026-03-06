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
  driveFileId: string | null;
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
      contentType: 'text/html',
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
    lines.push(`Got it &mdash; filed ${total} ${docWord}.`);
  } else if (filed.length > 0) {
    lines.push(`Got ${total} ${docWord}. Here&rsquo;s what happened:`);
  } else {
    lines.push(`Received ${total} ${docWord}, but couldn&rsquo;t file automatically:`);
  }

  lines.push('<br>');

  // Filed docs
  for (const r of filed) {
    const name = r.borrowerName ?? 'Unknown client';
    if (r.driveFileId) {
      const url = `https://drive.google.com/file/d/${r.driveFileId}/view`;
      lines.push(`&nbsp;&nbsp;Filed: ${name} &mdash; <a href="${url}">${r.docTypeLabel}</a>`);
    } else {
      lines.push(`&nbsp;&nbsp;Filed: ${name} &mdash; ${r.docTypeLabel}`);
    }
  }

  // Needs review
  for (const r of needsReview) {
    const name = r.borrowerName ?? 'Unknown client';
    const reason = r.reason ? ` &mdash; ${r.reason}` : '';
    lines.push(`&nbsp;&nbsp;Needs review: ${name} &mdash; ${r.docTypeLabel}${reason}`);
  }

  // Errors
  for (const r of errors) {
    lines.push(`&nbsp;&nbsp;Could not process: ${r.originalFilename}`);
  }

  // Footer note if anything needs attention
  if (needsReview.length > 0 || errors.length > 0) {
    lines.push('<br>');
    const reviewCount = needsReview.length + errors.length;
    const itemWord = reviewCount === 1 ? 'item' : 'items';
    lines.push(`${reviewCount} ${itemWord} moved to Needs Review for you to check.`);
  }

  return lines.join('<br>');
}

// ---------------------------------------------------------------------------
// Phase 26: Pending Choice Types & Storage
// ---------------------------------------------------------------------------

/**
 * Represents a pending filing choice awaiting Cat's reply.
 * Stored in Redis keyed by threadId so a reply to the thread resolves it.
 */
export interface PendingChoice {
  options: Array<{ folderId: string; folderName: string }>;
  documentInfo: {
    intakeDocumentId: string;
    originalFilename: string;
    docTypeLabel: string;
    driveFileId: string;
    needsReviewFolderId: string;
  };
  contactId: string | null;
  threadContext: {
    gmailThreadId: string;
    gmailMessageRfc822Id: string | null;
    senderEmail: string;
    emailSubject: string;
  };
  createdAt: string;
}

const PENDING_CHOICE_PREFIX = 'pending-choice:';
const PENDING_CHOICE_TTL = 86400; // 24 hours

// ---------------------------------------------------------------------------
// buildQuestionBody
// ---------------------------------------------------------------------------

/**
 * Builds a conversational plain-text email body asking Cat which folder to
 * file a document into. Lists options as a numbered list.
 *
 * @param originalFilename - The original filename of the document
 * @param docTypeLabel - Human-readable doc type label (e.g., "T4", "Pay Stub")
 * @param options - Array of folder name options to present
 * @returns Plain text body for the question email
 */
export function buildQuestionBody(
  originalFilename: string,
  docTypeLabel: string,
  options: Array<{ folderName: string }>,
): string {
  const lines: string[] = [];

  lines.push(`I received "${originalFilename}" (${docTypeLabel}) but I'm not sure where to file it.`);
  lines.push('');
  lines.push('I found a few possible folders:');
  lines.push('');

  for (let i = 0; i < options.length; i++) {
    lines.push(`  ${i + 1}. ${options[i].folderName}`);
  }

  lines.push('');
  lines.push('Which one should I use? You can reply with the number, the folder name, "create new folder", or "skip" to leave it in Needs Review.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// storePendingChoice / getPendingChoice / deletePendingChoice
// ---------------------------------------------------------------------------

/**
 * Stores a pending filing choice in Redis, keyed by threadId.
 * Expires after 24 hours.
 *
 * @param threadId - Gmail thread ID to key the choice by
 * @param choice - The pending choice data
 */
export async function storePendingChoice(
  threadId: string,
  choice: PendingChoice,
): Promise<void> {
  const redis = getRedis();
  await redis.set(
    `${PENDING_CHOICE_PREFIX}${threadId}`,
    JSON.stringify(choice),
    'EX',
    PENDING_CHOICE_TTL,
  );
}

/**
 * Retrieves a pending filing choice from Redis by threadId.
 *
 * @param threadId - Gmail thread ID
 * @returns The pending choice, or null if not found / expired
 */
export async function getPendingChoice(
  threadId: string,
): Promise<PendingChoice | null> {
  const redis = getRedis();
  const raw = await redis.get(`${PENDING_CHOICE_PREFIX}${threadId}`);
  if (!raw) return null;
  return JSON.parse(raw) as PendingChoice;
}

/**
 * Deletes a pending filing choice from Redis.
 *
 * @param threadId - Gmail thread ID
 */
export async function deletePendingChoice(threadId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`${PENDING_CHOICE_PREFIX}${threadId}`);
}

// ---------------------------------------------------------------------------
// buildFollowUpBody
// ---------------------------------------------------------------------------

/**
 * Builds the plain-text body for a follow-up confirmation email after
 * the filing action has been executed.
 *
 * @param action - The filing action that was executed
 * @param folderName - The folder name (used for select and create_new actions)
 * @returns Plain text body for the follow-up email
 */
export function buildFollowUpBody(
  action: 'select' | 'create_new' | 'skip' | 'unclear',
  folderName?: string,
): string {
  switch (action) {
    case 'select':
      return `Done -- filed to ${folderName}.`;
    case 'create_new':
      return `Done -- created new folder '${folderName}' and filed there.`;
    case 'skip':
      return `Got it, leaving in Needs Review.`;
    case 'unclear':
      return `Sorry, I wasn't sure which one you meant. Could you clarify?`;
  }
}

// ---------------------------------------------------------------------------
// sendFollowUpConfirmation
// ---------------------------------------------------------------------------

/**
 * Sends a follow-up confirmation email as an in-thread reply after a filing
 * action has been executed (or a clarification is needed).
 *
 * Same MIME threading pattern as sendQuestionEmail and maybeSendConfirmation.
 *
 * @param threadContext - Thread context from the pending choice
 * @param body - Plain text body (from buildFollowUpBody)
 */
export async function sendFollowUpConfirmation(
  threadContext: PendingChoice['threadContext'],
  body: string,
): Promise<void> {
  const raw = encodeMimeMessage({
    from: intakeConfig.docsInbox,
    to: threadContext.senderEmail,
    subject: `Re: ${threadContext.emailSubject}`,
    body,
    contentType: 'text/plain',
    ...(threadContext.gmailMessageRfc822Id ? {
      inReplyTo: threadContext.gmailMessageRfc822Id,
      references: threadContext.gmailMessageRfc822Id,
    } : {}),
  });

  const gmail = getGmailComposeClient(intakeConfig.docsInbox);
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId: threadContext.gmailThreadId,
    },
  });

  console.log('[filing-confirmation] Follow-up confirmation sent:', {
    threadId: threadContext.gmailThreadId,
    senderEmail: threadContext.senderEmail,
  });
}

// ---------------------------------------------------------------------------
// sendQuestionEmail
// ---------------------------------------------------------------------------

/**
 * Sends a question email as an in-thread reply to the original forwarding thread.
 * Same MIME threading pattern as maybeSendConfirmation.
 *
 * @param context - Gmail message context for threading
 * @param body - Plain text body (from buildQuestionBody)
 */
export async function sendQuestionEmail(
  context: MessageContext,
  body: string,
): Promise<void> {
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

  const gmail = getGmailComposeClient(intakeConfig.docsInbox);
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId: context.gmailThreadId,
    },
  });

  console.log('[filing-confirmation] Question email sent:', {
    threadId: context.gmailThreadId,
    senderEmail: context.senderEmail,
  });
}
