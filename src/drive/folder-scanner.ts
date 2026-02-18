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

/** Aliases for shorthand labels Cat sometimes uses (e.g., "FHSA" instead of "FHSA Statement") */
const DOC_TYPE_ALIASES: Map<string, DocumentType> = new Map([
  ['fhsa', 'fhsa_statement'],
  ['rrsp', 'rrsp_statement'],
  ['rsp', 'rrsp_statement'],
  ['tfsa', 'tfsa_statement'],
  ['chequing', 'bank_statement'],
  ['checking', 'bank_statement'],
  ['cra soa', 'cra_statement_of_account'],
]);

/** Check if a label matches a known doc type or alias */
function isKnownLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return LABEL_TO_DOC_TYPE.has(lower) || DOC_TYPE_ALIASES.has(lower);
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

  return parseDocTokens(rest, borrowerName);
}

/**
 * Parses the doc-type portion of a filename into structured parts.
 * Shared by both standard parse (after " - ") and flexible parse.
 */
function parseDocTokens(rest: string, borrowerName: string): ParsedDoc {
  // Tokenize: split on whitespace, then also split on colons (e.g., "Savings:RSP")
  const rawTokens = rest.split(/\s+/);
  const tokens: string[] = [];
  for (const t of rawTokens) {
    if (t.includes(':')) {
      tokens.push(...t.split(':').filter(Boolean));
    } else {
      tokens.push(t);
    }
  }

  // Separate years, amounts, and word tokens
  let year: number | undefined;
  let amount: string | undefined;
  const wordTokens: string[] = [];

  for (const token of tokens) {
    if (/^20\d{2}$/.test(token)) {
      year = parseInt(token, 10);
    } else if (token.startsWith('$')) {
      amount = token;
    } else {
      wordTokens.push(token);
    }
  }

  // Try matching doc type at any position within wordTokens (longest first).
  // This handles cases like "YE 2025 Pay Stub" where the year splits the
  // non-label prefix from the actual doc type label.
  let docTypeLabel = '';
  let institution: string | undefined;

  for (let len = wordTokens.length; len >= 1; len--) {
    for (let start = 0; start <= wordTokens.length - len; start++) {
      const candidate = wordTokens.slice(start, start + len).join(' ');
      if (isKnownLabel(candidate)) {
        docTypeLabel = candidate;
        const before = wordTokens.slice(0, start);
        const after = wordTokens.slice(start + len);
        const remaining = [...before, ...after];
        if (remaining.length > 0) {
          institution = remaining.join(' ');
        }
        break;
      }
    }
    if (docTypeLabel) break;
  }

  // If no known label matched, use all word tokens as the doc type
  if (!docTypeLabel) {
    docTypeLabel = wordTokens.join(' ');
  }

  return { borrowerName, docTypeLabel, institution, year, amount };
}

/**
 * Resolves a parsed doc type label to a DocumentType enum value.
 *
 * Checks: exact label match → alias match → contains match (≥3 chars).
 */
export function resolveDocumentType(docTypeLabel: string): DocumentType | null {
  const lower = docTypeLabel.toLowerCase();

  // Exact label match
  const exact = LABEL_TO_DOC_TYPE.get(lower);
  if (exact) return exact;

  // Alias match
  const alias = DOC_TYPE_ALIASES.get(lower);
  if (alias) return alias;

  // Contains match — only for labels >= 3 chars to avoid false positives
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
    // Try standard parse first, then flexible fallback for non-standard names
    let parsed = parseDocFromFilename(file.name);
    if (!parsed) {
      parsed = parseDocFlexible(file.name, normalizedNames);
    }
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

/**
 * Flexible fallback parser for files without the standard "Name - DocType" format.
 *
 * Handles Cat's alternative naming patterns:
 *   "Andrew CIBC FHSA Current Balance $24k.pdf" (name without " - ")
 *   "RRSP 90 day Andrew $31k.pdf"               (name after doc type)
 *   "CIBC FHSA Andrew Jan-March $16k.pdf"        (name in middle)
 *
 * Requires known borrower names to identify the borrower in the filename.
 * Returns null if no borrower name found or no doc type resolved.
 */
function parseDocFlexible(filename: string, knownNames: Set<string>): ParsedDoc | null {
  const base = filename.replace(/\.[^.]+$/, '');
  const rawTokens = base.split(/[\s:]+/).filter(Boolean);

  // Separate years, amounts, and word tokens
  let year: number | undefined;
  let amount: string | undefined;
  const wordTokens: string[] = [];

  for (const token of rawTokens) {
    if (/^20\d{2}$/.test(token)) {
      year = parseInt(token, 10);
    } else if (token.startsWith('$')) {
      amount = token;
    } else {
      wordTokens.push(token);
    }
  }

  // Find a known borrower name in the tokens
  let borrowerName: string | null = null;
  let nameIndex = -1;

  for (let i = 0; i < wordTokens.length; i++) {
    if (knownNames.has(wordTokens[i].toLowerCase())) {
      borrowerName = wordTokens[i];
      nameIndex = i;
      break;
    }
  }

  if (!borrowerName) return null;

  // Remove borrower name from tokens, try to find doc type in the rest
  const docTokens = [...wordTokens.slice(0, nameIndex), ...wordTokens.slice(nameIndex + 1)];

  let docTypeLabel = '';
  let institution: string | undefined;

  for (let len = docTokens.length; len >= 1; len--) {
    for (let start = 0; start <= docTokens.length - len; start++) {
      const candidate = docTokens.slice(start, start + len).join(' ');
      if (isKnownLabel(candidate)) {
        docTypeLabel = candidate;
        const before = docTokens.slice(0, start);
        const after = docTokens.slice(start + len);
        const remaining = [...before, ...after];
        if (remaining.length > 0) {
          institution = remaining.join(' ');
        }
        break;
      }
    }
    if (docTypeLabel) break;
  }

  if (!docTypeLabel) return null;

  return { borrowerName, docTypeLabel, institution, year, amount };
}

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
