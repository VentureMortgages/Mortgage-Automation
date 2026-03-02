/**
 * Tests for Classification Worker — Document Classification Pipeline
 *
 * Tests cover:
 * - Full pipeline success: classify -> match -> route -> upload -> filed=true
 * - Match outcome: auto_filed -> CRM note with reasoning (MATCH-03)
 * - Match outcome: needs_review -> global Needs Review/ with CRM task (MATCH-04)
 * - Match outcome: conflict -> global Needs Review/ with CRM task
 * - Match outcome: auto_created -> autoCreateFromDoc creates contact + folder
 * - Match outcome: error -> legacy resolveContactId fallback
 * - Low confidence classification -> manual review: CRM task created, filed=false
 * - Existing file found -> update instead of upload (FILE-04 versioning)
 * - Classification error -> caught gracefully, error in result
 * - Drive upload error -> caught gracefully, error in result
 * - Temp file cleaned up after success and error
 * - Missing client folder -> manual review
 *
 * All external dependencies are mocked via vi.mock / vi.hoisted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ClassificationJobData, ClassificationResult } from '../types.js';
import type { MatchDecision } from '../../matching/types.js';

// ---------------------------------------------------------------------------
// Module-level mocks (vi.hoisted)
// ---------------------------------------------------------------------------

const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:fs/promises', () => mockFs);

const mockConfig = vi.hoisted(() => ({
  classificationConfig: {
    confidenceThreshold: 0.7,
    driveRootFolderId: 'root-folder-123',
    enabled: true,
    geminiApiKey: 'test-key',
    model: 'gemini-2.0-flash',
    maxClassificationPages: 3,
    driveImpersonateAs: 'dev@test.com',
  },
}));

vi.mock('../config.js', () => mockConfig);

const mockClassifier = vi.hoisted(() => ({
  classifyDocument: vi.fn(),
}));

vi.mock('../classifier.js', () => mockClassifier);

const mockNaming = vi.hoisted(() => ({
  generateFilename: vi.fn(),
}));

vi.mock('../naming.js', () => mockNaming);

const mockRouter = vi.hoisted(() => ({
  routeToSubfolder: vi.fn(),
  getPersonSubfolderName: vi.fn(),
}));

vi.mock('../router.js', () => mockRouter);

const mockDriveClient = vi.hoisted(() => ({
  getDriveClient: vi.fn(),
}));

vi.mock('../drive-client.js', () => mockDriveClient);

const mockFiler = vi.hoisted(() => ({
  resolveTargetFolder: vi.fn(),
  uploadFile: vi.fn(),
  findExistingFile: vi.fn(),
  updateFileContent: vi.fn(),
  findOrCreateFolder: vi.fn(),
}));

vi.mock('../filer.js', () => mockFiler);

const mockOriginals = vi.hoisted(() => ({
  storeOriginal: vi.fn(),
}));

vi.mock('../../drive/originals.js', () => mockOriginals);

const mockContacts = vi.hoisted(() => ({
  resolveContactId: vi.fn(),
  getContact: vi.fn(),
  getContactDriveFolderId: vi.fn(),
  extractDriveFolderId: vi.fn((v: string) => v),
}));

vi.mock('../../crm/contacts.js', () => mockContacts);

const mockCrmConfig = vi.hoisted(() => ({
  crmConfig: {
    driveFolderIdFieldId: 'field-drive-folder-id',
    oppDealSubfolderIdFieldId: 'field-deal-subfolder-id',
  },
}));

vi.mock('../../crm/config.js', () => mockCrmConfig);

const mockOpportunities = vi.hoisted(() => ({
  findOpportunityByFinmoId: vi.fn(),
  getOpportunityFieldValue: vi.fn(),
}));

vi.mock('../../crm/opportunities.js', () => mockOpportunities);

vi.mock('../../crm/types/index.js', () => ({
  PIPELINE_IDS: { LIVE_DEALS: 'pipeline-live-deals' },
}));

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

const mockTasks = vi.hoisted(() => ({
  createReviewTask: vi.fn(),
}));

vi.mock('../../crm/tasks.js', () => mockTasks);

const mockNotes = vi.hoisted(() => ({
  createCrmNote: vi.fn(),
  createAuditNote: vi.fn(),
}));

vi.mock('../../crm/notes.js', () => mockNotes);

const mockTrackingSync = vi.hoisted(() => ({
  updateDocTracking: vi.fn(),
}));

vi.mock('../../crm/tracking-sync.js', () => mockTrackingSync);

const mockMatchAgent = vi.hoisted(() => ({
  matchDocument: vi.fn(),
}));

vi.mock('../../matching/agent.js', () => mockMatchAgent);

const mockAutoCreate = vi.hoisted(() => ({
  autoCreateFromDoc: vi.fn(),
}));

vi.mock('../../matching/auto-create.js', () => mockAutoCreate);

vi.mock('../../webhook/queue.js', () => ({
  createRedisConnection: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { processClassificationJob, CLASSIFICATION_QUEUE_NAME } from '../classification-worker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockClassificationResult(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    documentType: 't4',
    confidence: 0.95,
    borrowerFirstName: 'Terry',
    borrowerLastName: 'Smith',
    taxYear: 2024,
    amount: '$16k',
    institution: 'CIBC',
    pageCount: 2,
    additionalNotes: null,
    ...overrides,
  };
}

function mockJob(overrides: Partial<ClassificationJobData> = {}): Job<ClassificationJobData> {
  return {
    data: {
      intakeDocumentId: 'gmail-msg123-0',
      tempFilePath: '/tmp/intake-abc123.pdf',
      originalFilename: 'T4_2024.pdf',
      senderEmail: 'client@example.com',
      applicationId: null,
      source: 'gmail',
      receivedAt: '2026-02-15T12:00:00Z',
      ...overrides,
    },
    id: 'job-1',
  } as unknown as Job<ClassificationJobData>;
}

function mockMatchDecisionAutoFiled(overrides: Partial<MatchDecision> = {}): MatchDecision {
  return {
    intakeDocumentId: 'gmail-msg123-0',
    signals: [{ type: 'sender_email', value: 'client@example.com', contactId: 'contact-abc', confidence: 0.9, tier: 1 }],
    candidates: [{ contactId: 'contact-abc', contactName: 'Terry Smith', signals: [], confidence: 0.9 }],
    chosenContactId: 'contact-abc',
    chosenOpportunityId: null,
    chosenDriveFolderId: null,
    confidence: 0.9,
    reasoning: 'Sender email matched CRM contact',
    outcome: 'auto_filed',
    timestamp: new Date().toISOString(),
    durationMs: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classification-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock returns
    mockFs.readFile.mockResolvedValue(Buffer.from('fake-pdf'));
    mockFs.unlink.mockResolvedValue(undefined);
    mockClassifier.classifyDocument.mockResolvedValue(mockClassificationResult());
    mockNaming.generateFilename.mockReturnValue('Terry - T4 CIBC 2024 $16k.pdf');
    mockRouter.routeToSubfolder.mockReturnValue('person');
    mockRouter.getPersonSubfolderName.mockReturnValue('Terry');
    mockDriveClient.getDriveClient.mockReturnValue({});
    mockFiler.resolveTargetFolder.mockResolvedValue('target-folder-456');
    mockFiler.findExistingFile.mockResolvedValue(null);
    mockFiler.uploadFile.mockResolvedValue('drive-file-789');
    mockFiler.findOrCreateFolder.mockResolvedValue('needs-review-folder-id');
    mockOriginals.storeOriginal.mockResolvedValue('original-file-id');

    // Default: matchDocument returns auto_filed with a contact
    mockMatchAgent.matchDocument.mockResolvedValue(mockMatchDecisionAutoFiled());

    // Default: getContact returns a contact without Drive folder ID (fallback to root)
    mockContacts.getContact.mockResolvedValue({
      id: 'contact-abc',
      email: 'client@example.com',
      firstName: 'Terry',
      lastName: 'Smith',
      customFields: [],
    });
    // Default: no Drive folder ID on contact (triggers fallback to DRIVE_ROOT_FOLDER_ID)
    mockContacts.getContactDriveFolderId.mockReturnValue(null);
    // Legacy fallback
    mockContacts.resolveContactId.mockResolvedValue({ contactId: 'contact-abc', resolvedVia: 'email' });
    // Default: no opportunity match
    mockOpportunities.findOpportunityByFinmoId.mockResolvedValue(null);
    mockOpportunities.getOpportunityFieldValue.mockReturnValue(undefined);
    mockTasks.createReviewTask.mockResolvedValue('task-xyz');
    mockNotes.createCrmNote.mockResolvedValue('note-xyz');
    mockTrackingSync.updateDocTracking.mockResolvedValue({
      updated: true,
      contactId: 'contact-abc',
      newStatus: 'In Progress',
      noteId: 'note-xyz',
      errors: [],
    });
    mockAutoCreate.autoCreateFromDoc.mockResolvedValue({
      contactId: 'new-contact-1',
      driveFolderId: 'new-folder-1',
    });
  });

  describe('CLASSIFICATION_QUEUE_NAME', () => {
    it('should be doc-classification', () => {
      expect(CLASSIFICATION_QUEUE_NAME).toBe('doc-classification');
    });
  });

  describe('processClassificationJob', () => {
    it('should process full pipeline: classify -> match -> route -> upload', async () => {
      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(true);
      expect(result.manualReview).toBe(false);
      expect(result.driveFileId).toBe('drive-file-789');
      expect(result.error).toBeNull();
      expect(result.intakeDocumentId).toBe('gmail-msg123-0');
      expect(result.classification).toEqual(mockClassificationResult());

      // Verify pipeline calls
      expect(mockFs.readFile).toHaveBeenCalledWith('/tmp/intake-abc123.pdf');
      expect(mockClassifier.classifyDocument).toHaveBeenCalledWith(
        Buffer.from('fake-pdf'),
        'T4_2024.pdf',
      );
      expect(mockMatchAgent.matchDocument).toHaveBeenCalled();
      expect(mockNaming.generateFilename).toHaveBeenCalled();
      expect(mockRouter.routeToSubfolder).toHaveBeenCalledWith('t4');
      expect(mockFiler.uploadFile).toHaveBeenCalled();
    });

    it('should pass thread metadata to matchDocument', async () => {
      const job = mockJob({
        threadId: 'thread-123',
        ccAddresses: ['cc@example.com'],
        emailSubject: 'Re: Documents for Smith',
      });
      await processClassificationJob(job);

      expect(mockMatchAgent.matchDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-123',
          ccAddresses: ['cc@example.com'],
          emailSubject: 'Re: Documents for Smith',
        }),
      );
    });

    // -----------------------------------------------------------------
    // MATCH-03: auto_filed -> CRM note with reasoning
    // -----------------------------------------------------------------

    describe('auto_filed outcome (MATCH-03)', () => {
      it('creates CRM note (not task) with reasoning for auto-filed docs', async () => {
        const job = mockJob();
        await processClassificationJob(job);

        // CRM note with reasoning
        expect(mockNotes.createCrmNote).toHaveBeenCalledWith(
          'contact-abc',
          expect.stringContaining('Matched: Sender email matched CRM contact'),
        );
        expect(mockNotes.createCrmNote).toHaveBeenCalledWith(
          'contact-abc',
          expect.stringContaining('confidence: 0.90'),
        );
        // Should NOT create a review task for auto_filed
        expect(mockTasks.createReviewTask).not.toHaveBeenCalled();
      });

      it('CRM note includes doc type label', async () => {
        const job = mockJob();
        await processClassificationJob(job);

        expect(mockNotes.createCrmNote).toHaveBeenCalledWith(
          'contact-abc',
          expect.stringContaining('T4'),
        );
      });

      it('CRM note failure is non-fatal', async () => {
        mockNotes.createCrmNote.mockRejectedValue(new Error('CRM offline'));

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        expect(result.error).toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // MATCH-04: needs_review -> global Needs Review/ with CRM task
    // -----------------------------------------------------------------

    describe('needs_review outcome (MATCH-04)', () => {
      beforeEach(() => {
        mockMatchAgent.matchDocument.mockResolvedValue(mockMatchDecisionAutoFiled({
          outcome: 'needs_review',
          confidence: 0.5,
          reasoning: 'Low confidence sender match',
          chosenContactId: 'contact-abc',
          chosenDriveFolderId: null,
        }));
      });

      it('routes to global Needs Review/ at Drive root', async () => {
        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(false);
        expect(result.manualReview).toBe(true);
        // findOrCreateFolder called with DRIVE_ROOT_FOLDER_ID for global Needs Review
        expect(mockFiler.findOrCreateFolder).toHaveBeenCalledWith(
          expect.anything(),
          'Needs Review',
          'root-folder-123',
        );
      });

      it('creates CRM task with signals and Drive link', async () => {
        const job = mockJob();
        await processClassificationJob(job);

        expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
          'contact-abc',
          'Match Review: T4_2024.pdf',
          expect.stringContaining('https://drive.google.com/file/d/'),
        );
      });

      it('includes confidence percentage in CRM task', async () => {
        const job = mockJob();
        await processClassificationJob(job);

        expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.stringContaining('50%'),
        );
      });

      it('does NOT create CRM note for needs_review', async () => {
        const job = mockJob();
        await processClassificationJob(job);

        expect(mockNotes.createCrmNote).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------
    // conflict outcome -> same as needs_review (global Needs Review/)
    // -----------------------------------------------------------------

    describe('conflict outcome', () => {
      it('routes to global Needs Review/ with CRM task', async () => {
        mockMatchAgent.matchDocument.mockResolvedValue(mockMatchDecisionAutoFiled({
          outcome: 'conflict',
          confidence: 0.6,
          reasoning: 'CONFLICT: Sender vs doc name mismatch',
          chosenContactId: 'contact-abc',
        }));

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(false);
        expect(result.manualReview).toBe(true);
        expect(mockFiler.findOrCreateFolder).toHaveBeenCalledWith(
          expect.anything(),
          'Needs Review',
          'root-folder-123',
        );
        expect(mockTasks.createReviewTask).toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------
    // auto_created outcome -> calls autoCreateFromDoc
    // -----------------------------------------------------------------

    describe('auto_created outcome (MATCH-02 edge case)', () => {
      beforeEach(() => {
        mockMatchAgent.matchDocument.mockResolvedValue(mockMatchDecisionAutoFiled({
          outcome: 'auto_created',
          chosenContactId: null,
          chosenDriveFolderId: null,
          confidence: 0,
          reasoning: 'No matching contact found',
          candidates: [],
          signals: [],
        }));
      });

      it('calls autoCreateFromDoc and uses returned contactId/driveFolderId', async () => {
        mockAutoCreate.autoCreateFromDoc.mockResolvedValue({
          contactId: 'new-contact-1',
          driveFolderId: 'new-folder-1',
        });

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(mockAutoCreate.autoCreateFromDoc).toHaveBeenCalledWith({
          classificationResult: expect.any(Object),
          senderEmail: 'client@example.com',
          originalFilename: 'T4_2024.pdf',
        });
        // Should file to the new folder, not root
        expect(result.filed).toBe(true);
      });

      it('does NOT use matchDecision.chosenContactId (which is null for auto_created)', async () => {
        const job = mockJob();
        await processClassificationJob(job);

        // autoCreateFromDoc must be called (not skip it because chosenContactId is null)
        expect(mockAutoCreate.autoCreateFromDoc).toHaveBeenCalled();
      });

      it('routes to global Needs Review/ when autoCreateFromDoc returns null', async () => {
        mockAutoCreate.autoCreateFromDoc.mockResolvedValue(null);

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(false);
        expect(result.manualReview).toBe(true);
        // Should upload to global Needs Review
        expect(mockFiler.findOrCreateFolder).toHaveBeenCalledWith(
          expect.anything(),
          'Needs Review',
          'root-folder-123',
        );
      });
    });

    // -----------------------------------------------------------------
    // error outcome -> falls back to legacy resolveContactId
    // -----------------------------------------------------------------

    describe('error outcome (graceful degradation)', () => {
      it('falls back to legacy resolveContactId on matching error', async () => {
        mockMatchAgent.matchDocument.mockResolvedValue(mockMatchDecisionAutoFiled({
          outcome: 'error',
          chosenContactId: null,
          chosenDriveFolderId: null,
          confidence: 0,
          reasoning: 'Gemini API timeout',
        }));

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(mockContacts.resolveContactId).toHaveBeenCalledWith({
          senderEmail: 'client@example.com',
          borrowerFirstName: 'Terry',
          borrowerLastName: 'Smith',
        });
        expect(result.filed).toBe(true);
      });
    });

    // -----------------------------------------------------------------
    // Low confidence classification (FILE-05 + ORIG-02) — separate from matching
    // -----------------------------------------------------------------

    it('should route low-confidence classification to Needs Review (FILE-05 + ORIG-02)', async () => {
      mockClassifier.classifyDocument.mockResolvedValue(
        mockClassificationResult({ confidence: 0.3 }),
      );

      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(false);
      expect(result.manualReview).toBe(true);
      // driveFileId now contains the Needs Review file ID (ORIG-02)
      expect(result.driveFileId).toBe('drive-file-789');
      expect(result.error).toBeNull();
      expect(result.classification?.confidence).toBe(0.3);

      // CRM task should be created
      expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
        'contact-abc',
        'Manual Review: T4_2024.pdf',
        expect.stringContaining('https://drive.google.com/file/d/drive-file-789/view'),
      );
    });

    it('should update existing file instead of uploading (FILE-04 versioning)', async () => {
      mockFiler.findExistingFile.mockResolvedValue({
        id: 'existing-file-111',
        name: 'Terry - T4 CIBC 2023 $15k.pdf',
      });

      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(true);
      expect(result.driveFileId).toBe('existing-file-111');

      // updateFileContent should be called, not uploadFile for filing
      expect(mockFiler.updateFileContent).toHaveBeenCalledWith(
        expect.anything(), // drive client
        'existing-file-111',
        Buffer.from('fake-pdf'),
        'Terry - T4 CIBC 2024 $16k.pdf',
      );
    });

    it('should catch classification errors gracefully', async () => {
      mockClassifier.classifyDocument.mockRejectedValue(new Error('Claude API timeout'));

      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(false);
      expect(result.manualReview).toBe(false);
      expect(result.error).toBe('Claude API timeout');
      expect(result.classification).toBeNull();
    });

    it('should catch Drive upload errors gracefully', async () => {
      mockFiler.uploadFile.mockRejectedValue(new Error('Drive API quota exceeded'));

      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(false);
      expect(result.error).toBe('Drive API quota exceeded');
    });

    it('should clean up temp file after successful processing', async () => {
      const job = mockJob();
      await processClassificationJob(job);

      expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/intake-abc123.pdf');
    });

    it('should clean up temp file even when pipeline fails', async () => {
      mockClassifier.classifyDocument.mockRejectedValue(new Error('API error'));

      const job = mockJob();
      await processClassificationJob(job);

      expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/intake-abc123.pdf');
    });

    it('should route to manual review when no client folder can be resolved', async () => {
      // No driveRootFolderId configured
      mockConfig.classificationConfig.driveRootFolderId = '';
      // matchDocument returns error (triggers legacy fallback)
      mockMatchAgent.matchDocument.mockResolvedValue(mockMatchDecisionAutoFiled({
        outcome: 'error',
        chosenContactId: null,
        chosenDriveFolderId: null,
      }));
      // No contact found
      mockContacts.resolveContactId.mockResolvedValue({ contactId: null, resolvedVia: null });

      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(false);
      expect(result.manualReview).toBe(true);
      expect(result.driveFileId).toBeNull();

      // Restore config for other tests
      mockConfig.classificationConfig.driveRootFolderId = 'root-folder-123';
    });

    it('should handle missing senderEmail gracefully', async () => {
      const job = mockJob({ senderEmail: null });

      const result = await processClassificationJob(job);

      // Should still succeed using driveRootFolderId as fallback
      expect(result.filed).toBe(true);
      expect(result.driveFileId).toBe('drive-file-789');
    });

    it('should handle CRM task creation failure during low confidence review without crashing', async () => {
      mockClassifier.classifyDocument.mockResolvedValue(
        mockClassificationResult({ confidence: 0.3 }),
      );
      mockTasks.createReviewTask.mockRejectedValue(new Error('CRM offline'));

      const job = mockJob();
      const result = await processClassificationJob(job);

      // Should still return manual review result (CRM failure is non-fatal)
      expect(result.filed).toBe(false);
      expect(result.manualReview).toBe(true);
      expect(result.error).toBeNull();
    });

    // -----------------------------------------------------------------
    // Phase 8: CRM tracking integration tests
    // -----------------------------------------------------------------

    it('should call updateDocTracking with correct parameters after successful filing', async () => {
      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(true);
      expect(mockTrackingSync.updateDocTracking).toHaveBeenCalledWith(
        expect.objectContaining({
          senderEmail: 'client@example.com',
          documentType: 't4',
          driveFileId: 'drive-file-789',
          source: 'gmail',
          receivedAt: '2026-02-15T12:00:00Z',
          contactId: 'contact-abc',
        }),
      );
    });

    it('should still call updateDocTracking via contactId when senderEmail is null', async () => {
      const job = mockJob({ senderEmail: null });
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(true);
      expect(mockTrackingSync.updateDocTracking).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: 'contact-abc' }),
      );
    });

    it('should not call updateDocTracking when both senderEmail and contactId are null', async () => {
      mockMatchAgent.matchDocument.mockResolvedValue(mockMatchDecisionAutoFiled({
        outcome: 'error',
        chosenContactId: null,
        chosenDriveFolderId: null,
      }));
      mockContacts.resolveContactId.mockResolvedValue({ contactId: null, resolvedVia: null });
      const job = mockJob({ senderEmail: null });
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(true);
      expect(mockTrackingSync.updateDocTracking).not.toHaveBeenCalled();
    });

    it('should not call updateDocTracking when filing fails (low confidence manual review)', async () => {
      mockClassifier.classifyDocument.mockResolvedValue(
        mockClassificationResult({ confidence: 0.3 }),
      );

      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(false);
      expect(result.manualReview).toBe(true);
      expect(mockTrackingSync.updateDocTracking).not.toHaveBeenCalled();
    });

    it('should still return filed=true even when updateDocTracking throws', async () => {
      mockTrackingSync.updateDocTracking.mockRejectedValue(new Error('CRM API down'));

      const job = mockJob();
      const result = await processClassificationJob(job);

      // Tracking failure is non-fatal — doc is already filed to Drive
      expect(result.filed).toBe(true);
      expect(result.driveFileId).toBe('drive-file-789');
      expect(result.error).toBeNull();
    });

    // -----------------------------------------------------------------
    // Contact resolution fallback flow
    // -----------------------------------------------------------------

    it('should still file to Drive even when matching returns error and contact resolution fails', async () => {
      mockMatchAgent.matchDocument.mockResolvedValue(mockMatchDecisionAutoFiled({
        outcome: 'error',
        chosenContactId: null,
        chosenDriveFolderId: null,
      }));
      mockContacts.resolveContactId.mockResolvedValue({ contactId: null, resolvedVia: null });

      const job = mockJob();
      const result = await processClassificationJob(job);

      // Doc should still be filed — contact resolution is non-blocking for Drive
      expect(result.filed).toBe(true);
      expect(result.driveFileId).toBe('drive-file-789');
    });

    // -----------------------------------------------------------------
    // Phase 13: Original document preservation (ORIG-01)
    // -----------------------------------------------------------------

    describe('Original document preservation (ORIG-01)', () => {
      it('stores original in Originals/ before filing classified document', async () => {
        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        expect(mockOriginals.storeOriginal).toHaveBeenCalledWith(
          expect.anything(), // drive client
          'root-folder-123', // clientFolderId (fallback to root since no CRM folder)
          Buffer.from('fake-pdf'), // pdfBuffer
          'T4_2024.pdf', // originalFilename from job data
        );
      });

      it('stores original at client folder level even for property-specific docs', async () => {
        // Contact has folder, opportunity has deal subfolder
        mockContacts.getContactDriveFolderId.mockReturnValue('crm-client-folder-999');
        const mockOpp = { id: 'opp-1', customFields: [] };
        mockOpportunities.findOpportunityByFinmoId.mockResolvedValue(mockOpp);
        mockOpportunities.getOpportunityFieldValue.mockReturnValue('deal-subfolder-888');

        // Property-specific doc type
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ documentType: 'purchase_agreement' }),
        );
        mockRouter.routeToSubfolder.mockReturnValue('subject_property');

        const job = mockJob({ applicationId: 'finmo-app-uuid-1' });
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        // storeOriginal should use clientFolderId, NOT deal subfolder
        expect(mockOriginals.storeOriginal).toHaveBeenCalledWith(
          expect.anything(),
          'crm-client-folder-999', // client folder, not deal-subfolder-888
          expect.any(Buffer),
          expect.any(String),
        );
      });

      it('continues filing when storeOriginal fails', async () => {
        mockOriginals.storeOriginal.mockRejectedValue(new Error('Drive API error'));

        const job = mockJob();
        const result = await processClassificationJob(job);

        // Filing should still succeed — storeOriginal is non-fatal
        expect(result.filed).toBe(true);
        expect(result.driveFileId).toBe('drive-file-789');
      });

      it('calls storeOriginal before resolveTargetFolder', async () => {
        const callOrder: string[] = [];
        mockOriginals.storeOriginal.mockImplementation(async () => {
          callOrder.push('storeOriginal');
          return 'original-file-id';
        });
        mockFiler.resolveTargetFolder.mockImplementation(async () => {
          callOrder.push('resolveTargetFolder');
          return 'target-folder-456';
        });

        const job = mockJob();
        await processClassificationJob(job);

        expect(callOrder.indexOf('storeOriginal')).toBeLessThan(
          callOrder.indexOf('resolveTargetFolder'),
        );
      });
    });

    // -----------------------------------------------------------------
    // Phase 13: Low confidence — Needs Review routing (ORIG-02)
    // -----------------------------------------------------------------

    describe('Low confidence — Needs Review routing (ORIG-02)', () => {
      it('saves low-confidence doc to Needs Review/ folder', async () => {
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ confidence: 0.5 }),
        );

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.manualReview).toBe(true);
        expect(result.driveFileId).toBe('drive-file-789');
        // Verify findOrCreateFolder was called for 'Needs Review'
        // Note: first call is from needs_review/conflict routing if applicable,
        // but for low-classification-confidence, it routes to per-client Needs Review
        expect(mockFiler.findOrCreateFolder).toHaveBeenCalledWith(
          expect.anything(),
          'Needs Review',
          expect.any(String),
        );
      });

      it('includes Drive link in CRM task for low-confidence doc', async () => {
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ confidence: 0.5 }),
        );

        const job = mockJob();
        await processClassificationJob(job);

        // Verify createReviewTask was called with Drive link in body
        expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
          'contact-abc',
          'Manual Review: T4_2024.pdf',
          expect.stringContaining('https://drive.google.com/file/d/drive-file-789/view'),
        );
      });

      it('includes filename in CRM task body', async () => {
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ confidence: 0.5 }),
        );

        const job = mockJob();
        await processClassificationJob(job);

        expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.stringContaining('File: T4_2024.pdf'),
        );
      });

      it('also stores original in Originals/ for low-confidence docs', async () => {
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ confidence: 0.5 }),
        );

        const job = mockJob();
        await processClassificationJob(job);

        expect(mockOriginals.storeOriginal).toHaveBeenCalledWith(
          expect.anything(),
          expect.any(String), // client folder (root fallback)
          Buffer.from('fake-pdf'),
          'T4_2024.pdf',
        );
      });

      it('still creates CRM task when Needs Review upload fails', async () => {
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ confidence: 0.5 }),
        );
        mockFiler.findOrCreateFolder.mockRejectedValue(new Error('Drive error'));

        const job = mockJob();
        await processClassificationJob(job);

        // CRM task should still be created (without Drive link)
        expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
          'contact-abc',
          'Manual Review: T4_2024.pdf',
          expect.stringContaining('Classification uncertain'),
        );
        // But should NOT contain a Drive link (since upload failed)
        expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.not.stringContaining('https://drive.google.com'),
        );
      });

      it('uses CRM contact folder for low-confidence Needs Review when available', async () => {
        mockContacts.getContactDriveFolderId.mockReturnValue('crm-client-folder-999');
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ confidence: 0.5 }),
        );

        const job = mockJob();
        await processClassificationJob(job);

        // findOrCreateFolder should use contact's folder for low-confidence Needs Review
        // (This is per-client Needs Review, different from global Needs Review for matching)
        expect(mockFiler.findOrCreateFolder).toHaveBeenCalledWith(
          expect.anything(),
          'Needs Review',
          'crm-client-folder-999',
        );
      });
    });

    // -----------------------------------------------------------------
    // Phase 11: Folder resolution (DRIVE-02, DRIVE-04, DRIVE-05, DRIVE-07)
    // -----------------------------------------------------------------

    describe('folder resolution', () => {
      it('should use CRM contact Drive folder ID when available (DRIVE-02)', async () => {
        // Contact has a Drive folder ID set
        mockContacts.getContactDriveFolderId.mockReturnValue('crm-client-folder-999');

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        // resolveTargetFolder should receive the CRM-provided folder ID
        expect(mockFiler.resolveTargetFolder).toHaveBeenCalledWith(
          expect.anything(), // drive client
          'crm-client-folder-999', // base folder from CRM, not root-folder-123
          expect.any(String),
          expect.any(String),
        );
      });

      it('should fall back to DRIVE_ROOT_FOLDER_ID when contact has no Drive folder (DRIVE-07)', async () => {
        // Contact has no Drive folder ID (getContactDriveFolderId returns null)
        mockContacts.getContactDriveFolderId.mockReturnValue(null);

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        // resolveTargetFolder should receive the root folder ID as fallback
        expect(mockFiler.resolveTargetFolder).toHaveBeenCalledWith(
          expect.anything(),
          'root-folder-123', // DRIVE_ROOT_FOLDER_ID fallback
          expect.any(String),
          expect.any(String),
        );
      });

      it('should route property-specific doc to deal subfolder (DRIVE-05)', async () => {
        // Contact has folder, opportunity has deal subfolder
        mockContacts.getContactDriveFolderId.mockReturnValue('crm-client-folder-999');
        const mockOpp = { id: 'opp-1', customFields: [] };
        mockOpportunities.findOpportunityByFinmoId.mockResolvedValue(mockOpp);
        mockOpportunities.getOpportunityFieldValue.mockReturnValue('deal-subfolder-888');

        // Property-specific doc type
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ documentType: 'purchase_agreement' }),
        );
        mockRouter.routeToSubfolder.mockReturnValue('subject_property');

        const job = mockJob({ applicationId: 'finmo-app-uuid-1' });
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        // resolveTargetFolder should receive the DEAL subfolder ID
        expect(mockFiler.resolveTargetFolder).toHaveBeenCalledWith(
          expect.anything(),
          'deal-subfolder-888', // deal subfolder, not client folder
          expect.any(String),
          expect.any(String),
        );
      });

      it('should fall back to client folder for property-specific doc without deal subfolder', async () => {
        // Contact has folder, but opportunity has no deal subfolder
        mockContacts.getContactDriveFolderId.mockReturnValue('crm-client-folder-999');
        const mockOpp = { id: 'opp-1', customFields: [] };
        mockOpportunities.findOpportunityByFinmoId.mockResolvedValue(mockOpp);
        mockOpportunities.getOpportunityFieldValue.mockReturnValue(undefined); // no subfolder

        // Property-specific doc type
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ documentType: 'purchase_agreement' }),
        );
        mockRouter.routeToSubfolder.mockReturnValue('subject_property');

        const job = mockJob({ applicationId: 'finmo-app-uuid-1' });
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        // Falls back to client folder since dealSubfolderId is null
        expect(mockFiler.resolveTargetFolder).toHaveBeenCalledWith(
          expect.anything(),
          'crm-client-folder-999', // client folder fallback
          expect.any(String),
          expect.any(String),
        );
      });

      it('should always route reusable doc to client folder even when deal subfolder exists', async () => {
        // Contact has folder AND opportunity has deal subfolder
        mockContacts.getContactDriveFolderId.mockReturnValue('crm-client-folder-999');
        // Even though opportunity has a deal subfolder...
        const mockOpp = { id: 'opp-1', customFields: [] };
        mockOpportunities.findOpportunityByFinmoId.mockResolvedValue(mockOpp);
        mockOpportunities.getOpportunityFieldValue.mockReturnValue('deal-subfolder-888');

        // Reusable doc type (pay_stub is NOT in PROPERTY_SPECIFIC_TYPES)
        mockClassifier.classifyDocument.mockResolvedValue(
          mockClassificationResult({ documentType: 'pay_stub' }),
        );
        mockRouter.routeToSubfolder.mockReturnValue('person');

        const job = mockJob({ applicationId: 'finmo-app-uuid-1' });
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        // Reusable docs always go to client folder, not deal subfolder
        expect(mockFiler.resolveTargetFolder).toHaveBeenCalledWith(
          expect.anything(),
          'crm-client-folder-999', // client folder, not deal subfolder
          expect.any(String),
          expect.any(String),
        );
      });

      it('should handle getContact failure gracefully and fall back to root folder', async () => {
        // getContact throws an error (CRM offline)
        mockContacts.getContact.mockRejectedValue(new Error('CRM API timeout'));

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        // Falls back to DRIVE_ROOT_FOLDER_ID since contact fetch failed
        expect(mockFiler.resolveTargetFolder).toHaveBeenCalledWith(
          expect.anything(),
          'root-folder-123', // DRIVE_ROOT_FOLDER_ID fallback
          expect.any(String),
          expect.any(String),
        );
      });

      it('should pass pre-fetched contact to updateDocTracking', async () => {
        const contactRecord = {
          id: 'contact-abc',
          email: 'client@example.com',
          firstName: 'Terry',
          lastName: 'Smith',
          customFields: [{ id: 'field-drive-folder-id', value: 'crm-client-folder-999' }],
        };
        mockContacts.getContact.mockResolvedValue(contactRecord);
        mockContacts.getContactDriveFolderId.mockReturnValue('crm-client-folder-999');

        const job = mockJob();
        const result = await processClassificationJob(job);

        expect(result.filed).toBe(true);
        expect(mockTrackingSync.updateDocTracking).toHaveBeenCalledWith(
          expect.objectContaining({
            prefetchedContact: contactRecord,
          }),
        );
      });
    });
  });
});
