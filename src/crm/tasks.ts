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
 * @param checklistSummary - Optional checklist summary to include in the task body
 * @returns The created task ID
 */
export async function createReviewTask(
  contactId: string,
  borrowerName: string,
  checklistSummary?: string,
): Promise<string> {
  if (!crmConfig.userIds.cat) {
    throw new Error('Cat user ID not configured — run setup/fetch-ids.ts first');
  }

  const defaultBody =
    'Generated checklist ready for review. Check custom fields for document list. Edit and send email when ready.';
  const taskBody = checklistSummary
    ? `${defaultBody}\n\n--- Checklist Summary ---\n${checklistSummary}`
    : defaultBody;

  const body = {
    title: devPrefix(`Review doc request — ${borrowerName}`),
    body: taskBody,
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
// Task Search, Update, and Dedup
// ============================================================================

/**
 * Searches for an existing "Review doc request" task on a contact.
 *
 * Uses the GHL Tasks API to list all tasks for the contact, then filters
 * by title pattern. This enables deduplication when Finmo creates two MBP
 * opportunities (Leads + Live Deals) for the same application.
 *
 * Non-fatal: returns null on any error (logged, never thrown).
 *
 * @param contactId - The CRM contact ID to search tasks for
 * @returns The first matching task, or null if none found or on error
 */
export async function findReviewTask(
  contactId: string,
): Promise<{ id: string; title: string; completed: boolean } | null> {
  try {
    const response = await taskFetch(`/contacts/${contactId}/tasks`, {
      method: 'GET',
    });

    const data = (await response.json()) as {
      tasks: Array<{ id: string; title: string; completed: boolean; body?: string; assignedTo?: string }>;
    };

    const match = data.tasks.find((task) => task.title.includes('Review doc request'));
    return match ? { id: match.id, title: match.title, completed: match.completed } : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[findReviewTask] Failed to search tasks for contact: ${message}`);
    return null;
  }
}

/**
 * Marks a task as completed via the GHL API.
 *
 * Non-fatal: logs errors but never throws.
 *
 * @param contactId - The CRM contact ID the task belongs to
 * @param taskId - The task ID to mark as completed
 */
export async function completeTask(contactId: string, taskId: string): Promise<void> {
  try {
    await taskFetch(`/contacts/${contactId}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ completed: true }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[completeTask] Failed to complete task ${taskId}: ${message}`);
  }
}

/**
 * Creates a new review task or updates an existing one (deduplication).
 *
 * Checks for an existing "Review doc request" task on the contact first.
 * If found, updates its body with the latest checklist summary.
 * If not found, creates a new task via createReviewTask.
 *
 * Non-fatal: catches all errors, logs them, returns undefined.
 *
 * @param contactId - The CRM contact ID
 * @param borrowerName - Display name for the task title
 * @param checklistSummary - Optional checklist summary for the task body
 * @returns The task ID (existing or new), or undefined on error
 */
export async function createOrUpdateReviewTask(
  contactId: string,
  borrowerName: string,
  checklistSummary?: string,
): Promise<string | undefined> {
  try {
    const existing = await findReviewTask(contactId);

    if (existing) {
      // Update the existing task body with latest checklist
      const defaultBody =
        'Generated checklist ready for review. Check custom fields for document list. Edit and send email when ready.';
      const taskBody = checklistSummary
        ? `${defaultBody}\n\n--- Checklist Summary ---\n${checklistSummary}`
        : defaultBody;

      await taskFetch(`/contacts/${contactId}/tasks/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ body: taskBody }),
      });

      return existing.id;
    }

    // No existing task — create a new one
    return await createReviewTask(contactId, borrowerName, checklistSummary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[createOrUpdateReviewTask] Failed: ${message}`);
    return undefined;
  }
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
