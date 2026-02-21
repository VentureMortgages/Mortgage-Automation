/**
 * Tests for Diff Analyzer — Gemini structured output parsing
 *
 * Tests cover:
 * - Parses structured response with removed/added/reworded items
 * - Handles noChanges=true response
 * - Passes correct prompt structure to Gemini
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Gemini
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGoogleGenAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(_config: unknown) {
      return { generateContent: mockGenerateContent };
    }
  },
  SchemaType: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    BOOLEAN: 'BOOLEAN',
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

import { analyzeEdits } from '../diff-analyzer.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Diff Analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses structured response with edits', async () => {
    const mockResponse = {
      itemsRemoved: ['Void Cheque'],
      itemsAdded: ['Bank Statement'],
      itemsReworded: [
        { original: 'Letter of Employment', modified: 'LOE (dated within 30 days)' },
      ],
      sectionsReordered: false,
      otherChanges: null,
      noChanges: false,
    };

    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(mockResponse) },
    });

    const result = await analyzeEdits('<div>Original</div>', '<div>Sent</div>');

    expect(result.itemsRemoved).toEqual(['Void Cheque']);
    expect(result.itemsAdded).toEqual(['Bank Statement']);
    expect(result.itemsReworded).toHaveLength(1);
    expect(result.itemsReworded[0].original).toBe('Letter of Employment');
    expect(result.noChanges).toBe(false);
  });

  it('handles noChanges=true response', async () => {
    const mockResponse = {
      itemsRemoved: [],
      itemsAdded: [],
      itemsReworded: [],
      sectionsReordered: false,
      otherChanges: null,
      noChanges: true,
    };

    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(mockResponse) },
    });

    const result = await analyzeEdits('<div>Same</div>', '<div>Same</div>');

    expect(result.noChanges).toBe(true);
    expect(result.itemsRemoved).toEqual([]);
    expect(result.itemsAdded).toEqual([]);
  });

  it('passes original and sent HTML in prompt', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          itemsRemoved: [], itemsAdded: [], itemsReworded: [],
          sectionsReordered: false, otherChanges: null, noChanges: true,
        }),
      },
    });

    await analyzeEdits('<div>ORIG</div>', '<div>SENT</div>');

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs).toHaveLength(3);
    expect(callArgs[1].text).toContain('ORIG');
    expect(callArgs[2].text).toContain('SENT');
  });
});
