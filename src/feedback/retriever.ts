/**
 * Feedback Retriever — RAG search for similar past edits
 *
 * Embeds the current application context, then compares against all stored
 * feedback records using cosine similarity. Returns matches above the
 * configured threshold, sorted by similarity.
 *
 * Pure math — no vector DB needed at this scale (<100 records).
 *
 * Consumers: worker.ts (Phase B integration)
 */

import { feedbackConfig } from './config.js';
import { loadFeedbackRecords } from './feedback-store.js';
import { embedText } from './embedder.js';
import type { FeedbackMatch } from './types.js';

/**
 * Find feedback records with similar application context.
 *
 * @param contextText - Human-readable context summary to search for
 * @param threshold - Minimum cosine similarity (default: config value)
 * @returns Matching records sorted by similarity (highest first)
 */
export async function findSimilarEdits(
  contextText: string,
  threshold?: number,
): Promise<FeedbackMatch[]> {
  const minSimilarity = threshold ?? feedbackConfig.similarityThreshold;
  const records = await loadFeedbackRecords();

  // Filter to records that have embeddings
  const withEmbeddings = records.filter(r => r.embedding !== null && r.embedding.length > 0);
  if (withEmbeddings.length === 0) return [];

  // Embed the query
  const queryEmbedding = await embedText(contextText);

  // Score each record
  const matches: FeedbackMatch[] = [];
  for (const record of withEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, record.embedding!);
    if (similarity >= minSimilarity) {
      matches.push({ record, similarity });
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}

/**
 * Cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
