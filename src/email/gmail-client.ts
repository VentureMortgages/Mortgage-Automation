/**
 * Gmail API Client
 *
 * Supports two authentication modes:
 * 1. OAuth2 refresh token (dev) — GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
 * 2. Service account with domain-wide delegation (production) — GOOGLE_SERVICE_ACCOUNT_KEY
 *
 * The client auto-detects which mode to use based on which env vars are set.
 * OAuth2 is checked first (preferred for dev), then service account.
 *
 * Error handling:
 * - Auth errors (401, 403, "Delegation denied") throw GmailAuthError
 *   for downstream INFRA-05 alerting
 * - Other API errors propagate as-is
 *
 * Internal module — not exported from barrel. Consumers use draft.ts and send.ts.
 */

import { google } from 'googleapis';
import { JWT, OAuth2Client } from 'google-auth-library';
import { emailConfig } from './config.js';

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/**
 * Thrown when Gmail API authentication fails.
 * Enables downstream INFRA-05 alerting to detect delegation/credential issues.
 */
export class GmailAuthError extends Error {
  readonly code: string;

  constructor(message: string, code: string = 'GMAIL_AUTH_ERROR') {
    super(message);
    this.name = 'GmailAuthError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// OAuth2 Refresh Token Auth (dev mode)
// ---------------------------------------------------------------------------

function createOAuth2Auth(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new GmailAuthError(
      'OAuth2 credentials incomplete. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN. ' +
        'Run: npx tsx src/email/setup/get-refresh-token.ts',
      'GMAIL_AUTH_MISSING_OAUTH',
    );
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

// ---------------------------------------------------------------------------
// Service Account Auth (production)
// ---------------------------------------------------------------------------

function createServiceAccountAuth(): JWT {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded) {
    throw new GmailAuthError(
      'No Gmail credentials found. Set either:\n' +
        '  - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN (OAuth2), or\n' +
        '  - GOOGLE_SERVICE_ACCOUNT_KEY (service account with domain-wide delegation)',
      'GMAIL_AUTH_MISSING_KEY',
    );
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as { client_email?: string; private_key?: string };

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Missing client_email or private_key fields');
    }

    return new JWT({
      email: parsed.client_email,
      key: parsed.private_key,
      scopes: ['https://www.googleapis.com/auth/gmail.compose'],
      subject: emailConfig.senderAddress,
    });
  } catch (err) {
    if (err instanceof GmailAuthError) throw err;
    throw new GmailAuthError(
      `GOOGLE_SERVICE_ACCOUNT_KEY is malformed: ${err instanceof Error ? err.message : String(err)}. ` +
        'Ensure it is a base64-encoded JSON service account key file.',
      'GMAIL_AUTH_INVALID_KEY',
    );
  }
}

// ---------------------------------------------------------------------------
// Gmail Client (Lazy Singleton)
// ---------------------------------------------------------------------------

let gmailClient: ReturnType<typeof google.gmail> | null = null;

/**
 * Returns an authenticated Gmail API client.
 * Auto-detects auth mode: OAuth2 refresh token if GOOGLE_REFRESH_TOKEN is set,
 * otherwise service account if GOOGLE_SERVICE_ACCOUNT_KEY is set.
 * Client is lazily initialized and cached for reuse.
 */
export function getGmailClient(): ReturnType<typeof google.gmail> {
  if (gmailClient) return gmailClient;

  // Prefer OAuth2 (dev-friendly), fall back to service account (production)
  const auth = process.env.GOOGLE_REFRESH_TOKEN
    ? createOAuth2Auth()
    : createServiceAccountAuth();

  gmailClient = google.gmail({ version: 'v1', auth });
  return gmailClient;
}

// ---------------------------------------------------------------------------
// Auth Error Detection
// ---------------------------------------------------------------------------

/**
 * Checks if an error is an authentication/delegation error and wraps it as GmailAuthError.
 */
function wrapAuthError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    err !== null && typeof err === 'object' && 'code' in err
      ? (err as { code: number }).code
      : undefined;

  if (
    status === 401 ||
    status === 403 ||
    message.includes('Delegation denied') ||
    message.includes('Not Authorized') ||
    message.includes('unauthorized') ||
    message.includes('invalid_grant')
  ) {
    throw new GmailAuthError(
      `Gmail API auth error: ${message}. Check credentials and permissions.`,
      'GMAIL_AUTH_DELEGATION',
    );
  }

  throw err;
}

// ---------------------------------------------------------------------------
// Gmail Draft Operations
// ---------------------------------------------------------------------------

/**
 * Creates a draft in the authenticated user's Gmail.
 *
 * @param rawMessage - base64url-encoded MIME message (from encodeMimeMessage)
 * @returns The draft ID (used for sending later)
 */
export async function createGmailDraft(rawMessage: string): Promise<string> {
  try {
    const gmail = getGmailClient();
    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw: rawMessage,
        },
      },
    });

    const draftId = response.data.id;
    if (!draftId) {
      throw new Error('Gmail API returned draft with no ID');
    }

    return draftId;
  } catch (err) {
    if (err instanceof GmailAuthError) throw err;
    return wrapAuthError(err);
  }
}

/**
 * Sends a previously created draft.
 *
 * @param draftId - The draft ID returned from createGmailDraft
 * @returns Message ID and optional thread ID from the sent message
 */
export async function sendGmailDraft(
  draftId: string,
): Promise<{ messageId: string; threadId?: string }> {
  try {
    const gmail = getGmailClient();
    const response = await gmail.users.drafts.send({
      userId: 'me',
      requestBody: {
        id: draftId,
      },
    });

    const messageId = response.data.id;
    if (!messageId) {
      throw new Error('Gmail API returned sent message with no ID');
    }

    return {
      messageId,
      threadId: response.data.threadId ?? undefined,
    };
  } catch (err) {
    if (err instanceof GmailAuthError) throw err;
    return wrapAuthError(err);
  }
}
