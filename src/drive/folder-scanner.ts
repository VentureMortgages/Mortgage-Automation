// ============================================================================
// Drive Folder Scanner — Scans client folders for existing documents
// ============================================================================
//
// Scans a client's Google Drive folder (+ one level of subfolders) and parses
// Cat's file naming convention to identify which documents are already on file.
//
// This enables the "returning client" optimization: skip requesting docs that
// the client already submitted for a previous application.
//
// Naming convention: "Name - DocType [Institution] [Year] [Amount].pdf"
// Examples:
//   "Kathy - T4A CPP 2024 $16k.pdf"
//   "Kathy - Void Cheque.pdf"
//   "Mike - Bank Statement RBC 2024.pdf"

import type { DriveClient } from '../classification/drive-client.js';
import type { DocumentType } from '../classification/types.js';
import { DOC_TYPE_LABELS } from '../classification/types.js';
import { escapeDriveQuery } from '../classification/filer.js';

// ============================================================================
// Types
// ============================================================================

export interface DriveFileEntry {
  fileId: string;
  name: string;
  parentFolderName: string;
  modifiedTime: string;
}

export interface ParsedDoc {
  borrowerName: string;
  docTypeLabel: string;
  institution?: string;
  year?: number;
  amount?: string;
}

export interface ExistingDoc {
  fileId: string;
  filename: string;
  documentType: DocumentType;
  borrowerName: string;
  year?: number;
  modifiedTime: string;
}

// ============================================================================
// Label-to-DocumentType reverse mapping
// ============================================================================

/** Reverse map: label (lowercase) -> DocumentType */
const LABEL_TO_DOC_TYPE: Map<string, DocumentType> = new Map();
for (const [docType, label] of Object.entries(DOC_TYPE_LABELS)) {
  LABEL_TO_DOC_TYPE.set(label.toLowerCase(), docType as DocumentType);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Lists all files in a client folder + one level of subfolders.
 *
 * Returns a flat array of file entries with parent folder context.
 * Folders themselves are not included in the output.
 */
export async function listClientFolderFiles(
  drive: DriveClient,
  clientFolderId: string,
): Promise<DriveFileEntry[]> {
  const entries: DriveFileEntry[] = [];

  // List root contents (files + folders)
  const rootItems = await listFolderContents(drive, clientFolderId);

  const subfolders: { id: string; name: string }[] = [];

  for (const item of rootItems) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      subfolders.push({ id: item.id!, name: item.name! });
    } else {
      entries.push({
        fileId: item.id!,
        name: item.name!,
        parentFolderName: 'root',
        modifiedTime: item.modifiedTime!,
      });
    }
  }

  // List contents of each subfolder (one level deep)
  for (const folder of subfolders) {
    const subItems = await listFolderContents(drive, folder.id);
    for (const item of subItems) {
      if (item.mimeType !== 'application/vnd.google-apps.folder') {
        entries.push({
          fileId: item.id!,
          name: item.name!,
          parentFolderName: folder.name,
          modifiedTime: item.modifiedTime!,
        });
      }
    }
  }

  return entries;
}

/**
 * Parses Cat's filename convention into structured parts.
 *
 * Format: "Name - DocType [Institution] [Year] [Amount].ext"
 *
 * Returns null if the filename doesn't match the convention (no " - " separator).
 */
