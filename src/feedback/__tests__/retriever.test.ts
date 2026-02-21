/**
 * Tests for Retriever — Cosine similarity and threshold filtering
 *
 * Tests cover:
 * - cosineSimilarity: identical vectors → 1.0
 * - cosineSimilarity: orthogonal vectors → 0.0
 * - cosineSimilarity: opposite vectors → -1.0
 * - cosineSimilarity: mismatched lengths → 0.0
 * - cosineSimilarity: zero vector → 0.0
 * - findSimilarEdits: filters by threshold and sorts by similarity
 * - findSimilarEdits: skips records without embeddings
 * - findSimilarEdits: returns empty when no records exist
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cosineSimilarity } from '../retriever.js';
import type { FeedbackRecord } from '../types.js';

// ---------------------------------------------------------------------------
// Cosine Similarity (pure math, no mocks needed)
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0.0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0.0 for zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('handles high-dimensional vectors', () => {
    const a = Array.from({ length: 768 }, () => Math.random());
    const result = cosineSimilarity(a, a);
    expect(result).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// findSimilarEdits (needs mocks)
// ---------------------------------------------------------------------------

const mockLoadFeedbackRecords = vi.hoisted(() => vi.fn());
const mockEmbedText = vi.hoisted(() => vi.fn());

vi.mock('../feedback-store.js', () => ({
  loadFeedbackRecords: mockLoadFeedbackRecords,
}));

vi.mock('../embedder.js', () => ({
  embedText: mockEmbedText,
}));

vi.mock('../config.js', () => ({
  feedbackConfig: {
    similarityThreshold: 0.80,
  },
}));

import { findSimilarEdits } from '../retriever.js';

function makeRecord(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: 'rec-1',
    contactId: 'contact-1',
    createdAt: '2026-02-20T00:00:00Z',
    context: {
      goal: 'purchase',
      incomeTypes: ['employed/salaried'],
      propertyTypes: ['owner_occupied'],
      borrowerCount: 1,
      hasGiftDP: false,
      hasRentalIncome: false,
    },
    contextText: 'Single purchase, salaried',
    embedding: [1, 0, 0],
    edits: {
      itemsRemoved: ['Void Cheque'],
      itemsAdded: [],
      itemsReworded: [],
      sectionsReordered: false,
      otherChanges: null,
      noChanges: false,
    },
    ...overrides,
  };
}

describe('findSimilarEdits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns matches above threshold sorted by similarity', async () => {
    const records = [
      makeRecord({ id: 'rec-high', embedding: [0.9, 0.1, 0] }),  // high similarity
      makeRecord({ id: 'rec-low', embedding: [0.1, 0.9, 0] }),   // low similarity
      makeRecord({ id: 'rec-mid', embedding: [0.7, 0.3, 0] }),   // mid similarity
    ];
    mockLoadFeedbackRecords.mockResolvedValue(records);
    mockEmbedText.mockResolvedValue([1, 0, 0]); // query vector

    const matches = await findSimilarEdits('Single purchase', 0.5);

    // rec-high should be first (highest similarity)
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].record.id).toBe('rec-high');
    // All matches should be above threshold
    for (const match of matches) {
      expect(match.similarity).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('skips records without embeddings', async () => {
    const records = [
      makeRecord({ id: 'rec-null', embedding: null }),
      makeRecord({ id: 'rec-empty', embedding: [] }),
      makeRecord({ id: 'rec-valid', embedding: [1, 0, 0] }),
    ];
    mockLoadFeedbackRecords.mockResolvedValue(records);
    mockEmbedText.mockResolvedValue([1, 0, 0]);

    const matches = await findSimilarEdits('Test', 0.5);

    // Only rec-valid should be considered
    const matchIds = matches.map(m => m.record.id);
    expect(matchIds).not.toContain('rec-null');
    expect(matchIds).not.toContain('rec-empty');
  });

  it('returns empty when no records exist', async () => {
    mockLoadFeedbackRecords.mockResolvedValue([]);

    const matches = await findSimilarEdits('Test');

    expect(matches).toEqual([]);
    expect(mockEmbedText).not.toHaveBeenCalled(); // no need to embed
  });
});
