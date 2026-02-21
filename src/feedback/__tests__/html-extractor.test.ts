/**
 * Tests for HTML Extractor — MIME part walking and base64url decode
 *
 * Tests cover:
 * - Extracts HTML from multipart/alternative message
 * - Extracts HTML from nested multipart/mixed structure
 * - Falls back to payload.body for non-multipart messages
 * - Returns null when no HTML body is found
 * - Returns null when payload is missing
 * - Correctly decodes base64url-encoded content
 */

import { describe, it, expect, vi } from 'vitest';
import { extractEmailHtml } from '../html-extractor.js';

// ---------------------------------------------------------------------------
// Mock Gmail Client Factory
// ---------------------------------------------------------------------------

function createMockGmail(payload: object | null) {
  return {
    users: {
      messages: {
        get: vi.fn().mockResolvedValue({
          data: { payload },
        }),
      },
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HTML Extractor', () => {
  it('extracts HTML from multipart/alternative message', async () => {
    const html = '<div>Hello World</div>';
    const gmail = createMockGmail({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: toBase64Url('Hello World') } },
        { mimeType: 'text/html', body: { data: toBase64Url(html) } },
      ],
    });

    const result = await extractEmailHtml(gmail, 'msg-123');

    expect(result).toBe(html);
  });

  it('extracts HTML from nested multipart/mixed structure', async () => {
    const html = '<p>Nested HTML</p>';
    const gmail = createMockGmail({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: toBase64Url('Plain') } },
            { mimeType: 'text/html', body: { data: toBase64Url(html) } },
          ],
        },
        {
          mimeType: 'application/pdf',
          filename: 'doc.pdf',
          body: { attachmentId: 'att-1', size: 1000 },
        },
      ],
    });

    const result = await extractEmailHtml(gmail, 'msg-456');

    expect(result).toBe(html);
  });

  it('falls back to payload.body for non-multipart messages', async () => {
    const html = '<div>Simple message</div>';
    const gmail = createMockGmail({
      mimeType: 'text/html',
      body: { data: toBase64Url(html) },
    });

    const result = await extractEmailHtml(gmail, 'msg-789');

    expect(result).toBe(html);
  });

  it('returns null when no HTML body is found', async () => {
    const gmail = createMockGmail({
      mimeType: 'text/plain',
      body: { data: toBase64Url('Plain text only') },
    });

    const result = await extractEmailHtml(gmail, 'msg-plain');

    expect(result).toBeNull();
  });

  it('returns null when payload is missing', async () => {
    const gmail = createMockGmail(null);

    const result = await extractEmailHtml(gmail, 'msg-empty');

    expect(result).toBeNull();
  });

  it('correctly decodes base64url content with special chars', async () => {
    const html = '<div>Test with special chars: é, ñ, ü, 日本語</div>';
    const gmail = createMockGmail({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: toBase64Url(html) } },
      ],
    });

    const result = await extractEmailHtml(gmail, 'msg-special');

    expect(result).toBe(html);
  });
});
