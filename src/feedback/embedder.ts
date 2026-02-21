/**
 * Feedback Embedder — Generates text embeddings via Gemini
 *
 * Uses Gemini text-embedding-004 model to embed context text for
 * similarity search. Same @google/generative-ai package, same API key.
 *
 * Free tier: 1500 RPM (more than enough for <100 records).
 *
 * Consumers: capture.ts (embed on store), retriever.ts (embed query)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { classificationConfig } from '../classification/config.js';

// ---------------------------------------------------------------------------
// Gemini Client (lazy singleton — shared API key)
// ---------------------------------------------------------------------------

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  _genAI = new GoogleGenerativeAI(classificationConfig.geminiApiKey);
  return _genAI;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'text-embedding-004';

/**
 * Embed a text string into a 768-dimensional vector.
 *
 * @param text - The text to embed (e.g., context summary)
 * @returns 768-dim float array
 */
export async function embedText(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
}
