// ============================================================================
// Follow-up Text Generator — Creates reminder content for Cat
// ============================================================================
//
// Generates two types of content:
// 1. Follow-up email text that Cat can copy/paste to send to the client
// 2. CRM task body with context for Cat + the draft email text
//
// Tone matches existing doc request emails: professional, friendly, specific.
// Lists each missing document by name so the client knows exactly what to send.
//
// PII safety: Only document type names and borrower first name are included.

import type { MissingDocEntry } from '../crm/types/index.js';

/**
 * Generates a follow-up email body that Cat can copy/paste to send to the client.
 *
 * Lists each missing document by name. Matches the professional, friendly tone
 * of the initial doc request emails.
 *
 * @param borrowerFirstName - Client's first name for the greeting
 * @param missingDocs - List of documents still needed
 * @returns Plain text email body ready to copy/paste
 */
export function generateFollowUpText(
  borrowerFirstName: string,
  missingDocs: MissingDocEntry[],
): string {
  const docList = missingDocs
    .map((doc) => `  - ${doc.name}`)
    .join('\n');

  return [
    `Hi ${borrowerFirstName},`,
    '',
    'Just a friendly follow-up regarding your mortgage application. We are still waiting on the following documents to move forward:',
    '',
    docList,
    '',
    'Could you please send these at your earliest convenience? If you have any questions about what is needed, feel free to reach out and we will be happy to help.',
    '',
    'Thank you for your time,',
    'Venture Mortgages',
  ].join('\n');
}

/**
 * Generates a CRM task body for Cat with context and a ready-to-send draft.
 *
 * Includes:
 * - Missing doc list for Cat's quick reference
 * - Days since the original request was sent
 * - The full follow-up email text ready to copy/paste
 * - Borrower contact info
 *
 * @param borrowerName - Full name (First Last)
 * @param borrowerEmail - Email address for sending follow-up
 * @param missingDocs - List of documents still needed
 * @param businessDaysOverdue - Business days since doc request was sent
 * @param followUpText - Pre-generated follow-up email text
 * @returns Formatted CRM task body
 */
export function generateReminderTaskBody(
  borrowerName: string,
  borrowerEmail: string,
  missingDocs: MissingDocEntry[],
  businessDaysOverdue: number,
  followUpText: string,
): string {
  const docList = missingDocs
    .map((doc) => `  - ${doc.name} (${doc.stage})`)
    .join('\n');

  return [
    `--- Follow-up Reminder ---`,
    `Client: ${borrowerName}`,
    `Email: ${borrowerEmail}`,
    `Days since doc request: ${businessDaysOverdue} business days`,
    '',
    `--- Missing Documents (${missingDocs.length}) ---`,
    docList,
    '',
    '--- Draft Follow-up Email (copy/paste below) ---',
    '',
    followUpText,
  ].join('\n');
}
