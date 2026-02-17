// ============================================================================
// Tests: Drive Folder Scanner
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseDocFromFilename,
  resolveDocumentType,
  listClientFolderFiles,
  scanClientFolder,
} from '../folder-scanner.js';
import type { drive_v3 } from 'googleapis';

// ============================================================================
// parseDocFromFilename
// ============================================================================

describe('parseDocFromFilename', () => {
  it('parses standard format: "Name - DocType Year Amount.pdf"', () => {
    const result = parseDocFromFilename('Kathy - T4A CPP 2024 $16k.pdf');
    expect(result).toEqual({
      borrowerName: 'Kathy',
      docTypeLabel: 'T4A',
      institution: 'CPP',
      year: 2024,
      amount: '$16k',
    });
  });

  it('parses simple format: "Name - DocType.pdf"', () => {
    const result = parseDocFromFilename('Kathy - Void Cheque.pdf');
    expect(result).toEqual({
      borrowerName: 'Kathy',
      docTypeLabel: 'Void Cheque',
      institution: undefined,
      year: undefined,
      amount: undefined,
    });
  });

  it('parses doc with institution: "Name - Bank Statement RBC.pdf"', () => {
    const result = parseDocFromFilename('Mike - Bank Statement RBC 2024.pdf');
    expect(result).toEqual({
      borrowerName: 'Mike',
      docTypeLabel: 'Bank Statement',
      institution: 'RBC',
      year: 2024,
      amount: undefined,
    });
  });

  it('parses ID doc: "Name - ID.pdf"', () => {
    const result = parseDocFromFilename('Jane - ID.pdf');
    expect(result).toEqual({
      borrowerName: 'Jane',
      docTypeLabel: 'ID',
      institution: undefined,
      year: undefined,
      amount: undefined,
    });
  });

  it('parses LOE: "Name - LOE.pdf"', () => {
    const result = parseDocFromFilename('Sara - LOE.pdf');
    expect(result).toEqual({
      borrowerName: 'Sara',
      docTypeLabel: 'LOE',
      institution: undefined,
      year: undefined,
      amount: undefined,
    });
  });

  it('parses multi-word doc type: "Name - Pay Stub.pdf"', () => {
    const result = parseDocFromFilename('John - Pay Stub.pdf');
    expect(result).toEqual({
      borrowerName: 'John',
      docTypeLabel: 'Pay Stub',
      institution: undefined,
      year: undefined,
      amount: undefined,
    });
  });

  it('returns null for files without " - " separator', () => {
    expect(parseDocFromFilename('random-file.pdf')).toBeNull();
    expect(parseDocFromFilename('no-dash.docx')).toBeNull();
  });

  it('returns null for empty parts', () => {
    expect(parseDocFromFilename(' - .pdf')).toBeNull();
  });

  it('strips file extension', () => {
    const result = parseDocFromFilename('Jane - T4 2024.pdf');
    expect(result?.year).toBe(2024);
    expect(result?.docTypeLabel).toBe('T4');
  });

  it('handles .xlsx and other extensions', () => {
    const result = parseDocFromFilename('Jane - NOA 2024.xlsx');
    expect(result?.docTypeLabel).toBe('NOA');
    expect(result?.year).toBe(2024);
  });
});

// ============================================================================
// resolveDocumentType
// ============================================================================

describe('resolveDocumentType', () => {
  it('resolves exact label match', () => {
    expect(resolveDocumentType('T4')).toBe('t4');
    expect(resolveDocumentType('Pay Stub')).toBe('pay_stub');
    expect(resolveDocumentType('Void Cheque')).toBe('void_cheque');
    expect(resolveDocumentType('Bank Statement')).toBe('bank_statement');
  });

  it('resolves case-insensitive', () => {
    expect(resolveDocumentType('t4')).toBe('t4');
    expect(resolveDocumentType('pay stub')).toBe('pay_stub');
    expect(resolveDocumentType('VOID CHEQUE')).toBe('void_cheque');
  });

  it('resolves ID label', () => {
    expect(resolveDocumentType('ID')).toBe('photo_id');
  });

  it('resolves LOE label', () => {
    expect(resolveDocumentType('LOE')).toBe('loe');
  });

  it('returns null for unknown label', () => {
    expect(resolveDocumentType('Unknown Doc')).toBeNull();
  });

  it('does not false-match short labels via contains (e.g., "ID" in "Dividend")', () => {
    // "ID" is only 2 chars — should not match anything containing "id" as substring
    expect(resolveDocumentType('Dividend Statement')).toBeNull();
    expect(resolveDocumentType('Liquid Assets')).toBeNull();
  });
});

// ============================================================================
// listClientFolderFiles (with mocked Drive API)
// ============================================================================

