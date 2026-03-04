/**
 * ZIP Extractor — Extract documents from ZIP attachments
 *
 * Finmo and clients sometimes send document packages as ZIP files.
 * This module extracts individual files from ZIPs so each document
 * can be processed through the normal classify→match→file pipeline.
 *
 * Behavior:
 * - Extracts all files from the ZIP (non-directories)
 * - Skips hidden files (starting with . or __MACOSX)
 * - Determines MIME type from file extension
 * - Returns extracted files as {filename, mimeType, buffer} tuples
 *
 * Consumers: intake-worker.ts, admin/test-intake.ts
 */

import AdmZip from 'adm-zip';
import { extname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

// ---------------------------------------------------------------------------
// MIME Type from Extension
// ---------------------------------------------------------------------------

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function mimeFromExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// ZIP Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts processable documents from a ZIP buffer.
 *
 * Filters out:
 * - Directories
 * - macOS resource forks (__MACOSX/*)
 * - Hidden files (.*)
 * - Empty files
 *
 * @param zipBuffer - Raw ZIP file bytes
 * @param zipFilename - Original ZIP filename (for logging)
 * @returns Array of extracted files with MIME types inferred from extension
 */
export function extractFromZip(zipBuffer: Buffer, zipFilename: string): ExtractedFile[] {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const files: ExtractedFile[] = [];

  for (const entry of entries) {
    // Skip directories
    if (entry.isDirectory) continue;

    const name = entry.entryName;

    // Skip macOS resource fork metadata
    if (name.startsWith('__MACOSX/') || name.includes('/__MACOSX/')) continue;

    // Skip hidden files
    const basename = name.split('/').pop() ?? name;
    if (basename.startsWith('.')) continue;

    // Skip empty entries
    const data = entry.getData();
    if (data.length === 0) continue;

    files.push({
      filename: basename,
      mimeType: mimeFromExtension(basename),
      buffer: data,
    });
  }

  console.log(`[zip-extractor] Extracted ${files.length} files from ${zipFilename}`, {
    filenames: files.map(f => f.filename),
  });

  return files;
}

/**
 * Check if a MIME type is a ZIP archive.
 */
export function isZipMimeType(mimeType: string): boolean {
  return mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed' ||
    mimeType === 'application/x-zip';
}
