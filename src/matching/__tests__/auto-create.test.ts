/**
 * Tests for auto-create utility — creates CRM contact + Drive folder
 * for zero-match documents (no existing contact found).
 *
 * Covers:
 * - Creates CRM contact via upsertContact with name from classification
 * - Creates Drive folder under DRIVE_ROOT_FOLDER_ID
 * - Stores folder ID on the new contact
 * - Pre-creates standard subfolders
 * - Creates CRM task for Cat: "New contact created from incoming doc — please verify"
 * - Returns { contactId, driveFolderId } on success
 * - Returns null if no name available from classification
 * - Returns null on CRM/Drive errors (non-fatal)
 * - Phase 25-02: Fuzzy folder search before auto-create
 *   - Reuses existing folder when fuzzy match found
 *   - Falls back to findOrCreateFolder when no match
 *   - Falls back to findOrCreateFolder when fuzzy search throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (vi.hoisted)
// ---------------------------------------------------------------------------

const mockContacts = vi.hoisted(() => ({
  upsertContact: vi.fn(),
  getContact: vi.fn(),
  getContactDriveFolderId: vi.fn(),
  extractDriveFolderId: vi.fn((v: string) => v),
  resolveContactId: vi.fn(),
  findContactByEmail: vi.fn(),
  findContactByName: vi.fn(),
  findContactByPhone: vi.fn(),
  assignContactType: vi.fn(),
}));

vi.mock('../../crm/contacts.js', () => mockContacts);

const mockCrmConfig = vi.hoisted(() => ({
  crmConfig: {
    driveFolderIdFieldId: 'field-drive-folder-id',
    oppDealSubfolderIdFieldId: 'field-deal-subfolder-id',
  },
}));

vi.mock('../../crm/config.js', () => mockCrmConfig);

const mockTasks = vi.hoisted(() => ({
  createReviewTask: vi.fn(),
}));

vi.mock('../../crm/tasks.js', () => mockTasks);

const mockDriveClient = vi.hoisted(() => ({
  getDriveClient: vi.fn(),
}));

vi.mock('../../classification/drive-client.js', () => mockDriveClient);

const mockFiler = vi.hoisted(() => ({
  findOrCreateFolder: vi.fn(),
  uploadFile: vi.fn(),
  resolveTargetFolder: vi.fn(),
  findExistingFile: vi.fn(),
  updateFileContent: vi.fn(),
}));

vi.mock('../../classification/filer.js', () => mockFiler);

const mockOriginals = vi.hoisted(() => ({
  preCreateSubfolders: vi.fn(),
  storeOriginal: vi.fn(),
}));

vi.mock('../../drive/originals.js', () => mockOriginals);

const mockClassificationConfig = vi.hoisted(() => ({
  classificationConfig: {
    driveRootFolderId: 'root-folder-123',
    confidenceThreshold: 0.7,
    enabled: true,
    geminiApiKey: 'test-key',
    model: 'gemini-2.0-flash',
    maxClassificationPages: 3,
    driveImpersonateAs: 'dev@test.com',
  },
}));

vi.mock('../../classification/config.js', () => mockClassificationConfig);

const mockFolderSearch = vi.hoisted(() => ({
  searchExistingFolders: vi.fn(),
  normalizeName: vi.fn(),
  fuzzyNameMatch: vi.fn(),
}));

vi.mock('../folder-search.js', () => mockFolderSearch);

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { autoCreateFromDoc } from '../auto-create.js';
import type { ClassificationResult } from '../../classification/types.js';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autoCreateFromDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Defaults
    mockContacts.upsertContact.mockResolvedValue({ contactId: 'new-contact-1', isNew: true });
    mockDriveClient.getDriveClient.mockReturnValue({});
    mockFiler.findOrCreateFolder.mockResolvedValue('new-folder-1');
    mockOriginals.preCreateSubfolders.mockResolvedValue({});
    mockTasks.createReviewTask.mockResolvedValue('task-1');
    // Phase 25-02: Default fuzzy search to null (no match) so existing tests pass unchanged
    mockFolderSearch.searchExistingFolders.mockResolvedValue(null);
  });

  it('creates CRM contact with name from classification', async () => {
    const result = await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(result).not.toBeNull();
    expect(mockContacts.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Terry',
        lastName: 'Smith',
        email: 'terry@example.com',
        source: 'doc-automation',
      }),
    );
  });

  it('creates Drive folder under DRIVE_ROOT_FOLDER_ID', async () => {
    await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(mockFiler.findOrCreateFolder).toHaveBeenCalledWith(
      expect.anything(), // drive client
      'Smith, Terry',    // "LastName, FirstName" convention
      'root-folder-123', // DRIVE_ROOT_FOLDER_ID
    );
  });

  it('stores folder ID on the new contact via upsertContact', async () => {
    await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    // Second upsertContact call stores the driveFolderId
    expect(mockContacts.upsertContact).toHaveBeenCalledTimes(2);
    expect(mockContacts.upsertContact).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customFields: [{ id: 'field-drive-folder-id', field_value: 'new-folder-1' }],
      }),
    );
  });

  it('pre-creates standard subfolders in the new folder', async () => {
    await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(mockOriginals.preCreateSubfolders).toHaveBeenCalledWith(
      expect.anything(), // drive client
      'new-folder-1',
    );
  });

  it('creates CRM task for Cat with correct message', async () => {
    await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(mockTasks.createReviewTask).toHaveBeenCalledWith(
      'new-contact-1',
      'New contact created from incoming doc — please verify',
      expect.stringContaining('T4_2024.pdf'),
    );
  });

  it('returns contactId and driveFolderId on success', async () => {
    const result = await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(result).toEqual({
      contactId: 'new-contact-1',
      driveFolderId: 'new-folder-1',
    });
  });

  it('returns null if no name available from classification', async () => {
    const result = await autoCreateFromDoc({
      classificationResult: mockClassificationResult({
        borrowerFirstName: null,
        borrowerLastName: null,
      }),
      senderEmail: 'unknown@example.com',
      originalFilename: 'mystery.pdf',
    });

    expect(result).toBeNull();
    expect(mockContacts.upsertContact).not.toHaveBeenCalled();
  });

  it('returns null on CRM upsertContact failure (non-fatal)', async () => {
    mockContacts.upsertContact.mockRejectedValue(new Error('CRM API down'));

    const result = await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(result).toBeNull();
  });

  it('returns null on Drive folder creation failure (non-fatal)', async () => {
    mockFiler.findOrCreateFolder.mockRejectedValue(new Error('Drive API quota'));

    const result = await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(result).toBeNull();
  });

  it('uses placeholder email when senderEmail is null', async () => {
    await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: null,
      originalFilename: 'T4_2024.pdf',
    });

    expect(mockContacts.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'terry.smith@placeholder.venturemortgages.com',
      }),
    );
  });

  it('uses placeholder email when sender is internal @venturemortgages.com', async () => {
    await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'admin@venturemortgages.com',
      originalFilename: 'T4_2024.pdf',
    });

    // Should NOT use admin@ — would overwrite Cat's contact record
    expect(mockContacts.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'terry.smith@placeholder.venturemortgages.com',
      }),
    );
  });

  it('uses placeholder email when sender is docs@venturemortgages.com', async () => {
    await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'docs@venturemortgages.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(mockContacts.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'terry.smith@placeholder.venturemortgages.com',
      }),
    );
  });

  it('uses external sender email when not @venturemortgages.com', async () => {
    await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'client@gmail.com',
      originalFilename: 'T4_2024.pdf',
    });

    expect(mockContacts.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'client@gmail.com',
      }),
    );
  });

  it('CRM task failure does not prevent returning result', async () => {
    mockTasks.createReviewTask.mockRejectedValue(new Error('Task creation failed'));

    const result = await autoCreateFromDoc({
      classificationResult: mockClassificationResult(),
      senderEmail: 'terry@example.com',
      originalFilename: 'T4_2024.pdf',
    });

    // Should still return success — CRM task is non-fatal
    expect(result).toEqual({
      contactId: 'new-contact-1',
      driveFolderId: 'new-folder-1',
    });
  });

  // -------------------------------------------------------------------------
  // Phase 25-02: Fuzzy folder search integration
  // -------------------------------------------------------------------------

  describe('fuzzy folder search (Phase 25-02)', () => {
    it('reuses existing folder when fuzzy match found (no new folder created)', async () => {
      mockFolderSearch.searchExistingFolders.mockResolvedValue({
        folderId: 'existing-folder-xyz',
        folderName: 'Wong-Ranasinghe, Carolyn/Srimal',
      });

      const result = await autoCreateFromDoc({
        classificationResult: mockClassificationResult({
          borrowerFirstName: 'Srimal',
          borrowerLastName: 'Ranasinghe',
        }),
        senderEmail: 'srimal@example.com',
        originalFilename: 'ID_Srimal.pdf',
      });

      // Should use the existing folder, NOT call findOrCreateFolder
      expect(result).toEqual({
        contactId: 'new-contact-1',
        driveFolderId: 'existing-folder-xyz',
      });
      expect(mockFiler.findOrCreateFolder).not.toHaveBeenCalled();

      // Should still store the folder ID on the CRM contact
      expect(mockContacts.upsertContact).toHaveBeenLastCalledWith(
        expect.objectContaining({
          customFields: [{ id: 'field-drive-folder-id', field_value: 'existing-folder-xyz' }],
        }),
      );
    });

    it('falls back to findOrCreateFolder when no fuzzy match found', async () => {
      mockFolderSearch.searchExistingFolders.mockResolvedValue(null);

      const result = await autoCreateFromDoc({
        classificationResult: mockClassificationResult(),
        senderEmail: 'terry@example.com',
        originalFilename: 'T4_2024.pdf',
      });

      expect(result).toEqual({
        contactId: 'new-contact-1',
        driveFolderId: 'new-folder-1',
      });
      expect(mockFiler.findOrCreateFolder).toHaveBeenCalledWith(
        expect.anything(),
        'Smith, Terry',
        'root-folder-123',
      );
    });

    it('falls back to findOrCreateFolder when fuzzy search throws (non-fatal)', async () => {
      mockFolderSearch.searchExistingFolders.mockRejectedValue(
        new Error('Drive API unavailable'),
      );

      const result = await autoCreateFromDoc({
        classificationResult: mockClassificationResult(),
        senderEmail: 'terry@example.com',
        originalFilename: 'T4_2024.pdf',
      });

      // Should NOT fail — falls back to normal folder creation
      expect(result).toEqual({
        contactId: 'new-contact-1',
        driveFolderId: 'new-folder-1',
      });
      expect(mockFiler.findOrCreateFolder).toHaveBeenCalled();
    });

    it('calls searchExistingFolders with correct folder name and root ID', async () => {
      mockFolderSearch.searchExistingFolders.mockResolvedValue(null);

      await autoCreateFromDoc({
        classificationResult: mockClassificationResult({
          borrowerFirstName: 'Carolyn',
          borrowerLastName: 'Wong',
        }),
        senderEmail: 'carolyn@example.com',
        originalFilename: 'ID_Carolyn.pdf',
      });

      expect(mockFolderSearch.searchExistingFolders).toHaveBeenCalledWith(
        expect.anything(), // drive client
        'Wong, Carolyn',   // folderName format
        'root-folder-123', // DRIVE_ROOT_FOLDER_ID
      );
    });
  });
});
