/**
 * Tests for Tracking Sync Orchestrator — Opportunity-level doc tracking (Phase 10)
 *
 * Tests cover:
 * - parseContactTrackingFields: valid JSON, missing fields, malformed JSON, numeric strings
 * - parseOpportunityTrackingFields: fieldValueString/fieldValueNumber, missing fields
 * - Opportunity-level tracking:
 *   - Happy path: PRE doc received on single opportunity
 *   - Reusable doc updates ALL open opportunities (cross-deal)
 *   - Property-specific doc updates only matched opportunity (single-deal)
 *   - Property-specific doc with ambiguous deal returns error
 *   - Pipeline stage advances per-opportunity when All Complete
 *   - PRE readiness task created only once even for cross-deal
 *   - Audit note created on contact, not opportunity
 * - Contact fallback when no opportunities
 * - Edge cases: no-contact, no-match, already-received, LATER/CONDITIONAL stage
 * - Error handling: non-fatal audit note, task, pipeline failures
 *
 * All external dependencies are mocked via vi.mock / vi.hoisted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrmContact, CrmOpportunity, CrmOpportunityCustomField, MissingDocEntry } from '../types/index.js';
import { EXISTING_OPP_FIELDS } from '../types/index.js';

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

vi.mock('../checklist-mapper.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    ...mockChecklistMapper,
  };
});

const mockTasks = vi.hoisted(() => ({
  createPreReadinessTask: vi.fn(),
}));

vi.mock('../tasks.js', () => mockTasks);

const mockOpportunities = vi.hoisted(() => ({
  searchOpportunities: vi.fn(),
  getOpportunity: vi.fn(),
  updateOpportunityFields: vi.fn(),
  updateOpportunityStage: vi.fn(),
  getOpportunityFieldValue: vi.fn(),
}));

vi.mock('../opportunities.js', () => mockOpportunities);

// Mock PROPERTY_SPECIFIC_TYPES from doc-expiry
const mockDocExpiry = vi.hoisted(() => ({
  PROPERTY_SPECIFIC_TYPES: new Set([
    'purchase_agreement',
    'mls_listing',
    'property_tax_bill',
    'home_insurance',
    'gift_letter',
    'lease_agreement',
    'mortgage_statement',
  ]),
}));

vi.mock('../../drive/doc-expiry.js', () => mockDocExpiry);

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

const MOCK_OPP_FIELD_IDS = vi.hoisted(() => ({
  docStatus: 'opp-field-doc-status',
  docRequestSent: 'opp-field-doc-request-sent',
  missingDocs: 'opp-field-missing-docs',
  receivedDocs: 'opp-field-received-docs',
  preDocsTotal: 'opp-field-pre-total',
  preDocsReceived: 'opp-field-pre-received',
  fullDocsTotal: 'opp-field-full-total',
  fullDocsReceived: 'opp-field-full-received',
  lastDocReceived: 'opp-field-last-doc-received',
}));

vi.mock('../config.js', () => ({
  crmConfig: {
    fieldIds: MOCK_FIELD_IDS,
    opportunityFieldIds: MOCK_OPP_FIELD_IDS,
    locationId: 'loc-123',
    isDev: false,
    stageIds: {
      applicationReceived: 'stage-app-received',
      collectingDocuments: 'stage-collecting-docs',
      allDocsReceived: 'stage-all-docs-received',
    },
  },
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  updateDocTracking,
  parseContactTrackingFields,
  parseOpportunityTrackingFields,
} from '../tracking-sync.js';
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
 * Creates a CrmOpportunity with opportunity-format custom fields.
 * Fields use fieldValueString/fieldValueNumber format (not contact's { id, value } format).
 */
function makeOpportunity(
  id: string,
  customFields: CrmOpportunityCustomField[] = [],
  overrides: Partial<CrmOpportunity> = {},
): CrmOpportunity {
  return {
    id,
    name: 'Test Deal',
    contactId: 'contact-abc',
    pipelineId: 'pipeline-123',
    pipelineStageId: 'stage-collecting-docs',
    status: 'open',
    customFields,
    ...overrides,
  };
}

/**
 * Builds opportunity custom fields from tracking data in the opportunity format.
 */
