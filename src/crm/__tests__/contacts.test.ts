// ============================================================================
// Tests: CRM Contacts Service — getContact() and findContactByEmail()
// ============================================================================
//
// Tests the contacts module with mocked fetch. Uses the same mocking pattern
// as the existing CRM test files.

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock CRM config before imports
vi.mock('../config.js', () => ({
  crmConfig: {
    apiKey: 'test-api-key',
    baseUrl: 'https://test-api.example.com',
    locationId: 'test-location-id',
    isDev: false,
  },
  devPrefix: (text: string) => text,
}));

import { getContact, findContactByEmail } from '../contacts.js';
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
// getContact
// ============================================================================

describe('getContact', () => {
  test('sends GET to /contacts/:contactId with auth headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contact: {
          id: 'contact-123',
          email: 'test@example.com',
          firstName: 'Terry',
          lastName: 'Smith',
          customFields: [
            { id: 'field-1', value: 'some-value' },
            { id: 'field-2', value: 42 },
          ],
        },
      }),
    });

    const result = await getContact('contact-123');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/contacts/contact-123');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-api-key');
    expect(init.headers.Version).toBe('2021-07-28');
  });

  test('returns parsed CrmContact with customFields', async () => {
    const contactData = {
      id: 'contact-456',
      email: 'borrower@example.com',
      firstName: 'Kathy',
      lastName: 'Jones',
      customFields: [
        { id: 'missing-docs-field', value: '[{"name":"T4","stage":"PRE"}]' },
        { id: 'received-docs-field', value: '[]' },
        { id: 'pre-total', value: 5 },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contact: contactData }),
    });

    const result = await getContact('contact-456');

    expect(result.id).toBe('contact-456');
    expect(result.email).toBe('borrower@example.com');
    expect(result.firstName).toBe('Kathy');
    expect(result.lastName).toBe('Jones');
    expect(result.customFields).toHaveLength(3);
    expect(result.customFields[0]).toEqual({ id: 'missing-docs-field', value: '[{"name":"T4","stage":"PRE"}]' });
  });

  test('throws CrmApiError on 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'Contact not found',
    });

    await expect(getContact('nonexistent-id')).rejects.toThrow(CrmApiError);
  });

  test('throws CrmAuthError on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key',
    });

    await expect(getContact('contact-123')).rejects.toThrow(CrmAuthError);
  });

  test('throws CrmApiError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(getContact('contact-123')).rejects.toThrow(CrmApiError);
  });
});

// ============================================================================
// findContactByEmail
// ============================================================================

describe('findContactByEmail', () => {
  test('returns contact ID when found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contacts: [{ id: 'found-contact-id', email: 'user@example.com' }],
      }),
    });

    const result = await findContactByEmail('user@example.com');
    expect(result).toBe('found-contact-id');
  });

  test('returns null when no contacts found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [] }),
    });

    const result = await findContactByEmail('unknown@example.com');
    expect(result).toBeNull();
  });

  test('sends POST to /contacts/search with locationId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [] }),
    });

    await findContactByEmail('test@example.com');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/contacts/search');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.locationId).toBe('test-location-id');
    expect(body.query).toBe('test@example.com');
  });
});
