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

const mockMoveToCollectingDocs = vi.hoisted(() => vi.fn());

vi.mock('../../crm/opportunities.js', () => ({
  moveToCollectingDocs: mockMoveToCollectingDocs,
}));

vi.mock('../../crm/config.js', () => ({
  crmConfig: {
    fieldIds: {
      docRequestSent: 'field-doc-request-sent-id',
    },
  },
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
      mockMoveToCollectingDocs.mockResolvedValue('opp-123');
      mockCreateAuditNote.mockResolvedValue('note-456');
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

    it('moves pipeline to Collecting Documents', async () => {
      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      await handleSentDetection(meta);

      expect(mockMoveToCollectingDocs).toHaveBeenCalledWith(
        'contact-abc',
        'TestEmp Borrower',
      );
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

    it('captures pipeline error without failing', async () => {
      mockMoveToCollectingDocs.mockRejectedValue(new Error('Pipeline API down'));

      const meta = createMeta({
        ventureType: 'doc-request',
        ventureContactId: 'contact-abc',
      });

      const result = await handleSentDetection(meta);

      expect(result.detected).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Pipeline advance failed');
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
  });
});
