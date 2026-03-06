/**
 * Tests for Body Extractor — Forwarding Notes Parser (Phase 23 + Phase 25)
 *
 * Phase 23 tests (unchanged):
 * - parseForwardingNote: extracts clientName from plain name
 * - parseForwardingNote: extracts clientEmail from email address
 * - parseForwardingNote: extracts clientName + docTypeHint with separator
 * - parseForwardingNote: extracts clientEmail + docTypeHint with separator
 * - parseForwardingNote: handles em dash separator
 * - extractForwardingNotes: returns null when no payload
 * - extractForwardingNotes: returns null when no forward delimiter
 * - extractForwardingNotes: extracts note above Gmail forward delimiter
 *
 * Phase 25 tests (new):
 * - parseForwardingNoteAI: single-client note returns structured result
 * - parseForwardingNoteAI: multi-client note returns per-client doc assignments
 * - parseForwardingNoteAI: email-based note returns clientEmail
 * - parseForwardingNoteAI: plain name with no doc type returns clients only
 * - parseForwardingNoteAI: populates legacy fields for backward compatibility
 * - extractForwardingNotes: uses AI parser and returns expanded result
 * - extractForwardingNotes: falls back to regex when AI fails
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Gemini SDK
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  SchemaType: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
  },
}));

// Mock classification config so Gemini API key doesn't throw
vi.mock('../../classification/config.js', () => ({
  classificationConfig: {
    geminiApiKey: 'test-api-key',
    model: 'gemini-2.0-flash',
  },
}));

import {
  parseForwardingNote,
  parseForwardingNoteAI,
  extractForwardingNotes,
} from '../body-extractor.js';

// ---------------------------------------------------------------------------
// Phase 23: Regex parser tests (UNCHANGED)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Phase 25: AI parser tests (NEW)
// ---------------------------------------------------------------------------

describe('parseForwardingNoteAI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses single-client note with doc type', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          clients: ['John Smith'],
          docs: [{ client: 'John Smith', type: 'paystub' }],
          rawNote: 'John Smith - paystub',
        }),
      },
    });

    const result = await parseForwardingNoteAI('John Smith - paystub');
    expect(result).not.toBeNull();
    expect(result!.clients).toEqual(['John Smith']);
    expect(result!.docs).toEqual([{ client: 'John Smith', type: 'paystub' }]);
    expect(result!.rawNote).toBe('John Smith - paystub');
  });

  it('parses multi-client note with per-client doc assignments', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          clients: ['Srimal Wong-Ranasinghe', 'Carolyn Wong-Ranasinghe'],
          docs: [
            { client: 'Srimal Wong-Ranasinghe', type: 'ID' },
            { client: 'Carolyn Wong-Ranasinghe', type: 'ID' },
            { client: 'Srimal Wong-Ranasinghe', type: 'Statement of Account' },
          ],
          rawNote: "Srimal and Carolyn Wong-Ranasinghe ID's and Srimal's Statement of Account",
        }),
      },
    });

    const result = await parseForwardingNoteAI(
      "Srimal and Carolyn Wong-Ranasinghe ID's and Srimal's Statement of Account",
    );
    expect(result).not.toBeNull();
    expect(result!.clients).toHaveLength(2);
    expect(result!.clients).toContain('Srimal Wong-Ranasinghe');
    expect(result!.clients).toContain('Carolyn Wong-Ranasinghe');
    expect(result!.docs).toHaveLength(3);
    expect(result!.docs).toContainEqual({ client: 'Srimal Wong-Ranasinghe', type: 'ID' });
    expect(result!.docs).toContainEqual({ client: 'Carolyn Wong-Ranasinghe', type: 'ID' });
    expect(result!.docs).toContainEqual({ client: 'Srimal Wong-Ranasinghe', type: 'Statement of Account' });
  });

  it('parses email-based note with doc type', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          clients: ['john@example.com'],
          docs: [{ client: 'john@example.com', type: 'T4' }],
          rawNote: 'john@example.com - T4',
        }),
      },
    });

    const result = await parseForwardingNoteAI('john@example.com - T4');
    expect(result).not.toBeNull();
    expect(result!.clientEmail).toBe('john@example.com');
    expect(result!.docs).toEqual([{ client: 'john@example.com', type: 'T4' }]);
  });

  it('parses plain name with no doc type (clients only, empty docs)', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          clients: ['John Smith'],
          docs: [],
          rawNote: 'John Smith',
        }),
      },
    });

    const result = await parseForwardingNoteAI('John Smith');
    expect(result).not.toBeNull();
    expect(result!.clients).toEqual(['John Smith']);
    expect(result!.docs).toEqual([]);
    expect(result!.clientName).toBe('John Smith');
  });

  it('populates legacy fields for backward compatibility', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          clients: ['Srimal Wong-Ranasinghe', 'Carolyn Wong-Ranasinghe'],
          docs: [
            { client: 'Srimal Wong-Ranasinghe', type: 'ID' },
            { client: 'Carolyn Wong-Ranasinghe', type: 'ID' },
          ],
          rawNote: "Srimal and Carolyn's IDs",
        }),
      },
    });

    const result = await parseForwardingNoteAI("Srimal and Carolyn's IDs");
    expect(result).not.toBeNull();
    // Legacy: clientName = first client
    expect(result!.clientName).toBe('Srimal Wong-Ranasinghe');
    // Legacy: docTypeHint = first doc type
    expect(result!.docTypeHint).toBe('ID');
    // rawNote preserved
    expect(result!.rawNote).toBe("Srimal and Carolyn's IDs");
  });

  it('returns null when AI returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'not valid json' },
    });

    const result = await parseForwardingNoteAI('John Smith');
    expect(result).toBeNull();
  });

  it('returns null when AI call throws', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Network error'));

    const result = await parseForwardingNoteAI('John Smith');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 23: extractForwardingNotes tests (UNCHANGED)
// ---------------------------------------------------------------------------

describe('extractForwardingNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no payload', async () => {
    expect(await extractForwardingNotes(undefined)).toBeNull();
  });

  it('returns null when no text/plain body', async () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/html', body: { data: Buffer.from('<p>hello</p>').toString('base64url') } },
      ],
    };

    expect(await extractForwardingNotes(payload)).toBeNull();
  });

  it('returns null when no forward delimiter found', async () => {
    const bodyText = 'Just a regular email with no forwarding.';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    expect(await extractForwardingNotes(payload)).toBeNull();
  });

  it('extracts note above Gmail forward delimiter using AI parser', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          clients: ['John Smith'],
          docs: [{ client: 'John Smith', type: 'paystub' }],
          rawNote: 'John Smith - paystub',
        }),
      },
    });

    const bodyText = 'John Smith - paystub\n\n---------- Forwarded message ---------\nFrom: someone@bank.com\nDate: Mon, Jan 1\nSubject: Your pay stub\n\nPlease find attached...';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    const result = await extractForwardingNotes(payload);
    expect(result).not.toBeNull();
    expect(result!.clientName).toBe('John Smith');
    expect(result!.docTypeHint).toBe('paystub');
    expect(result!.clients).toEqual(['John Smith']);
    expect(result!.docs).toEqual([{ client: 'John Smith', type: 'paystub' }]);
  });

  it('falls back to regex parser when AI fails', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('API timeout'));

    const bodyText = 'John Smith - paystub\n\n---------- Forwarded message ---------\nFrom: someone@bank.com';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    const result = await extractForwardingNotes(payload);
    expect(result).not.toBeNull();
    // Falls back to regex: gets clientName and docTypeHint
    expect(result!.clientName).toBe('John Smith');
    expect(result!.docTypeHint).toBe('paystub');
    // But no multi-client fields
    expect(result!.clients).toBeUndefined();
    expect(result!.docs).toBeUndefined();
  });

  it('extracts note from nested multipart message', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          clients: ['jane@example.com'],
          docs: [{ client: 'jane@example.com', type: 'T4' }],
          rawNote: 'jane@example.com - T4',
        }),
      },
    });

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

    const result = await extractForwardingNotes(payload);
    expect(result).not.toBeNull();
    expect(result!.clientEmail).toBe('jane@example.com');
    expect(result!.docTypeHint).toBe('T4');
  });

  it('returns null when text above delimiter is empty', async () => {
    const bodyText = '\n\n---------- Forwarded message ---------\nContent here';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    expect(await extractForwardingNotes(payload)).toBeNull();
  });

  it('handles Original Message delimiter', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          clients: ['Marcus Lee'],
          docs: [],
          rawNote: 'Marcus Lee',
        }),
      },
    });

    const bodyText = 'Marcus Lee\n-----Original Message-----\nFrom: bank';
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(bodyText).toString('base64url') },
    };

    const result = await extractForwardingNotes(payload);
    expect(result).not.toBeNull();
    expect(result!.clientName).toBe('Marcus Lee');
  });
});
