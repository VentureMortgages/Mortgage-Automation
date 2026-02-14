/**
 * Tests for Attachment Extractor — MIME Part Walking and Download
 *
 * Tests cover:
 * - extractAttachments: single attachment, multiple, nested multipart, no attachments,
 *   .eml detection, skipping parts without filename
 * - downloadAttachment: base64url decoding
 *
 * Uses mock MessagePart objects matching the Gmail API shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { extractAttachments, downloadAttachment } from '../attachment-extractor.js';
import type { gmail_v1 } from 'googleapis';

type MessagePart = gmail_v1.Schema$MessagePart;

// ---------------------------------------------------------------------------
// extractAttachments
// ---------------------------------------------------------------------------

describe('extractAttachments', () => {
  it('extracts a single attachment from a flat parts array', () => {
    const parts: MessagePart[] = [
      {
        partId: '0',
        mimeType: 'text/plain',
        filename: '',
        body: { size: 100 },
      },
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename: 'document.pdf',
        body: { attachmentId: 'att-123', size: 1024 },
      },
    ];

    const result = extractAttachments(parts);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      filename: 'document.pdf',
      mimeType: 'application/pdf',
      attachmentId: 'att-123',
      size: 1024,
    });
  });

  it('extracts multiple attachments', () => {
    const parts: MessagePart[] = [
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename: 'doc1.pdf',
        body: { attachmentId: 'att-1', size: 500 },
      },
      {
        partId: '2',
        mimeType: 'image/jpeg',
        filename: 'photo.jpg',
        body: { attachmentId: 'att-2', size: 2000 },
      },
      {
        partId: '3',
        mimeType: 'image/png',
        filename: 'screenshot.png',
        body: { attachmentId: 'att-3', size: 3000 },
      },
    ];

    const result = extractAttachments(parts);

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.filename)).toEqual([
      'doc1.pdf',
      'photo.jpg',
      'screenshot.png',
    ]);
  });

  it('finds deeply nested attachments in multipart structures', () => {
    const parts: MessagePart[] = [
      {
        partId: '0',
        mimeType: 'multipart/mixed',
        filename: '',
        body: { size: 0 },
        parts: [
          {
            partId: '0.0',
            mimeType: 'multipart/alternative',
            filename: '',
            body: { size: 0 },
            parts: [
              {
                partId: '0.0.0',
                mimeType: 'text/plain',
                filename: '',
                body: { size: 50 },
              },
              {
                partId: '0.0.1',
                mimeType: 'text/html',
                filename: '',
                body: { size: 200 },
              },
            ],
          },
          {
            partId: '0.1',
            mimeType: 'application/pdf',
            filename: 'nested-doc.pdf',
            body: { attachmentId: 'att-nested', size: 5000 },
          },
        ],
      },
    ];

    const result = extractAttachments(parts);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      filename: 'nested-doc.pdf',
      mimeType: 'application/pdf',
      attachmentId: 'att-nested',
      size: 5000,
    });
  });

  it('returns empty array for text-only email (no attachments)', () => {
    const parts: MessagePart[] = [
      {
        partId: '0',
        mimeType: 'text/plain',
        filename: '',
        body: { size: 100 },
      },
      {
        partId: '1',
        mimeType: 'text/html',
        filename: '',
        body: { size: 500 },
      },
    ];

    const result = extractAttachments(parts);

    expect(result).toEqual([]);
  });

  it('returns empty array for undefined parts', () => {
    const result = extractAttachments(undefined);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty parts array', () => {
    const result = extractAttachments([]);
    expect(result).toEqual([]);
  });

  it('includes .eml attachment (message/rfc822) with correct mimeType', () => {
    const parts: MessagePart[] = [
      {
        partId: '0',
        mimeType: 'text/plain',
        filename: '',
        body: { size: 50 },
      },
      {
        partId: '1',
        mimeType: 'message/rfc822',
        filename: 'forwarded-email.eml',
        body: { attachmentId: 'att-eml', size: 8000 },
      },
    ];

    const result = extractAttachments(parts);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      filename: 'forwarded-email.eml',
      mimeType: 'message/rfc822',
      attachmentId: 'att-eml',
      size: 8000,
    });
  });

  it('skips parts without filename (inline text/HTML parts)', () => {
    const parts: MessagePart[] = [
      {
        partId: '0',
        mimeType: 'text/plain',
        filename: '', // Empty filename
        body: { attachmentId: 'att-inline', size: 100 },
      },
      {
        partId: '1',
        mimeType: 'text/html',
        filename: '', // Empty filename
        body: { attachmentId: 'att-html', size: 500 },
      },
      {
        partId: '2',
        mimeType: 'image/jpeg',
        filename: 'actual-photo.jpg',
        body: { attachmentId: 'att-real', size: 2000 },
      },
    ];

    const result = extractAttachments(parts);

    // Only the actual attachment with a filename
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('actual-photo.jpg');
  });

  it('skips parts without attachmentId', () => {
    const parts: MessagePart[] = [
      {
        partId: '0',
        mimeType: 'application/pdf',
        filename: 'inline.pdf',
        body: { size: 1000 }, // No attachmentId — might be inline data
      },
    ];

    const result = extractAttachments(parts);
    expect(result).toEqual([]);
  });

  it('defaults mimeType to application/octet-stream when missing', () => {
    const parts: MessagePart[] = [
      {
        partId: '1',
        mimeType: undefined as unknown as string,
        filename: 'unknown-file',
        body: { attachmentId: 'att-unknown', size: 500 },
      },
    ];

    const result = extractAttachments(parts);

    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// downloadAttachment
// ---------------------------------------------------------------------------

describe('downloadAttachment', () => {
  it('decodes base64url-encoded attachment data to Buffer', async () => {
    // "Hello, PDF!" encoded as base64url
    const plaintext = 'Hello, PDF!';
    const base64url = Buffer.from(plaintext).toString('base64url');

    const mockGmail = {
      users: {
        messages: {
          attachments: {
            get: vi.fn().mockResolvedValue({
              data: { data: base64url, size: plaintext.length },
            }),
          },
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await downloadAttachment(mockGmail as any, 'msg-1', 'att-1');

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString('utf-8')).toBe('Hello, PDF!');

    expect(mockGmail.users.messages.attachments.get).toHaveBeenCalledWith({
      userId: 'me',
      messageId: 'msg-1',
      id: 'att-1',
    });
  });

  it('handles binary data (non-UTF8) correctly', async () => {
    // Binary data: some bytes that aren't valid UTF-8
    const binaryData = Buffer.from([0x00, 0xff, 0x25, 0x50, 0x44, 0x46]); // includes %PDF
    const base64url = binaryData.toString('base64url');

    const mockGmail = {
      users: {
        messages: {
          attachments: {
            get: vi.fn().mockResolvedValue({
              data: { data: base64url, size: binaryData.length },
            }),
          },
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await downloadAttachment(mockGmail as any, 'msg-2', 'att-2');

    expect(result).toBeInstanceOf(Buffer);
    expect(Buffer.compare(result, binaryData)).toBe(0);
  });

  it('throws when attachment data is missing', async () => {
    const mockGmail = {
      users: {
        messages: {
          attachments: {
            get: vi.fn().mockResolvedValue({
              data: { data: null, size: 0 },
            }),
          },
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(downloadAttachment(mockGmail as any, 'msg-3', 'att-3')).rejects.toThrow(
      'returned no data',
    );
  });
});
