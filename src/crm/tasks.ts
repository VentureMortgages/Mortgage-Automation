// ============================================================================
// CRM Tasks Service — Task creation for Cat (review) and Taylor (PRE-readiness)
// ============================================================================

import { crmConfig, devPrefix } from './config.js';
import { CrmApiError, CrmAuthError, CrmRateLimitError } from './errors.js';

// ============================================================================
// Functions
// ============================================================================

/**
 * Creates a task assigned to Cat to review the generated doc request checklist.
 *
 * Due date is set to 1 business day from now (skips weekends).
 * In dev mode, the task title is prefixed with [TEST].
 *
 * @param contactId - The CRM contact ID to attach the task to
 * @param borrowerName - Display name for the task title (visible in CRM, not a log)
 * @returns The created task ID
 */
export async function createReviewTask(contactId: string, borrowerName: string): Promise<string> {
  if (!crmConfig.userIds.cat) {
    throw new Error('Cat user ID not configured — run setup/fetch-ids.ts first');
  }

  const body = {
    title: devPrefix(`Review doc request — ${borrowerName}`),
    body: 'Generated checklist ready for review. Check custom fields for document list. Edit and send email when ready.',
    assignedTo: crmConfig.userIds.cat,
    dueDate: addBusinessDays(new Date(), 1).toISOString(),
    completed: false,
  };

  const response = await taskFetch(`/contacts/${contactId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as { task: { id: string } };
  return data.task.id;
}

/**
 * Creates a task assigned to Taylor notifying that all PRE documents have been
 * received and the client is ready for budget call.
 *
 * Due date is set to 1 business day from now (skips weekends).
 * In dev mode, the task title is prefixed with [TEST].
 *
 * @param contactId - The CRM contact ID to attach the task to
 * @param borrowerName - Display name for the task title (visible in CRM, not a log)
 * @returns The created task ID
 */
export async function createPreReadinessTask(contactId: string, borrowerName: string): Promise<string> {
  if (!crmConfig.userIds.taylor) {
    throw new Error('Taylor user ID not configured — run setup/fetch-ids.ts first');
  }

  const body = {
    title: devPrefix(`PRE docs complete — ${borrowerName}`),
    body: 'All PRE-approval documents have been received. Client is ready for budget call.',
    assignedTo: crmConfig.userIds.taylor,
    dueDate: addBusinessDays(new Date(), 1).toISOString(),
    completed: false,
  };

  const response = await taskFetch(`/contacts/${contactId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as { task: { id: string } };
  return data.task.id;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Adds business days to a date, skipping weekends (Saturday and Sunday).
 *
 * @param date - The starting date
 * @param days - Number of business days to add (must be >= 0)
 * @returns A new Date with the calculated business day
 */
export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remaining = days;

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    // Skip Saturday (6) and Sunday (0)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remaining--;
    }
  }

  return result;
}

// ============================================================================
// Internal — HTTP helper with error classification
// ============================================================================

async function taskFetch(path: string, init: RequestInit): Promise<Response> {
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
