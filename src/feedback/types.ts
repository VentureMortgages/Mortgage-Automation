/**
 * Feedback Loop Type Definitions
 *
 * Types shared across the feedback module:
 * - ApplicationContext: borrower/app metadata for similarity matching
 * - EmailEdits: structured diff output from Gemini analysis
 * - FeedbackRecord: persisted record of Cat's edits with context + embedding
 * - FeedbackMatch: a retrieved record with similarity score
 */

// ---------------------------------------------------------------------------
// Application Context (attached to email drafts for similarity matching)
// ---------------------------------------------------------------------------

export interface ApplicationContext {
  /** Application goal: "purchase", "refinance", "renew" */
  goal: string;
  /** Income types per borrower, e.g., ["employed/salaried", "self-employed/none"] */
  incomeTypes: string[];
  /** Property use types, e.g., ["owner_occupied", "investment"] */
  propertyTypes: string[];
  /** Number of borrowers on the application */
  borrowerCount: number;
  /** Whether the application has a gift down payment */
  hasGiftDP: boolean;
  /** Whether any property has rental income */
  hasRentalIncome: boolean;
}

// ---------------------------------------------------------------------------
// Email Edits (Gemini diff output)
// ---------------------------------------------------------------------------

export interface EmailEdits {
  /** Document names that were removed from the email */
  itemsRemoved: string[];
  /** Document names that were added to the email */
  itemsAdded: string[];
  /** Documents that were reworded */
  itemsReworded: { original: string; modified: string }[];
  /** Whether sections were reordered */
  sectionsReordered: boolean;
  /** Any other changes not covered above */
  otherChanges: string | null;
  /** True if no meaningful changes were made */
  noChanges: boolean;
}

// ---------------------------------------------------------------------------
// Feedback Record (persisted)
// ---------------------------------------------------------------------------

export interface FeedbackRecord {
  /** Unique record ID */
  id: string;
  /** CRM contact ID */
  contactId: string;
  /** ISO timestamp of when feedback was captured */
  createdAt: string;
  /** Application context for similarity matching */
  context: ApplicationContext;
  /** Human-readable context summary for embedding */
  contextText: string;
  /** Embedding vector (null until Phase B backfills) */
  embedding: number[] | null;
  /** Structured edits captured from the diff */
  edits: EmailEdits;
}

// ---------------------------------------------------------------------------
// Feedback Match (retrieval result)
// ---------------------------------------------------------------------------

export interface FeedbackMatch {
  /** The matched feedback record */
  record: FeedbackRecord;
  /** Cosine similarity score (0-1) */
  similarity: number;
}
