/**
 * Tests for Tracking Sync Orchestrator — Document-received CRM updates
 *
 * Tests cover:
 * - Happy path: PRE doc received, FULL doc received, counters/status update
 * - Milestone triggers: PRE Complete -> task, All Complete -> pipeline advance
 * - Audit note created with correct document name and source
 * - Edge cases: no contact, no match, already received, LATER/CONDITIONAL stage
 * - Error handling: non-fatal audit note, task, and pipeline failures
 * - parseContactTrackingFields: valid JSON, missing fields, malformed JSON
 *
 * All external dependencies are mocked via vi.mock / vi.hoisted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrmContact, MissingDocEntry } from '../types/index.js';

// ---------------------------------------------------------------------------
// Module-level mocks (vi.hoisted)
// ---------------------------------------------------------------------------

const mockContacts = vi.hoisted(() => ({
  findContactByEmail: vi.fn(),
  getContact: vi.fn(),
  upsertContact: vi.fn(),
}));

vi.mock('../contacts.js', () => mockContacts);

const mockNotes = vi.hoisted(() => ({
  createAuditNote: vi.fn(),
}));

vi.mock('../notes.js', () => mockNotes);

const mockDocTypeMatcher = vi.hoisted(() => ({
  findMatchingChecklistDoc: vi.fn(),
}));

vi.mock('../doc-type-matcher.js', () => mockDocTypeMatcher);

const mockChecklistMapper = vi.hoisted(() => ({
  computeDocStatus: vi.fn(),
}));

vi.mock('../checklist-mapper.js', () => mockChecklistMapper);

const mockTasks = vi.hoisted(() => ({
  createPreReadinessTask: vi.fn(),
}));

vi.mock('../tasks.js', () => mockTasks);

const mockOpportunities = vi.hoisted(() => ({
  moveToAllDocsReceived: vi.fn(),
}));

vi.mock('../opportunities.js', () => mockOpportunities);

const MOCK_FIELD_IDS = vi.hoisted(() => ({
  docStatus: 'field-doc-status',
  docRequestSent: 'field-doc-request-sent',
  missingDocs: 'field-missing-docs',
  receivedDocs: 'field-received-docs',
  preDocsTotal: 'field-pre-total',
  preDocsReceived: 'field-pre-received',
  fullDocsTotal: 'field-full-total',
  fullDocsReceived: 'field-full-received',
  lastDocReceived: 'field-last-doc-received',
}));

vi.mock('../config.js', () => ({
  crmConfig: {
    fieldIds: MOCK_FIELD_IDS,
    locationId: 'loc-123',
    isDev: false,
  },
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { updateDocTracking, parseContactTrackingFields } from '../tracking-sync.js';
import type { TrackingUpdateInput } from '../tracking-sync.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContact(customFields: Array<{ id: string; value: unknown }> = []): CrmContact {
  return {
    id: 'contact-abc',
    email: 'borrower@example.com',
    firstName: 'Terry',
    lastName: 'Smith',
    customFields,
  };
}

function makeMissingDocs(entries: Array<{ name: string; stage: MissingDocEntry['stage'] }>): MissingDocEntry[] {
  return entries.map((e) => ({ name: e.name, stage: e.stage }));
}

function makeInput(overrides: Partial<TrackingUpdateInput> = {}): TrackingUpdateInput {
  return {
    senderEmail: 'borrower@example.com',
    documentType: 't4',
    driveFileId: 'drive-file-789',
    source: 'gmail',
    receivedAt: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

/**
 * Sets up the standard happy-path mocks: contact found, contact record with
 * missingDocs/receivedDocs/counters, doc matched, status computed.
 */
