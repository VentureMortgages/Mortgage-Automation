/**
 * HTML Extractor — Extracts email body HTML from Gmail messages
 *
 * When a BCC copy arrives, this extracts the HTML body content so it can
 * be diffed against the original draft. Walks the MIME part tree similar
 * to attachment-extractor.ts but looks for text/html body content.
 *
 * Consumers: capture.ts
 */

import type { gmail_v1 } from 'googleapis';

type GmailClient = gmail_v1.Gmail;
type MessagePart = gmail_v1.Schema$MessagePart;

/**
 * Extract the HTML body from a Gmail message.
 *
 * Fetches the full message, then walks the MIME part tree looking for
 * text/html content. Decodes base64url body data to a UTF-8 string.
 *
 * @param gmail - Authenticated Gmail client (readonly scope is sufficient)
 * @param messageId - The Gmail message ID
 * @returns The HTML body string, or null if no HTML body found
 */
export async function extractEmailHtml(
  gmail: GmailClient,
  messageId: string,
): Promise<string | null> {
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const payload = response.data.payload;
  if (!payload) return null;

  // Try multipart parts first
  if (payload.parts && payload.parts.length > 0) {
    const html = findHtmlPart(payload.parts);
    if (html) return html;
  }

  // Fallback: non-multipart message with direct body
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return null;
}

/**
 * Recursively walk MIME parts looking for text/html content.
 */
function findHtmlPart(parts: MessagePart[]): string | null {
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }

    // Recurse into nested parts (multipart/alternative, multipart/mixed, etc.)
    if (part.parts && part.parts.length > 0) {
      const found = findHtmlPart(part.parts);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Decode Gmail's base64url-encoded body data to UTF-8 string.
 */
function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}
