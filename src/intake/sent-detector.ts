/**
 * Sent Detector — Detects outbound BCC copies and updates CRM
 *
 * When Cat sends a doc-request email draft, the BCC copy arrives in the
 * monitored inbox. This module detects those BCC copies by checking for
 * custom X-Venture-* headers and updates the CRM:
 *
 * 1. Sets "Doc Request Sent" date on the contact
 * 2. Moves pipeline to "Collecting Documents" stage
 * 3. Creates an audit note
 *
 * The intake worker calls isBccCopy() early to short-circuit normal
 * attachment processing for outbound BCC messages.
 *
 * Consumers: intake-worker.ts (Phase 6)
 */

import { getContact, upsertContact } from '../crm/contacts.js';
import { createAuditNote } from '../crm/notes.js';
import { moveToCollectingDocs } from '../crm/opportunities.js';
import { crmConfig } from '../crm/config.js';
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
 * 3. Moves pipeline to "Collecting Documents"
 * 4. Creates an audit note
 *
 * Steps 3-4 are non-critical: failures are captured in errors[] but
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

  // 3. Move pipeline to "Collecting Documents" (non-critical)
  try {
    await moveToCollectingDocs(contactId, `${contact.firstName} ${contact.lastName}`);
    console.log('[sent-detector] Pipeline moved to Collecting Documents', { contactId });
  } catch (err) {
    errors.push(`Pipeline advance failed: ${err instanceof Error ? err.message : String(err)}`);
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

  return {
    detected: true,
    contactId,
    sentDate,
    errors,
  };
}
