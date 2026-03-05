/**
 * Tests for Original Document Preservation Module
 *
 * Tests DEAL_SUBFOLDERS, BORROWER_SUBFOLDERS constants,
 * preCreateSubfolders function (deal-level + per-borrower),
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

import { DEAL_SUBFOLDERS, BORROWER_SUBFOLDERS, CLIENT_SUBFOLDERS, preCreateSubfolders, storeOriginal } from '../originals.js';
import type { DriveClient } from '../../classification/drive-client.js';

// ============================================================================
// Test Setup
// ============================================================================

const mockDrive = {} as DriveClient;
const DEAL_FOLDER_ID = 'deal-folder-123';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// DEAL_SUBFOLDERS
// ============================================================================

describe('DEAL_SUBFOLDERS', () => {
  it('should contain exactly 5 entries', () => {
    expect(DEAL_SUBFOLDERS).toHaveLength(5);
  });

  it('should contain the expected folder names with numbered prefixes', () => {
    expect(DEAL_SUBFOLDERS).toEqual([
      '1. Originals',
      '2. Needs Review',
      'Down Payment',
      'Property',
      'Signed Docs',
    ]);
  });
});

describe('BORROWER_SUBFOLDERS', () => {
  it('should contain exactly 3 entries', () => {
    expect(BORROWER_SUBFOLDERS).toHaveLength(3);
  });

  it('should contain ID, Income, Tax', () => {
    expect(BORROWER_SUBFOLDERS).toEqual(['ID', 'Income', 'Tax']);
  });
});

describe('CLIENT_SUBFOLDERS (deprecated alias)', () => {
  it('should equal DEAL_SUBFOLDERS', () => {
    expect(CLIENT_SUBFOLDERS).toBe(DEAL_SUBFOLDERS);
  });
});

// ============================================================================
// preCreateSubfolders
// ============================================================================

describe('preCreateSubfolders', () => {
  it('should create all DEAL_SUBFOLDERS when no borrowers provided', async () => {
    mockFindOrCreateFolder.mockImplementation(
      (_drive: DriveClient, name: string) => Promise.resolve(`${name}-folder-id`),
    );

    await preCreateSubfolders(mockDrive, DEAL_FOLDER_ID);

    expect(mockFindOrCreateFolder).toHaveBeenCalledTimes(DEAL_SUBFOLDERS.length);
    for (const name of DEAL_SUBFOLDERS) {
      expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, name, DEAL_FOLDER_ID);
    }
  });

  it('should return a Record mapping folder names to IDs (deal-level only)', async () => {
    mockFindOrCreateFolder.mockImplementation(
      (_drive: DriveClient, name: string) => Promise.resolve(`${name}-folder-id`),
    );

    const result = await preCreateSubfolders(mockDrive, DEAL_FOLDER_ID);

    expect(result).toEqual({
      '1. Originals': '1. Originals-folder-id',
      '2. Needs Review': '2. Needs Review-folder-id',
      'Down Payment': 'Down Payment-folder-id',
      'Property': 'Property-folder-id',
      'Signed Docs': 'Signed Docs-folder-id',
    });
  });

  it('should create borrower folders + inner subfolders when borrowers provided', async () => {
    mockFindOrCreateFolder.mockImplementation(
      (_drive: DriveClient, name: string) => Promise.resolve(`${name}-folder-id`),
    );

    const borrowers = [
      { firstName: 'John', lastName: 'Smith' },
      { firstName: 'Jane', lastName: 'Doe' },
    ];

    const result = await preCreateSubfolders(mockDrive, DEAL_FOLDER_ID, borrowers);

    // Deal subfolders (5) + 2 borrower folders + 2*3 inner subfolders = 13
    expect(mockFindOrCreateFolder).toHaveBeenCalledTimes(5 + 2 + 6);

    // Borrower folders created inside deal folder
    expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, 'Smith, John', DEAL_FOLDER_ID);
    expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, 'Doe, Jane', DEAL_FOLDER_ID);

    // Inner subfolders created inside borrower folders
    expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, 'ID', 'Smith, John-folder-id');
    expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, 'Income', 'Smith, John-folder-id');
    expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, 'Tax', 'Smith, John-folder-id');

    // Result includes borrower paths
    expect(result['Smith, John']).toBe('Smith, John-folder-id');
    expect(result['Smith, John/ID']).toBe('ID-folder-id');
    expect(result['Smith, John/Income']).toBe('Income-folder-id');
    expect(result['Smith, John/Tax']).toBe('Tax-folder-id');
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

    const result = await preCreateSubfolders(mockDrive, DEAL_FOLDER_ID);

    // Should have 4 entries (all except Property)
    expect(Object.keys(result)).toHaveLength(4);
    expect(result['Property']).toBeUndefined();
    expect(result['1. Originals']).toBe('1. Originals-folder-id');
  });

  it('should return empty record when all fail (does not throw)', async () => {
    mockFindOrCreateFolder.mockRejectedValue(new Error('Drive API down'));

    const result = await preCreateSubfolders(mockDrive, DEAL_FOLDER_ID);

    expect(result).toEqual({});
  });

  it('should skip borrower inner subfolders when borrower folder creation fails', async () => {
    mockFindOrCreateFolder.mockImplementation(
      (_drive: DriveClient, name: string) => {
        if (name === 'Smith, John') {
          return Promise.reject(new Error('Folder creation failed'));
        }
        return Promise.resolve(`${name}-folder-id`);
      },
    );

    const borrowers = [{ firstName: 'John', lastName: 'Smith' }];
    const result = await preCreateSubfolders(mockDrive, DEAL_FOLDER_ID, borrowers);

    // Deal subfolders created, but no borrower subfolders
    expect(result['Smith, John']).toBeUndefined();
    expect(result['Smith, John/ID']).toBeUndefined();
    expect(result['1. Originals']).toBe('1. Originals-folder-id');
  });
});

// ============================================================================
// storeOriginal
// ============================================================================

describe('storeOriginal', () => {
  it('should resolve 1. Originals/ folder then upload with timestamp prefix', async () => {
    mockFindOrCreateFolder.mockResolvedValue('originals-folder-id');
    mockUploadFile.mockResolvedValue('uploaded-file-id');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T12:00:00Z'));

    await storeOriginal(mockDrive, DEAL_FOLDER_ID, Buffer.from('pdf'), 'paystub.pdf');

    expect(mockFindOrCreateFolder).toHaveBeenCalledWith(mockDrive, '1. Originals', DEAL_FOLDER_ID);
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

    await storeOriginal(mockDrive, DEAL_FOLDER_ID, Buffer.from('pdf'), 'T4_2025.pdf');

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

    const result = await storeOriginal(mockDrive, DEAL_FOLDER_ID, Buffer.from('pdf'), 'doc.pdf');

    expect(result).toBe('uploaded-file-id');
  });

  it('should return null when 1. Originals/ folder resolution fails (does not throw)', async () => {
    mockFindOrCreateFolder.mockRejectedValue(new Error('Folder creation failed'));

    const result = await storeOriginal(mockDrive, DEAL_FOLDER_ID, Buffer.from('pdf'), 'doc.pdf');

    expect(result).toBeNull();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('should return null when upload fails (does not throw)', async () => {
    mockFindOrCreateFolder.mockResolvedValue('originals-folder-id');
    mockUploadFile.mockRejectedValue(new Error('Upload quota exceeded'));

    const result = await storeOriginal(mockDrive, DEAL_FOLDER_ID, Buffer.from('pdf'), 'doc.pdf');

    expect(result).toBeNull();
  });
});
