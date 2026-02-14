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
 * Provides two client types:
 * - getGmailClient(): compose-scoped client for draft creation/sending (Phase 5)
 * - getGmailReadonlyClient(impersonateAs): readonly-scoped client for inbox monitoring (Phase 6)
 *
 * Error handling:
 * - Auth errors (401, 403, "Delegation denied") throw GmailAuthError
 *   for downstream INFRA-05 alerting
 * - Other API errors propagate as-is
 *
 * Internal module — not exported from barrel. Consumers use draft.ts, send.ts,
 * and intake modules.
 */

import { google } from 'googleapis';
import { JWT, OAuth2Client } from 'google-auth-library';
import { emailConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GmailClient = ReturnType<typeof google.gmail>;

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

/**
 * Loads and validates the service account key from GOOGLE_SERVICE_ACCOUNT_KEY env var.
 * Returns the parsed key fields needed for JWT creation.
 */
function loadServiceAccountKey(): { client_email: string; private_key: string } {
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

    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch (err) {
    if (err instanceof GmailAuthError) throw err;
    throw new GmailAuthError(
      `GOOGLE_SERVICE_ACCOUNT_KEY is malformed: ${err instanceof Error ? err.message : String(err)}. ` +
        'Ensure it is a base64-encoded JSON service account key file.',
      'GMAIL_AUTH_INVALID_KEY',
    );
  }
}

function createServiceAccountAuth(scopes: string[], subject: string): JWT {
  const key = loadServiceAccountKey();
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes,
    subject,
  });
}

// ---------------------------------------------------------------------------
// Generic Gmail Client Factory (internal)
// ---------------------------------------------------------------------------

/**
 * Creates a Gmail API client with the specified scopes and impersonation target.
 * Used internally by getGmailClient and getGmailReadonlyClient.
 */
function createGmailClientForScope(scopes: string[], impersonateAs: string): GmailClient {
  let auth: OAuth2Client | JWT;

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    // OAuth2 mode: use refresh token credentials
    // Note: OAuth2 refresh token is tied to the authorizing user's mailbox.
    // The impersonateAs parameter is ignored for OAuth2 — the token determines the user.
    auth = createOAuth2Auth();
  } else {
    // Service account mode: create JWT with specified scopes and subject
    auth = createServiceAccountAuth(scopes, impersonateAs);
  }

  return google.gmail({ version: 'v1', auth });
}

// ---------------------------------------------------------------------------
// Gmail Client Cache (Lazy Singletons)
// ---------------------------------------------------------------------------

/** Cache key format: "{scope}:{impersonateAs}" */
const clientCache = new Map<string, GmailClient>();

function getCacheKey(scope: string, impersonateAs: string): string {
  return `${scope}:${impersonateAs}`;
}

/**
 * Returns an authenticated Gmail API client with compose scope.
 * Auto-detects auth mode: OAuth2 refresh token if GOOGLE_REFRESH_TOKEN is set,
 * otherwise service account if GOOGLE_SERVICE_ACCOUNT_KEY is set.
 * Client is lazily initialized and cached for reuse.
 *
 * Impersonates emailConfig.senderAddress (admin@/dev@ depending on environment).
 */
export function getGmailClient(): GmailClient {
  const scope = 'https://www.googleapis.com/auth/gmail.compose';
  const key = getCacheKey(scope, emailConfig.senderAddress);

  const cached = clientCache.get(key);
  if (cached) return cached;

  const client = createGmailClientForScope([scope], emailConfig.senderAddress);
  clientCache.set(key, client);
  return client;
}

/**
 * Returns an authenticated Gmail API client with readonly scope.
 * Used for monitoring inboxes (e.g., docs@venturemortgages.co) in Phase 6.
 *
 * @param impersonateAs - Email address of the mailbox to read
 *   - Service account mode: creates JWT with gmail.readonly scope impersonating this address
 *   - OAuth2 mode: uses the existing refresh token credentials. If impersonateAs differs
 *     from the token's authorized user, a warning is logged (API call will fail at runtime)
 *
 * Client is lazily initialized and cached per impersonateAs address.
 */
export function getGmailReadonlyClient(impersonateAs: string): GmailClient {
  const scope = 'https://www.googleapis.com/auth/gmail.readonly';
  const key = getCacheKey(scope, impersonateAs);

  const cached = clientCache.get(key);
  if (cached) return cached;

  // OAuth2 mode warning: refresh token may not match impersonateAs
  if (process.env.GOOGLE_REFRESH_TOKEN && impersonateAs !== emailConfig.senderAddress) {
    console.warn(
      `[gmail-client] OAuth2 mode: refresh token may not have access to "${impersonateAs}". ` +
        `Token is typically authorized for "${emailConfig.senderAddress}". ` +
        'API calls may fail with 403. Use service account mode for cross-mailbox access.',
    );
  }

  const client = createGmailClientForScope([scope], impersonateAs);
  clientCache.set(key, client);
  return client;
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
