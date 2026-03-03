// ============================================================================
// Cat Email Notification — Send reminder notification to Cat
// ============================================================================
//
// Sends Cat a structured email when documents are overdue.
// Includes: Drive link, client info, email subject + body ready to copy/paste.
//
// Non-fatal: all errors are caught and logged as warnings.
// This ensures notification failures never block the reminder pipeline.

import { emailConfig } from '../email/config.js';
import { encodeMimeMessage } from '../email/mime.js';
import { createGmailDraft, sendGmailDraft } from '../email/gmail-client.js';
import type { MissingDocEntry } from '../crm/types/index.js';

export interface ReminderNotificationInput {
  borrowerName: string;
  borrowerEmail: string;
  missingDocs: MissingDocEntry[];
  businessDaysOverdue: number;
  followUpText: string;
  driveFolderUrl: string | null;
}

/**
 * Sends Cat a structured email notification about overdue documents.
 *
 * Format:
 *   Link to drive: [url]
 *   Client name: [name]
 *   Email: [email]
 *   Subject: [ready-to-use subject line]
 *   Body: [draft follow-up email text]
 *
 * Non-fatal: catches all errors, logs warning. Never throws.
 */
export async function sendReminderNotification(
  input: ReminderNotificationInput,
): Promise<void> {
  try {
    const { borrowerName, borrowerEmail, missingDocs, businessDaysOverdue, followUpText, driveFolderUrl } = input;

    // Determine recipient
    const recipient = emailConfig.recipientOverride
      ?? process.env.CAT_EMAIL
      ?? 'docs@venturemortgages.com';

    const subject = `${emailConfig.subjectPrefix}Follow up: Need docs - ${borrowerName}`;

    const followUpSubject = `Outstanding documents - ${borrowerName}`;

    const body = [
      `Follow-up reminder: ${missingDocs.length} docs still outstanding (${businessDaysOverdue} business days)`,
      '',
      `Link to drive: ${driveFolderUrl ?? 'Not linked'}`,
      `Client name: ${borrowerName}`,
      `Email: ${borrowerEmail}`,
      `Subject: ${followUpSubject}`,
      '',
      'Body:',
      '---',
      followUpText,
      '---',
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
      missingDocCount: missingDocs.length,
      businessDaysOverdue,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[notify-cat] Failed to send reminder notification: ${message}`);
  }
}
