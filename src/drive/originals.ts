/**
 * Original Document Preservation Module
 *
 * Provides utilities for preserving original documents before classification:
 * - CLIENT_SUBFOLDERS: standard subfolder names pre-created in every client folder
 * - preCreateSubfolders: idempotent creation of all standard subfolders
 * - storeOriginal: saves a timestamped copy of the original file to Originals/
 *
 * All operations are non-fatal — errors are logged but never thrown.
 * This is the safety net: Cat can always find the original file even if
 * classification was wrong or the file was renamed.
 *
 * Implements ORIG-03 (no overwrite on re-upload — each upload creates a new file).
 */

import { findOrCreateFolder, uploadFile } from '../classification/filer.js';
import type { DriveClient } from '../classification/drive-client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Standard subfolders pre-created in every client folder.
 * Derived from Cat's doc categories (DOC_CHECKLIST_RULES_V2 sections)
 * plus Originals/ (safety net) and Needs Review/ (low-confidence routing).
 */
export const CLIENT_SUBFOLDERS = [
  'Income',
  'Property',
  'Down Payment',
  'ID',
  'Originals',
  'Needs Review',
  'Signed Docs',
] as const;

// ---------------------------------------------------------------------------
// Subfolder Pre-Creation
// ---------------------------------------------------------------------------

/**
 * Pre-creates all standard subfolders in a client folder.
 *
 * Idempotent: uses findOrCreateFolder so running twice does not create duplicates.
 * Non-fatal: if an individual folder creation fails, logs the error and continues.
 * Sequential calls to avoid Drive API rate limits.
 *
 * @param drive - Google Drive API client
 * @param clientFolderId - The client's root Drive folder ID
 * @returns Record mapping folder name to folder ID (partial if some failed)
 */
export async function preCreateSubfolders(
  drive: DriveClient,
  clientFolderId: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const name of CLIENT_SUBFOLDERS) {
    try {
      const folderId = await findOrCreateFolder(drive, name, clientFolderId);
      result[name] = folderId;
      console.log(`[originals] Pre-created subfolder "${name}" (${folderId})`);
    } catch (err) {
      console.error(`[originals] Failed to pre-create subfolder "${name}"`, {
        clientFolderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Original File Storage
// ---------------------------------------------------------------------------

/**
 * Stores a timestamped copy of the original file in the Originals/ subfolder.
 *
 * Write-once: never checks for existing files, never reads back.
 * Re-uploading the same file creates a second copy with a different timestamp.
 * Non-fatal: returns null on any error (does not throw).
 *
 * @param drive - Google Drive API client
 * @param clientFolderId - The client's root Drive folder ID
 * @param pdfBuffer - PDF file content as Buffer
 * @param originalFilename - The original filename from the client
 * @returns The uploaded file's Drive ID, or null on error
 */
export async function storeOriginal(
  drive: DriveClient,
  clientFolderId: string,
  pdfBuffer: Buffer,
  originalFilename: string,
): Promise<string | null> {
  try {
    const originalsFolderId = await findOrCreateFolder(drive, 'Originals', clientFolderId);
    const datePrefix = new Date().toISOString().slice(0, 10);
    const timestampedFilename = `${datePrefix}_${originalFilename}`;
    const fileId = await uploadFile(drive, pdfBuffer, timestampedFilename, originalsFolderId);
    return fileId;
  } catch (err) {
    console.error('[originals] Failed to store original', {
      clientFolderId,
      originalFilename,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
