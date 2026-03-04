/**
 * Signal Collectors — Pre-agent deterministic signal collection
 *
 * These functions run BEFORE the agentic Gemini loop to collect
 * high-confidence deterministic signals:
 * - Thread match (Tier 1): Gmail threadId -> contactId via Redis mapping
 * - Sender email (Tier 1): Sender email -> CRM contact lookup
 * - Email metadata (Tier 3): CC addresses, subject name patterns
 *
 * Consumers: matching agent (src/matching/agent.ts)
 */

import { getThreadContactId } from './thread-store.js';
import { findContactByEmail, findContactByName } from '../crm/contacts.js';
import type { MatchSignal } from './types.js';

// ---------------------------------------------------------------------------
// Thread Signal (Tier 1)
// ---------------------------------------------------------------------------

/**
 * Collect a thread-match signal by looking up the threadId in Redis.
 *
 * When a doc-request email is sent, we store threadId -> contactId.
 * If a reply arrives in the same thread, this provides the strongest
 * matching signal (Tier 1, confidence 0.95).
 *
 * @param threadId - Gmail thread ID (optional)
 * @returns MatchSignal or null
 */
export async function collectThreadSignal(
  threadId?: string,
): Promise<MatchSignal | null> {
  if (!threadId) return null;

  const mapping = await getThreadContactId(threadId);
  if (!mapping) return null;

  return {
    type: 'thread_match',
    value: threadId,
    contactId: mapping.contactId,
    opportunityId: mapping.opportunityId,
    confidence: 0.95,
    tier: 1,
  };
}

// ---------------------------------------------------------------------------
// Sender Email Signal (Tier 1)
// ---------------------------------------------------------------------------

/**
 * Collect a sender-email signal by looking up the sender in the CRM.
 *
 * If the sender's email matches a CRM contact, this is a strong signal
 * (Tier 1, confidence 0.9) — the client is sending their own documents.
 *
 * @param senderEmail - Email address of the sender (nullable)
 * @returns MatchSignal or null
 */
export async function collectSenderSignal(
  senderEmail: string | null,
): Promise<MatchSignal | null> {
  if (!senderEmail) return null;

  const contactId = await findContactByEmail(senderEmail);
  if (!contactId) return null;

  return {
    type: 'sender_email',
    value: senderEmail,
    contactId,
    confidence: 0.9,
    tier: 1,
  };
}

// ---------------------------------------------------------------------------
// Doc Content Name Signal (Tier 2)
// ---------------------------------------------------------------------------

/**
 * Collect a doc-content-name signal by looking up the borrower name
 * extracted from the document (via Gemini classification) in the CRM.
 *
 * This is the primary matching signal for Cat-forwarded emails where
 * the sender (admin@) doesn't match any client. The classification
 * already extracted the borrower name from the PDF, so we do a
 * deterministic CRM lookup here instead of relying on the agent
 * to call search_contact_by_name.
 *
 * Tier 2, confidence 0.85 — strong signal (Gemini read the name from
 * the actual document), but slightly below sender email (Tier 1, 0.9).
 *
 * @param firstName - Borrower first name from classification
 * @param lastName - Borrower last name from classification
 * @returns MatchSignal or null
 */
export async function collectDocNameSignal(
  firstName: string | null,
  lastName: string | null,
): Promise<MatchSignal | null> {
  if (!firstName || !lastName) return null;

  const contactId = await findContactByName(firstName, lastName);
  if (!contactId) return null;

  return {
    type: 'doc_content_name',
    value: `${firstName} ${lastName}`,
    contactId,
    confidence: 0.85,
    tier: 2,
  };
}

// ---------------------------------------------------------------------------
// Email Metadata Signals (Tier 3)
// ---------------------------------------------------------------------------

/** Common subject patterns containing client names */
const SUBJECT_NAME_PATTERNS = [
  /Documents?\s+for\s+(.+)/i,
  /Re:\s*Documents?\s+Needed\s*[-—]\s*(.+)/i,
  /Re:\s*Document\s+Request\s*[-—]\s*(.+)/i,
  /Docs?\s+[-—]\s*(.+)/i,
  /(.+?)\s+[-—]\s*Documents?$/i,
];

/**
 * Collect metadata signals from CC addresses and email subject.
 *
 * CC signals are Tier 3 — a CC'd address matching a CRM contact
 * is a weak signal (the client may be CC'd on someone else's email).
 *
 * Subject signals are also Tier 3 — extracting a name from the subject
 * line (e.g., "Documents for John Smith") provides a hint for the agent.
 *
 * @param ccAddresses - CC/To addresses from the email
 * @param emailSubject - Email subject line
 * @returns Array of MatchSignal (may be empty)
 */
export async function collectEmailMetadataSignals(
  ccAddresses?: string[],
  emailSubject?: string,
): Promise<MatchSignal[]> {
  const signals: MatchSignal[] = [];

  // Check CC addresses against CRM
  if (ccAddresses && ccAddresses.length > 0) {
    for (const cc of ccAddresses) {
      const contactId = await findContactByEmail(cc);
      if (contactId) {
        signals.push({
          type: 'cc_email',
          value: cc,
          contactId,
          confidence: 0.4,
          tier: 3,
        });
      }
    }
  }

  // Extract name patterns from subject
  if (emailSubject) {
    for (const pattern of SUBJECT_NAME_PATTERNS) {
      const match = emailSubject.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        // Only add if the name looks reasonable (2+ chars, not just punctuation)
        if (name.length >= 2 && /[a-zA-Z]/.test(name)) {
          signals.push({
            type: 'email_subject',
            value: name,
            confidence: 0.3,
            tier: 3,
          });
          break; // Only use the first matching pattern
        }
      }
    }
  }

  return signals;
}
