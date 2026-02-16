// ============================================================================
// Tests: CRM Notes Service — Audit trail note creation
// ============================================================================
//
// Tests createAuditNote() with mocked fetch. Follows the same mocking pattern
// as the existing CRM test files (vi.mock for config, vi.fn for global fetch).

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock CRM config before imports
vi.mock('../config.js', () => ({
  crmConfig: {
    apiKey: 'test-api-key',
    baseUrl: 'https://test-api.example.com',
    userIds: {
      cat: 'cat-user-id-123',
      taylor: 'taylor-user-id-456',
    },
  },
}));

import { createAuditNote } from '../notes.js';
import { CrmAuthError, CrmApiError } from '../errors.js';

// ============================================================================
// Shared Setup
// ============================================================================

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

// ============================================================================
// createAuditNote
// ============================================================================

describe('createAuditNote', () => {
  test('sends POST to correct URL with note body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ note: { id: 'note-abc-123' } }),
    });

    const result = await createAuditNote('contact-123', {
      documentType: 'T4',
      source: 'gmail',
      driveFileId: 'drive-file-xyz',
    });

    expect(result).toBe('note-abc-123');
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/contacts/contact-123/notes');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-api-key');
    expect(init.headers.Version).toBe('2021-07-28');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  test('note body contains document type, source, driveFileId, and timestamp', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ note: { id: 'note-123' } }),
    });

    await createAuditNote('contact-123', {
      documentType: 'Pay Stub',
      source: 'finmo',
      driveFileId: 'drive-file-abc',
    });

    const [, init] = mockFetch.mock.calls[0];
    const parsed = JSON.parse(init.body);

    expect(parsed.body).toContain('Document received: Pay Stub');
    expect(parsed.body).toContain('Source: finmo');
    expect(parsed.body).toContain('Filed to Drive: drive-file-abc');
    expect(parsed.body).toContain('Received:');
    expect(parsed.body).toContain('[Automated by Venture Mortgages Doc System]');
  });

  test('includes userId for Cat attribution', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ note: { id: 'note-123' } }),
    });

    await createAuditNote('contact-123', {
      documentType: 'T4',
      source: 'gmail',
      driveFileId: 'drive-file-xyz',
    });

    const [, init] = mockFetch.mock.calls[0];
    const parsed = JSON.parse(init.body);
    expect(parsed.userId).toBe('cat-user-id-123');
  });

  test('returns the note ID from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ note: { id: 'unique-note-id' } }),
    });

    const result = await createAuditNote('contact-456', {
      documentType: 'LOE',
      source: 'gmail',
      driveFileId: 'drive-789',
    });

    expect(result).toBe('unique-note-id');
  });

  test('throws CrmAuthError on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key',
    });

    await expect(
      createAuditNote('contact-123', {
        documentType: 'T4',
        source: 'gmail',
        driveFileId: 'drive-xyz',
      }),
    ).rejects.toThrow(CrmAuthError);
  });

  test('throws CrmApiError on other HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server error',
    });

    await expect(
      createAuditNote('contact-123', {
        documentType: 'T4',
        source: 'gmail',
        driveFileId: 'drive-xyz',
      }),
    ).rejects.toThrow(CrmApiError);
  });

  test('throws CrmApiError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    await expect(
      createAuditNote('contact-123', {
        documentType: 'T4',
        source: 'gmail',
        driveFileId: 'drive-xyz',
      }),
    ).rejects.toThrow(CrmApiError);
  });
});
