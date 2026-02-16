// ============================================================================
// CRM Notes Service — Contact notes for audit trail (TRACK-02)
// ============================================================================

import { crmConfig } from './config.js';
import type { CrmNoteInput } from './types/index.js';
import { CrmApiError, CrmAuthError, CrmRateLimitError } from './errors.js';

// ============================================================================
// Functions
// ============================================================================

/**
 * Creates a timestamped audit note on a contact recording document receipt.
 *
 * Notes appear in the CRM timeline alongside emails and tasks, providing
 * a native audit trail visible where Cat already works (TRACK-02).
 *
 * The note is attributed to Cat's user account so it shows as her activity
 * in the CRM UI.
 *
 * @param contactId - The CRM contact ID to attach the note to
 * @param data - Document receipt details (type, source, Drive file ID)
 * @returns The created note ID
 */
export async function createAuditNote(
  contactId: string,
  data: CrmNoteInput,
): Promise<string> {
  const noteBody = [
    `Document received: ${data.documentType}`,
    `Source: ${data.source}`,
    `Filed to Drive: ${data.driveFileId}`,
    `Received: ${new Date().toISOString()}`,
    '',
    '[Automated by Venture Mortgages Doc System]',
  ].join('\n');

  const response = await noteFetch(`/contacts/${contactId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body: noteBody, userId: crmConfig.userIds.cat }),
  });

  const result = (await response.json()) as { note: { id: string } };
  return result.note.id;
}

// ============================================================================
// Internal — HTTP helper with error classification
// ============================================================================

async function noteFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${crmConfig.baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${crmConfig.apiKey}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });

    if (!response.ok) {
      const responseBody = await response.text();

      if (response.status === 429) {
        throw new CrmRateLimitError(responseBody);
      }
      if (response.status === 401) {
        throw new CrmAuthError(responseBody);
      }

      throw new CrmApiError(
        `CRM API error: ${response.status} ${response.statusText}`,
        response.status,
        responseBody,
      );
    }

    return response;
  } catch (error) {
    if (error instanceof CrmApiError) {
      throw error;
    }

    throw new CrmApiError(
      `CRM API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      0,
      '',
    );
  }
}
