// ============================================================================
// CRM Checklist Sync — Main Orchestrator
// ============================================================================
//
// This is the single entry point that the webhook handler (Phase 1) calls
// when a Finmo application is submitted. It ties together all CRM operations
// in the correct order:
//
//   1. Map checklist to CRM fields (pure, no API)
//   2. Upsert contact with custom field updates
//   3. Create review task for Cat
//   4. Move pipeline to "Collecting Documents"
//
// Idempotency:
// - Contact upsert is idempotent (dedup by email)
// - Custom field updates overwrite previous values (safe for retry)
// - Task creation is NOT idempotent (creates duplicates on retry).
//   The webhook handler (Phase 1) is responsible for deduplication using
//   idempotency keys at the HTTP layer.
// - Opportunity upsert is idempotent (dedup by contactId + pipelineId)

import type { GeneratedChecklist } from '../checklist/types/index.js';
import { crmConfig } from './config.js';
import { upsertContact } from './contacts.js';
import { mapChecklistToFields, buildChecklistSummary } from './checklist-mapper.js';
import { createReviewTask } from './tasks.js';
import { moveToCollectingDocs } from './opportunities.js';

// ============================================================================
// Types
// ============================================================================

export interface SyncChecklistInput {
  /** Phase 3 output — the generated document checklist */
  checklist: GeneratedChecklist;
  /** Main borrower email for contact upsert */
  borrowerEmail: string;
  /** Main borrower first name */
  borrowerFirstName: string;
  /** Main borrower last name */
  borrowerLastName: string;
  /** Optional phone number */
  borrowerPhone?: string;
  /** For linking to existing Finmo contact */
  finmoDealId?: string;
}

export interface SyncChecklistResult {
  /** CRM contact ID (created or updated) */
  contactId: string;
  /** Cat's review task ID (undefined if task creation failed) */
  taskId?: string;
  /** Pipeline opportunity ID (undefined if opportunity upsert failed) */
  opportunityId?: string;
  /** Count of custom fields written to the contact */
  fieldsUpdated: number;
  /** Errors from non-critical operations (task, opportunity) */
  errors: string[];
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Syncs a generated checklist to MyBrokerPro CRM.
 *
 * Execution order:
 * 1. Map checklist to CRM field updates (pure function)
 * 2. Upsert contact with borrower details + custom fields
 * 3. Create review task for Cat (non-critical — warning on failure)
 * 4. Move pipeline to "Collecting Documents" (non-critical — warning on failure)
 *
 * If contact upsert fails, the entire operation aborts (cannot create
 * tasks or opportunities without a contactId).
 *
 * If task creation or opportunity upsert fails, the operation continues
 * and the failure is recorded in the errors array.
 *
 * @param input - Borrower details and generated checklist
 * @returns Result with contactId, taskId, opportunityId, and any errors
 */
export async function syncChecklistToCrm(
  input: SyncChecklistInput,
): Promise<SyncChecklistResult> {
  const errors: string[] = [];

  // 0. Log environment mode
  if (crmConfig.isDev) {
    console.log('[DEV MODE] syncChecklistToCrm — contacts/tasks will be prefixed with [TEST]');
  }

  // 1. Map checklist to CRM fields (pure, no API call)
  const fieldUpdates = mapChecklistToFields(input.checklist, {
    fieldIds: crmConfig.fieldIds,
  });

  // 2. Upsert contact — CRITICAL: abort if this fails
  const { contactId } = await upsertContact({
    email: input.borrowerEmail,
    firstName: input.borrowerFirstName,
    lastName: input.borrowerLastName,
    phone: input.borrowerPhone,
    customFields: fieldUpdates,
  });

  // 3. Create review task for Cat — non-critical
  let taskId: string | undefined;
  try {
    const borrowerName = `${input.borrowerFirstName} ${input.borrowerLastName}`;
    const summary = buildChecklistSummary(input.checklist);
    taskId = await createReviewTask(contactId, borrowerName, summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[syncChecklistToCrm] Task creation failed: ${message}`);
    errors.push(`Task creation failed: ${message}`);
  }

  // 4. Move pipeline to Collecting Documents — non-critical
  let opportunityId: string | undefined;
  try {
    const borrowerName = `${input.borrowerFirstName} ${input.borrowerLastName}`;
    opportunityId = await moveToCollectingDocs(contactId, borrowerName);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[syncChecklistToCrm] Opportunity upsert failed: ${message}`);
    errors.push(`Opportunity upsert failed: ${message}`);
  }

  // 5. Return result
  return {
    contactId,
    taskId,
    opportunityId,
    fieldsUpdated: fieldUpdates.length,
    errors,
  };
}
