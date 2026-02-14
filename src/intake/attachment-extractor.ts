/**
 * Attachment Extractor — MIME Part Walking and Attachment Download
 *
 * Provides two functions for extracting attachments from Gmail messages:
 * 1. extractAttachments: recursively walks the MIME part tree to find all file attachments
 * 2. downloadAttachment: fetches and decodes base64url-encoded attachment data
 *
 * Special handling:
 * - message/rfc822 parts (.eml forwarded emails) are included with their mimeType
 *   so downstream code can flag them for manual review
 * - Parts without a filename are skipped (inline text/HTML parts)
 * - Nested multipart structures are fully traversed
 *
 * Consumers: Phase 6 Plan 04 (intake worker)
 */

import type { gmail_v1 } from 'googleapis';
import type { AttachmentInfo } from './types.js';

type MessagePart = gmail_v1.Schema$MessagePart;
type GmailClient = gmail_v1.Gmail;

// ---------------------------------------------------------------------------
// extractAttachments
// ---------------------------------------------------------------------------

/**
 * Recursively walks the MIME part tree and extracts attachment metadata.
 *
 * @param parts - The `payload.parts` array from a Gmail message
 * @returns Array of AttachmentInfo for all file attachments found
 */
export function extractAttachments(parts: MessagePart[] | undefined): AttachmentInfo[] {
  if (!parts || parts.length === 0) return [];

  const attachments: AttachmentInfo[] = [];
  walkParts(parts, attachments);
  return attachments;
}

/**
 * Recursive MIME part walker.
 * Collects file attachments (parts with filename + attachmentId).
 * Recurses into nested multipart structures (parts with sub-parts).
 */
function walkParts(parts: MessagePart[], result: AttachmentInfo[]): void {
  for (const part of parts) {
    // If this part has a filename and attachmentId, it's a file attachment
    if (part.filename && part.body?.attachmentId) {
      result.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        attachmentId: part.body.attachmentId,
        size: part.body.size ?? 0,
      });
    }

    // Recurse into nested parts (multipart/mixed, multipart/alternative, etc.)
    if (part.parts && part.parts.length > 0) {
      walkParts(part.parts, result);
    }
  }
}

// ---------------------------------------------------------------------------
// downloadAttachment
// ---------------------------------------------------------------------------

/**
 * Downloads and decodes a single attachment from a Gmail message.
 *
 * @param gmail - Authenticated Gmail client
 * @param messageId - The message containing the attachment
 * @param attachmentId - The attachment ID from extractAttachments
 * @returns Raw attachment data as a Buffer
 */
export async function downloadAttachment(
  gmail: GmailClient,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const response = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  const data = response.data.data;
  if (!data) {
    throw new Error(
      `[intake] Attachment ${attachmentId} on message ${messageId} returned no data`,
    );
  }

  // Gmail API returns base64url-encoded data
  return Buffer.from(data, 'base64url');
}
