// ============================================================================
// Tests: CRM Contacts Service
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

import { getContact, findContactByEmail, findContactByName, resolveContactId, extractDriveFolderId, getContactDriveFolderId, assignContactType } from '../contacts.js';
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

// ============================================================================
// findContactByName
// ============================================================================

describe('findContactByName', () => {
  test('returns contact ID on exact match', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contacts: [{ id: 'contact-abc', firstName: 'Terry', lastName: 'Smith' }],
      }),
    });

    const result = await findContactByName('Terry', 'Smith');
    expect(result).toBe('contact-abc');
  });

  test('returns null when no contacts found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [] }),
    });

    const result = await findContactByName('Nobody', 'Here');
    expect(result).toBeNull();
  });

  test('returns null on ambiguity (2+ exact matches)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contacts: [
          { id: 'contact-1', firstName: 'Terry', lastName: 'Smith' },
          { id: 'contact-2', firstName: 'Terry', lastName: 'Smith' },
        ],
      }),
    });

    const result = await findContactByName('Terry', 'Smith');
    expect(result).toBeNull();
  });

  test('filters out fuzzy/non-exact matches from GHL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contacts: [
          { id: 'contact-1', firstName: 'Terrence', lastName: 'Smith' },
          { id: 'contact-2', firstName: 'Terry', lastName: 'Smithson' },
        ],
      }),
    });

    const result = await findContactByName('Terry', 'Smith');
    expect(result).toBeNull();
  });

  test('matches case-insensitively', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contacts: [{ id: 'contact-abc', firstName: 'terry', lastName: 'SMITH' }],
      }),
    });

    const result = await findContactByName('Terry', 'Smith');
    expect(result).toBe('contact-abc');
  });

  test('sends query as "firstName lastName" with pageLimit 5', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [] }),
    });

    await findContactByName('Terry', 'Smith');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/contacts/search');
    const body = JSON.parse(init.body);
    expect(body.query).toBe('Terry Smith');
    expect(body.pageLimit).toBe(5);
  });
});

// ============================================================================
// resolveContactId
// ============================================================================

describe('resolveContactId', () => {
  test('returns email resolution when email lookup succeeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contacts: [{ id: 'contact-email', email: 'borrower@example.com' }],
      }),
    });

    const result = await resolveContactId({
      senderEmail: 'borrower@example.com',
      borrowerFirstName: 'Terry',
      borrowerLastName: 'Smith',
    });

    expect(result.contactId).toBe('contact-email');
    expect(result.resolvedVia).toBe('email');
    // Should NOT make a second call for name lookup
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('falls back to name lookup when email fails', async () => {
    // Email lookup returns no results
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [] }),
    });
    // Name lookup returns a match
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contacts: [{ id: 'contact-name', firstName: 'Terry', lastName: 'Smith' }],
      }),
    });

    const result = await resolveContactId({
      senderEmail: 'admin@venturemortgages.com',
      borrowerFirstName: 'Terry',
      borrowerLastName: 'Smith',
    });

    expect(result.contactId).toBe('contact-name');
    expect(result.resolvedVia).toBe('name');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('returns null when both email and name fail', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [] }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [] }),
    });

    const result = await resolveContactId({
      senderEmail: 'admin@venturemortgages.com',
      borrowerFirstName: 'Unknown',
      borrowerLastName: 'Person',
    });

    expect(result.contactId).toBeNull();
    expect(result.resolvedVia).toBeNull();
  });

  test('skips email lookup when senderEmail is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        contacts: [{ id: 'contact-name', firstName: 'Terry', lastName: 'Smith' }],
      }),
    });

    const result = await resolveContactId({
      senderEmail: null,
      borrowerFirstName: 'Terry',
      borrowerLastName: 'Smith',
    });

    expect(result.contactId).toBe('contact-name');
    expect(result.resolvedVia).toBe('name');
    // Only one call — name lookup, no email lookup
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('skips name lookup when names are null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [] }),
    });

    const result = await resolveContactId({
      senderEmail: 'admin@venturemortgages.com',
      borrowerFirstName: null,
      borrowerLastName: null,
    });

    expect(result.contactId).toBeNull();
    expect(result.resolvedVia).toBeNull();
    // Only one call — email lookup, no name lookup
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// extractDriveFolderId
// ============================================================================

