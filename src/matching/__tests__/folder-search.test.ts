/**
 * Tests for folder-search module — fuzzy Drive folder matching
 *
 * Before creating a new Drive folder, the system searches for existing folders
 * with fuzzy name matching. This prevents duplicate folder creation for clients
 * with hyphenated names, compound names, or different name orderings.
 *
 * Covers:
 * - normalizeName: tokenizes names into lowercase word arrays
 * - fuzzyNameMatch: checks if all search tokens appear in folder name tokens
 * - searchExistingFolders: Drive API search + fuzzy filter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockDriveFilesList = vi.fn();

// ---------------------------------------------------------------------------
// Import SUT
// ---------------------------------------------------------------------------

import { normalizeName, fuzzyNameMatch, searchExistingFolders } from '../folder-search.js';

// ---------------------------------------------------------------------------
// normalizeName tests
// ---------------------------------------------------------------------------

describe('normalizeName', () => {
  it('normalizes a compound hyphenated name with slash', () => {
    expect(normalizeName('Wong-Ranasinghe, Carolyn/Srimal')).toEqual([
      'wong', 'ranasinghe', 'carolyn', 'srimal',
    ]);
  });

  it('normalizes an uppercase last-first name', () => {
    expect(normalizeName('RANASINGHE, SRIMAL')).toEqual([
      'ranasinghe', 'srimal',
    ]);
  });

  it('normalizes a simple name', () => {
    expect(normalizeName('Smith, John')).toEqual(['smith', 'john']);
  });

  it('handles extra whitespace and periods', () => {
    expect(normalizeName('  St. Pierre , Jean-Luc  ')).toEqual([
      'st', 'pierre', 'jean', 'luc',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(normalizeName('')).toEqual([]);
  });

  it('handles single word names', () => {
    expect(normalizeName('Madonna')).toEqual(['madonna']);
  });
});

// ---------------------------------------------------------------------------
// fuzzyNameMatch tests
// ---------------------------------------------------------------------------

describe('fuzzyNameMatch', () => {
  it('matches RANASINGHE, SRIMAL against Wong-Ranasinghe, Carolyn/Srimal', () => {
    expect(fuzzyNameMatch('RANASINGHE, SRIMAL', 'Wong-Ranasinghe, Carolyn/Srimal')).toBe(true);
  });

  it('matches WONG, CAROLYN against Wong-Ranasinghe, Carolyn/Srimal', () => {
    expect(fuzzyNameMatch('WONG, CAROLYN', 'Wong-Ranasinghe, Carolyn/Srimal')).toBe(true);
  });

  it('does NOT match SMITH, JOHN against Wong-Ranasinghe, Carolyn/Srimal', () => {
    expect(fuzzyNameMatch('SMITH, JOHN', 'Wong-Ranasinghe, Carolyn/Srimal')).toBe(false);
  });

  it('does NOT match partial words (SMITH, JOHN vs Smith, Jonathan)', () => {
    // "john" should NOT match "jonathan" — exact word match required
    expect(fuzzyNameMatch('SMITH, JOHN', 'Smith, Jonathan')).toBe(false);
  });

  it('matches exact same name in different case/format', () => {
    expect(fuzzyNameMatch('smith, john', 'Smith, John')).toBe(true);
  });

  it('matches when search name tokens are a subset of folder name tokens', () => {
    expect(fuzzyNameMatch('Carolyn', 'Wong-Ranasinghe, Carolyn/Srimal')).toBe(true);
  });

  it('does NOT match when folder has fewer tokens than search', () => {
    expect(fuzzyNameMatch('Wong-Ranasinghe, Carolyn, Srimal, Extra', 'Wong, Carolyn')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchExistingFolders tests
// ---------------------------------------------------------------------------

describe('searchExistingFolders', () => {
  const mockDrive = {
    files: {
      list: mockDriveFilesList,
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns matching folder when fuzzy match exists', async () => {
    mockDriveFilesList.mockResolvedValue({
      data: {
        files: [
          { id: 'folder-abc', name: 'Wong-Ranasinghe, Carolyn/Srimal' },
        ],
      },
    });

    const result = await searchExistingFolders(mockDrive, 'Ranasinghe, Srimal', 'root-123');

    expect(result).toEqual({
      folderId: 'folder-abc',
      folderName: 'Wong-Ranasinghe, Carolyn/Srimal',
    });

    // Verify Drive API was called with name contains last name (lowercase)
    expect(mockDriveFilesList).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining('ranasinghe'),
      }),
    );
  });

  it('returns null when no folders match', async () => {
    mockDriveFilesList.mockResolvedValue({
      data: {
        files: [],
      },
    });

    const result = await searchExistingFolders(mockDrive, 'Nonexistent, Person', 'root-123');

    expect(result).toBeNull();
  });

  it('returns null when Drive returns folders but none fuzzy match', async () => {
    mockDriveFilesList.mockResolvedValue({
      data: {
        files: [
          { id: 'folder-xyz', name: 'Ranasinghe-Other, Different' },
        ],
      },
    });

    // Searching for "Smith, John" but Drive returned a Ranasinghe folder (name contains matched something)
    const result = await searchExistingFolders(mockDrive, 'Smith, John', 'root-123');

    expect(result).toBeNull();
  });

  it('returns null for multiple fuzzy matches (ambiguous) with logged warning', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockDriveFilesList.mockResolvedValue({
      data: {
        files: [
          { id: 'folder-1', name: 'Ranasinghe, Srimal' },
          { id: 'folder-2', name: 'Wong-Ranasinghe, Carolyn/Srimal' },
        ],
      },
    });

    const result = await searchExistingFolders(mockDrive, 'Ranasinghe, Srimal', 'root-123');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[folder-search]'),
      expect.objectContaining({
        searchName: 'Ranasinghe, Srimal',
      }),
    );

    consoleSpy.mockRestore();
  });

  it('handles Drive API errors gracefully (returns null)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockDriveFilesList.mockRejectedValue(new Error('Drive API unavailable'));

    const result = await searchExistingFolders(mockDrive, 'Smith, John', 'root-123');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[folder-search]'),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });

  it('filters results to only folders in the specified parent', async () => {
    mockDriveFilesList.mockResolvedValue({
      data: {
        files: [
          { id: 'folder-abc', name: 'Smith, John' },
        ],
      },
    });

    await searchExistingFolders(mockDrive, 'Smith, John', 'parent-456');

    expect(mockDriveFilesList).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("'parent-456' in parents"),
      }),
    );
  });

  it('queries Drive with folder mime type filter', async () => {
    mockDriveFilesList.mockResolvedValue({ data: { files: [] } });

    await searchExistingFolders(mockDrive, 'Smith, John', 'root-123');

    expect(mockDriveFilesList).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("mimeType = 'application/vnd.google-apps.folder'"),
      }),
    );
  });
});