describe('listClientFolderFiles', () => {
  function createMockDrive(folderContents: Record<string, drive_v3.Schema$File[]>) {
    return {
      files: {
        list: vi.fn(async ({ q }: { q: string }) => {
          // Extract folder ID from query: "'folderId' in parents..."
          const match = q.match(/'([^']+)' in parents/);
          const folderId = match?.[1] ?? '';
          return { data: { files: folderContents[folderId] ?? [] } };
        }),
      },
    } as unknown as drive_v3.Drive;
  }

  it('lists files from root folder', async () => {
    const drive = createMockDrive({
      'root-folder': [
        { id: 'f1', name: 'Jane - T4 2024.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
        { id: 'f2', name: 'Jane - Void Cheque.pdf', mimeType: 'application/pdf', modifiedTime: '2025-03-15T00:00:00Z' },
      ],
    });

    const files = await listClientFolderFiles(drive, 'root-folder');
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({
      fileId: 'f1',
      name: 'Jane - T4 2024.pdf',
      parentFolderName: 'root',
      modifiedTime: '2025-04-01T00:00:00Z',
    });
  });

  it('lists files from subfolders (one level deep)', async () => {
    const drive = createMockDrive({
      'root-folder': [
        { id: 'sub1', name: 'Jane', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2025-01-01T00:00:00Z' },
      ],
      'sub1': [
        { id: 'f1', name: 'Jane - LOE.pdf', mimeType: 'application/pdf', modifiedTime: '2025-06-01T00:00:00Z' },
      ],
    });

    const files = await listClientFolderFiles(drive, 'root-folder');
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      fileId: 'f1',
      name: 'Jane - LOE.pdf',
      parentFolderName: 'Jane',
      modifiedTime: '2025-06-01T00:00:00Z',
    });
  });

  it('skips nested subfolders (only one level deep)', async () => {
    const drive = createMockDrive({
      'root-folder': [
        { id: 'sub1', name: 'Jane', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2025-01-01T00:00:00Z' },
      ],
      'sub1': [
        { id: 'nested', name: 'Old', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2025-01-01T00:00:00Z' },
        { id: 'f1', name: 'Jane - T4 2024.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
      ],
    });

    const files = await listClientFolderFiles(drive, 'root-folder');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('Jane - T4 2024.pdf');
  });
});

// ============================================================================
// scanClientFolder
// ============================================================================

describe('scanClientFolder', () => {
  function createMockDrive(files: drive_v3.Schema$File[]) {
    return {
      files: {
        list: vi.fn(async () => ({
          data: { files },
        })),
      },
    } as unknown as drive_v3.Drive;
  }

  it('scans and returns parsed existing docs', async () => {
    const drive = createMockDrive([
      { id: 'f1', name: 'Jane - T4 2024.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
      { id: 'f2', name: 'Jane - Void Cheque.pdf', mimeType: 'application/pdf', modifiedTime: '2025-03-15T00:00:00Z' },
    ]);

    const results = await scanClientFolder(drive, 'folder-id', ['Jane']);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      fileId: 'f1',
      filename: 'Jane - T4 2024.pdf',
      documentType: 't4',
      borrowerName: 'Jane',
      year: 2024,
      modifiedTime: '2025-04-01T00:00:00Z',
    });
    expect(results[1].documentType).toBe('void_cheque');
  });

  it('skips files that cannot be parsed', async () => {
    const drive = createMockDrive([
      { id: 'f1', name: 'random-notes.pdf', mimeType: 'application/pdf', modifiedTime: '2025-01-01T00:00:00Z' },
      { id: 'f2', name: 'Jane - T4 2024.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
    ]);

    const results = await scanClientFolder(drive, 'folder-id', ['Jane']);
    expect(results).toHaveLength(1);
    expect(results[0].documentType).toBe('t4');
  });

  it('filters by borrower first names', async () => {
    const drive = createMockDrive([
      { id: 'f1', name: 'Jane - T4 2024.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
      { id: 'f2', name: 'Bob - T4 2024.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
    ]);

    const results = await scanClientFolder(drive, 'folder-id', ['Jane']);
    expect(results).toHaveLength(1);
    expect(results[0].borrowerName).toBe('Jane');
  });

  it('matches borrower names case-insensitively', async () => {
    const drive = createMockDrive([
      { id: 'f1', name: 'jane - T4 2024.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
    ]);

    const results = await scanClientFolder(drive, 'folder-id', ['Jane']);
    expect(results).toHaveLength(1);
  });

  it('skips docs with "other" document type', async () => {
    const drive = createMockDrive([
      { id: 'f1', name: 'Jane - Document.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
    ]);

    const results = await scanClientFolder(drive, 'folder-id', ['Jane']);
    expect(results).toHaveLength(0);
  });
});
