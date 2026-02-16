/**
 * Tests for Google Drive API Client
 *
 * Tests cover:
 * - Creates Drive client with service account auth (JWT with drive scope)
 * - Creates Drive client with OAuth2 auth (refresh token)
 * - Caches client (singleton behavior)
 * - resetDriveClient clears cache
 * - Throws if no credentials are set
 *
 * googleapis and google-auth-library are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (vi.hoisted for Vitest 4 factory hoisting)
// ---------------------------------------------------------------------------

const { mockDrive, mockJWT, MockOAuth2ClientClass } = vi.hoisted(() => {
  class MockOAuth2 {
    clientId: string;
    clientSecret: string;
    setCredentials = vi.fn();
    constructor(clientId: string, clientSecret: string) {
      this.clientId = clientId;
      this.clientSecret = clientSecret;
    }
  }
  return {
    mockDrive: vi.fn().mockReturnValue({ files: {} }),
    mockJWT: vi.fn(),
    MockOAuth2ClientClass: MockOAuth2,
  };
});

vi.mock('googleapis', () => ({
  google: {
    drive: mockDrive,
  },
}));

vi.mock('google-auth-library', () => ({
  JWT: mockJWT,
  OAuth2Client: MockOAuth2ClientClass,
}));

// Mock config to avoid env var loading
vi.mock('../../classification/config.js', () => ({
  classificationConfig: {
    driveImpersonateAs: 'admin@venturemortgages.com',
  },
}));

// ---------------------------------------------------------------------------
// Import module under test (after mocks)
// ---------------------------------------------------------------------------

import { getDriveClient, resetDriveClient } from '../drive-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SA_KEY = Buffer.from(
  JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n' }),
).toString('base64');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Drive Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDriveClient();
    // Clear relevant env vars
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('creates Drive client with service account auth', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = VALID_SA_KEY;

    getDriveClient();

    // JWT should be created with drive scope and impersonation
    expect(mockJWT).toHaveBeenCalledWith({
      email: 'sa@test.iam.gserviceaccount.com',
      key: expect.stringContaining('BEGIN RSA PRIVATE KEY'),
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: 'admin@venturemortgages.com',
    });

    // google.drive should be called with v3
    expect(mockDrive).toHaveBeenCalledWith({
      version: 'v3',
      auth: expect.any(Object),
    });
  });

  it('creates Drive client with OAuth2 auth', () => {
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

    getDriveClient();

    // google.drive should be called with an OAuth2Client instance as auth
    expect(mockDrive).toHaveBeenCalledWith({
      version: 'v3',
      auth: expect.any(MockOAuth2ClientClass),
    });

    // JWT should NOT be used
    expect(mockJWT).not.toHaveBeenCalled();
  });

  it('caches client (singleton behavior)', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = VALID_SA_KEY;

    const client1 = getDriveClient();
    const client2 = getDriveClient();

    expect(client1).toBe(client2);
    expect(mockDrive).toHaveBeenCalledTimes(1);
  });

  it('resetDriveClient clears cache', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = VALID_SA_KEY;

    getDriveClient();
    expect(mockDrive).toHaveBeenCalledTimes(1);

    resetDriveClient();
    getDriveClient();
    expect(mockDrive).toHaveBeenCalledTimes(2);
  });

  it('throws if no credentials are set', () => {
    // No env vars set at all
    expect(() => getDriveClient()).toThrow('No Drive credentials found');
  });

  it('throws if OAuth2 credentials are incomplete', () => {
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
    // Missing CLIENT_ID and CLIENT_SECRET

    expect(() => getDriveClient()).toThrow('OAuth2 credentials incomplete');
  });

  it('throws if service account key is malformed', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'not-valid-base64-json!!!';

    expect(() => getDriveClient()).toThrow('GOOGLE_SERVICE_ACCOUNT_KEY is malformed');
  });

  it('throws if service account key missing required fields', () => {
    const incompleteKey = Buffer.from(JSON.stringify({ client_email: 'test@test.com' })).toString('base64');
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = incompleteKey;

    expect(() => getDriveClient()).toThrow('Missing client_email or private_key fields');
  });
});
