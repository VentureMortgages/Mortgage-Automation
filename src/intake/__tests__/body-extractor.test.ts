/**
 * Tests for Body Extractor — Forwarding Notes Parser (Phase 23)
 *
 * Tests:
 * - parseForwardingNote: extracts clientName from plain name
 * - parseForwardingNote: extracts clientEmail from email address
 * - parseForwardingNote: extracts clientName + docTypeHint with separator
 * - parseForwardingNote: extracts clientEmail + docTypeHint with separator
 * - parseForwardingNote: handles em dash separator
 * - extractForwardingNotes: returns null when no payload
 * - extractForwardingNotes: returns null when no forward delimiter
 * - extractForwardingNotes: extracts note above Gmail forward delimiter
 */

import { describe, it, expect } from 'vitest';
import { parseForwardingNote, extractForwardingNotes } from '../body-extractor.js';

describe('parseForwardingNote', () => {
  it('extracts clientName from plain name', () => {
    const result = parseForwardingNote('John Smith');
    expect(result.clientName).toBe('John Smith');
    expect(result.clientEmail).toBeUndefined();
    expect(result.docTypeHint).toBeUndefined();
    expect(result.rawNote).toBe('John Smith');
  });

  it('extracts clientEmail from email address', () => {
    const result = parseForwardingNote('john@example.com');
    expect(result.clientEmail).toBe('john@example.com');
    expect(result.clientName).toBeUndefined();
    expect(result.docTypeHint).toBeUndefined();
  });

  it('extracts clientName + docTypeHint with dash separator', () => {
    const result = parseForwardingNote('John Smith - paystub');
    expect(result.clientName).toBe('John Smith');
    expect(result.docTypeHint).toBe('paystub');
    expect(result.clientEmail).toBeUndefined();
  });

  it('extracts clientEmail + docTypeHint with dash separator', () => {
    const result = parseForwardingNote('john@example.com - T4');
    expect(result.clientEmail).toBe('john@example.com');
    expect(result.docTypeHint).toBe('T4');
    expect(result.clientName).toBeUndefined();
  });

  it('handles em dash separator', () => {
    const result = parseForwardingNote('John Smith \u2014 bank statement');
    expect(result.clientName).toBe('John Smith');
    expect(result.docTypeHint).toBe('bank statement');
  });

  it('handles en dash separator', () => {
    const result = parseForwardingNote('Jane Doe \u2013 LOE');
    expect(result.clientName).toBe('Jane Doe');
    expect(result.docTypeHint).toBe('LOE');
  });

  it('returns rawNote for single character input', () => {
    const result = parseForwardingNote('X');
    expect(result.clientName).toBeUndefined();
    expect(result.clientEmail).toBeUndefined();
    expect(result.rawNote).toBe('X');
  });
});

describe('extractForwardingNotes', () => {
  it('returns null when no payload', () => {
    expect(extractForwardingNotes(undefined)).toBeNull();
  });

  it('returns null when no text/plain body', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/html', body: { data: Buffer.from('<p>hello</p>').toString('base64url') } },
      ],
    };

    expect(extractForwardingNotes(payload)).toBeNull();
  });

  it('returns null when no forward delimiter found', () => {
    const bodyText = 'Just a regular email with no forwarding.';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    expect(extractForwardingNotes(payload)).toBeNull();
  });

  it('extracts note above Gmail forward delimiter', () => {
    const bodyText = 'John Smith - paystub\n\n---------- Forwarded message ---------\nFrom: someone@bank.com\nDate: Mon, Jan 1\nSubject: Your pay stub\n\nPlease find attached...';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    const result = extractForwardingNotes(payload);
    expect(result).not.toBeNull();
    expect(result!.clientName).toBe('John Smith');
    expect(result!.docTypeHint).toBe('paystub');
  });

  it('extracts note from nested multipart message', () => {
    const bodyText = 'jane@example.com - T4\n\n---------- Forwarded message ---------\nFrom: CRA';
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: Buffer.from(bodyText).toString('base64url') } },
            { mimeType: 'text/html', body: { data: Buffer.from('<p>html</p>').toString('base64url') } },
          ],
        },
        { mimeType: 'application/pdf', filename: 'doc.pdf', body: { attachmentId: 'abc123' } },
      ],
    };

    const result = extractForwardingNotes(payload);
    expect(result).not.toBeNull();
    expect(result!.clientEmail).toBe('jane@example.com');
    expect(result!.docTypeHint).toBe('T4');
  });

  it('returns null when text above delimiter is empty', () => {
    const bodyText = '\n\n---------- Forwarded message ---------\nContent here';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    expect(extractForwardingNotes(payload)).toBeNull();
  });

  it('handles Original Message delimiter', () => {
    const bodyText = 'Marcus Lee\n-----Original Message-----\nFrom: bank';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    const result = extractForwardingNotes(payload);
    expect(result).not.toBeNull();
    expect(result!.clientName).toBe('Marcus Lee');
  });
});
