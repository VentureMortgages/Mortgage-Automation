/**
 * MIME Message Encoder
 *
 * Constructs an RFC 2822 compliant MIME message and base64url encodes it
 * for the Gmail API `message.raw` field.
 *
 * - Headers use CRLF (\r\n) line endings per RFC 2822
 * - Body newlines (\n) are converted to CRLF for compliance
 * - Output is base64url encoded (no +, /, or = padding)
 *
 * No external dependencies — uses Node.js built-in Buffer.
 */

import type { MimeMessageInput } from './types.js';

/**
 * Encodes a plain text email as a base64url-encoded RFC 2822 MIME message.
 *
 * @param input - Message headers and body
 * @returns base64url-encoded string suitable for Gmail API raw field
 */
export function encodeMimeMessage(input: MimeMessageInput): string {
  // Build MIME headers (joined with CRLF)
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
  ].join('\r\n');

  // Convert body newlines to CRLF for RFC 2822 compliance
  const body = input.body.replace(/\r?\n/g, '\r\n');

  // Combine: headers + blank line + body
  const mimeMessage = `${headers}\r\n\r\n${body}`;

  // Base64url encode (Gmail API format)
  return Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
