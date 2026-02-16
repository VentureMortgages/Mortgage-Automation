/**
 * Tests for Document Classifier (Claude API)
 *
 * Tests cover:
 * - classifyDocument returns valid ClassificationResult from Claude API response
 * - Handles different doc types (T4, pay stub)
 * - Handles low confidence (result still returned)
 * - Passes PDF as base64 document block with correct media_type
 * - Uses structured output config (output_config.format with zodOutputFormat)
 * - Uses configured model from classificationConfig
 * - Propagates API errors
 * - Truncates large PDFs before classification
 *
 * All Anthropic SDK and pdf-lib interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (must be before imports)
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Mock zodOutputFormat to return a recognizable format object
vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({
  zodOutputFormat: (schema: unknown) => ({
    type: 'json_schema',
    json_schema: { name: 'classification', schema },
  }),
}));

// Mock config to avoid env var loading
vi.mock('../../classification/config.js', () => ({
  classificationConfig: {
    anthropicApiKey: 'test-key',
    model: 'claude-haiku-4-5-20241022',
    maxClassificationPages: 3,
    confidenceThreshold: 0.7,
  },
}));

// Mock pdf-lib for truncation tests
const mockGetPageCount = vi.fn();
const mockCopyPages = vi.fn();
const mockAddPage = vi.fn();
const mockSave = vi.fn();
const mockGetPages = vi.fn();

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn().mockImplementation(async () => ({
      getPageCount: mockGetPageCount,
      getPages: mockGetPages,
      copyPages: mockCopyPages,
    })),
    create: vi.fn().mockImplementation(async () => ({
      addPage: mockAddPage,
      save: mockSave,
      copyPages: mockCopyPages,
    })),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { classifyDocument, truncatePdf } from '../classifier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockClaudeResponse(result: Record<string, unknown>) {
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(result) }],
  });
}

const sampleT4Result = {
  documentType: 't4',
  confidence: 0.95,
  borrowerFirstName: 'Kathy',
  borrowerLastName: 'Albrecht',
  taxYear: 2024,
  amount: '$16k',
  institution: 'CPP',
  pageCount: 1,
  additionalNotes: null,
};

const samplePayStubResult = {
  documentType: 'pay_stub',
  confidence: 0.88,
  borrowerFirstName: 'Susan',
  borrowerLastName: 'Hunter',
  taxYear: null,
  amount: null,
  institution: 'RBC',
  pageCount: 2,
  additionalNotes: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Document Classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // classifyDocument
  // -------------------------------------------------------------------------

  describe('classifyDocument', () => {
    it('classifies a T4 document', async () => {
      mockClaudeResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('fake-pdf-content');
      // Mock a 1-page PDF so no truncation needed
      mockGetPageCount.mockReturnValue(1);

      const result = await classifyDocument(pdfBuffer);

      expect(result.documentType).toBe('t4');
      expect(result.confidence).toBe(0.95);
      expect(result.borrowerFirstName).toBe('Kathy');
      expect(result.borrowerLastName).toBe('Albrecht');
      expect(result.taxYear).toBe(2024);
      expect(result.amount).toBe('$16k');
      expect(result.institution).toBe('CPP');
    });

    it('classifies a pay stub', async () => {
      mockClaudeResponse(samplePayStubResult);

      const pdfBuffer = Buffer.from('fake-pay-stub-pdf');
      mockGetPageCount.mockReturnValue(2);

      const result = await classifyDocument(pdfBuffer);

      expect(result.documentType).toBe('pay_stub');
      expect(result.confidence).toBe(0.88);
      expect(result.borrowerFirstName).toBe('Susan');
      expect(result.institution).toBe('RBC');
    });

    it('handles low confidence (result still returned)', async () => {
      const lowConfResult = { ...sampleT4Result, confidence: 0.4 };
      mockClaudeResponse(lowConfResult);

      const pdfBuffer = Buffer.from('blurry-scan');
      mockGetPageCount.mockReturnValue(1);

      const result = await classifyDocument(pdfBuffer);

      // Low confidence is returned as-is -- threshold checking is done by worker
      expect(result.confidence).toBe(0.4);
      expect(result.documentType).toBe('t4');
    });

    it('passes PDF as base64 document block', async () => {
      mockClaudeResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('test-pdf-bytes');
      mockGetPageCount.mockReturnValue(1);

      await classifyDocument(pdfBuffer);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0][0];
      const contentBlocks = callArgs.messages[0].content;

      // First block should be the document
      expect(contentBlocks[0].type).toBe('document');
      expect(contentBlocks[0].source.type).toBe('base64');
      expect(contentBlocks[0].source.media_type).toBe('application/pdf');
      // The data should be base64-encoded
      expect(typeof contentBlocks[0].source.data).toBe('string');
    });

    it('uses structured output config', async () => {
      mockClaudeResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('test-pdf');
      mockGetPageCount.mockReturnValue(1);

      await classifyDocument(pdfBuffer);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.output_config).toBeDefined();
      expect(callArgs.output_config.format).toBeDefined();
      expect(callArgs.output_config.format.type).toBe('json_schema');
    });

    it('uses configured model', async () => {
      mockClaudeResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('test-pdf');
      mockGetPageCount.mockReturnValue(1);

      await classifyDocument(pdfBuffer);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-haiku-4-5-20241022');
    });

    it('throws on API error', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const pdfBuffer = Buffer.from('test-pdf');
      mockGetPageCount.mockReturnValue(1);

      await expect(classifyDocument(pdfBuffer)).rejects.toThrow('API rate limit exceeded');
    });

    it('includes filenameHint in prompt when provided', async () => {
      mockClaudeResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('test-pdf');
      mockGetPageCount.mockReturnValue(1);

      await classifyDocument(pdfBuffer, 'T4-Kathy-2024.pdf');

      const callArgs = mockCreate.mock.calls[0][0];
      const textBlock = callArgs.messages[0].content.find(
        (b: { type: string }) => b.type === 'text',
      );
      expect(textBlock.text).toContain('T4-Kathy-2024.pdf');
    });
  });

  // -------------------------------------------------------------------------
  // truncatePdf
  // -------------------------------------------------------------------------

  describe('truncatePdf', () => {
    it('returns original buffer when page count <= max', async () => {
      mockGetPageCount.mockReturnValue(2);

      const pdfBuffer = Buffer.from('short-pdf');
      const result = await truncatePdf(pdfBuffer, 3);

      // Should return original buffer unchanged
      expect(result).toBe(pdfBuffer);
    });

    it('truncates large PDFs to maxPages', async () => {
      mockGetPageCount.mockReturnValue(10);

      // Mock page objects for copyPages
      const mockPages = Array.from({ length: 10 }, (_, i) => ({ pageNum: i }));
      mockGetPages.mockReturnValue(mockPages);
      mockCopyPages.mockResolvedValue([{ copied: 0 }, { copied: 1 }, { copied: 2 }]);
      mockSave.mockResolvedValue(new Uint8Array([1, 2, 3]));

      const pdfBuffer = Buffer.from('large-pdf-with-10-pages');
      const result = await truncatePdf(pdfBuffer, 3);

      // Should return a different (truncated) buffer
      expect(result).not.toBe(pdfBuffer);
      expect(mockAddPage).toHaveBeenCalledTimes(3);
      expect(mockSave).toHaveBeenCalled();
    });
  });
});
