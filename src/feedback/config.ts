/**
 * Feedback Loop Configuration
 *
 * Controls the feedback capture + RAG retrieval pipeline.
 * When Cat edits a doc-request email draft and sends it, the system
 * captures the diff and uses it to improve future emails.
 *
 * Environment variables:
 * - FEEDBACK_ENABLED: Kill switch (default: true)
 */

export const feedbackConfig = {
  /** Kill switch — set FEEDBACK_ENABLED=false to disable */
  enabled: process.env.FEEDBACK_ENABLED !== 'false',
  /** Cosine similarity threshold for RAG retrieval */
  similarityThreshold: 0.80,
  /** Minimum number of matching feedback records to auto-apply edits */
  minMatchesForAutoApply: 2,
  /** TTL for original email storage in Redis (30 days) */
  originalTtlSeconds: 30 * 24 * 60 * 60,
};