function setupHappyPath(opts: {
  missingDocs?: MissingDocEntry[];
  receivedDocs?: string[];
  preDocsTotal?: number;
  preDocsReceived?: number;
  fullDocsTotal?: number;
  fullDocsReceived?: number;
  matchedDoc?: MissingDocEntry | null;
  newStatus?: string;
} = {}) {
  const {
    missingDocs = makeMissingDocs([
      { name: 'T4 - Current year', stage: 'PRE' },
      { name: 'Recent paystub (within 30 days)', stage: 'PRE' },
      { name: 'NOA - Previous year', stage: 'FULL' },
    ]),
    receivedDocs = ['Letter of Employment'],
    preDocsTotal = 3,
    preDocsReceived = 1,
    fullDocsTotal = 2,
    fullDocsReceived = 0,
    matchedDoc = { name: 'T4 - Current year', stage: 'PRE' as const },
    newStatus = 'In Progress',
  } = opts;

  const contact = makeContact([
    { id: MOCK_FIELD_IDS.missingDocs, value: JSON.stringify(missingDocs) },
    { id: MOCK_FIELD_IDS.receivedDocs, value: JSON.stringify(receivedDocs) },
    { id: MOCK_FIELD_IDS.preDocsTotal, value: preDocsTotal },
    { id: MOCK_FIELD_IDS.preDocsReceived, value: preDocsReceived },
    { id: MOCK_FIELD_IDS.fullDocsTotal, value: fullDocsTotal },
    { id: MOCK_FIELD_IDS.fullDocsReceived, value: fullDocsReceived },
  ]);

  mockContacts.findContactByEmail.mockResolvedValue('contact-abc');
  mockContacts.getContact.mockResolvedValue(contact);
  mockContacts.upsertContact.mockResolvedValue({ contactId: 'contact-abc', isNew: false });
  mockDocTypeMatcher.findMatchingChecklistDoc.mockReturnValue(matchedDoc);
  mockChecklistMapper.computeDocStatus.mockReturnValue(newStatus);
  mockNotes.createAuditNote.mockResolvedValue('note-xyz');
  mockTasks.createPreReadinessTask.mockResolvedValue('task-123');
  mockOpportunities.moveToAllDocsReceived.mockResolvedValue('opp-456');

  return contact;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tracking-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // parseContactTrackingFields
  // =========================================================================

  describe('parseContactTrackingFields', () => {
    it('should parse valid JSON from customFields', () => {
      const missingDocs: MissingDocEntry[] = [
        { name: 'T4 - Current year', stage: 'PRE' },
        { name: 'NOA', stage: 'FULL' },
      ];
      const receivedDocs = ['LOE', 'Pay Stub'];

      const contact = makeContact([
        { id: MOCK_FIELD_IDS.missingDocs, value: JSON.stringify(missingDocs) },
        { id: MOCK_FIELD_IDS.receivedDocs, value: JSON.stringify(receivedDocs) },
        { id: MOCK_FIELD_IDS.preDocsTotal, value: 5 },
        { id: MOCK_FIELD_IDS.preDocsReceived, value: 2 },
        { id: MOCK_FIELD_IDS.fullDocsTotal, value: 3 },
        { id: MOCK_FIELD_IDS.fullDocsReceived, value: 1 },
      ]);

      const result = parseContactTrackingFields(contact, MOCK_FIELD_IDS);

      expect(result.missingDocs).toEqual(missingDocs);
      expect(result.receivedDocs).toEqual(receivedDocs);
      expect(result.preDocsTotal).toBe(5);
      expect(result.preDocsReceived).toBe(2);
      expect(result.fullDocsTotal).toBe(3);
      expect(result.fullDocsReceived).toBe(1);
    });

    it('should handle missing fields with safe defaults', () => {
      const contact = makeContact([]); // no custom fields

      const result = parseContactTrackingFields(contact, MOCK_FIELD_IDS);

      expect(result.missingDocs).toEqual([]);
      expect(result.receivedDocs).toEqual([]);
      expect(result.preDocsTotal).toBe(0);
      expect(result.preDocsReceived).toBe(0);
      expect(result.fullDocsTotal).toBe(0);
      expect(result.fullDocsReceived).toBe(0);
    });

    it('should handle malformed JSON gracefully with defaults', () => {
      const contact = makeContact([
        { id: MOCK_FIELD_IDS.missingDocs, value: 'not-valid-json{' },
        { id: MOCK_FIELD_IDS.receivedDocs, value: '{ bad }' },
        { id: MOCK_FIELD_IDS.preDocsTotal, value: 'abc' },
        { id: MOCK_FIELD_IDS.preDocsReceived, value: null },
      ]);

      const result = parseContactTrackingFields(contact, MOCK_FIELD_IDS);

      expect(result.missingDocs).toEqual([]);
      expect(result.receivedDocs).toEqual([]);
      expect(result.preDocsTotal).toBe(0); // 'abc' -> NaN -> 0
      expect(result.preDocsReceived).toBe(0); // null -> 0
    });

    it('should handle numeric strings as field values', () => {
      const contact = makeContact([
        { id: MOCK_FIELD_IDS.preDocsTotal, value: '5' },
        { id: MOCK_FIELD_IDS.fullDocsReceived, value: '3' },
      ]);

      const result = parseContactTrackingFields(contact, MOCK_FIELD_IDS);

      expect(result.preDocsTotal).toBe(5);
      expect(result.fullDocsReceived).toBe(3);
    });

    it('should return default when JSON field contains non-array value', () => {
      const contact = makeContact([
        { id: MOCK_FIELD_IDS.missingDocs, value: '"just a string"' },
        { id: MOCK_FIELD_IDS.receivedDocs, value: '42' },
      ]);

      const result = parseContactTrackingFields(contact, MOCK_FIELD_IDS);

      expect(result.missingDocs).toEqual([]);
      expect(result.receivedDocs).toEqual([]);
    });
  });

  // =========================================================================
  // updateDocTracking — Happy path
  // =========================================================================

  describe('updateDocTracking — happy path', () => {
    it('should update tracking when PRE doc received: remove from missing, add to received, increment preDocsReceived', async () => {
      setupHappyPath({ newStatus: 'In Progress' });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.contactId).toBe('contact-abc');
      expect(result.newStatus).toBe('In Progress');
      expect(result.noteId).toBe('note-xyz');
      expect(result.errors).toEqual([]);

      // Verify upsertContact was called with updated fields
      expect(mockContacts.upsertContact).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'borrower@example.com',
          customFields: expect.arrayContaining([
            expect.objectContaining({ id: MOCK_FIELD_IDS.preDocsReceived, field_value: 2 }), // 1 + 1
          ]),
        }),
      );

      // Verify missingDocs no longer contains the matched doc
      const upsertCall = mockContacts.upsertContact.mock.calls[0][0];
      const missingField = upsertCall.customFields.find(
        (f: { id: string }) => f.id === MOCK_FIELD_IDS.missingDocs,
      );
      const updatedMissing = JSON.parse(missingField.field_value as string);
      expect(updatedMissing).toHaveLength(2); // was 3, removed 1
      expect(updatedMissing.find((d: MissingDocEntry) => d.name === 'T4 - Current year')).toBeUndefined();

      // Verify receivedDocs now contains the matched doc name
      const receivedField = upsertCall.customFields.find(
        (f: { id: string }) => f.id === MOCK_FIELD_IDS.receivedDocs,
      );
      const updatedReceived = JSON.parse(receivedField.field_value as string);
      expect(updatedReceived).toContain('T4 - Current year');
      expect(updatedReceived).toContain('Letter of Employment'); // existing
    });

    it('should increment fullDocsReceived when FULL doc received', async () => {
      setupHappyPath({
        matchedDoc: { name: 'NOA - Previous year', stage: 'FULL' },
        fullDocsReceived: 0,
        newStatus: 'In Progress',
      });

      const result = await updateDocTracking(makeInput({ documentType: 'noa' }));

      expect(result.updated).toBe(true);

      const upsertCall = mockContacts.upsertContact.mock.calls[0][0];
      const fullReceivedField = upsertCall.customFields.find(
        (f: { id: string }) => f.id === MOCK_FIELD_IDS.fullDocsReceived,
      );
      expect(fullReceivedField.field_value).toBe(1); // 0 + 1

      // PRE counter should NOT be incremented
      const preReceivedField = upsertCall.customFields.find(
        (f: { id: string }) => f.id === MOCK_FIELD_IDS.preDocsReceived,
      );
      expect(preReceivedField.field_value).toBe(1); // unchanged from setup
    });

    it('should create audit note with matched doc name and source', async () => {
      setupHappyPath();

      await updateDocTracking(makeInput());

      expect(mockNotes.createAuditNote).toHaveBeenCalledWith('contact-abc', {
        documentType: 'T4 - Current year',
        source: 'gmail',
        driveFileId: 'drive-file-789',
      });
    });

    it('should compute new status using computeDocStatus', async () => {
      setupHappyPath({ preDocsTotal: 3, preDocsReceived: 1, fullDocsTotal: 2, fullDocsReceived: 0 });

      await updateDocTracking(makeInput());

      // Should be called with updated preDocsReceived (1+1=2)
      expect(mockChecklistMapper.computeDocStatus).toHaveBeenCalledWith(3, 2, 2, 0);
    });

    it('should set lastDocReceived to today ISO date', async () => {
      setupHappyPath();

      await updateDocTracking(makeInput());

      const upsertCall = mockContacts.upsertContact.mock.calls[0][0];
      const lastDocField = upsertCall.customFields.find(
        (f: { id: string }) => f.id === MOCK_FIELD_IDS.lastDocReceived,
      );
      // Should be YYYY-MM-DD format
      expect(lastDocField.field_value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // =========================================================================
  // updateDocTracking — Milestone triggers
  // =========================================================================

  describe('updateDocTracking — milestone triggers', () => {
    it('should create PRE readiness task for Taylor when status becomes PRE Complete', async () => {
      setupHappyPath({ newStatus: 'PRE Complete' });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(mockTasks.createPreReadinessTask).toHaveBeenCalledWith(
        'contact-abc',
        'Terry Smith',
      );
      // Pipeline advance should NOT be called for PRE Complete
      expect(mockOpportunities.moveToAllDocsReceived).not.toHaveBeenCalled();
    });

    it('should advance pipeline when status becomes All Complete', async () => {
      setupHappyPath({ newStatus: 'All Complete' });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(mockOpportunities.moveToAllDocsReceived).toHaveBeenCalledWith(
        'contact-abc',
        'Terry Smith',
      );
      // PRE readiness task should NOT be called for All Complete
      expect(mockTasks.createPreReadinessTask).not.toHaveBeenCalled();
    });

    it('should not trigger milestone actions for In Progress status', async () => {
      setupHappyPath({ newStatus: 'In Progress' });

      await updateDocTracking(makeInput());

      expect(mockTasks.createPreReadinessTask).not.toHaveBeenCalled();
      expect(mockOpportunities.moveToAllDocsReceived).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateDocTracking — Edge cases
  // =========================================================================

  describe('updateDocTracking — edge cases', () => {
    it('should use provided contactId and skip findContactByEmail', async () => {
      setupHappyPath();

      const result = await updateDocTracking(makeInput({ contactId: 'pre-resolved-id' }));

      expect(result.updated).toBe(true);
      expect(mockContacts.findContactByEmail).not.toHaveBeenCalled();
      expect(mockContacts.getContact).toHaveBeenCalledWith('pre-resolved-id');
    });

    it('should return no-contact when email not found in CRM', async () => {
      mockContacts.findContactByEmail.mockResolvedValue(null);

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('no-contact');
      expect(result.errors).toEqual([]);
      expect(mockContacts.getContact).not.toHaveBeenCalled();
    });

    it('should return no-match-in-checklist when doc type not in client checklist', async () => {
      setupHappyPath({ matchedDoc: null });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('no-match-in-checklist');
      expect(result.errors).toEqual([]);
      expect(mockContacts.upsertContact).not.toHaveBeenCalled();
    });

    it('should return already-received when doc is already in receivedDocs', async () => {
      setupHappyPath({
        receivedDocs: ['Letter of Employment', 'T4 - Current year'],
        matchedDoc: { name: 'T4 - Current year', stage: 'PRE' },
      });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('already-received');
      expect(result.errors).toEqual([]);
      expect(mockContacts.upsertContact).not.toHaveBeenCalled();
    });

    it('should not increment either counter for LATER stage doc', async () => {
      setupHappyPath({
        matchedDoc: { name: 'Gift letter', stage: 'LATER' },
        newStatus: 'In Progress',
      });

      const result = await updateDocTracking(makeInput({ documentType: 'gift_letter' }));

      expect(result.updated).toBe(true);

      // computeDocStatus should be called with unchanged counter values
      expect(mockChecklistMapper.computeDocStatus).toHaveBeenCalledWith(
        3, 1, // preTotal, preReceived unchanged
        2, 0, // fullTotal, fullReceived unchanged
      );
    });

    it('should not increment either counter for CONDITIONAL stage doc', async () => {
      setupHappyPath({
        matchedDoc: { name: 'Separation agreement', stage: 'CONDITIONAL' },
        newStatus: 'In Progress',
      });

      const result = await updateDocTracking(makeInput({ documentType: 'separation_agreement' }));

      expect(result.updated).toBe(true);

      expect(mockChecklistMapper.computeDocStatus).toHaveBeenCalledWith(
        3, 1, // unchanged
        2, 0, // unchanged
      );
    });
  });

  // =========================================================================
  // updateDocTracking — Error handling (non-fatal)
  // =========================================================================

  describe('updateDocTracking — error handling', () => {
    it('should still return updated=true when audit note creation fails', async () => {
      setupHappyPath();
      mockNotes.createAuditNote.mockRejectedValue(new Error('Notes API offline'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.noteId).toBeUndefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Audit note failed');
      expect(result.errors[0]).toContain('Notes API offline');
    });

    it('should still return updated=true when PRE readiness task creation fails', async () => {
      setupHappyPath({ newStatus: 'PRE Complete' });
      mockTasks.createPreReadinessTask.mockRejectedValue(new Error('Task API error'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('PRE readiness task failed');
      expect(result.errors[0]).toContain('Task API error');
    });

    it('should still return updated=true when pipeline advance fails', async () => {
      setupHappyPath({ newStatus: 'All Complete' });
      mockOpportunities.moveToAllDocsReceived.mockRejectedValue(new Error('Pipeline API down'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Pipeline advance failed');
      expect(result.errors[0]).toContain('Pipeline API down');
    });

    it('should collect multiple non-fatal errors', async () => {
      setupHappyPath({ newStatus: 'PRE Complete' });
      mockNotes.createAuditNote.mockRejectedValue(new Error('Note fail'));
      mockTasks.createPreReadinessTask.mockRejectedValue(new Error('Task fail'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('Audit note failed');
      expect(result.errors[1]).toContain('PRE readiness task failed');
    });
  });
});
