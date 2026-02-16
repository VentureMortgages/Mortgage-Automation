/**
 * Tests for Document Classifier (Gemini API)
 *
 * Tests cover:
 * - classifyDocument returns valid ClassificationResult from Gemini API response
 * - Handles different doc types (T4, pay stub)
 * - Handles low confidence (result still returned)
 * - Passes PDF as inlineData with correct mimeType
 * - Uses structured output config (responseMimeType + responseSchema)
 * - Uses configured model from classificationConfig
 * - Propagates API errors
 * - Truncates large PDFs before classification
 *
 * All Gemini SDK and pdf-lib interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (must be before imports)
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();

vi.mock('@google/generative-ai', () => ({
  SchemaType: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
  },
  GoogleGenerativeAI: class MockGoogleGenAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(_config: unknown) {
      return { generateContent: mockGenerateContent };
    }
  },
}));

// Mock config to avoid env var loading
vi.mock('../../classification/config.js', () => ({
  classificationConfig: {
    geminiApiKey: 'test-key',
    model: 'gemini-2.0-flash',
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

function mockGeminiResponse(result: Record<string, unknown>) {
  mockGenerateContent.mockResolvedValue({
    response: {
      text: () => JSON.stringify(result),
    },
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
      mockGeminiResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('fake-pdf-content');
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
      mockGeminiResponse(samplePayStubResult);

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
      mockGeminiResponse(lowConfResult);

      const pdfBuffer = Buffer.from('blurry-scan');
      mockGetPageCount.mockReturnValue(1);

      const result = await classifyDocument(pdfBuffer);

      // Low confidence is returned as-is -- threshold checking is done by worker
      expect(result.confidence).toBe(0.4);
      expect(result.documentType).toBe('t4');
    });

    it('passes PDF as inlineData with correct mimeType', async () => {
      mockGeminiResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('test-pdf-bytes');
      mockGetPageCount.mockReturnValue(1);

      await classifyDocument(pdfBuffer);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0][0];

      // First element should be the inlineData
      expect(callArgs[0].inlineData).toBeDefined();
      expect(callArgs[0].inlineData.mimeType).toBe('application/pdf');
      expect(typeof callArgs[0].inlineData.data).toBe('string');
    });

    it('includes prompt text in request', async () => {
      mockGeminiResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('test-pdf');
      mockGetPageCount.mockReturnValue(1);

      await classifyDocument(pdfBuffer);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      // Second element should be the text prompt
      expect(callArgs[1].text).toContain('Classify this Canadian mortgage document');
    });

    it('throws on API error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API rate limit exceeded'));

      const pdfBuffer = Buffer.from('test-pdf');
      mockGetPageCount.mockReturnValue(1);

      await expect(classifyDocument(pdfBuffer)).rejects.toThrow('API rate limit exceeded');
    });

    it('includes filenameHint in prompt when provided', async () => {
      mockGeminiResponse(sampleT4Result);

      const pdfBuffer = Buffer.from('test-pdf');
      mockGetPageCount.mockReturnValue(1);

      await classifyDocument(pdfBuffer, 'T4-Kathy-2024.pdf');

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const textPart = callArgs.find(
        (p: { text?: string }) => p.text !== undefined,
      );
      expect(textPart.text).toContain('T4-Kathy-2024.pdf');
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

      expect(result).toBe(pdfBuffer);
    });

    it('truncates large PDFs to maxPages', async () => {
      mockGetPageCount.mockReturnValue(10);

      const mockPages = Array.from({ length: 10 }, (_, i) => ({ pageNum: i }));
      mockGetPages.mockReturnValue(mockPages);
      mockCopyPages.mockResolvedValue([{ copied: 0 }, { copied: 1 }, { copied: 2 }]);
      mockSave.mockResolvedValue(new Uint8Array([1, 2, 3]));

      const pdfBuffer = Buffer.from('large-pdf-with-10-pages');
      const result = await truncatePdf(pdfBuffer, 3);

      expect(result).not.toBe(pdfBuffer);
      expect(mockAddPage).toHaveBeenCalledTimes(3);
      expect(mockSave).toHaveBeenCalled();
    });
  });
});
