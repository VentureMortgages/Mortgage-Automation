/**
 * Tests for Sent Detector — BCC copy detection and CRM update
 *
 * Tests cover:
 * - isBccCopy: detects doc-request BCC copies by X-Venture headers
 * - isBccCopy: returns false for normal messages (no venture headers)
 * - isBccCopy: returns false for partial headers (type but no contactId)
 * - handleSentDetection: updates docRequestSent field on CRM contact
 * - handleSentDetection: moves pipeline to Collecting Documents
 * - handleSentDetection: creates audit note
 * - handleSentDetection: captures non-critical errors without failing
 * - handleSentDetection: returns detected=false when contactId is missing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GmailMessageMeta } from '../types.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockGetContact = vi.hoisted(() => vi.fn());
const mockUpsertContact = vi.hoisted(() => vi.fn());

vi.mock('../../crm/contacts.js', () => ({
  getContact: mockGetContact,
  upsertContact: mockUpsertContact,
}));

const mockCreateAuditNote = vi.hoisted(() => vi.fn());

vi.mock('../../crm/notes.js', () => ({
  createAuditNote: mockCreateAuditNote,
}));

const mockSearchOpportunities = vi.hoisted(() => vi.fn());
const mockUpdateOpportunityStage = vi.hoisted(() => vi.fn());

vi.mock('../../crm/opportunities.js', () => ({
  searchOpportunities: mockSearchOpportunities,
  updateOpportunityStage: mockUpdateOpportunityStage,
}));

const mockFindReviewTask = vi.hoisted(() => vi.fn());
const mockCompleteTask = vi.hoisted(() => vi.fn());

vi.mock('../../crm/tasks.js', () => ({
  findReviewTask: mockFindReviewTask,
  completeTask: mockCompleteTask,
}));

vi.mock('../../crm/config.js', () => ({
  crmConfig: {
    fieldIds: {
      docRequestSent: 'field-doc-request-sent-id',
    },
    stageIds: {
      collectingDocuments: 'stage-collecting-docs',
    },
  },
}));

vi.mock('../../crm/types/index.js', () => ({
  PIPELINE_IDS: { LIVE_DEALS: 'pipeline-live-deals' },
}));

const mockCaptureFeedback = vi.hoisted(() => vi.fn());

vi.mock('../../feedback/capture.js', () => ({
  captureFeedback: mockCaptureFeedback,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { isBccCopy, handleSentDetection } from '../sent-detector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMeta(overrides: Partial<GmailMessageMeta> = {}): GmailMessageMeta {
  return {
    messageId: 'msg-bcc-1',
    threadId: 'thread-1',
    from: 'admin@venturemortgages.com',
    subject: 'Documents Needed — TestEmp',
    date: '2026-02-16',
    historyId: '12345',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sent Detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // isBccCopy
  // -------------------------------------------------------------------------

  describe('isBccCopy', () => {
    it('returns true for doc-request BCC with contact ID', () => {
      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });
      expect(isBccCopy(meta)).toBe(true);
    });

    it('returns false for normal messages (no venture headers)', () => {
      const meta = createMeta();
      expect(isBccCopy(meta)).toBe(false);
    });

    it('returns false when ventureType is set but ventureContactId is missing', () => {
      const meta = createMeta({ ventureType: 'doc-request' });
      expect(isBccCopy(meta)).toBe(false);
    });

    it('returns false when ventureContactId is set but ventureType is wrong', () => {
      const meta = createMeta({
        ventureType: 'other-type',
        ventureContactId: 'contact-abc',
      });
      expect(isBccCopy(meta)).toBe(false);
    });

    it('returns false when ventureContactId is empty string', () => {
      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: '',
      });
      expect(isBccCopy(meta)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // handleSentDetection
  // -------------------------------------------------------------------------

  describe('handleSentDetection', () => {
    const mockContact = {
      id: 'contact-abc',
      email: 'borrower@example.com',
      firstName: 'TestEmp',
      lastName: 'Borrower',
      customFields: [],
    };

    beforeEach(() => {
      mockGetContact.mockResolvedValue(mockContact);
      mockUpsertContact.mockResolvedValue({ contactId: 'contact-abc', isNew: false });
      mockSearchOpportunities.mockResolvedValue([{ id: 'opp-123', name: 'Test Deal' }]);
      mockUpdateOpportunityStage.mockResolvedValue(undefined);
      mockFindReviewTask.mockResolvedValue({ id: 'task-review-1', title: 'Review doc request — TestEmp Borrower', completed: false });
      mockCompleteTask.mockResolvedValue(undefined);
      mockCreateAuditNote.mockResolvedValue('note-456');
      mockCaptureFeedback.mockResolvedValue(undefined);
    });

    it('updates docRequestSent field on CRM contact', async () => {
      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      const result = await handleSentDetection(meta);

      expect(result.detected).toBe(true);
      expect(result.contactId).toBe('contact-abc');
      expect(result.sentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      expect(mockGetContact).toHaveBeenCalledWith('contact-abc');
      expect(mockUpsertContact).toHaveBeenCalledWith({
        email: 'borrower@example.com',
        firstName: 'TestEmp',
        lastName: 'Borrower',
        customFields: [
          { id: 'field-doc-request-sent-id', field_value: result.sentDate },
        ],
      });
    });

    it('moves opportunity to Collecting Documents via opportunity-level API', async () => {
      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      await handleSentDetection(meta);

      expect(mockSearchOpportunities).toHaveBeenCalledWith('contact-abc', 'pipeline-live-deals');
      expect(mockUpdateOpportunityStage).toHaveBeenCalledWith('opp-123', 'stage-collecting-docs');
    });

    it('creates audit note', async () => {
      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      await handleSentDetection(meta);

      expect(mockCreateAuditNote).toHaveBeenCalledWith('contact-abc', {
        documentType: 'Doc Request Email Sent',
        source: 'gmail',
        driveFileId: 'N/A — outbound email',
      });
    });

    it('captures stage move error without failing', async () => {
      mockSearchOpportunities.mockRejectedValue(new Error('Pipeline API down'));

      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      const result = await handleSentDetection(meta);

      expect(result.detected).toBe(true);
      expect(result.errors).toContainEqual(expect.stringContaining('Stage move failed'));
    });

    it('captures audit note error without failing', async () => {
      mockCreateAuditNote.mockRejectedValue(new Error('Notes API down'));

      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      const result = await handleSentDetection(meta);

      expect(result.detected).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Audit note failed');
    });

    it('returns detected=false when contactId is missing', async () => {
      const meta = createMeta({
        ventureType: 'doc-request',
        // ventureContactId intentionally missing
      });

      const result = await handleSentDetection(meta);

      expect(result.detected).toBe(false);
      expect(mockGetContact).not.toHaveBeenCalled();
    });

    it('returns empty errors when everything succeeds', async () => {
      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      const result = await handleSentDetection(meta);

      expect(result.errors).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Task auto-completion tests (PIPE-03)
    // -----------------------------------------------------------------------

    it('auto-completes review task when email is sent', async () => {
      const meta = createMeta({ ventureType: 'doc-request', ventureContactId: 'contact-abc' });
      await handleSentDetection(meta);

      expect(mockFindReviewTask).toHaveBeenCalledWith('contact-abc');
      expect(mockCompleteTask).toHaveBeenCalledWith('contact-abc', 'task-review-1');
    });

    it('skips task completion when task is already completed', async () => {
      mockFindReviewTask.mockResolvedValue({ id: 'task-review-1', title: 'Review', completed: true });
      const meta = createMeta({ ventureType: 'doc-request', ventureContactId: 'contact-abc' });
      await handleSentDetection(meta);

      expect(mockCompleteTask).not.toHaveBeenCalled();
    });

    it('skips task completion when no review task exists', async () => {
      mockFindReviewTask.mockResolvedValue(null);
      const meta = createMeta({ ventureType: 'doc-request', ventureContactId: 'contact-abc' });
      await handleSentDetection(meta);

      expect(mockCompleteTask).not.toHaveBeenCalled();
    });

    it('handles stage move when no opportunity found', async () => {
      mockSearchOpportunities.mockResolvedValue([]);
      const meta = createMeta({ ventureType: 'doc-request', ventureContactId: 'contact-abc' });
      const result = await handleSentDetection(meta);

      expect(result.detected).toBe(true);
      expect(mockUpdateOpportunityStage).not.toHaveBeenCalled();
      expect(result.errors).toHaveLength(0);
    });

    it('captures task completion error without failing', async () => {
      mockCompleteTask.mockRejectedValue(new Error('Task API down'));
      const meta = createMeta({ ventureType: 'doc-request', ventureContactId: 'contact-abc' });
      const result = await handleSentDetection(meta);

      expect(result.detected).toBe(true);
      expect(result.errors).toContainEqual(expect.stringContaining('Task completion failed'));
    });
  });
});
