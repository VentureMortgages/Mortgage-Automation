/**
 * Gmail API Client
 *
 * Authenticated client using a Google service account with domain-wide delegation
 * to impersonate admin@venturemortgages.com for draft creation and sending.
 *
 * Authentication:
 * - Service account key read from GOOGLE_SERVICE_ACCOUNT_KEY env var (base64-encoded JSON)
 * - JWT auth with gmail.compose scope (minimum privilege)
 * - Domain-wide delegation impersonates senderAddress from emailConfig
 *
 * Error handling:
 * - Auth errors (401, 403, "Delegation denied") throw GmailAuthError
 *   for downstream INFRA-05 alerting
 * - Other API errors propagate as-is
 *
 * Internal module — not exported from barrel. Consumers use draft.ts and send.ts.
 */

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
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
// Service Account Key
// ---------------------------------------------------------------------------

/**
 * Reads and decodes the service account key from GOOGLE_SERVICE_ACCOUNT_KEY env var.
 * The env var must contain the base64-encoded contents of the JSON key file.
 */
function loadServiceAccountKey(): { client_email: string; private_key: string } {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded) {
    throw new GmailAuthError(
      'GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set. ' +
        'Generate a service account key JSON file in Google Cloud Console, ' +
        'then base64 encode it and set the env var.',
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

// ---------------------------------------------------------------------------
// Gmail Client (Lazy Singleton)
// ---------------------------------------------------------------------------

let gmailClient: ReturnType<typeof google.gmail> | null = null;

/**
 * Returns an authenticated Gmail API client.
 * Uses JWT auth with domain-wide delegation to impersonate the sender address.
 * Client is lazily initialized and cached for reuse.
 */
export function getGmailClient(): ReturnType<typeof google.gmail> {
  if (gmailClient) return gmailClient;

  const key = loadServiceAccountKey();

  const auth = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
    subject: emailConfig.senderAddress,
  });

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
    message.includes('unauthorized')
  ) {
    throw new GmailAuthError(
      `Gmail API auth error: ${message}. Check service account delegation in Google Workspace Admin.`,
      'GMAIL_AUTH_DELEGATION',
    );
  }

  throw err;
}

// ---------------------------------------------------------------------------
// Gmail Draft Operations
// ---------------------------------------------------------------------------

/**
 * Creates a draft in the impersonated user's Gmail.
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
