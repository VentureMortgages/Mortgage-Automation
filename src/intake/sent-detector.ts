/**
 * Sent Detector — Detects outbound BCC copies and updates CRM
 *
 * When Cat sends a doc-request email draft, the BCC copy arrives in the
 * monitored inbox. This module detects those BCC copies by checking for
 * custom X-Venture-* headers and updates the CRM:
 *
 * 1. Sets "Doc Request Sent" date on the contact
 * 2. Moves opportunity to "Collecting Documents" stage (opportunity-level API)
 * 3. Auto-completes the "Review doc request" CRM task
 * 4. Creates an audit note
 *
 * The intake worker calls isBccCopy() early to short-circuit normal
 * attachment processing for outbound BCC messages.
 *
 * Consumers: intake-worker.ts (Phase 6)
 */

import { getContact, upsertContact } from '../crm/contacts.js';
import { createAuditNote } from '../crm/notes.js';
import { searchOpportunities, updateOpportunityStage } from '../crm/opportunities.js';
import { findReviewTask, completeTask } from '../crm/tasks.js';
import { crmConfig } from '../crm/config.js';
import { PIPELINE_IDS } from '../crm/types/index.js';
import { captureFeedback } from '../feedback/capture.js';
import type { GmailMessageMeta } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SentDetectionResult {
  detected: boolean;
  contactId?: string;
  sentDate?: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Checks if a Gmail message is an outbound BCC copy of a doc-request email.
 *
 * Returns true when both X-Venture-Type is 'doc-request' and
 * X-Venture-Contact-Id is present (set by the draft creator).
 */
export function isBccCopy(meta: GmailMessageMeta): boolean {
  return meta.ventureType === 'doc-request' && !!meta.ventureContactId;
}

// ---------------------------------------------------------------------------
// CRM Update
// ---------------------------------------------------------------------------

/**
 * Handles a detected BCC copy: updates CRM fields and pipeline.
 *
 * 1. Fetches the contact record (to get email/name for upsertContact)
 * 2. Sets docRequestSent field to today's date
 * 3. Moves opportunity to "Collecting Documents" (opportunity-level API)
 * 3b. Auto-completes the "Review doc request" CRM task
 * 4. Creates an audit note
 * 5. Captures feedback from Cat's edits
 *
 * Steps 3-5 are non-critical: failures are captured in errors[] but
 * don't prevent the result from being detected=true.
 *
 * @param meta - The Gmail message metadata with venture headers
 * @returns Result with detection status and any non-critical errors
 */
export async function handleSentDetection(
  meta: GmailMessageMeta,
): Promise<SentDetectionResult> {
  const contactId = meta.ventureContactId;
  if (!contactId) {
    return { detected: false, errors: [] };
  }

  const errors: string[] = [];
  const sentDate = new Date().toISOString().split('T')[0];

  // 1. Get contact record for email/name (needed by upsertContact)
  const contact = await getContact(contactId);

  // 2. Update docRequestSent field
  await upsertContact({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    customFields: [
      { id: crmConfig.fieldIds.docRequestSent, field_value: sentDate },
    ],
  });

  console.log('[sent-detector] Updated Doc Request Sent date', {
    contactId,
    sentDate,
  });

  // 3. Move opportunity to "Collecting Documents" (non-critical)
  // Uses opportunity-level API — finds the Live Deals opportunity and updates its stage
  try {
    const opportunities = await searchOpportunities(contactId, PIPELINE_IDS.LIVE_DEALS);
    if (opportunities.length > 0) {
      // Move the first Live Deals opportunity (most recent)
      const opp = opportunities[0];
      await updateOpportunityStage(opp.id, crmConfig.stageIds.collectingDocuments);
      console.log('[sent-detector] Opportunity moved to Collecting Documents', {
        contactId,
        opportunityId: opp.id,
      });
    } else {
      console.log('[sent-detector] No Live Deals opportunity found for stage move', { contactId });
    }
  } catch (err) {
    errors.push(`Stage move failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3b. Auto-complete "Review checklist" task (non-critical, PIPE-03)
  try {
    const reviewTask = await findReviewTask(contactId);
    if (reviewTask && !reviewTask.completed) {
      await completeTask(contactId, reviewTask.id);
      console.log('[sent-detector] Review task auto-completed', {
        contactId,
        taskId: reviewTask.id,
      });
    }
  } catch (err) {
    errors.push(`Task completion failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Create audit note (non-critical)
  try {
    await createAuditNote(contactId, {
      documentType: 'Doc Request Email Sent',
      source: 'gmail',
      driveFileId: 'N/A — outbound email',
    });
  } catch (err) {
    errors.push(`Audit note failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Capture feedback from Cat's edits (non-critical)
  try {
    await captureFeedback(meta.messageId, contactId);
  } catch (err) {
    errors.push(`Feedback capture failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    detected: true,
    contactId,
    sentDate,
    errors,
  };
}