function makeOppTrackingFields(opts: {
  missingDocs?: MissingDocEntry[];
  receivedDocs?: string[];
  preDocsTotal?: number;
  preDocsReceived?: number;
  fullDocsTotal?: number;
  fullDocsReceived?: number;
} = {}): CrmOpportunityCustomField[] {
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
  } = opts;

  // Format missingDocs as text (same format the CRM stores)
  const missingText = missingDocs.map((d) => `${d.name} [${d.stage}]`).join('\n');
  const receivedText = receivedDocs.join('\n');

  return [
    { id: MOCK_OPP_FIELD_IDS.missingDocs, fieldValueString: missingText },
    { id: MOCK_OPP_FIELD_IDS.receivedDocs, fieldValueString: receivedText },
    { id: MOCK_OPP_FIELD_IDS.preDocsTotal, fieldValueNumber: preDocsTotal },
    { id: MOCK_OPP_FIELD_IDS.preDocsReceived, fieldValueNumber: preDocsReceived },
    { id: MOCK_OPP_FIELD_IDS.fullDocsTotal, fieldValueNumber: fullDocsTotal },
    { id: MOCK_OPP_FIELD_IDS.fullDocsReceived, fieldValueNumber: fullDocsReceived },
  ];
}

/**
 * Sets up standard happy path for opportunity-level tracking:
 * contact found, 1 open opportunity with tracking fields, doc matched.
 */
function setupOpportunityHappyPath(opts: {
  opportunities?: CrmOpportunity[];
  matchedDoc?: MissingDocEntry | null;
  newStatus?: string;
} = {}) {
  const {
    opportunities = [makeOpportunity('opp-001', makeOppTrackingFields())],
    matchedDoc = { name: 'T4 - Current year', stage: 'PRE' as const },
    newStatus = 'In Progress',
  } = opts;

  const contact = makeContact();

  // Contact resolution
  mockContacts.findContactByEmail.mockResolvedValue('contact-abc');
  mockContacts.getContact.mockResolvedValue(contact);
  mockContacts.upsertContact.mockResolvedValue({ contactId: 'contact-abc', isNew: false });

  // Opportunity search + get
  mockOpportunities.searchOpportunities.mockResolvedValue(opportunities);
  // getOpportunity returns the same as search by default (with full custom fields)
  for (const opp of opportunities) {
    mockOpportunities.getOpportunity.mockResolvedValue(opp);
  }
  mockOpportunities.updateOpportunityFields.mockResolvedValue(undefined);
  mockOpportunities.updateOpportunityStage.mockResolvedValue(undefined);

  // Use real getOpportunityFieldValue implementation
  mockOpportunities.getOpportunityFieldValue.mockImplementation(
    (opp: CrmOpportunity, fieldId: string): string | number | undefined => {
      if (!opp.customFields) return undefined;
      const field = opp.customFields.find((f) => f.id === fieldId);
      if (!field) return undefined;
      if (field.fieldValueString !== undefined && field.fieldValueString !== null) return field.fieldValueString;
      if (field.fieldValueNumber !== undefined && field.fieldValueNumber !== null) return field.fieldValueNumber;
      if (field.fieldValueDate !== undefined && field.fieldValueDate !== null) return field.fieldValueDate;
      return undefined;
    },
  );

  // Doc matching
  mockDocTypeMatcher.findMatchingChecklistDoc.mockReturnValue(matchedDoc);
  mockChecklistMapper.computeDocStatus.mockReturnValue(newStatus);
  mockNotes.createAuditNote.mockResolvedValue('note-xyz');
  mockTasks.createPreReadinessTask.mockResolvedValue('task-123');

  return contact;
}

/**
 * Sets up standard happy path for CONTACT-level fallback:
 * contact found, no opportunities, doc tracked on contact.
 */
