/**
 * Tests for Embedder — Gemini text embedding API
 *
 * Tests cover:
 * - embedText: returns embedding vector from Gemini API
 * - embedText: passes text to embedContent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Gemini
// ---------------------------------------------------------------------------

const mockEmbedContent = vi.fn();

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGoogleGenAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(_config: unknown) {
      return { embedContent: mockEmbedContent };
    }
  },
}));

vi.mock('../../classification/config.js', () => ({
  classificationConfig: {
    geminiApiKey: 'test-api-key',
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { embedText } from '../embedder.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Embedder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns embedding vector from Gemini API', async () => {
    const fakeEmbedding = Array.from({ length: 768 }, (_, i) => i * 0.001);
    mockEmbedContent.mockResolvedValue({
      embedding: { values: fakeEmbedding },
    });

    const result = await embedText('Single purchase, salaried');

    expect(result).toHaveLength(768);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0.001);
  });

  it('passes text to embedContent', async () => {
    mockEmbedContent.mockResolvedValue({
      embedding: { values: [0.1, 0.2, 0.3] },
    });

    await embedText('Couple refinance, self-employed');

    expect(mockEmbedContent).toHaveBeenCalledWith('Couple refinance, self-employed');
  });
});
