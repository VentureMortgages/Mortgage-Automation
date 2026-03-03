// ============================================================================
// Follow-up Text Generator — Creates reminder content for Cat
// ============================================================================

import type { MissingDocEntry } from '../crm/types/index.js';

/**
 * Generates a follow-up email body that Cat can copy/paste to send to the client.
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
 * Generates a concise CRM task body for Cat.
 *
 * Kept under 2000 chars (GHL limit) by listing doc names only,
 * without the full draft email (that's in Cat's email notification).
 */
export function generateReminderTaskBody(
  borrowerName: string,
  borrowerEmail: string,
  missingDocs: MissingDocEntry[],
  businessDaysOverdue: number,
  _followUpText: string,
): string {
  const docList = missingDocs
    .map((doc) => `- ${doc.name}`)
    .join('\n');

  const lines = [
    `Client: ${borrowerName}`,
    `Email: ${borrowerEmail}`,
    `Days overdue: ${businessDaysOverdue} business days`,
    `Missing: ${missingDocs.length} documents`,
    '',
    docList,
  ];

  const body = lines.join('\n');

  // GHL task body limit is ~2000 chars — truncate if needed
  if (body.length > 1900) {
    const truncated = body.slice(0, 1900);
    return truncated + '\n\n... (see email for full list)';
  }

  return body;
}
