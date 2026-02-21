/**
 * Feedback Capture — Orchestrates the full feedback extraction pipeline
 *
 * When a BCC copy of a doc-request email is detected by the sent-detector,
 * this module:
 *   1. Retrieves the stored original email from Redis
 *   2. Extracts the sent HTML from the BCC Gmail message
 *   3. Diffs original vs sent using Gemini Flash
 *   4. If changes found, stores a feedback record
 *   5. Cleans up the Redis original
 *
 * All steps are non-fatal — if any step fails, it logs and returns.
 * CRM updates (existing sent-detector behavior) are unaffected.
 *
 * Consumers: sent-detector.ts
 */

import { randomUUID } from 'node:crypto';
import { getGmailReadonlyClient } from '../email/gmail-client.js';
import { emailConfig } from '../email/config.js';
import { feedbackConfig } from './config.js';
import { getOriginalEmail, deleteOriginalEmail } from './original-store.js';
import { extractEmailHtml } from './html-extractor.js';
import { analyzeEdits } from './diff-analyzer.js';
import { appendFeedbackRecord } from './feedback-store.js';
import { buildContextText } from './utils.js';
import type { FeedbackRecord } from './types.js';

/**
 * Capture feedback from a sent BCC copy.
 *
 * @param messageId - Gmail message ID of the BCC copy
 * @param contactId - CRM contact ID from X-Venture-Contact-Id header
 */
export async function captureFeedback(
  messageId: string,
  contactId: string,
): Promise<void> {
  if (!feedbackConfig.enabled) return;

  // 1. Retrieve stored original
  const original = await getOriginalEmail(contactId);
  if (!original) {
    console.log('[feedback] No stored original for contact, skipping', { contactId });
    return;
  }

  // 2. Extract sent HTML from BCC message
  const gmail = getGmailReadonlyClient(emailConfig.senderAddress);
  const sentHtml = await extractEmailHtml(gmail, messageId);
  if (!sentHtml) {
    console.log('[feedback] Could not extract HTML from BCC message, skipping', { messageId });
    return;
  }

  // 3. Diff using Gemini Flash
  const edits = await analyzeEdits(original.html, sentHtml);

  // 4. Skip if no changes
  if (edits.noChanges) {
    console.log('[feedback] No edits detected, skipping', { contactId });
    await deleteOriginalEmail(contactId);
    return;
  }

  // 5. Store feedback record
  const contextText = buildContextText(original.context);
  const record: FeedbackRecord = {
    id: randomUUID(),
    contactId,
    createdAt: new Date().toISOString(),
    context: original.context,
    contextText,
    embedding: null, // Phase B backfills
    edits,
  };

  await appendFeedbackRecord(record);

  console.log('[feedback] Feedback captured', {
    contactId,
    recordId: record.id,
    itemsRemoved: edits.itemsRemoved.length,
    itemsAdded: edits.itemsAdded.length,
    itemsReworded: edits.itemsReworded.length,
  });

  // 6. Cleanup Redis
  await deleteOriginalEmail(contactId);
}
