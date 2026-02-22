// ============================================================================
// Tests: Drive Folder Scanner
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseDocFromFilename,
  resolveDocumentType,
  listClientFolderFiles,
  scanClientFolder,
  extractDealReference,
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

  it('parses "YE Pay Stub" with mid-label year', () => {
    const result = parseDocFromFilename('Tabitha - YE 2025 Pay Stub $34k.pdf');
    expect(result).toEqual({
      borrowerName: 'Tabitha',
      docTypeLabel: 'Pay Stub',
      institution: 'YE',
      year: 2025,
      amount: '$34k',
    });
  });

  it('parses shorthand FHSA (without "Statement")', () => {
    const result = parseDocFromFilename('Tabitha - FHSA June 4 $16k.pdf');
    expect(result?.borrowerName).toBe('Tabitha');
    expect(result?.docTypeLabel).toBe('FHSA');
    expect(result?.amount).toBe('$16k');
  });

  it('parses shorthand RRSP with extra context', () => {
    const result = parseDocFromFilename('Andrew - RRSP 90 days $43k.pdf');
    expect(result?.borrowerName).toBe('Andrew');
    expect(result?.docTypeLabel).toBe('RRSP');
    expect(result?.amount).toBe('$43k');
  });

  it('parses colon-separated labels: "Savings:RSP"', () => {
    const result = parseDocFromFilename('Tabitha - April Statement Savings:RSP $140k.pdf');
    expect(result?.borrowerName).toBe('Tabitha');
    expect(result?.docTypeLabel).toBe('RSP');
    expect(result?.amount).toBe('$140k');
  });

  it('parses CRA SOA shorthand', () => {
    const result = parseDocFromFilename('Brigitte - CRA SOA Feb 4.pdf');
    expect(result?.borrowerName).toBe('Brigitte');
    expect(result?.docTypeLabel).toBe('CRA SOA');
    expect(result?.institution).toBe('Feb 4');
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

  it('resolves shorthand aliases', () => {
    expect(resolveDocumentType('FHSA')).toBe('fhsa_statement');
    expect(resolveDocumentType('RRSP')).toBe('rrsp_statement');
    expect(resolveDocumentType('RSP')).toBe('rrsp_statement');
    expect(resolveDocumentType('TFSA')).toBe('tfsa_statement');
    expect(resolveDocumentType('Chequing')).toBe('bank_statement');
  });

  it('resolves aliases case-insensitively', () => {
    expect(resolveDocumentType('fhsa')).toBe('fhsa_statement');
    expect(resolveDocumentType('rrsp')).toBe('rrsp_statement');
  });

  it('resolves CRA SOA alias', () => {
    expect(resolveDocumentType('CRA SOA')).toBe('cra_statement_of_account');
    expect(resolveDocumentType('cra soa')).toBe('cra_statement_of_account');
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

  it('uses flexible fallback for files without " - " separator', async () => {
    const drive = createMockDrive([
      { id: 'f1', name: 'Andrew CIBC FHSA Current Balance $24k.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
      { id: 'f2', name: 'RRSP 90 day Andrew $31k.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
      { id: 'f3', name: 'CIBC FHSA Andrew Jan-March $16k.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
    ]);

    const results = await scanClientFolder(drive, 'folder-id', ['Andrew']);
    expect(results).toHaveLength(3);
    expect(results[0].documentType).toBe('fhsa_statement');
    expect(results[0].borrowerName).toBe('Andrew');
    expect(results[1].documentType).toBe('rrsp_statement');
    expect(results[1].borrowerName).toBe('Andrew');
    expect(results[2].documentType).toBe('fhsa_statement');
    expect(results[2].borrowerName).toBe('Andrew');
  });

  it('flexible fallback skips files with no known borrower name', async () => {
    const drive = createMockDrive([
      { id: 'f1', name: 'CIBC #6937 Chequing 90 days $34k.pdf', mimeType: 'application/pdf', modifiedTime: '2025-04-01T00:00:00Z' },
    ]);

    const results = await scanClientFolder(drive, 'folder-id', ['Jane']);
    expect(results).toHaveLength(0);
  });
});

// ============================================================================
// extractDealReference
// ============================================================================

describe('extractDealReference', () => {
  const fallbackId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('extracts deal reference from standard format: "John - BRXM-F050382"', () => {
    expect(extractDealReference('John - BRXM-F050382', fallbackId)).toBe('BRXM-F050382');
  });

  it('uses lastIndexOf for multiple dashes: "John Smith - Jane - BRXM-F050382"', () => {
    expect(extractDealReference('John Smith - Jane - BRXM-F050382', fallbackId)).toBe('BRXM-F050382');
  });

  it('returns first 8 chars of fallbackId when no dash separator present', () => {
    expect(extractDealReference('JohnBRXMF050382', fallbackId)).toBe('a1b2c3d4');
  });

  it('returns first 8 chars of fallbackId when opportunityName is undefined', () => {
    expect(extractDealReference(undefined, fallbackId)).toBe('a1b2c3d4');
  });

  it('returns first 8 chars of fallbackId when string after dash is empty', () => {
    expect(extractDealReference('John - ', fallbackId)).toBe('a1b2c3d4');
  });

  it('trims whitespace from extracted reference', () => {
    expect(extractDealReference('John -   BRXM-F050382  ', fallbackId)).toBe('BRXM-F050382');
  });
});
