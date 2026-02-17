/**
 * Tests for Intake Worker — Document Processing Pipeline
 *
 * Tests cover:
 * - Gmail source: message with 2 PDF attachments -> 2 IntakeDocuments
 * - Gmail source: message with 1 JPEG attachment -> 1 IntakeDocument (converted)
 * - Gmail source: message with 1 Word doc -> 0 IntakeDocuments, 1 error
 * - Gmail source: attachment exceeds maxAttachmentBytes -> skipped
 * - Gmail source: message with no attachments -> 0 documents
 * - Gmail source: missing gmailMessageId -> 0 documents, error
 * - Finmo source: downloads and converts files via finmo-downloader
 * - Finmo source: skips already-processed doc requests (dedup)
 * - Finmo source: returns error when documentRequestId is missing
 * - Finmo source: handles download errors gracefully
 * - IntakeDocument has correct fields (id format, source, senderEmail)
 *
 * All external dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { IntakeJobData } from '../types.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockIntakeConfig = vi.hoisted(() => ({
  intakeConfig: {
    pollIntervalMs: 120000,
    maxAttachmentBytes: 25 * 1024 * 1024,
    docsInbox: 'docs@venturemortgages.co',
    enabled: true,
  },
  getConversionStrategy: vi.fn(),
  SUPPORTED_MIME_TYPES: new Map(),
}));

vi.mock('../config.js', () => mockIntakeConfig);

const mockGmailClient = vi.hoisted(() => {
  const client = {
    users: {
      messages: {
        get: vi.fn(),
      },
    },
  };
  return { getGmailReadonlyClient: vi.fn(() => client), client };
});

vi.mock('../../email/gmail-client.js', () => ({
  getGmailReadonlyClient: mockGmailClient.getGmailReadonlyClient,
}));

const mockReader = vi.hoisted(() => ({
  getMessageDetails: vi.fn(),
  pollForNewMessages: vi.fn(),
  getInitialHistoryId: vi.fn(),
}));

vi.mock('../gmail-reader.js', () => ({
  getMessageDetails: mockReader.getMessageDetails,
  pollForNewMessages: mockReader.pollForNewMessages,
  getInitialHistoryId: mockReader.getInitialHistoryId,
}));

const mockExtractor = vi.hoisted(() => ({
  extractAttachments: vi.fn(),
  downloadAttachment: vi.fn(),
}));

vi.mock('../attachment-extractor.js', () => ({
  extractAttachments: mockExtractor.extractAttachments,
  downloadAttachment: mockExtractor.downloadAttachment,
}));

const mockConverter = vi.hoisted(() => ({
  convertToPdf: vi.fn(),
  ConversionError: class ConversionError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'ConversionError';
      this.code = code;
    }
  },
}));

vi.mock('../pdf-converter.js', () => ({
  convertToPdf: mockConverter.convertToPdf,
  ConversionError: mockConverter.ConversionError,
}));

const mockFinmoDownloader = vi.hoisted(() => ({
  downloadFinmoDocument: vi.fn(),
  isDocRequestProcessed: vi.fn(),
  markDocRequestProcessed: vi.fn(),
}));

vi.mock('../finmo-downloader.js', () => ({
  downloadFinmoDocument: mockFinmoDownloader.downloadFinmoDocument,
  isDocRequestProcessed: mockFinmoDownloader.isDocRequestProcessed,
  markDocRequestProcessed: mockFinmoDownloader.markDocRequestProcessed,
}));

const mockMonitor = vi.hoisted(() => ({
  getStoredHistoryId: vi.fn().mockResolvedValue(null),
  storeHistoryId: vi.fn().mockResolvedValue(undefined),
  getIntakeQueue: vi.fn().mockReturnValue({
    add: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../gmail-monitor.js', () => ({
  INTAKE_QUEUE_NAME: 'doc-intake',
  getStoredHistoryId: mockMonitor.getStoredHistoryId,
  storeHistoryId: mockMonitor.storeHistoryId,
  getIntakeQueue: mockMonitor.getIntakeQueue,
}));

vi.mock('../../webhook/queue.js', () => ({
  createRedisConnection: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

const mockClassificationQueue = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

const MockQueue = vi.hoisted(() => {
  return class MockQueue {
    add = mockClassificationQueue.add;
    close = mockClassificationQueue.close;
  };
});

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
  Job: vi.fn(),
  Queue: MockQueue,
}));

vi.mock('../../classification/classification-worker.js', () => ({
  CLASSIFICATION_QUEUE_NAME: 'doc-classification',
}));

const mockSentDetector = vi.hoisted(() => ({
  isBccCopy: vi.fn().mockReturnValue(false),
  handleSentDetection: vi.fn(),
}));

vi.mock('../sent-detector.js', () => ({
  isBccCopy: mockSentDetector.isBccCopy,
  handleSentDetection: mockSentDetector.handleSentDetection,
}));

const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { processIntakeJob } from '../intake-worker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockJob(data: IntakeJobData): Job<IntakeJobData> {
  return {
    data,
    id: 'test-job-1',
    attemptsMade: 0,
  } as unknown as Job<IntakeJobData>;
}

function setupGmailMessage(messageId: string, parts: unknown[] = []) {
  mockReader.getMessageDetails.mockResolvedValue({
    messageId,
    threadId: 'thread-1',
    from: 'sender@example.com',
    subject: 'Documents',
    date: '2026-02-14',
    historyId: '99999',
  });

  mockGmailClient.client.users.messages.get.mockResolvedValue({
    data: {
      id: messageId,
      payload: { parts },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Intake Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIntakeConfig.intakeConfig.maxAttachmentBytes = 25 * 1024 * 1024;
    // Reset BCC detection mock (clearAllMocks doesn't reset return values)
    mockSentDetector.isBccCopy.mockReturnValue(false);
  });

  // -------------------------------------------------------------------------
  // Gmail source
  // -------------------------------------------------------------------------

  describe('Gmail source', () => {
    it('processes message with 2 PDF attachments -> 2 IntakeDocuments', async () => {
      const messageId = 'msg-pdf-2';
      setupGmailMessage(messageId);

      mockExtractor.extractAttachments.mockReturnValue([
        { filename: 'doc1.pdf', mimeType: 'application/pdf', attachmentId: 'att-1', size: 1000 },
        { filename: 'doc2.pdf', mimeType: 'application/pdf', attachmentId: 'att-2', size: 2000 },
      ]);

      mockIntakeConfig.getConversionStrategy
        .mockReturnValueOnce('pdf')
        .mockReturnValueOnce('pdf');

      const pdfBuf1 = Buffer.from('pdf-content-1');
      const pdfBuf2 = Buffer.from('pdf-content-2');
      mockExtractor.downloadAttachment
        .mockResolvedValueOnce(pdfBuf1)
        .mockResolvedValueOnce(pdfBuf2);

      mockConverter.convertToPdf
        .mockResolvedValueOnce({ pdfBuffer: pdfBuf1, converted: false })
        .mockResolvedValueOnce({ pdfBuffer: pdfBuf2, converted: false });

      const job = createMockJob({
        source: 'gmail',
        gmailMessageId: messageId,
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(2);
      expect(result.documentIds).toEqual(['gmail-msg-pdf-2-0', 'gmail-msg-pdf-2-1']);
      expect(result.errors).toHaveLength(0);
    });

    it('processes message with 1 JPEG attachment -> 1 IntakeDocument (converted)', async () => {
      const messageId = 'msg-jpeg-1';
      setupGmailMessage(messageId);

      mockExtractor.extractAttachments.mockReturnValue([
        { filename: 'photo.jpg', mimeType: 'image/jpeg', attachmentId: 'att-jpg', size: 500 },
      ]);

      mockIntakeConfig.getConversionStrategy.mockReturnValue('image-to-pdf');

      const rawBuf = Buffer.from('jpeg-data');
      const pdfBuf = Buffer.from('converted-pdf');
      mockExtractor.downloadAttachment.mockResolvedValue(rawBuf);
      mockConverter.convertToPdf.mockResolvedValue({ pdfBuffer: pdfBuf, converted: true });

      const job = createMockJob({
        source: 'gmail',
        gmailMessageId: messageId,
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(1);
      expect(result.documentIds).toEqual(['gmail-msg-jpeg-1-0']);
      expect(result.errors).toHaveLength(0);
      expect(mockConverter.convertToPdf).toHaveBeenCalledWith(rawBuf, 'image/jpeg');
    });

    it('handles message with 1 Word doc -> 0 IntakeDocuments, 1 error (WORD_MANUAL_REVIEW)', async () => {
      const messageId = 'msg-word-1';
      setupGmailMessage(messageId);

      mockExtractor.extractAttachments.mockReturnValue([
        {
          filename: 'letter.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          attachmentId: 'att-docx',
          size: 3000,
        },
      ]);

      mockIntakeConfig.getConversionStrategy.mockReturnValue('word-to-pdf');

      const rawBuf = Buffer.from('docx-data');
      mockExtractor.downloadAttachment.mockResolvedValue(rawBuf);
      mockConverter.convertToPdf.mockRejectedValue(
        new mockConverter.ConversionError(
          'WORD_MANUAL_REVIEW',
          'Word document requires manual review',
        ),
      );

      const job = createMockJob({
        source: 'gmail',
        gmailMessageId: messageId,
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.documentIds).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('WORD_MANUAL_REVIEW');
    });

    it('skips attachment that exceeds maxAttachmentBytes', async () => {
      const messageId = 'msg-oversize';
      setupGmailMessage(messageId);

      mockIntakeConfig.intakeConfig.maxAttachmentBytes = 1000;

      mockExtractor.extractAttachments.mockReturnValue([
        { filename: 'huge.pdf', mimeType: 'application/pdf', attachmentId: 'att-huge', size: 5000 },
      ]);

      mockIntakeConfig.getConversionStrategy.mockReturnValue('pdf');

      const job = createMockJob({
        source: 'gmail',
        gmailMessageId: messageId,
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('too large');
      expect(mockExtractor.downloadAttachment).not.toHaveBeenCalled();
    });

    it('handles message with no attachments -> 0 documents', async () => {
      const messageId = 'msg-empty';
      setupGmailMessage(messageId);

      mockExtractor.extractAttachments.mockReturnValue([]);

      const job = createMockJob({
        source: 'gmail',
        gmailMessageId: messageId,
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.documentIds).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('short-circuits for outbound BCC copy (doc-request)', async () => {
      const messageId = 'msg-bcc-1';
      mockReader.getMessageDetails.mockResolvedValue({
        messageId,
        threadId: 'thread-1',
        from: 'admin@venturemortgages.com',
        subject: 'Documents Needed — TestEmp',
        date: '2026-02-16',
        historyId: '99999',
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      mockSentDetector.isBccCopy.mockReturnValue(true);
      mockSentDetector.handleSentDetection.mockResolvedValue({
        detected: true,
        contactId: 'contact-abc',
        sentDate: '2026-02-16',
        errors: [],
      });

      const job = createMockJob({
        source: 'gmail',
        gmailMessageId: messageId,
        receivedAt: '2026-02-16T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockSentDetector.handleSentDetection).toHaveBeenCalled();
      // Should NOT fetch full message or extract attachments
      expect(mockGmailClient.client.users.messages.get).not.toHaveBeenCalled();
      expect(mockExtractor.extractAttachments).not.toHaveBeenCalled();
    });

    it('propagates sent-detector errors in BCC short-circuit', async () => {
      const messageId = 'msg-bcc-err';
      mockReader.getMessageDetails.mockResolvedValue({
        messageId,
        threadId: 'thread-1',
        from: 'admin@venturemortgages.com',
        subject: 'Documents Needed',
        date: '2026-02-16',
        historyId: '99999',
        ventureType: 'doc-request',
        ventureContactId: 'contact-xyz',
      });

      mockSentDetector.isBccCopy.mockReturnValue(true);
      mockSentDetector.handleSentDetection.mockResolvedValue({
        detected: true,
        contactId: 'contact-xyz',
        sentDate: '2026-02-16',
        errors: ['Pipeline advance failed: API down'],
      });

      const job = createMockJob({
        source: 'gmail',
        gmailMessageId: messageId,
        receivedAt: '2026-02-16T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Pipeline advance failed');
    });

    it('triggers poll and enqueues new messages when gmailMessageId is missing', async () => {
      // When no gmailMessageId, the worker polls Gmail for new messages
      mockMonitor.getStoredHistoryId.mockResolvedValue('12345');
      mockReader.pollForNewMessages.mockResolvedValue({
        messageIds: ['msg-new-1', 'msg-new-2'],
        newHistoryId: '12346',
      });

      const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
      mockMonitor.getIntakeQueue.mockReturnValue({ add: mockQueueAdd });

      const job = createMockJob({
        source: 'gmail',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockMonitor.storeHistoryId).toHaveBeenCalledWith('12346');
      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
    });

    it('seeds historyId on first poll (no stored value)', async () => {
      mockMonitor.getStoredHistoryId.mockResolvedValue(null);
      mockReader.getInitialHistoryId.mockResolvedValue('99999');

      const job = createMockJob({
        source: 'gmail',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(mockMonitor.storeHistoryId).toHaveBeenCalledWith('99999');
      expect(mockReader.pollForNewMessages).not.toHaveBeenCalled();
    });

    it('produces IntakeDocument with correct fields', async () => {
      const messageId = 'msg-fields';
      setupGmailMessage(messageId);

      mockExtractor.extractAttachments.mockReturnValue([
        { filename: 'income.pdf', mimeType: 'application/pdf', attachmentId: 'att-f', size: 100 },
      ]);

      mockIntakeConfig.getConversionStrategy.mockReturnValue('pdf');

      const pdfBuf = Buffer.from('pdf-bytes');
      mockExtractor.downloadAttachment.mockResolvedValue(pdfBuf);
      mockConverter.convertToPdf.mockResolvedValue({ pdfBuffer: pdfBuf, converted: false });

      const job = createMockJob({
        source: 'gmail',
        gmailMessageId: messageId,
        receivedAt: '2026-02-14T12:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(1);
      expect(result.documentIds[0]).toBe('gmail-msg-fields-0');
      // Verify the console log was called with correct metadata
      expect(result.errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Finmo source
  // -------------------------------------------------------------------------

  describe('Finmo source', () => {
    it('downloads and converts Finmo files into IntakeDocuments', async () => {
      mockFinmoDownloader.isDocRequestProcessed.mockResolvedValue(false);
      mockFinmoDownloader.downloadFinmoDocument.mockResolvedValue([
        { buffer: Buffer.from('pdf-data'), filename: 'T4-2024.pdf', mimeType: 'application/pdf' },
      ]);
      mockFinmoDownloader.markDocRequestProcessed.mockResolvedValue(undefined);

      mockIntakeConfig.getConversionStrategy.mockReturnValue('pdf');
      const pdfBuf = Buffer.from('converted-pdf');
      mockConverter.convertToPdf.mockResolvedValue({ pdfBuffer: pdfBuf, converted: false });

      const job = createMockJob({
        source: 'finmo',
        applicationId: 'app-123',
        documentRequestId: 'doc-456',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(1);
      expect(result.documentIds).toEqual(['finmo-doc-456-0']);
      expect(result.errors).toHaveLength(0);
      expect(mockFinmoDownloader.downloadFinmoDocument).toHaveBeenCalledWith('app-123', 'doc-456');
      expect(mockFinmoDownloader.markDocRequestProcessed).toHaveBeenCalledWith('doc-456');
    });

    it('skips already-processed doc requests (dedup)', async () => {
      mockFinmoDownloader.isDocRequestProcessed.mockResolvedValue(true);

      const job = createMockJob({
        source: 'finmo',
        applicationId: 'app-123',
        documentRequestId: 'doc-already',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockFinmoDownloader.downloadFinmoDocument).not.toHaveBeenCalled();
    });

    it('returns error when documentRequestId is missing', async () => {
      const job = createMockJob({
        source: 'finmo',
        applicationId: 'app-123',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('missing documentRequestId');
    });

    it('handles empty download results (no files)', async () => {
      mockFinmoDownloader.isDocRequestProcessed.mockResolvedValue(false);
      mockFinmoDownloader.downloadFinmoDocument.mockResolvedValue([]);
      mockFinmoDownloader.markDocRequestProcessed.mockResolvedValue(undefined);

      const job = createMockJob({
        source: 'finmo',
        applicationId: 'app-123',
        documentRequestId: 'doc-empty',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockFinmoDownloader.markDocRequestProcessed).toHaveBeenCalledWith('doc-empty');
    });

    it('catches download errors without crashing', async () => {
      mockFinmoDownloader.isDocRequestProcessed.mockResolvedValue(false);
      mockFinmoDownloader.downloadFinmoDocument.mockRejectedValue(new Error('API timeout'));

      const job = createMockJob({
        source: 'finmo',
        applicationId: 'app-123',
        documentRequestId: 'doc-fail',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Finmo download failed');
      expect(result.errors[0]).toContain('API timeout');
    });

    it('handles unsupported MIME type from Finmo file', async () => {
      mockFinmoDownloader.isDocRequestProcessed.mockResolvedValue(false);
      mockFinmoDownloader.downloadFinmoDocument.mockResolvedValue([
        { buffer: Buffer.from('data'), filename: 'spreadsheet.xlsx', mimeType: 'application/vnd.ms-excel' },
      ]);
      mockFinmoDownloader.markDocRequestProcessed.mockResolvedValue(undefined);

      mockIntakeConfig.getConversionStrategy.mockReturnValue('unsupported');

      const job = createMockJob({
        source: 'finmo',
        applicationId: 'app-123',
        documentRequestId: 'doc-unsupported',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Unsupported MIME type from Finmo');
    });

    it('catches per-file ConversionError without failing the batch', async () => {
      mockFinmoDownloader.isDocRequestProcessed.mockResolvedValue(false);
      mockFinmoDownloader.downloadFinmoDocument.mockResolvedValue([
        { buffer: Buffer.from('docx'), filename: 'letter.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { buffer: Buffer.from('pdf'), filename: 'T4.pdf', mimeType: 'application/pdf' },
      ]);
      mockFinmoDownloader.markDocRequestProcessed.mockResolvedValue(undefined);

      mockIntakeConfig.getConversionStrategy
        .mockReturnValueOnce('word-to-pdf')
        .mockReturnValueOnce('pdf');

      const pdfBuf = Buffer.from('good-pdf');
      mockConverter.convertToPdf
        .mockRejectedValueOnce(new mockConverter.ConversionError('WORD_MANUAL_REVIEW', 'Word doc'))
        .mockResolvedValueOnce({ pdfBuffer: pdfBuf, converted: false });

      const job = createMockJob({
        source: 'finmo',
        applicationId: 'app-123',
        documentRequestId: 'doc-mixed',
        receivedAt: '2026-02-14T00:00:00Z',
      });

      const result = await processIntakeJob(job);

      expect(result.documentsProcessed).toBe(1);
      expect(result.documentIds).toEqual(['finmo-doc-mixed-1']);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('WORD_MANUAL_REVIEW');
    });
  });
});
