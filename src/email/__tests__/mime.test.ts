// ============================================================================
// Tests: MIME Encoder — encodeMimeMessage
// ============================================================================
//
// Tests that encodeMimeMessage produces valid base64url-encoded RFC 2822 MIME
// content with CRLF line endings, suitable for the Gmail API raw field.
//
// TDD RED phase: these tests are written before the implementation exists.

import { describe, test, expect } from 'vitest';
import { encodeMimeMessage } from '../mime.js';
import type { MimeMessageInput } from '../types.js';

// ---------------------------------------------------------------------------
// Helper: decode base64url back to string for verification
// ---------------------------------------------------------------------------

function decodeBase64url(encoded: string): string {
  // Restore standard base64: - -> +, _ -> /
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// ---------------------------------------------------------------------------
// Standard fixture
// ---------------------------------------------------------------------------

const standardInput: MimeMessageInput = {
  to: 'recipient@test.com',
  from: 'sender@test.com',
  subject: 'Test Subject',
  body: 'Hello, this is the email body.',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('encodeMimeMessage', () => {
  test('produces base64url-safe output (no +, /, or = padding)', () => {
    const encoded = encodeMimeMessage(standardInput);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('decoded output contains CRLF line endings in headers', () => {
    const encoded = encodeMimeMessage(standardInput);
    const decoded = decodeBase64url(encoded);
    // Headers should be separated by CRLF
    expect(decoded).toContain('\r\n');
  });

  test('decoded output contains From header', () => {
    const encoded = encodeMimeMessage(standardInput);
    const decoded = decodeBase64url(encoded);
    expect(decoded).toContain('From: sender@test.com');
  });

  test('decoded output contains To header', () => {
    const encoded = encodeMimeMessage(standardInput);
    const decoded = decodeBase64url(encoded);
    expect(decoded).toContain('To: recipient@test.com');
  });

  test('decoded output contains Subject header', () => {
    const encoded = encodeMimeMessage(standardInput);
    const decoded = decodeBase64url(encoded);
    expect(decoded).toContain('Subject: Test Subject');
  });

  test('decoded output contains MIME-Version header', () => {
    const encoded = encodeMimeMessage(standardInput);
    const decoded = decodeBase64url(encoded);
    expect(decoded).toContain('MIME-Version: 1.0');
  });

  test('decoded output contains Content-Type header', () => {
    const encoded = encodeMimeMessage(standardInput);
    const decoded = decodeBase64url(encoded);
    expect(decoded).toContain('Content-Type: text/html; charset=utf-8');
  });

  test('decoded output contains base64-encoded body after blank line', () => {
    const encoded = encodeMimeMessage(standardInput);
    const decoded = decodeBase64url(encoded);
    // RFC 2822: headers and body separated by blank line (CRLF CRLF)
    const parts = decoded.split('\r\n\r\n');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    // Body is base64-encoded for UTF-8 transport — decode it
    const bodyDecoded = Buffer.from(parts[1], 'base64').toString('utf-8');
    expect(bodyDecoded).toContain('Hello, this is the email body.');
  });

  test('handles special characters in body via base64 encoding', () => {
    const specialInput: MimeMessageInput = {
      ...standardInput,
      body: 'Accented: cafe\u0301, Emoji: \u{1F680}, French: r\u00E9sum\u00E9',
    };
    const encoded = encodeMimeMessage(specialInput);
    const decoded = decodeBase64url(encoded);
    const parts = decoded.split('\r\n\r\n');
    const bodyDecoded = Buffer.from(parts[1], 'base64').toString('utf-8');
    expect(bodyDecoded).toContain('cafe\u0301');
    expect(bodyDecoded).toContain('\u{1F680}');
    expect(bodyDecoded).toContain('r\u00E9sum\u00E9');
  });

  test('handles multi-line body', () => {
    const multiLineInput: MimeMessageInput = {
      ...standardInput,
      body: 'Line one\nLine two\nLine three',
    };
    const encoded = encodeMimeMessage(multiLineInput);
    const decoded = decodeBase64url(encoded);
    const parts = decoded.split('\r\n\r\n');
    const bodyDecoded = Buffer.from(parts[1], 'base64').toString('utf-8');
    expect(bodyDecoded).toContain('Line one');
    expect(bodyDecoded).toContain('Line two');
    expect(bodyDecoded).toContain('Line three');
  });

  test('encodes non-ASCII subject with RFC 2047', () => {
    const unicodeSubject: MimeMessageInput = {
      ...standardInput,
      subject: 'Documents Needed \u2014 John',
    };
    const encoded = encodeMimeMessage(unicodeSubject);
    const decoded = decodeBase64url(encoded);
    // Non-ASCII subject should use RFC 2047 encoded-word
    expect(decoded).toContain('Subject: =?UTF-8?B?');
  });
});
