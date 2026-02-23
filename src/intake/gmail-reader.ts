/**
 * Gmail Reader — Inbox Polling via History API
 *
 * Provides three functions for reading the Gmail inbox:
 * 1. getInitialHistoryId: gets the current historyId from the user's profile
 * 2. pollForNewMessages: polls for new messages since a given historyId using history.list
 * 3. getMessageDetails: fetches message metadata (from, subject, date, etc.)
 *
 * All functions accept the gmail client as the first parameter (pure, testable).
 * The caller (intake monitor) provides the authenticated client.
 *
 * Stale historyId recovery: if history.list returns 404 (stale/expired historyId),
 * falls back to messages.list with newer_than:1d filter and refreshes the historyId.
 *
 * Consumers: Phase 6 Plan 04 (intake monitor/worker)
 */

import type { gmail_v1 } from 'googleapis';
import type { GmailMessageMeta } from './types.js';

type GmailClient = gmail_v1.Gmail;

// ---------------------------------------------------------------------------
// getInitialHistoryId
// ---------------------------------------------------------------------------

/**
 * Returns the current historyId from the user's Gmail profile.
 * Used on first startup when no stored historyId exists.
 */
export async function getInitialHistoryId(gmail: GmailClient): Promise<string> {
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const historyId = profile.data.historyId;

  if (!historyId) {
    throw new Error('[intake] Gmail profile returned no historyId');
  }

  return historyId;
}

// ---------------------------------------------------------------------------
// pollForNewMessages
// ---------------------------------------------------------------------------

/**
 * Polls for new inbox messages since the given historyId.
 *
 * Uses the Gmail history.list API for efficient delta reads.
 * If the historyId is stale (expired from Gmail's history window),
 * falls back to messages.list with newer_than:1d.
 *
 * @returns messageIds (deduplicated) and newHistoryId for next poll
 */
export async function pollForNewMessages(
  gmail: GmailClient,
  startHistoryId: string,
): Promise<{ messageIds: string[]; newHistoryId: string }> {
  try {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
    });

    const history = response.data.history ?? [];
    const messageIdSet = new Set<string>();

    for (const record of history) {
      const messagesAdded = record.messagesAdded ?? [];
      for (const added of messagesAdded) {
        if (added.message?.id) {
          messageIdSet.add(added.message.id);
        }
      }
    }

    // Use the historyId from the response for next poll, fall back to input
    const newHistoryId = response.data.historyId ?? startHistoryId;

    return {
      messageIds: [...messageIdSet],
      newHistoryId,
    };
  } catch (err: unknown) {
    // Check for stale historyId (404 or "notFound" error)
    if (isStaleHistoryError(err)) {
      console.warn('[intake] historyId stale, falling back to recent messages');
      return fallbackToRecentMessages(gmail);
    }
    throw err;
  }
}

/**
 * Detects whether an error indicates a stale/expired historyId.
 * Gmail returns 404 when the historyId is too old.
 */
function isStaleHistoryError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;

  // Google API errors have a code property
  if ('code' in err && (err as { code: number }).code === 404) return true;

  // Also check for "notFound" in the message
  if (err instanceof Error && err.message.includes('notFound')) return true;

  return false;
}

/**
 * Fallback when historyId is stale: fetches recent inbox messages
 * and a fresh historyId from the user's profile.
 */
async function fallbackToRecentMessages(
  gmail: GmailClient,
): Promise<{ messageIds: string[]; newHistoryId: string }> {
  const [messagesResponse, profileResponse] = await Promise.all([
    gmail.users.messages.list({
      userId: 'me',
      q: 'newer_than:1d',
      labelIds: ['INBOX'],
      maxResults: 50,
    }),
    gmail.users.getProfile({ userId: 'me' }),
  ]);

  const messages = messagesResponse.data.messages ?? [];
  const messageIds = messages
    .map((m) => m.id)
    .filter((id): id is string => id != null);

  const newHistoryId = profileResponse.data.historyId;
  if (!newHistoryId) {
    throw new Error('[intake] Gmail profile returned no historyId during fallback');
  }

  return { messageIds, newHistoryId };
}

// ---------------------------------------------------------------------------
// getMessageDetails
// ---------------------------------------------------------------------------

/**
 * Fetches full message details and extracts metadata.
 *
 * Parses the From header to extract the email address
 * (handles both "Name <email>" and plain "email" formats).
 */
export async function getMessageDetails(
  gmail: GmailClient,
  messageId: string,
): Promise<GmailMessageMeta> {
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = response.data.payload?.headers ?? [];
  const getHeader = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

  const fromRaw = getHeader('From');
  const from = parseEmailFromHeader(fromRaw);

  // Check X- headers first (may be stripped by Gmail on send)
  let ventureType = getHeader('X-Venture-Type') || undefined;
  let ventureContactId = getHeader('X-Venture-Contact-Id') || undefined;

  // Fallback: parse hidden HTML comment embedded in email body
  // (Gmail preserves body content but strips custom X- headers)
  if (!ventureType || !ventureContactId) {
    const htmlBody = extractHtmlBodyText(response.data.payload ?? undefined);
    if (htmlBody) {
      const match = htmlBody.match(/<!-- venture:doc-request:(\S+) -->/);
      if (match) {
        ventureType = 'doc-request';
        ventureContactId = match[1];
      }
    }
  }

  return {
    messageId: response.data.id ?? messageId,
    threadId: response.data.threadId ?? null,
    from,
    subject: getHeader('Subject'),
    date: getHeader('Date'),
    historyId: response.data.historyId ?? '',
    ventureType,
    ventureContactId,
  };
}

/**
 * Extracts the HTML body text from a Gmail message payload.
 * Walks MIME parts recursively looking for text/html content.
 * Decodes base64url-encoded body data.
 */
function extractHtmlBodyText(
  payload: gmail_v1.Schema$MessagePart | undefined,
): string | null {
  if (!payload) return null;

  // Direct body (non-multipart)
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Walk parts recursively
  for (const part of payload.parts ?? []) {
    const result = extractHtmlBodyText(part);
    if (result) return result;
  }

  return null;
}

/**
 * Extracts the email address from a From header value.
 * Handles formats:
 * - "John Doe <john@example.com>" -> "john@example.com"
 * - "john@example.com" -> "john@example.com"
 * - "<john@example.com>" -> "john@example.com"
 */
function parseEmailFromHeader(fromHeader: string): string {
  // Match email inside angle brackets
  const match = fromHeader.match(/<([^>]+)>/);
  if (match) return match[1];

  // Already a bare email address (or empty)
  return fromHeader.trim();
}
