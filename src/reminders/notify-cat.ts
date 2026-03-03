// ============================================================================
// Cat Email Notification — Send reminder notification to Cat
// ============================================================================
//
// Sends Cat a short email notification when documents are overdue.
// This is NOT the follow-up email to the client -- it's an internal
// notification pointing Cat to the CRM task for the full list and draft.
//
// Non-fatal: all errors are caught and logged as warnings.
// This ensures notification failures never block the reminder pipeline.

import { emailConfig } from '../email/config.js';
import { encodeMimeMessage } from '../email/mime.js';
import { createGmailDraft, sendGmailDraft } from '../email/gmail-client.js';

/**
 * Sends Cat an email notification about overdue documents.
 *
 * Creates a Gmail draft and immediately sends it. The email contains
 * client name, email, doc count, and days overdue. Cat should check
 * the CRM task for the full missing doc list and draft follow-up email.
 *
 * Recipient: In dev mode uses emailConfig.recipientOverride.
 * In production uses CAT_EMAIL env var (fallback: docs@venturemortgages.com).
 *
 * Non-fatal: catches all errors, logs warning. Never throws.
 *
 * @param borrowerName - Client's full name
 * @param borrowerEmail - Client's email address
 * @param missingDocCount - Number of outstanding documents
 * @param businessDaysOverdue - Business days since doc request was sent
 */
export async function sendReminderNotification(
  borrowerName: string,
  borrowerEmail: string,
  missingDocCount: number,
  businessDaysOverdue: number,
): Promise<void> {
  try {
    // Determine recipient
    const recipient = emailConfig.recipientOverride
      ?? process.env.CAT_EMAIL
      ?? 'docs@venturemortgages.com';

    const subject = `${emailConfig.subjectPrefix}Follow up: Need docs - ${borrowerName}`;

    const body = [
      `Reminder: Outstanding documents for ${borrowerName}`,
      '',
      `Client: ${borrowerName} (${borrowerEmail})`,
      `${missingDocCount} docs still outstanding (${businessDaysOverdue} business days since request).`,
      '',
      'Please check the CRM task for the full list and draft follow-up email.',
      '',
      '-- Venture Mortgages Doc Automation',
    ].join('\n');

    const rawMessage = encodeMimeMessage({
      from: emailConfig.senderAddress,
      to: recipient,
      subject,
      body,
    });

    const { draftId } = await createGmailDraft(rawMessage);
    await sendGmailDraft(draftId);

    console.log('[notify-cat] Reminder notification sent', {
      borrowerName,
      missingDocCount,
      businessDaysOverdue,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[notify-cat] Failed to send reminder notification: ${message}`);
  }
}
