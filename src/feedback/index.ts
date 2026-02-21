/**
 * Feedback Module — Barrel Export
 *
 * Captures Cat's edits to doc-request emails and uses RAG to apply
 * similar past edits to future emails.
 *
 * Phase A: Capture edits (original-store, html-extractor, diff-analyzer, capture)
 * Phase B: RAG retrieval + application (embedder, retriever, applier)
 */

// Types
export type {
  ApplicationContext,
  EmailEdits,
  FeedbackRecord,
  FeedbackMatch,
} from './types.js';

// Config
export { feedbackConfig } from './config.js';

// Phase A: Capture
export { storeOriginalEmail, getOriginalEmail, deleteOriginalEmail } from './original-store.js';
export { extractEmailHtml } from './html-extractor.js';
export { analyzeEdits } from './diff-analyzer.js';
export { appendFeedbackRecord, loadFeedbackRecords } from './feedback-store.js';
export { captureFeedback } from './capture.js';

// Phase B: RAG
export { embedText } from './embedder.js';
export { findSimilarEdits, cosineSimilarity } from './retriever.js';
export { applyFeedbackToChecklist } from './applier.js';

// Utilities
export { buildContextText } from './utils.js';
