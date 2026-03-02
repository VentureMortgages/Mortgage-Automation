/**
 * Smart Document Matching Type Definitions
 *
 * Types for the document matching pipeline (Phase 14):
 * - SignalType: categories of matching signals the agent can collect
 * - MatchSignal: individual evidence for a contact match
 * - MatchCandidate: aggregated signals for a candidate contact
 * - MatchDecision: complete record of a matching decision
 * - MatchOutcome: possible results of the matching process
 *
 * Consumers:
 * - Phase 14 Plans 01-03: thread-store, decision-log, matching agent, filing
 */

// ---------------------------------------------------------------------------
// Signal Types
// ---------------------------------------------------------------------------

/** Signal types the matching agent can collect */
export type SignalType =
  | 'thread_match'        // Email reply in same thread as doc-request
  | 'sender_email'        // Sender email matches CRM contact email
  | 'doc_content_name'    // Name extracted from document content by Gemini
  | 'sender_display_name' // Sender display name fuzzy match
  | 'cc_email'            // CC/To addresses match CRM contacts
  | 'email_subject'       // Subject contains client name
  | 'email_body'          // Body snippet contains client name
  | 'doc_address'         // Address on doc matches property on file
  | 'employer_match'      // Employer name matches known employer
  | 'pipeline_stage'      // Opportunity in "Collecting Documents" stage
  | 'checklist_gap';      // Doc type matches outstanding checklist items

// ---------------------------------------------------------------------------
// Match Signal
// ---------------------------------------------------------------------------

/** A single signal collected during matching */
export interface MatchSignal {
  type: SignalType;
  value: string;           // The matched value (email, name, threadId, etc.)
  contactId?: string;      // CRM contact this signal points to
  opportunityId?: string;  // CRM opportunity if resolved
  confidence: number;      // 0.0-1.0 for this individual signal
  tier: 1 | 2 | 3 | 4;    // Signal priority tier
}

// ---------------------------------------------------------------------------
// Match Candidate
// ---------------------------------------------------------------------------

/** A candidate match with aggregated signals */
export interface MatchCandidate {
  contactId: string;
  opportunityId?: string;
  contactName: string;
  driveFolderId?: string;
  signals: MatchSignal[];
  confidence: number;      // Agent's overall confidence for this candidate
}

// ---------------------------------------------------------------------------
// Match Outcome
// ---------------------------------------------------------------------------

/** Possible matching outcomes */
export type MatchOutcome =
  | 'auto_filed'      // Confidence >= threshold, auto-filed
  | 'needs_review'    // Confidence < threshold, Cat reviews
  | 'auto_created'    // No match found, new contact created
  | 'conflict'        // Conflicting signals, escalated to Cat
  | 'error';          // Matching failed

// ---------------------------------------------------------------------------
// Match Decision
// ---------------------------------------------------------------------------

/** Complete matching decision record */
export interface MatchDecision {
  intakeDocumentId: string;
  signals: MatchSignal[];
  candidates: MatchCandidate[];
  chosenContactId: string | null;
  chosenOpportunityId: string | null;
  chosenDriveFolderId: string | null;
  confidence: number;
  reasoning: string;
  outcome: MatchOutcome;
  timestamp: string;
  durationMs: number;
}
