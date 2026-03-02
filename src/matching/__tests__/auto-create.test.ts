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
        customFields: [{ id: 'field-drive-folder-id', value: 'new-folder-1' }],
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
        email: 'unknown@placeholder.venturemortgages.com',
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
});
