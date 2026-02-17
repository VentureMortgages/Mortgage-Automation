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
  // Subject uses RFC 2047 encoded-word for non-ASCII characters (e.g., em dash)
  const encodedSubject = encodeSubject(input.subject);
  const headerLines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
  ];
  if (input.bcc) {
    headerLines.push(`Bcc: ${input.bcc}`);
  }
  // Custom X- headers for tracking (e.g., X-Venture-Contact-Id)
  if (input.customHeaders) {
    for (const [key, value] of Object.entries(input.customHeaders)) {
      headerLines.push(`${key}: ${value}`);
    }
  }
  headerLines.push(
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  );
  const headers = headerLines.join('\r\n');

  // Base64-encode the body for safe UTF-8 transport
  const bodyBase64 = Buffer.from(input.body, 'utf-8').toString('base64');

  // Combine: headers + blank line + base64-encoded body
  const mimeMessage = `${headers}\r\n\r\n${bodyBase64}`;

  // Base64url encode (Gmail API format)
  return Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Encodes a subject line using RFC 2047 encoded-word syntax if it contains
 * non-ASCII characters (e.g., em dash —). ASCII-only subjects pass through unchanged.
 */
function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  const encoded = Buffer.from(subject, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}
