// ============================================================================
// CRM Checklist Sync — Main Orchestrator
// ============================================================================
//
// This is the single entry point that the webhook handler (Phase 1) calls
// when a Finmo application is submitted. It ties together all CRM operations
// in the correct order:
//
//   1. Map checklist to CRM fields (pure, no API)
//   2. Upsert contact with borrower details (no doc tracking fields)
//   3. Find Finmo's existing opportunity and write doc tracking there
//   4. Create review task for Cat
//
// Opportunity-centric tracking (Phase 10):
// - Doc tracking fields are written to the OPPORTUNITY, not the contact
// - The opportunity is found by matching Finmo Application ID, not created
// - If no opportunity is found, falls back to contact-level tracking (backward compat)
//
// Idempotency:
// - Contact upsert is idempotent (dedup by email)
// - Custom field updates overwrite previous values (safe for retry)
// - Task creation is NOT idempotent (creates duplicates on retry).
//   The webhook handler (Phase 1) is responsible for deduplication using
//   idempotency keys at the HTTP layer.

import type { GeneratedChecklist } from '../checklist/types/index.js';
import { crmConfig } from './config.js';
import { PIPELINE_IDS } from './types/index.js';
import { upsertContact } from './contacts.js';
import { mapChecklistToFields, buildChecklistSummary } from './checklist-mapper.js';
import { createOrUpdateReviewTask } from './tasks.js';
import {
  findOpportunityByFinmoId,
  updateOpportunityFields,
  updateOpportunityStage,
} from './opportunities.js';

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
  /** Finmo application UUID (e.g., '98f332e4-...') — used to find existing opportunity */
  finmoApplicationId?: string;
  /** Pre-received docs from Drive scan (already on file) */
  preReceivedDocs?: { name: string; stage: string }[];
  /** Skip review task creation (used on CRM sync retry to avoid duplicates) */
  skipTask?: boolean;
}

export interface SyncChecklistResult {
  /** CRM contact ID (created or updated) */
  contactId: string;
  /** Cat's review task ID (undefined if task creation failed) */
  taskId?: string;
  /** Pipeline opportunity ID (undefined if not found or update failed) */
  opportunityId?: string;
  /** Count of custom fields written */
  fieldsUpdated: number;
  /** Where doc tracking fields were written: opportunity (preferred) or contact (fallback) */
  trackingTarget: 'opportunity' | 'contact';
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
 * 2. Upsert contact with borrower details only (no doc tracking fields)
 * 3. Find Finmo's existing opportunity by application ID
 * 4. If found: write doc tracking to opportunity + set stage
 * 5. If not found: fallback — write doc tracking to contact (old behavior)
 * 6. Create review task for Cat (non-critical — warning on failure)
 *
 * If contact upsert fails, the entire operation aborts (cannot create
 * tasks or find opportunities without a contactId).
 *
 * If opportunity search, field update, or task creation fails, the operation
 * continues and the failure is recorded in the errors array.
 *
 * @param input - Borrower details and generated checklist
 * @returns Result with contactId, opportunityId, trackingTarget, and any errors
 */
export async function syncChecklistToCrm(
  input: SyncChecklistInput,
): Promise<SyncChecklistResult> {
  const errors: string[] = [];

  // 0. Log environment mode
  if (crmConfig.isDev) {
    console.log('[DEV MODE] syncChecklistToCrm — contacts/tasks will be prefixed with [TEST]');
  }

  // 1. Map checklist to CRM fields for OPPORTUNITY (uses opportunityFieldIds)
  const oppFieldUpdates = mapChecklistToFields(
    input.checklist,
    { fieldIds: crmConfig.opportunityFieldIds },
    input.preReceivedDocs,
  );

  // 2. Upsert contact — CRITICAL: abort if this fails
  //    Contact only gets borrower details, NOT doc tracking custom fields
  const { contactId } = await upsertContact({
    email: input.borrowerEmail,
    firstName: input.borrowerFirstName,
    lastName: input.borrowerLastName,
    phone: input.borrowerPhone,
  });

  // 3. Find Finmo's existing opportunity
  let opportunityId: string | undefined;
  let trackingTarget: 'opportunity' | 'contact' = 'contact';

  if (input.finmoApplicationId) {
    try {
      const opp = await findOpportunityByFinmoId(
        contactId,
        PIPELINE_IDS.LIVE_DEALS,
        input.finmoApplicationId,
      );

      if (opp) {
        opportunityId = opp.id;

        // 4a. Write doc tracking fields to opportunity
        try {
          await updateOpportunityFields(opportunityId, oppFieldUpdates);
          trackingTarget = 'opportunity';
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.warn(`[syncChecklistToCrm] Opportunity field update failed: ${message}`);
          errors.push(`Opportunity field update failed: ${message}`);
        }

        // 4b. Set stage to "Collecting Documents"
        try {
          await updateOpportunityStage(opportunityId, crmConfig.stageIds.collectingDocuments);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.warn(`[syncChecklistToCrm] Stage update failed: ${message}`);
          errors.push(`Stage update failed: ${message}`);
        }
      } else {
        // No opportunity found — fall back to contact-level tracking
        console.warn(
          '[syncChecklistToCrm] No Finmo opportunity found, falling back to contact-level tracking',
        );
      }
    } catch (error) {
      // Opportunity search failed — non-fatal, fall back to contact-level
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[syncChecklistToCrm] Opportunity search failed: ${message}`);
      errors.push(`Opportunity search failed: ${message}`);
    }
  }

  // 5. Fallback: if tracking not written to opportunity, write to contact
  if (trackingTarget === 'contact') {
    const contactFieldUpdates = mapChecklistToFields(
      input.checklist,
      { fieldIds: crmConfig.fieldIds },
      input.preReceivedDocs,
    );

    await upsertContact({
      email: input.borrowerEmail,
      firstName: input.borrowerFirstName,
      lastName: input.borrowerLastName,
      phone: input.borrowerPhone,
      customFields: contactFieldUpdates,
    });
  }

  // 6. Create review task for Cat — non-critical
  //    Skipped on retry to avoid duplicate tasks
  let taskId: string | undefined;
  if (!input.skipTask) {
    try {
      const borrowerName = `${input.borrowerFirstName} ${input.borrowerLastName}`;
      const summary = buildChecklistSummary(input.checklist);
      taskId = await createOrUpdateReviewTask(contactId, borrowerName, summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[syncChecklistToCrm] Task creation failed: ${message}`);
      errors.push(`Task creation failed: ${message}`);
    }
  }

  // 7. Return result
  return {
    contactId,
    taskId,
    opportunityId,
    fieldsUpdated: oppFieldUpdates.length,
    trackingTarget,
    errors,
  };
}
