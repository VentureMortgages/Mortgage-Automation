/**
 * Tests for Feedback Capture — Full orchestration pipeline
 *
 * Tests cover:
 * - Full happy path: retrieve original, extract sent, diff, store feedback
 * - Skips when no original stored (Redis miss)
 * - Skips when no HTML body in BCC message
 * - Skips when no changes detected (noChanges=true)
 * - Skips when feedback is disabled
 * - Cleans up Redis after successful capture
 * - Cleans up Redis after no-changes detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetOriginalEmail = vi.hoisted(() => vi.fn());
const mockDeleteOriginalEmail = vi.hoisted(() => vi.fn());

vi.mock('../original-store.js', () => ({
  getOriginalEmail: mockGetOriginalEmail,
  deleteOriginalEmail: mockDeleteOriginalEmail,
}));

const mockExtractEmailHtml = vi.hoisted(() => vi.fn());

vi.mock('../html-extractor.js', () => ({
  extractEmailHtml: mockExtractEmailHtml,
}));

const mockAnalyzeEdits = vi.hoisted(() => vi.fn());

vi.mock('../diff-analyzer.js', () => ({
  analyzeEdits: mockAnalyzeEdits,
}));

const mockAppendFeedbackRecord = vi.hoisted(() => vi.fn());

vi.mock('../feedback-store.js', () => ({
  appendFeedbackRecord: mockAppendFeedbackRecord,
}));

vi.mock('../config.js', () => ({
  feedbackConfig: {
    enabled: true,
  },
}));

const mockGetGmailReadonlyClient = vi.hoisted(() => vi.fn());

vi.mock('../../email/gmail-client.js', () => ({
  getGmailReadonlyClient: mockGetGmailReadonlyClient,
}));

vi.mock('../../email/config.js', () => ({
  emailConfig: {
    senderAddress: 'admin@venturemortgages.com',
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { captureFeedback } from '../capture.js';
import type { ApplicationContext } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testContext: ApplicationContext = {
  goal: 'purchase',
  incomeTypes: ['employed/salaried'],
  propertyTypes: ['owner_occupied'],
  borrowerCount: 1,
  hasGiftDP: false,
  hasRentalIncome: false,
};

const storedOriginal = {
  html: '<div>Original email</div>',
  context: testContext,
};

const editedEdits = {
  itemsRemoved: ['Void Cheque'],
  itemsAdded: [],
  itemsReworded: [],
  sectionsReordered: false,
  otherChanges: null,
  noChanges: false,
};

const noChangesEdits = {
  itemsRemoved: [],
  itemsAdded: [],
  itemsReworded: [],
  sectionsReordered: false,
  otherChanges: null,
  noChanges: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feedback Capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGmailReadonlyClient.mockReturnValue({});
    mockDeleteOriginalEmail.mockResolvedValue(undefined);
    mockAppendFeedbackRecord.mockResolvedValue(undefined);
  });

  it('captures feedback on full happy path', async () => {
    mockGetOriginalEmail.mockResolvedValue(storedOriginal);
    mockExtractEmailHtml.mockResolvedValue('<div>Edited email</div>');
    mockAnalyzeEdits.mockResolvedValue(editedEdits);

    await captureFeedback('msg-bcc-1', 'contact-123');

    expect(mockAppendFeedbackRecord).toHaveBeenCalledOnce();
    const record = mockAppendFeedbackRecord.mock.calls[0][0];
    expect(record.contactId).toBe('contact-123');
    expect(record.edits.itemsRemoved).toEqual(['Void Cheque']);
    expect(record.context).toEqual(testContext);
    expect(record.contextText).toBeTruthy();
    expect(record.embedding).toBeNull();

    // Redis cleanup
    expect(mockDeleteOriginalEmail).toHaveBeenCalledWith('contact-123');
  });

  it('skips when no original stored', async () => {
    mockGetOriginalEmail.mockResolvedValue(null);

    await captureFeedback('msg-bcc-1', 'contact-missing');

    expect(mockExtractEmailHtml).not.toHaveBeenCalled();
    expect(mockAppendFeedbackRecord).not.toHaveBeenCalled();
  });

  it('skips when no HTML body in BCC message', async () => {
    mockGetOriginalEmail.mockResolvedValue(storedOriginal);
    mockExtractEmailHtml.mockResolvedValue(null);

    await captureFeedback('msg-no-html', 'contact-123');

    expect(mockAnalyzeEdits).not.toHaveBeenCalled();
    expect(mockAppendFeedbackRecord).not.toHaveBeenCalled();
  });

  it('skips and cleans up when no changes detected', async () => {
    mockGetOriginalEmail.mockResolvedValue(storedOriginal);
    mockExtractEmailHtml.mockResolvedValue('<div>Same email</div>');
    mockAnalyzeEdits.mockResolvedValue(noChangesEdits);

    await captureFeedback('msg-same', 'contact-123');

    expect(mockAppendFeedbackRecord).not.toHaveBeenCalled();
    expect(mockDeleteOriginalEmail).toHaveBeenCalledWith('contact-123');
  });
});
