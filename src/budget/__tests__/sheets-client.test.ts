/**
 * Sheets Client Tests
 *
 * Tests for the Google Sheets API client singleton.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSheetsReturn = vi.hoisted(() => ({ spreadsheets: { values: {} } }));
const mockGoogleSheets = vi.hoisted(() => vi.fn(() => mockSheetsReturn));

vi.mock('googleapis', () => ({
  google: { sheets: mockGoogleSheets },
}));

vi.mock('google-auth-library', () => {
  const setCredentialsFn = vi.fn();

  class MockOAuth2Client {
    constructor(..._args: unknown[]) {}
    setCredentials = setCredentialsFn;
  }

  class MockJWT {
    constructor(..._args: unknown[]) {}
  }

  return {
    OAuth2Client: MockOAuth2Client,
    JWT: MockJWT,
  };
});

import { getSheetsClient, resetSheetsClient } from '../sheets-client.js';

describe('getSheetsClient', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetSheetsClient();
    vi.clearAllMocks();
    delete process.env.GOOGLE_REFRESH_TOKEN;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should create Sheets v4 client when using OAuth2', () => {
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

    const client = getSheetsClient();

    expect(mockGoogleSheets).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v4' }),
    );
    expect(client).toBe(mockSheetsReturn);
  });

  it('should create Sheets v4 client when using service account', () => {
    const saKey = Buffer.from(
      JSON.stringify({ client_email: 'test@sa.com', private_key: 'key' }),
    ).toString('base64');
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = saKey;

    const client = getSheetsClient();

    expect(mockGoogleSheets).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v4' }),
    );
    expect(client).toBe(mockSheetsReturn);
  });

  it('should cache the client (singleton pattern)', () => {
    process.env.GOOGLE_REFRESH_TOKEN = 'test-token';
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';

    const client1 = getSheetsClient();
    const client2 = getSheetsClient();

    expect(client1).toBe(client2);
    expect(mockGoogleSheets).toHaveBeenCalledTimes(1);
  });

  it('should create new client after reset', () => {
    process.env.GOOGLE_REFRESH_TOKEN = 'test-token';
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';

    getSheetsClient();
    resetSheetsClient();
    getSheetsClient();

    expect(mockGoogleSheets).toHaveBeenCalledTimes(2);
  });

  it('should throw when OAuth2 credentials are incomplete', () => {
    process.env.GOOGLE_REFRESH_TOKEN = 'test-token';

    expect(() => getSheetsClient()).toThrow('OAuth2 credentials incomplete');
  });
});