function setupContactFallbackPath(opts: {
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

  // No opportunities — triggers contact fallback
  mockOpportunities.searchOpportunities.mockResolvedValue([]);

  mockDocTypeMatcher.findMatchingChecklistDoc.mockReturnValue(matchedDoc);
  mockChecklistMapper.computeDocStatus.mockReturnValue(newStatus);
  mockNotes.createAuditNote.mockResolvedValue('note-xyz');
  mockTasks.createPreReadinessTask.mockResolvedValue('task-123');

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

    it('should handle malformed JSON gracefully — parses as text fallback', () => {
      const contact = makeContact([
        { id: MOCK_FIELD_IDS.missingDocs, value: 'not-valid-json{' },
        { id: MOCK_FIELD_IDS.receivedDocs, value: '{ bad }' },
        { id: MOCK_FIELD_IDS.preDocsTotal, value: 'abc' },
        { id: MOCK_FIELD_IDS.preDocsReceived, value: null },
      ]);

      const result = parseContactTrackingFields(contact, MOCK_FIELD_IDS);

      // Text parser treats non-JSON as plain text lines (backward-compatible fallback)
      expect(result.missingDocs).toHaveLength(1); // 'not-valid-json{' parsed as one line
      expect(result.receivedDocs).toHaveLength(1); // '{ bad }' parsed as one line
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

    it('should parse non-JSON text as plain text lines', () => {
      const contact = makeContact([
        { id: MOCK_FIELD_IDS.missingDocs, value: '"just a string"' },
        { id: MOCK_FIELD_IDS.receivedDocs, value: '42' },
      ]);

      const result = parseContactTrackingFields(contact, MOCK_FIELD_IDS);

      // Text parser treats these as plain text (one line each)
      expect(result.missingDocs).toHaveLength(1);
      expect(result.receivedDocs).toHaveLength(1);
    });
  });

  // =========================================================================
  // parseOpportunityTrackingFields
  // =========================================================================

  describe('parseOpportunityTrackingFields', () => {
    // Need real getOpportunityFieldValue for these tests
    beforeEach(() => {
      mockOpportunities.getOpportunityFieldValue.mockImplementation(
        (opp: CrmOpportunity, fieldId: string): string | number | undefined => {
          if (!opp.customFields) return undefined;
          const field = opp.customFields.find((f) => f.id === fieldId);
          if (!field) return undefined;
          if (field.fieldValueString !== undefined && field.fieldValueString !== null) return field.fieldValueString;
          if (field.fieldValueNumber !== undefined && field.fieldValueNumber !== null) return field.fieldValueNumber;
          if (field.fieldValueDate !== undefined && field.fieldValueDate !== null) return field.fieldValueDate;
          return undefined;
        },
      );
    });

    it('should parse fieldValueString and fieldValueNumber correctly', () => {
      const missingDocs = makeMissingDocs([
        { name: 'T4 - Current year', stage: 'PRE' },
        { name: 'NOA', stage: 'FULL' },
      ]);
      const missingText = missingDocs.map((d) => `${d.name} [${d.stage}]`).join('\n');

      const opp = makeOpportunity('opp-1', [
        { id: MOCK_OPP_FIELD_IDS.missingDocs, fieldValueString: missingText },
        { id: MOCK_OPP_FIELD_IDS.receivedDocs, fieldValueString: 'LOE\nPay Stub' },
        { id: MOCK_OPP_FIELD_IDS.preDocsTotal, fieldValueNumber: 5 },
        { id: MOCK_OPP_FIELD_IDS.preDocsReceived, fieldValueNumber: 2 },
        { id: MOCK_OPP_FIELD_IDS.fullDocsTotal, fieldValueNumber: 3 },
        { id: MOCK_OPP_FIELD_IDS.fullDocsReceived, fieldValueNumber: 1 },
      ]);

      const result = parseOpportunityTrackingFields(opp, MOCK_OPP_FIELD_IDS);

      expect(result.missingDocs).toEqual(missingDocs);
      expect(result.receivedDocs).toEqual(['LOE', 'Pay Stub']);
      expect(result.preDocsTotal).toBe(5);
      expect(result.preDocsReceived).toBe(2);
      expect(result.fullDocsTotal).toBe(3);
      expect(result.fullDocsReceived).toBe(1);
    });

    it('should handle missing fields with safe defaults', () => {
      const opp = makeOpportunity('opp-1', []); // no tracking fields

      const result = parseOpportunityTrackingFields(opp, MOCK_OPP_FIELD_IDS);

      expect(result.missingDocs).toEqual([]);
      expect(result.receivedDocs).toEqual([]);
      expect(result.preDocsTotal).toBe(0);
      expect(result.preDocsReceived).toBe(0);
      expect(result.fullDocsTotal).toBe(0);
      expect(result.fullDocsReceived).toBe(0);
    });

    it('should handle undefined customFields array', () => {
      const opp: CrmOpportunity = { id: 'opp-1' }; // no customFields property

      const result = parseOpportunityTrackingFields(opp, MOCK_OPP_FIELD_IDS);

      expect(result.missingDocs).toEqual([]);
      expect(result.receivedDocs).toEqual([]);
      expect(result.preDocsTotal).toBe(0);
    });
  });

  // =========================================================================
  // updateDocTracking — Opportunity-level happy path
  // =========================================================================

  describe('updateDocTracking — opportunity-level happy path', () => {
    it('should update tracking on opportunity when PRE doc received', async () => {
      setupOpportunityHappyPath({ newStatus: 'In Progress' });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.contactId).toBe('contact-abc');
      expect(result.opportunityId).toBe('opp-001');
      expect(result.trackingTarget).toBe('opportunity');
      expect(result.newStatus).toBe('In Progress');
      expect(result.noteId).toBe('note-xyz');
      expect(result.errors).toEqual([]);

      // Verify updateOpportunityFields was called (not upsertContact for tracking)
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledWith(
        'opp-001',
        expect.arrayContaining([
          expect.objectContaining({ id: MOCK_OPP_FIELD_IDS.preDocsReceived, field_value: 2 }), // 1 + 1
        ]),
      );

      // upsertContact should NOT be called for opportunity-level tracking
      expect(mockContacts.upsertContact).not.toHaveBeenCalled();
    });

    it('should create audit note on contact with matched doc name', async () => {
      setupOpportunityHappyPath();

      await updateDocTracking(makeInput());

      expect(mockNotes.createAuditNote).toHaveBeenCalledWith('contact-abc', {
        documentType: 'T4 - Current year',
        source: 'gmail',
        driveFileId: 'drive-file-789',
      });
    });

    it('should compute new status using computeDocStatus', async () => {
      setupOpportunityHappyPath();

      await updateDocTracking(makeInput());

      // Called with updated preDocsReceived (1+1=2)
      expect(mockChecklistMapper.computeDocStatus).toHaveBeenCalledWith(3, 2, 2, 0);
    });
  });

  // =========================================================================
  // updateDocTracking — Cross-deal reuse (reusable docs)
  // =========================================================================

  describe('updateDocTracking — cross-deal reuse', () => {
    it('should update ALL open opportunities for reusable doc', async () => {
      const opp1 = makeOpportunity('opp-001', makeOppTrackingFields());
      const opp2 = makeOpportunity('opp-002', makeOppTrackingFields());

      setupOpportunityHappyPath({ opportunities: [opp1, opp2] });

      // getOpportunity must return different opps for different IDs
      mockOpportunities.getOpportunity
        .mockResolvedValueOnce(opp1) // first call for opp-001
        .mockResolvedValueOnce(opp2); // second call for opp-002

      const result = await updateDocTracking(makeInput({ documentType: 't4' })); // t4 is reusable

      expect(result.updated).toBe(true);
      expect(result.crossDealUpdates).toBe(2);
      expect(result.trackingTarget).toBe('opportunity');

      // updateOpportunityFields called TWICE (once per opportunity)
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledTimes(2);
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledWith('opp-001', expect.any(Array));
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledWith('opp-002', expect.any(Array));
    });

    it('should create audit note only once for cross-deal update', async () => {
      const opp1 = makeOpportunity('opp-001', makeOppTrackingFields());
      const opp2 = makeOpportunity('opp-002', makeOppTrackingFields());

      setupOpportunityHappyPath({ opportunities: [opp1, opp2] });
      mockOpportunities.getOpportunity
        .mockResolvedValueOnce(opp1)
        .mockResolvedValueOnce(opp2);

      await updateDocTracking(makeInput());

      // Audit note created on contact, only once
      expect(mockNotes.createAuditNote).toHaveBeenCalledTimes(1);
      expect(mockNotes.createAuditNote).toHaveBeenCalledWith('contact-abc', expect.any(Object));
    });
  });

  // =========================================================================
  // updateDocTracking — Property-specific docs (single-deal)
  // =========================================================================

  describe('updateDocTracking — property-specific docs', () => {
    it('should update only matched opportunity for property-specific doc', async () => {
      const opp1 = makeOpportunity('opp-001', [
        ...makeOppTrackingFields({
          missingDocs: makeMissingDocs([
            { name: 'Purchase Agreement', stage: 'FULL' },
            { name: 'T4 - Current year', stage: 'PRE' },
          ]),
        }),
        { id: EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID, fieldValueString: 'finmo-app-111' },
      ]);
      const opp2 = makeOpportunity('opp-002', [
        ...makeOppTrackingFields(),
        { id: EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID, fieldValueString: 'finmo-app-222' },
      ]);

      setupOpportunityHappyPath({
        opportunities: [opp1, opp2],
        matchedDoc: { name: 'Purchase Agreement', stage: 'FULL' },
      });

      // getOpportunityFieldValue for resolving target: match by Finmo App ID
      // The implementation mock handles both opportunity and tracking field lookups
      mockOpportunities.getOpportunityFieldValue.mockImplementation(
        (opp: CrmOpportunity, fieldId: string): string | number | undefined => {
          if (!opp.customFields) return undefined;
          const field = opp.customFields.find((f) => f.id === fieldId);
          if (!field) return undefined;
          if (field.fieldValueString !== undefined && field.fieldValueString !== null) return field.fieldValueString;
          if (field.fieldValueNumber !== undefined && field.fieldValueNumber !== null) return field.fieldValueNumber;
          return undefined;
        },
      );

      mockOpportunities.getOpportunity.mockResolvedValue(opp1);

      const result = await updateDocTracking(makeInput({
        documentType: 'purchase_agreement',
        finmoApplicationId: 'finmo-app-111',
      }));

      expect(result.updated).toBe(true);
      // Should only update opp-001 (matched by Finmo app ID)
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledTimes(1);
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledWith('opp-001', expect.any(Array));
    });

    it('should return ambiguous-deal when property-specific doc has multiple deals and no finmoApplicationId', async () => {
      const opp1 = makeOpportunity('opp-001', makeOppTrackingFields());
      const opp2 = makeOpportunity('opp-002', makeOppTrackingFields());

      setupOpportunityHappyPath({ opportunities: [opp1, opp2] });

      const result = await updateDocTracking(makeInput({
        documentType: 'mls_listing', // property-specific
        // No finmoApplicationId provided
      }));

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('ambiguous-deal');
      expect(result.contactId).toBe('contact-abc');
      expect(mockOpportunities.updateOpportunityFields).not.toHaveBeenCalled();
    });

    it('should use single opportunity without finmoApplicationId when only one exists', async () => {
      const opp1 = makeOpportunity('opp-001', makeOppTrackingFields({
        missingDocs: makeMissingDocs([
          { name: 'Purchase Agreement', stage: 'FULL' },
        ]),
      }));

      setupOpportunityHappyPath({
        opportunities: [opp1],
        matchedDoc: { name: 'Purchase Agreement', stage: 'FULL' },
      });

      const result = await updateDocTracking(makeInput({
        documentType: 'purchase_agreement',
        // No finmoApplicationId — but only 1 opp, so unambiguous
      }));

      expect(result.updated).toBe(true);
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // updateDocTracking — Pipeline stage advances
  // =========================================================================

  describe('updateDocTracking — pipeline stage advance', () => {
    it('should advance pipeline stage per-opportunity when All Complete', async () => {
      setupOpportunityHappyPath({ newStatus: 'All Complete' });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(mockOpportunities.updateOpportunityStage).toHaveBeenCalledWith(
        'opp-001',
        'stage-all-docs-received',
      );
    });

    it('should not advance pipeline for In Progress status', async () => {
      setupOpportunityHappyPath({ newStatus: 'In Progress' });

      await updateDocTracking(makeInput());

      expect(mockOpportunities.updateOpportunityStage).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateDocTracking — PRE readiness task
  // =========================================================================

  describe('updateDocTracking — PRE readiness task', () => {
    it('should create PRE readiness task when status becomes PRE Complete', async () => {
      setupOpportunityHappyPath({ newStatus: 'PRE Complete' });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(mockTasks.createPreReadinessTask).toHaveBeenCalledWith(
        'contact-abc',
        'Terry Smith',
      );
    });

    it('should create PRE readiness task only once even for cross-deal updates', async () => {
      const opp1 = makeOpportunity('opp-001', makeOppTrackingFields());
      const opp2 = makeOpportunity('opp-002', makeOppTrackingFields());
      const opp3 = makeOpportunity('opp-003', makeOppTrackingFields());

      setupOpportunityHappyPath({
        opportunities: [opp1, opp2, opp3],
        newStatus: 'PRE Complete',
      });

      mockOpportunities.getOpportunity
        .mockResolvedValueOnce(opp1)
        .mockResolvedValueOnce(opp2)
        .mockResolvedValueOnce(opp3);

      await updateDocTracking(makeInput());

      // PRE task created exactly ONCE despite 3 opportunities reaching PRE Complete
      expect(mockTasks.createPreReadinessTask).toHaveBeenCalledTimes(1);
    });

    it('should not create PRE readiness task for All Complete status', async () => {
      setupOpportunityHappyPath({ newStatus: 'All Complete' });

      await updateDocTracking(makeInput());

      expect(mockTasks.createPreReadinessTask).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateDocTracking — Contact fallback
  // =========================================================================

  describe('updateDocTracking — contact fallback', () => {
    it('should fall back to contact tracking when no opportunities exist', async () => {
      setupContactFallbackPath({ newStatus: 'In Progress' });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.trackingTarget).toBe('contact');
      expect(result.contactId).toBe('contact-abc');
      expect(result.newStatus).toBe('In Progress');
      expect(result.errors).toEqual([]);

      // upsertContact called with doc tracking fields
      expect(mockContacts.upsertContact).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'borrower@example.com',
          customFields: expect.arrayContaining([
            expect.objectContaining({ id: MOCK_FIELD_IDS.preDocsReceived, field_value: 2 }), // 1 + 1
          ]),
        }),
      );

      // Opportunity functions not called for tracking
      expect(mockOpportunities.updateOpportunityFields).not.toHaveBeenCalled();
    });

    it('should create PRE readiness task in contact fallback', async () => {
      setupContactFallbackPath({ newStatus: 'PRE Complete' });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.trackingTarget).toBe('contact');
      expect(mockTasks.createPreReadinessTask).toHaveBeenCalledWith(
        'contact-abc',
        'Terry Smith',
      );
    });

    it('should create audit note in contact fallback', async () => {
      setupContactFallbackPath();

      await updateDocTracking(makeInput());

      expect(mockNotes.createAuditNote).toHaveBeenCalledWith('contact-abc', {
        documentType: 'T4 - Current year',
        source: 'gmail',
        driveFileId: 'drive-file-789',
      });
    });
  });

  // =========================================================================
  // updateDocTracking — Edge cases
  // =========================================================================

  describe('updateDocTracking — edge cases', () => {
    it('should use provided contactId and skip findContactByEmail', async () => {
      setupOpportunityHappyPath();

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

    it('should return no-match-in-checklist when doc type not in any opportunity checklist', async () => {
      setupOpportunityHappyPath({ matchedDoc: null });

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(false);
      expect(result.reason).toBe('no-match-in-checklist');
      expect(result.errors).toEqual([]);
      expect(mockOpportunities.updateOpportunityFields).not.toHaveBeenCalled();
    });

    it('should skip already-received docs on opportunity (return no-match when all skip)', async () => {
      // Set up opportunity where the doc is already in receivedDocs
      const opp = makeOpportunity('opp-001', makeOppTrackingFields({
        receivedDocs: ['Letter of Employment', 'T4 - Current year'],
      }));

      setupOpportunityHappyPath({
        opportunities: [opp],
        matchedDoc: { name: 'T4 - Current year', stage: 'PRE' },
      });

      const result = await updateDocTracking(makeInput());

      // Doc is already received — no update happens, treated as no-match
      expect(result.updated).toBe(false);
      expect(result.reason).toBe('no-match-in-checklist');
      expect(mockOpportunities.updateOpportunityFields).not.toHaveBeenCalled();
    });

    it('should not increment either counter for LATER stage doc', async () => {
      setupOpportunityHappyPath({
        matchedDoc: { name: 'Gift letter', stage: 'LATER' },
        newStatus: 'In Progress',
      });

      const result = await updateDocTracking(makeInput({ documentType: 'gift_letter' }));

      // gift_letter is in PROPERTY_SPECIFIC_TYPES, so single-deal mode with 1 opp
      expect(result.updated).toBe(true);

      // computeDocStatus should be called with unchanged counter values
      expect(mockChecklistMapper.computeDocStatus).toHaveBeenCalledWith(
        3, 1, // preTotal, preReceived unchanged
        2, 0, // fullTotal, fullReceived unchanged
      );
    });

    it('should not increment either counter for CONDITIONAL stage doc on contact fallback', async () => {
      setupContactFallbackPath({
        matchedDoc: { name: 'Separation agreement', stage: 'CONDITIONAL' },
        newStatus: 'In Progress',
      });

      const result = await updateDocTracking(makeInput({ documentType: 'separation_agreement' }));

      expect(result.updated).toBe(true);
      expect(result.trackingTarget).toBe('contact');

      expect(mockChecklistMapper.computeDocStatus).toHaveBeenCalledWith(
        3, 1, // unchanged
        2, 0, // unchanged
      );
    });

    it('should filter to only open opportunities', async () => {
      const openOpp = makeOpportunity('opp-001', makeOppTrackingFields(), { status: 'open' });
      const closedOpp = makeOpportunity('opp-002', makeOppTrackingFields(), { status: 'won' });

      setupOpportunityHappyPath({ opportunities: [openOpp, closedOpp] });
      mockOpportunities.getOpportunity.mockResolvedValue(openOpp);

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      // Only the open opportunity should be updated
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledTimes(1);
      expect(mockOpportunities.updateOpportunityFields).toHaveBeenCalledWith('opp-001', expect.any(Array));
    });
  });

  // =========================================================================
  // updateDocTracking — Error handling (non-fatal)
  // =========================================================================

  describe('updateDocTracking — error handling', () => {
    it('should still return updated=true when audit note creation fails', async () => {
      setupOpportunityHappyPath();
      mockNotes.createAuditNote.mockRejectedValue(new Error('Notes API offline'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.noteId).toBeUndefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Audit note failed');
      expect(result.errors[0]).toContain('Notes API offline');
    });

    it('should still return updated=true when PRE readiness task creation fails', async () => {
      setupOpportunityHappyPath({ newStatus: 'PRE Complete' });
      mockTasks.createPreReadinessTask.mockRejectedValue(new Error('Task API error'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('PRE readiness task failed');
      expect(result.errors[0]).toContain('Task API error');
    });

    it('should still return updated=true when pipeline advance fails', async () => {
      setupOpportunityHappyPath({ newStatus: 'All Complete' });
      mockOpportunities.updateOpportunityStage.mockRejectedValue(new Error('Pipeline API down'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Pipeline advance failed');
      expect(result.errors[0]).toContain('Pipeline API down');
    });

    it('should collect multiple non-fatal errors', async () => {
      setupOpportunityHappyPath({ newStatus: 'PRE Complete' });
      mockNotes.createAuditNote.mockRejectedValue(new Error('Note fail'));
      mockTasks.createPreReadinessTask.mockRejectedValue(new Error('Task fail'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('PRE readiness task failed'); // PRE task runs before audit note
      expect(result.errors[1]).toContain('Audit note failed');
    });

    it('should still return updated=true when contact fallback audit note fails', async () => {
      setupContactFallbackPath();
      mockNotes.createAuditNote.mockRejectedValue(new Error('Notes API offline'));

      const result = await updateDocTracking(makeInput());

      expect(result.updated).toBe(true);
      expect(result.trackingTarget).toBe('contact');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Audit note failed');
    });
  });
});
