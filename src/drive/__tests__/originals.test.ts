/**
 * Tests for Original Document Preservation Module
 *
 * Tests CLIENT_SUBFOLDERS constant, preCreateSubfolders function,
 * and storeOriginal function including error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Module-level mocks
// ============================================================================

const mockFindOrCreateFolder = vi.hoisted(() => vi.fn());
const mockUploadFile = vi.hoisted(() => vi.fn());

vi.mock('../../classification/filer.js', () => ({
  findOrCreateFolder: mockFindOrCreateFolder,
  uploadFile: mockUploadFile,
}));

import { CLIENT_SUBFOLDERS, preCreateSubfolders, storeOriginal } from '../originals.js';
import type { DriveClient } from '../../classification/drive-client.js';

// ============================================================================
// Test Setup
// ============================================================================

const mockDrive = {} as DriveClient;
const CLIENT_FOLDER_ID = 'client-folder-123';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// CLIENT_SUBFOLDERS
// ============================================================================

describe('CLIENT_SUBFOLDERS', () => {
  it('should contain exactly 7 entries', () => {
    expect(CLIENT_SUBFOLDERS).toHaveLength(7);
  });

  it('should contain the expected folder names', () => {
    expect(CLIENT_SUBFOLDERS).toEqual([
      'Income',
      'Property',
      'Down Payment',
      'ID',
      'Originals',
      'Needs Review',
      'Signed Docs',
    ]);
  });
});

// ============================================================================
// preCreateSubfolders
// ============================================================================

describe('preCreateSubfolders', () => {
  it('should create all CLIENT_SUBFOLDERS folders', async () => {
    mockFindOrCreateFolder.mockImplementation(
      (_drive: DriveClient, name: string) => Promise.resolve(`${name}-folder-id`),
    );

    await preCreateSubfolders(mockDrive, CLIENT_FOLDER_ID);

    expect(mockFindOrCreateFolder).toHaveBeenCalledTimes(CLIENT_SUBFOLDERS.length);
    for (const name of CLIENT_SUBFOLDERS) {
      expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, name, CLIENT_FOLDER_ID);
    }
  });

  it('should return a Record mapping folder names to IDs', async () => {
    mockFindOrCreateFolder.mockImplementation(
      (_drive: DriveClient, name: string) => Promise.resolve(`${name}-folder-id`),
    );

    const result = await preCreateSubfolders(mockDrive, CLIENT_FOLDER_ID);

    expect(result).toEqual({
      'Income': 'Income-folder-id',
      'Property': 'Property-folder-id',
      'Down Payment': 'Down Payment-folder-id',
      'ID': 'ID-folder-id',
      'Originals': 'Originals-folder-id',
      'Needs Review': 'Needs Review-folder-id',
      'Signed Docs': 'Signed Docs-folder-id',
    });
  });

  it('should continue when one folder creation fails (partial success)', async () => {
    mockFindOrCreateFolder.mockImplementation(
      (_drive: DriveClient, name: string) => {
        if (name === 'Property') {
          return Promise.reject(new Error('Drive API quota exceeded'));
        }
        return Promise.resolve(`${name}-folder-id`);
      },
    );

    const result = await preCreateSubfolders(mockDrive, CLIENT_FOLDER_ID);

    // Should have 6 entries (all except Property)
    expect(Object.keys(result)).toHaveLength(6);
    expect(result['Property']).toBeUndefined();
    expect(result['Income']).toBe('Income-folder-id');
    expect(result['Originals']).toBe('Originals-folder-id');
  });

  it('should return empty record when all fail (does not throw)', async () => {
    mockFindOrCreateFolder.mockRejectedValue(new Error('Drive API down'));

    const result = await preCreateSubfolders(mockDrive, CLIENT_FOLDER_ID);

    expect(result).toEqual({});
  });
});

// ============================================================================
// storeOriginal
// ============================================================================

describe('storeOriginal', () => {
  it('should resolve Originals/ folder then upload with timestamp prefix', async () => {
    mockFindOrCreateFolder.mockResolvedValue('originals-folder-id');
    mockUploadFile.mockResolvedValue('uploaded-file-id');

    // Mock date to a known value
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T12:00:00Z'));

    await storeOriginal(mockDrive, CLIENT_FOLDER_ID, Buffer.from('pdf'), 'paystub.pdf');

    expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, 'Originals', CLIENT_FOLDER_ID);
    expect(mockUploadFile).toHaveBeenCalledWith(
      mockDrive,
      Buffer.from('pdf'),
      '2026-03-02_paystub.pdf',
      'originals-folder-id',
    );

    vi.useRealTimers();
  });

  it('should format filename as YYYY-MM-DD_originalfilename.pdf', async () => {
    mockFindOrCreateFolder.mockResolvedValue('originals-folder-id');
    mockUploadFile.mockResolvedValue('uploaded-file-id');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-25T08:30:00Z'));

    await storeOriginal(mockDrive, CLIENT_FOLDER_ID, Buffer.from('pdf'), 'T4_2025.pdf');

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '2026-12-25_T4_2025.pdf',
      expect.anything(),
    );

    vi.useRealTimers();
  });

  it('should return file ID on success', async () => {
    mockFindOrCreateFolder.mockResolvedValue('originals-folder-id');
    mockUploadFile.mockResolvedValue('uploaded-file-id');

    const result = await storeOriginal(mockDrive, CLIENT_FOLDER_ID, Buffer.from('pdf'), 'doc.pdf');

    expect(result).toBe('uploaded-file-id');
  });

  it('should return null when Originals/ folder resolution fails (does not throw)', async () => {
    mockFindOrCreateFolder.mockRejectedValue(new Error('Folder creation failed'));

    const result = await storeOriginal(mockDrive, CLIENT_FOLDER_ID, Buffer.from('pdf'), 'doc.pdf');

    expect(result).toBeNull();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('should return null when upload fails (does not throw)', async () => {
    mockFindOrCreateFolder.mockResolvedValue('originals-folder-id');
    mockUploadFile.mockRejectedValue(new Error('Upload quota exceeded'));

    const result = await storeOriginal(mockDrive, CLIENT_FOLDER_ID, Buffer.from('pdf'), 'doc.pdf');

    expect(result).toBeNull();
  });
});
