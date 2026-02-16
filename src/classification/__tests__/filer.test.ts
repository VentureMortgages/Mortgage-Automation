/**
 * Tests for Google Drive Filer Module
 *
 * Tests cover:
 * - findFolder: returns ID when found, returns null when empty
 * - createFolder: creates with correct metadata (mime type, parent)
 * - findOrCreateFolder: uses existing folder, creates when missing
 * - uploadFile: uploads with correct metadata (PDF MIME, filename, parent, media body)
 * - findExistingFile: returns match, returns null when no match
 * - updateFileContent: updates existing file, renames if newFilename provided
 * - resolveTargetFolder: root returns clientFolderId, person creates person subfolder,
 *   subject_property creates Subject Property subfolder
 * - escapeDriveQuery: escapes single quotes
 *
 * Uses a mock Drive client factory (no googleapis mocking needed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  findFolder,
  createFolder,
  findOrCreateFolder,
  uploadFile,
  findExistingFile,
  updateFileContent,
  resolveTargetFolder,
  escapeDriveQuery,
} from '../filer.js';

import type { DriveClient } from '../drive-client.js';

// ---------------------------------------------------------------------------
// Mock Drive Client Factory
// ---------------------------------------------------------------------------

interface MockDriveFiles {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createMockDrive(): { drive: DriveClient; files: MockDriveFiles } {
  const files: MockDriveFiles = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const drive = { files } as unknown as DriveClient;
  return { drive, files };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Filer', () => {
  let drive: DriveClient;
  let files: MockDriveFiles;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ drive, files } = createMockDrive());
  });

  // -------------------------------------------------------------------------
  // findFolder
  // -------------------------------------------------------------------------

  describe('findFolder', () => {
    it('returns ID when folder is found', async () => {
      files.list.mockResolvedValueOnce({
        data: {
          files: [{ id: 'folder-123', name: 'Terry' }],
        },
      });

      const result = await findFolder(drive, 'Terry', 'parent-id');

      expect(result).toBe('folder-123');
      expect(files.list).toHaveBeenCalledWith({
        q: expect.stringContaining("name = 'Terry'"),
        fields: 'files(id, name)',
        pageSize: 1,
      });
      // Also check parent and mime type in query
      const query = files.list.mock.calls[0][0].q;
      expect(query).toContain("'parent-id' in parents");
      expect(query).toContain("mimeType = 'application/vnd.google-apps.folder'");
      expect(query).toContain('trashed = false');
    });

    it('returns null when no folder found', async () => {
      files.list.mockResolvedValueOnce({
        data: { files: [] },
      });

      const result = await findFolder(drive, 'Missing', 'parent-id');

      expect(result).toBeNull();
    });

    it('returns null when files array is undefined', async () => {
      files.list.mockResolvedValueOnce({
        data: {},
      });

      const result = await findFolder(drive, 'Missing', 'parent-id');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // createFolder
  // -------------------------------------------------------------------------

  describe('createFolder', () => {
    it('creates folder with correct metadata', async () => {
      files.create.mockResolvedValueOnce({
        data: { id: 'new-folder-456' },
      });

      const result = await createFolder(drive, 'Subject Property', 'parent-id');

      expect(result).toBe('new-folder-456');
      expect(files.create).toHaveBeenCalledWith({
        requestBody: {
          name: 'Subject Property',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['parent-id'],
        },
        fields: 'id',
      });
    });

    it('throws if Drive API returns no ID', async () => {
      files.create.mockResolvedValueOnce({
        data: {},
      });

      await expect(createFolder(drive, 'Test', 'parent-id')).rejects.toThrow(
        'Drive API returned no ID after creating folder "Test"',
      );
    });
  });

  // -------------------------------------------------------------------------
  // findOrCreateFolder
  // -------------------------------------------------------------------------

  describe('findOrCreateFolder', () => {
    it('returns existing folder without creating', async () => {
      // findFolder returns an existing folder
      files.list.mockResolvedValueOnce({
        data: { files: [{ id: 'existing-789', name: 'Terry' }] },
      });

      const result = await findOrCreateFolder(drive, 'Terry', 'parent-id');

      expect(result).toBe('existing-789');
      // files.create should NOT have been called
      expect(files.create).not.toHaveBeenCalled();
    });

    it('creates folder when not found', async () => {
      // findFolder returns nothing
      files.list.mockResolvedValueOnce({
        data: { files: [] },
      });
      // createFolder returns new folder
      files.create.mockResolvedValueOnce({
        data: { id: 'created-101' },
      });

      const result = await findOrCreateFolder(drive, 'Down Payment', 'parent-id');

      expect(result).toBe('created-101');
      expect(files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ name: 'Down Payment' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // uploadFile
  // -------------------------------------------------------------------------

  describe('uploadFile', () => {
    it('uploads file with correct metadata', async () => {
      files.create.mockResolvedValueOnce({
        data: { id: 'file-202', name: 'Terry - T4 2024.pdf', webViewLink: 'https://drive.google.com/file/d/file-202' },
      });

      const pdfBuffer = Buffer.from('fake-pdf-content');
      const result = await uploadFile(drive, pdfBuffer, 'Terry - T4 2024.pdf', 'folder-303');

      expect(result).toBe('file-202');
      expect(files.create).toHaveBeenCalledWith({
        requestBody: {
          name: 'Terry - T4 2024.pdf',
          parents: ['folder-303'],
        },
        media: {
          mimeType: 'application/pdf',
          body: expect.any(Object), // Readable stream
        },
        fields: 'id, name, webViewLink',
      });
    });

    it('throws if Drive API returns no ID', async () => {
      files.create.mockResolvedValueOnce({
        data: {},
      });

      const pdfBuffer = Buffer.from('fake-pdf');
      await expect(
        uploadFile(drive, pdfBuffer, 'test.pdf', 'folder-id'),
      ).rejects.toThrow('Drive API returned no ID after uploading "test.pdf"');
    });
  });

  // -------------------------------------------------------------------------
  // findExistingFile
  // -------------------------------------------------------------------------

  describe('findExistingFile', () => {
    it('returns match when file found', async () => {
      files.list.mockResolvedValueOnce({
        data: {
          files: [{ id: 'file-404', name: 'Terry - T4 2023.pdf', modifiedTime: '2024-01-01' }],
        },
      });

      const result = await findExistingFile(drive, 'Terry - T4', 'folder-id');

      expect(result).toEqual({ id: 'file-404', name: 'Terry - T4 2023.pdf' });
      expect(files.list).toHaveBeenCalledWith({
        q: expect.stringContaining("name contains 'Terry - T4'"),
        fields: 'files(id, name, modifiedTime)',
        pageSize: 1,
      });
    });

    it('returns null when no match', async () => {
      files.list.mockResolvedValueOnce({
        data: { files: [] },
      });

      const result = await findExistingFile(drive, 'NonExistent', 'folder-id');

      expect(result).toBeNull();
    });

    it('returns null when files array is undefined', async () => {
      files.list.mockResolvedValueOnce({
        data: {},
      });

      const result = await findExistingFile(drive, 'Missing', 'folder-id');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // updateFileContent
  // -------------------------------------------------------------------------

  describe('updateFileContent', () => {
    it('updates existing file content', async () => {
      files.update.mockResolvedValueOnce({ data: {} });

      const pdfBuffer = Buffer.from('updated-pdf-content');
      await updateFileContent(drive, 'file-505', pdfBuffer);

      expect(files.update).toHaveBeenCalledWith({
        fileId: 'file-505',
        requestBody: {},
        media: {
          mimeType: 'application/pdf',
          body: expect.any(Object),
        },
      });
    });

    it('renames file if newFilename provided', async () => {
      files.update.mockResolvedValueOnce({ data: {} });

      const pdfBuffer = Buffer.from('updated-pdf');
      await updateFileContent(drive, 'file-606', pdfBuffer, 'Terry - T4 2024 $16k.pdf');

      expect(files.update).toHaveBeenCalledWith({
        fileId: 'file-606',
        requestBody: { name: 'Terry - T4 2024 $16k.pdf' },
        media: {
          mimeType: 'application/pdf',
          body: expect.any(Object),
        },
      });
    });
  });

  // -------------------------------------------------------------------------
  // resolveTargetFolder
  // -------------------------------------------------------------------------

  describe('resolveTargetFolder', () => {
    it("'root' returns clientFolderId directly", async () => {
      const result = await resolveTargetFolder(drive, 'client-folder-id', 'root', 'Terry');

      expect(result).toBe('client-folder-id');
      // No API calls should be made
      expect(files.list).not.toHaveBeenCalled();
      expect(files.create).not.toHaveBeenCalled();
    });

    it("'person' finds/creates person subfolder", async () => {
      // findFolder returns existing person folder
      files.list.mockResolvedValueOnce({
        data: { files: [{ id: 'terry-folder', name: 'Terry' }] },
      });

      const result = await resolveTargetFolder(drive, 'client-folder-id', 'person', 'Terry');

      expect(result).toBe('terry-folder');
      const query = files.list.mock.calls[0][0].q;
      expect(query).toContain("name = 'Terry'");
      expect(query).toContain("'client-folder-id' in parents");
    });

    it("'subject_property' finds/creates Subject Property subfolder", async () => {
      files.list.mockResolvedValueOnce({
        data: { files: [] },
      });
      files.create.mockResolvedValueOnce({
        data: { id: 'sp-folder' },
      });

      const result = await resolveTargetFolder(
        drive,
        'client-folder-id',
        'subject_property',
        'Terry',
      );

      expect(result).toBe('sp-folder');
      expect(files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ name: 'Subject Property' }),
        }),
      );
    });

    it("'non_subject_property' finds/creates Non-Subject Property subfolder", async () => {
      files.list.mockResolvedValueOnce({
        data: { files: [{ id: 'nsp-folder', name: 'Non-Subject Property' }] },
      });

      const result = await resolveTargetFolder(
        drive,
        'client-folder-id',
        'non_subject_property',
        'Terry',
      );

      expect(result).toBe('nsp-folder');
    });

    it("'down_payment' finds/creates Down Payment subfolder", async () => {
      files.list.mockResolvedValueOnce({
        data: { files: [{ id: 'dp-folder', name: 'Down Payment' }] },
      });

      const result = await resolveTargetFolder(
        drive,
        'client-folder-id',
        'down_payment',
        'Terry',
      );

      expect(result).toBe('dp-folder');
    });

    it("'signed_docs' finds/creates Signed Docs subfolder", async () => {
      files.list.mockResolvedValueOnce({
        data: { files: [] },
      });
      files.create.mockResolvedValueOnce({
        data: { id: 'sd-folder' },
      });

      const result = await resolveTargetFolder(
        drive,
        'client-folder-id',
        'signed_docs',
        'Terry',
      );

      expect(result).toBe('sd-folder');
      expect(files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ name: 'Signed Docs' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // escapeDriveQuery
  // -------------------------------------------------------------------------

  describe('escapeDriveQuery', () => {
    it('escapes single quotes', () => {
      expect(escapeDriveQuery("O'Brien")).toBe("O\\'Brien");
    });

    it('escapes multiple single quotes', () => {
      expect(escapeDriveQuery("it's a name's test")).toBe("it\\'s a name\\'s test");
    });

    it('returns unchanged string with no quotes', () => {
      expect(escapeDriveQuery('No Quotes Here')).toBe('No Quotes Here');
    });
  });
});
