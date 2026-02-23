/**
 * Email Draft Orchestrator
 *
 * Main entry point for email automation. Ties together:
 * - generateEmailBody (Plan 01) — checklist -> formatted email text
 * - encodeMimeMessage (Plan 01) — email text -> base64url MIME for Gmail API
 * - createGmailDraft (this plan) — MIME -> draft in admin@venturemortgages.com's Gmail
 *
 * The Phase 1 webhook handler calls createEmailDraft after CRM sync.
 * Cat then reviews the draft in Gmail before approving it.
 *
 * Safety:
 * - Dev mode overrides recipient to dev@venturemortgages.com
 * - Dev mode prefixes subject with [TEST]
 * - Logs only metadata (no PII) per CLAUDE.md
 */

import type { CreateEmailDraftInput, CreateEmailDraftResult } from './types.js';
import { emailConfig } from './config.js';
import { generateEmailBody } from './body.js';
import { encodeMimeMessage } from './mime.js';
import { createGmailDraft } from './gmail-client.js';
import { storeOriginalEmail } from '../feedback/original-store.js';

/**
 * Creates an email draft in admin@venturemortgages.com's Gmail.
 *
 * Flow:
 * 1. Generate email body from checklist
 * 2. Determine recipient (dev override or real)
 * 3. Build subject line with borrower names
 * 4. Encode as base64url MIME message
 * 5. Create draft via Gmail API
 *
 * @param input - Checklist, recipient, borrower names, contact ID
 * @returns Draft ID, subject, recipient, and body preview
 */
export async function createEmailDraft(
  input: CreateEmailDraftInput,
): Promise<CreateEmailDraftResult> {
  // 1. Generate email body
  const rawBody = generateEmailBody(input.checklist, {
    borrowerFirstNames: input.borrowerFirstNames,
    docInboxEmail: emailConfig.docInbox,
    alreadyOnFile: input.alreadyOnFile,
  });

  // Embed tracking metadata as hidden element (Gmail strips X- headers AND HTML comments on send)
  // Using a zero-height div with data attributes — Gmail preserves data-* attributes on block elements
  const body = input.contactId
    ? `${rawBody}\n<div style="height:0;overflow:hidden;font-size:0;color:transparent;" data-venture-type="doc-request" data-venture-contact="${input.contactId}">.</div>`
    : rawBody;

  // 1b. Store original for feedback capture (non-fatal)
  if (input.contactId && input.applicationContext) {
    try {
      await storeOriginalEmail(input.contactId, {
        html: body,
        context: input.applicationContext,
      });
    } catch (err) {
      console.error('[email] Failed to store original for feedback (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Determine recipient (dev override for safety)
  const recipient = emailConfig.recipientOverride ?? input.recipientEmail;

  // 3. Build subject line
  const subject = `${emailConfig.subjectPrefix}Documents Needed — ${input.borrowerFirstNames.join(' & ')}`;

  // 4. Encode as MIME message (with BCC for send tracking + custom headers)
  const raw = encodeMimeMessage({
    to: recipient,
    from: emailConfig.senderAddress,
    bcc: emailConfig.bccAddress,
    subject,
    body,
    customHeaders: {
      'X-Venture-Type': 'doc-request',
      'X-Venture-Contact-Id': input.contactId,
    },
  });

  // 5. Create Gmail draft
  const draftId = await createGmailDraft(raw);

  // 6. Log metadata only (no PII per CLAUDE.md)
  console.log('[email] Draft created', {
    draftId,
    subject,
    recipientDomain: recipient.split('@')[1],
    itemCount: input.checklist.stats.totalItems,
  });

  return {
    draftId,
    subject,
    recipientEmail: recipient,
    bodyPreview: body.substring(0, 200),
  };
}
