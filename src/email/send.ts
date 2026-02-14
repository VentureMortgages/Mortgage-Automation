/**
 * Email Send Function
 *
 * Sends a previously created Gmail draft. Called after Cat reviews and
 * approves the draft in Gmail.
 *
 * Logs only metadata (no PII) per CLAUDE.md.
 */

import type { SendResult } from './types.js';
import { sendGmailDraft } from './gmail-client.js';

/**
 * Sends a Gmail draft that was previously created by createEmailDraft.
 *
 * @param draftId - The draft ID returned from createEmailDraft
 * @returns Message ID and optional thread ID from the sent message
 */
export async function sendEmailDraft(draftId: string): Promise<SendResult> {
  const result = await sendGmailDraft(draftId);

  console.log('[email] Draft sent', {
    draftId,
    messageId: result.messageId,
  });

  return {
    messageId: result.messageId,
    threadId: result.threadId,
  };
}
