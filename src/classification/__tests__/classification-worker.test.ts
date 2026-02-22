/**
 * Tests for Classification Worker — Document Classification Pipeline
 *
 * Tests cover:
 * - Full pipeline success: classify -> name -> route -> upload -> filed=true
 * - Low confidence -> manual review: CRM task created, filed=false, manualReview=true
 * - Existing file found -> update instead of upload (FILE-04 versioning)
 * - Classification error -> caught gracefully, error in result
 * - Drive upload error -> caught gracefully, error in result
 * - Temp file cleaned up after success
 * - Temp file cleaned up after error
 * - Missing client folder -> manual review
 *
 * All external dependencies are mocked via vi.mock / vi.hoisted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ClassificationJobData, ClassificationResult } from '../types.js';

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
}));

vi.mock('../filer.js', () => mockFiler);

const mockContacts = vi.hoisted(() => ({
  resolveContactId: vi.fn(),
  getContact: vi.fn(),
  getContactDriveFolderId: vi.fn(),
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

const mockTrackingSync = vi.hoisted(() => ({
  updateDocTracking: vi.fn(),
}));

vi.mock('../../crm/tracking-sync.js', () => mockTrackingSync);

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
    mockContacts.resolveContactId.mockResolvedValue({ contactId: 'contact-abc', resolvedVia: 'email' });
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
    // Default: no opportunity match
    mockOpportunities.findOpportunityByFinmoId.mockResolvedValue(null);
    mockOpportunities.getOpportunityFieldValue.mockReturnValue(undefined);
    mockTasks.createReviewTask.mockResolvedValue('task-xyz');
    mockTrackingSync.updateDocTracking.mockResolvedValue({
      updated: true,
      contactId: 'contact-abc',
      newStatus: 'In Progress',
      noteId: 'note-xyz',
      errors: [],
    });
  });

  describe('CLASSIFICATION_QUEUE_NAME', () => {
    it('should be doc-classification', () => {
      expect(CLASSIFICATION_QUEUE_NAME).toBe('doc-classification');
    });
  });

  describe('processClassificationJob', () => {
    it('should process full pipeline: classify -> name -> route -> upload', async () => {
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
      expect(mockNaming.generateFilename).toHaveBeenCalled();
      expect(mockRouter.routeToSubfolder).toHaveBeenCalledWith('t4');
      expect(mockFiler.uploadFile).toHaveBeenCalled();
    });

    it('should route low-confidence classification to manual review (FILE-05)', async () => {
      mockClassifier.classifyDocument.mockResolvedValue(
        mockClassificationResult({ confidence: 0.3 }),
      );

      const job = mockJob();
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(false);
      expect(result.manualReview).toBe(true);
      expect(result.driveFileId).toBeNull();
      expect(result.error).toBeNull();
      expect(result.classification?.confidence).toBe(0.3);

      // CRM task should be created (contact resolved via resolveContactId)
      expect(mockContacts.resolveContactId).toHaveBeenCalled();
      expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
        'contact-abc',
        'Manual Review: T4_2024.pdf',
        expect.stringContaining('Classification uncertain'),
      );

      // Drive operations should NOT be called
      expect(mockFiler.uploadFile).not.toHaveBeenCalled();
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

      // updateFileContent should be called, not uploadFile
      expect(mockFiler.updateFileContent).toHaveBeenCalledWith(
        expect.anything(), // drive client
        'existing-file-111',
        Buffer.from('fake-pdf'),
        'Terry - T4 CIBC 2024 $16k.pdf',
      );
      expect(mockFiler.uploadFile).not.toHaveBeenCalled();
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
      mockContacts.resolveContactId.mockResolvedValue({ contactId: 'contact-name', resolvedVia: 'name' });
      const job = mockJob({ senderEmail: null });
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(true);
      expect(mockTrackingSync.updateDocTracking).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: 'contact-name' }),
      );
    });

    it('should not call updateDocTracking when both senderEmail and contactId are null', async () => {
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
    // Name fallback contact resolution
    // -----------------------------------------------------------------

    it('should resolve contact by name when email lookup fails (forwarded email)', async () => {
      // Simulate Cat forwarding — email resolves via name fallback
      mockContacts.resolveContactId.mockResolvedValue({ contactId: 'contact-name', resolvedVia: 'name' });

      const job = mockJob({ senderEmail: 'admin@venturemortgages.com' });
      const result = await processClassificationJob(job);

      expect(result.filed).toBe(true);
      expect(mockContacts.resolveContactId).toHaveBeenCalledWith({
        senderEmail: 'admin@venturemortgages.com',
        borrowerFirstName: 'Terry',
        borrowerLastName: 'Smith',
      });
      expect(mockTrackingSync.updateDocTracking).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: 'contact-name' }),
      );
    });

    it('should still file to Drive even when contact resolution fails entirely', async () => {
      mockContacts.resolveContactId.mockResolvedValue({ contactId: null, resolvedVia: null });

      const job = mockJob();
      const result = await processClassificationJob(job);

      // Doc should still be filed — contact resolution is non-blocking for Drive
      expect(result.filed).toBe(true);
      expect(result.driveFileId).toBe('drive-file-789');
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
