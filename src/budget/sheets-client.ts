/**
 * Google Sheets API Client
 *
 * Supports two authentication modes (same pattern as src/classification/drive-client.ts):
 * 1. OAuth2 refresh token (dev) — GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
 * 2. Service account with domain-wide delegation (production) — GOOGLE_SERVICE_ACCOUNT_KEY
 *
 * The client auto-detects which mode to use based on which env vars are set.
 * OAuth2 is checked first (preferred for dev), then service account.
 *
 * Provides getSheetsClient() lazy singleton for Google Sheets API v4.
 */

import { google } from 'googleapis';
import { JWT, OAuth2Client } from 'google-auth-library';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SheetsClient = ReturnType<typeof google.sheets>;

// ---------------------------------------------------------------------------
// Service Account Key Loading
// ---------------------------------------------------------------------------

/**
 * Loads and validates the service account key from GOOGLE_SERVICE_ACCOUNT_KEY env var.
 * Same logic as drive-client.ts loadServiceAccountKey (internal, not exported there).
 */
function loadServiceAccountKey(): { client_email: string; private_key: string } {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded) {
    throw new Error(
      'No Sheets credentials found. Set either:\n' +
        '  - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN (OAuth2), or\n' +
        '  - GOOGLE_SERVICE_ACCOUNT_KEY (service account with domain-wide delegation)',
    );
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as { client_email?: string; private_key?: string };

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Missing client_email or private_key fields');
    }

    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch (err) {
    if (err instanceof Error && err.message.includes('No Sheets credentials found')) throw err;
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_KEY is malformed: ${err instanceof Error ? err.message : String(err)}. ` +
        'Ensure it is a base64-encoded JSON service account key file.',
    );
  }
}

// ---------------------------------------------------------------------------
// Sheets Client Singleton
// ---------------------------------------------------------------------------

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const isDev = (process.env.APP_ENV ?? 'development') !== 'production';
const impersonateAs = process.env.DRIVE_IMPERSONATE_AS ??
  (isDev ? 'dev@venturemortgages.com' : 'admin@venturemortgages.com');

let _sheetsClient: SheetsClient | null = null;

/**
 * Returns an authenticated Google Sheets API v4 client.
 * Auto-detects auth mode: OAuth2 refresh token if GOOGLE_REFRESH_TOKEN is set,
 * otherwise service account if GOOGLE_SERVICE_ACCOUNT_KEY is set.
 * Client is lazily initialized and cached for reuse.
 */
export function getSheetsClient(): SheetsClient {
  if (_sheetsClient) return _sheetsClient;

  let auth: OAuth2Client | JWT;

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    // OAuth2 mode: use refresh token credentials
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret) {
      throw new Error(
        'OAuth2 credentials incomplete. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET ' +
          'alongside GOOGLE_REFRESH_TOKEN.',
      );
    }

    const oauth2Client = new OAuth2Client(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    auth = oauth2Client;
  } else {
    // Service account mode: create JWT with sheets scope
    const key = loadServiceAccountKey();
    auth = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [SHEETS_SCOPE],
      subject: impersonateAs,
    });
  }

  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

/**
 * Resets the cached Sheets client. Used in tests to clear singleton state.
 */
export function resetSheetsClient(): void {
  _sheetsClient = null;
}