export function parseDocFromFilename(filename: string): ParsedDoc | null {
  // Strip extension
  const base = filename.replace(/\.[^.]+$/, '');

  // Split on " - " (Name - Rest)
  const dashIdx = base.indexOf(' - ');
  if (dashIdx < 0) return null;

  const borrowerName = base.slice(0, dashIdx).trim();
  const rest = base.slice(dashIdx + 3).trim();
  if (!borrowerName || !rest) return null;

  // Parse the rest: DocType tokens, optional year, optional amount, optional institution
  const tokens = rest.split(/\s+/);

  let year: number | undefined;
  let amount: string | undefined;
  const labelTokens: string[] = [];
  const extraTokens: string[] = [];

  for (const token of tokens) {
    // Year: 4-digit number between 2000-2099
    if (/^20\d{2}$/.test(token)) {
      year = parseInt(token, 10);
    }
    // Amount: starts with $
    else if (token.startsWith('$')) {
      amount = token;
    }
    // Doc type label tokens come first, institution tokens come after
    else {
      // Heuristic: once we've seen a year or amount, remaining tokens are institution
      if (year !== undefined || amount !== undefined) {
        extraTokens.push(token);
      } else {
        labelTokens.push(token);
      }
    }
  }

  // The doc type label is the first meaningful tokens
  // Institution is what's left after extracting doc type label
  // We try progressively shorter prefixes to find a known doc type label
  let docTypeLabel = '';
  let institution: string | undefined;

  // Try matching from longest possible label to shortest
  for (let i = labelTokens.length; i >= 1; i--) {
    const candidate = labelTokens.slice(0, i).join(' ');
    if (LABEL_TO_DOC_TYPE.has(candidate.toLowerCase())) {
      docTypeLabel = candidate;
      const remainingTokens = [...labelTokens.slice(i), ...extraTokens];
      if (remainingTokens.length > 0) {
        institution = remainingTokens.join(' ');
      }
      break;
    }
  }

  // If no known label matched, use all label tokens as the doc type
  if (!docTypeLabel) {
    docTypeLabel = labelTokens.join(' ');
    if (extraTokens.length > 0) {
      institution = extraTokens.join(' ');
    }
  }

  return {
    borrowerName,
    docTypeLabel,
    institution,
    year,
    amount,
  };
}

/**
 * Resolves a parsed doc type label to a DocumentType enum value.
 *
 * Uses exact match first, then case-insensitive contains match
 * (only for labels >= 3 chars to avoid false positives from short
 * labels like "ID" matching "dividend", "liquid", etc.).
 */
export function resolveDocumentType(docTypeLabel: string): DocumentType | null {
  // Exact match (case-insensitive)
  const exact = LABEL_TO_DOC_TYPE.get(docTypeLabel.toLowerCase());
  if (exact) return exact;

  // Contains match — only for labels >= 3 chars to avoid false positives
  const lower = docTypeLabel.toLowerCase();
  for (const [label, docType] of LABEL_TO_DOC_TYPE) {
    if (label.length < 3 || lower.length < 3) continue;
    if (label.includes(lower) || lower.includes(label)) {
      return docType;
    }
  }

  return null;
}

/**
 * Scans a client's Drive folder for existing documents.
 *
 * Orchestrates the full scan: list files, parse filenames, resolve types.
 * Files that can't be parsed or resolved are silently skipped.
 *
 * @param drive - Authenticated Drive client
 * @param clientFolderId - The client's root folder ID in Drive
 * @param borrowerFirstNames - First names of borrowers on the new application (for filtering)
 * @returns Array of existing documents found in the folder
 */
export async function scanClientFolder(
  drive: DriveClient,
  clientFolderId: string,
  borrowerFirstNames: string[],
): Promise<ExistingDoc[]> {
  const files = await listClientFolderFiles(drive, clientFolderId);
  const results: ExistingDoc[] = [];

  const normalizedNames = new Set(borrowerFirstNames.map(n => n.toLowerCase()));

  for (const file of files) {
    const parsed = parseDocFromFilename(file.name);
    if (!parsed) continue;

    // Only include files belonging to borrowers on this application
    if (normalizedNames.size > 0 && !normalizedNames.has(parsed.borrowerName.toLowerCase())) {
      continue;
    }

    const docType = resolveDocumentType(parsed.docTypeLabel);
    if (!docType || docType === 'other') continue;

    results.push({
      fileId: file.fileId,
      filename: file.name,
      documentType: docType,
      borrowerName: parsed.borrowerName,
      year: parsed.year,
      modifiedTime: file.modifiedTime,
    });
  }

  return results;
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Lists contents of a single Drive folder (handles pagination) */
async function listFolderContents(
  drive: DriveClient,
  folderId: string,
): Promise<{ id?: string | null; name?: string | null; mimeType?: string | null; modifiedTime?: string | null }[]> {
  const items: { id?: string | null; name?: string | null; mimeType?: string | null; modifiedTime?: string | null }[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${escapeDriveQuery(folderId)}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: 100,
      pageToken,
    });

    if (res.data.files) {
      items.push(...res.data.files);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return items;
}
