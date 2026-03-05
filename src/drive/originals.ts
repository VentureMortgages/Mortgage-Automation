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
 * Standard subfolders pre-created inside each deal folder.
 * Numbered prefixes ensure sort order in Google Drive.
 */
export const DEAL_SUBFOLDERS = [
  '1. Originals',
  '2. Needs Review',
  'Down Payment',
  'Property',
  'Signed Docs',
] as const;

/**
 * Subfolders pre-created inside each borrower folder within a deal.
 * Each borrower gets a "LastName, FirstName" folder containing these.
 */
export const BORROWER_SUBFOLDERS = [
  'ID',
  'Income',
  'Tax',
] as const;

/** @deprecated Use DEAL_SUBFOLDERS instead */
export const CLIENT_SUBFOLDERS = DEAL_SUBFOLDERS;

// ---------------------------------------------------------------------------
// Subfolder Pre-Creation
// ---------------------------------------------------------------------------

/** Borrower info needed for pre-creating per-borrower subfolders */
export interface BorrowerInfo {
  firstName: string;
  lastName: string;
}

/**
 * Pre-creates all standard subfolders inside a deal folder.
 *
 * Creates:
 * 1. Deal-level subfolders (1. Originals, 2. Needs Review, Down Payment, etc.)
 * 2. Per-borrower subfolders (LastName, FirstName/ID/, LastName, FirstName/Income/, etc.)
 *
 * Idempotent: uses findOrCreateFolder so running twice does not create duplicates.
 * Non-fatal: if an individual folder creation fails, logs the error and continues.
 * Sequential calls to avoid Drive API rate limits.
 *
 * @param drive - Google Drive API client
 * @param dealFolderId - The deal's Drive folder ID
 * @param borrowers - List of borrowers to create per-borrower subfolders for
 * @returns Record mapping folder name to folder ID (partial if some failed)
 */
export async function preCreateSubfolders(
  drive: DriveClient,
  dealFolderId: string,
  borrowers: BorrowerInfo[] = [],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // 1. Create deal-level subfolders
  for (const name of DEAL_SUBFOLDERS) {
    try {
      const folderId = await findOrCreateFolder(drive, name, dealFolderId);
      result[name] = folderId;
      console.log(`[originals] Pre-created deal subfolder "${name}" (${folderId})`);
    } catch (err) {
      console.error(`[originals] Failed to pre-create deal subfolder "${name}"`, {
        dealFolderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Create per-borrower subfolders
  for (const borrower of borrowers) {
    const borrowerFolderName = `${borrower.lastName}, ${borrower.firstName}`;
    try {
      const borrowerFolderId = await findOrCreateFolder(drive, borrowerFolderName, dealFolderId);
      result[borrowerFolderName] = borrowerFolderId;
      console.log(`[originals] Pre-created borrower folder "${borrowerFolderName}" (${borrowerFolderId})`);

      for (const subName of BORROWER_SUBFOLDERS) {
        try {
          const subId = await findOrCreateFolder(drive, subName, borrowerFolderId);
          result[`${borrowerFolderName}/${subName}`] = subId;
          console.log(`[originals] Pre-created borrower subfolder "${borrowerFolderName}/${subName}" (${subId})`);
        } catch (err) {
          console.error(`[originals] Failed to pre-create borrower subfolder "${borrowerFolderName}/${subName}"`, {
            dealFolderId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      console.error(`[originals] Failed to pre-create borrower folder "${borrowerFolderName}"`, {
        dealFolderId,
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
 * Stores a timestamped copy of the original file in the 1. Originals/ subfolder.
 *
 * Write-once: never checks for existing files, never reads back.
 * Re-uploading the same file creates a second copy with a different timestamp.
 * Non-fatal: returns null on any error (does not throw).
 *
 * @param drive - Google Drive API client
 * @param dealFolderId - The deal's Drive folder ID (or client folder as fallback)
 * @param pdfBuffer - PDF file content as Buffer
 * @param originalFilename - The original filename from the client
 * @returns The uploaded file's Drive ID, or null on error
 */
export async function storeOriginal(
  drive: DriveClient,
  dealFolderId: string,
  pdfBuffer: Buffer,
  originalFilename: string,
): Promise<string | null> {
  try {
    const originalsFolderId = await findOrCreateFolder(drive, '1. Originals', dealFolderId);
    const datePrefix = new Date().toISOString().slice(0, 10);
    const timestampedFilename = `${datePrefix}_${originalFilename}`;
    const fileId = await uploadFile(drive, pdfBuffer, timestampedFilename, originalsFolderId);
    return fileId;
  } catch (err) {
    console.error('[originals] Failed to store original', {
      dealFolderId,
      originalFilename,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