describe('extractDriveFolderId', () => {
  test('extracts folder ID from full Drive URL', () => {
    expect(extractDriveFolderId('https://drive.google.com/drive/folders/1abc123def456'))
      .toBe('1abc123def456');
  });

  test('returns raw ID as-is', () => {
    expect(extractDriveFolderId('1abc123def456')).toBe('1abc123def456');
  });

  test('handles URL with query params', () => {
    expect(extractDriveFolderId('https://drive.google.com/drive/folders/1abc123?usp=sharing'))
      .toBe('1abc123');
  });

  test('handles URL with hash fragment', () => {
    expect(extractDriveFolderId('https://drive.google.com/drive/folders/1abc123#section'))
      .toBe('1abc123');
  });
});

// ============================================================================
// getContactDriveFolderId
// ============================================================================

describe('getContactDriveFolderId', () => {
  test('extracts folder ID from URL stored in custom field', () => {
    const contact = {
      id: 'c1', email: 'test@example.com', firstName: 'Test', lastName: 'User',
      customFields: [{ id: 'drive-field', value: 'https://drive.google.com/drive/folders/1abc123' }],
    };
    expect(getContactDriveFolderId(contact, 'drive-field')).toBe('1abc123');
  });

  test('returns raw ID from custom field', () => {
    const contact = {
      id: 'c1', email: 'test@example.com', firstName: 'Test', lastName: 'User',
      customFields: [{ id: 'drive-field', value: '1abc123' }],
    };
    expect(getContactDriveFolderId(contact, 'drive-field')).toBe('1abc123');
  });

  test('returns null when field not found', () => {
    const contact = {
      id: 'c1', email: 'test@example.com', firstName: 'Test', lastName: 'User',
      customFields: [],
    };
    expect(getContactDriveFolderId(contact, 'drive-field')).toBeNull();
  });

  test('returns null when field value is empty', () => {
    const contact = {
      id: 'c1', email: 'test@example.com', firstName: 'Test', lastName: 'User',
      customFields: [{ id: 'drive-field', value: '' }],
    };
    expect(getContactDriveFolderId(contact, 'drive-field')).toBeNull();
  });
});

// ============================================================================
// assignContactType
// ============================================================================

describe('assignContactType', () => {
  test('upserts contact with professional type as tag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contact: { id: 'contact-1' }, new: false }),
    } as Response);

    await assignContactType('jane@example.com', 'Jane Doe', 'lawyer');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/contacts/upsert');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.tags).toEqual(['lawyer']);
    expect(body.email).toBe('jane@example.com');
    expect(body.locationId).toBe('test-location-id');
  });

  test('parses full name into firstName and lastName', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contact: { id: 'contact-1' }, new: false }),
    } as Response);

    await assignContactType('jane@example.com', 'Jane Marie Doe', 'realtor');

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body.firstName).toBe('Jane');
    expect(body.lastName).toBe('Marie Doe');
  });

  test('handles single-word name (no lastName)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contact: { id: 'contact-1' }, new: false }),
    } as Response);

    await assignContactType('jane@example.com', 'Jane', 'realtor');

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body.firstName).toBe('Jane');
    expect(body.lastName).toBe('');
  });

  test('does not throw when API call fails (non-fatal)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    await expect(
      assignContactType('jane@example.com', 'Jane Doe', 'realtor'),
    ).resolves.toBeUndefined();
  });

  test('normalizes type to lowercase for tag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contact: { id: 'contact-1' }, new: false }),
    } as Response);

    await assignContactType('jane@example.com', 'Jane Doe', 'REALTOR');

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body.tags).toEqual(['realtor']);
  });

  test('trims whitespace from type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contact: { id: 'contact-1' }, new: false }),
    } as Response);

    await assignContactType('jane@example.com', 'Jane Doe', '  lawyer  ');

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body.tags).toEqual(['lawyer']);
  });
});
