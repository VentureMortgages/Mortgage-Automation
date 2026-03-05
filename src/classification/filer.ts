/**
 * Google Drive Filer Module
 *
 * Provides operations for managing files and folders in Google Drive:
 * - findFolder: search for a folder by name within a parent
 * - createFolder: create a new folder within a parent
 * - findOrCreateFolder: idempotent folder resolution
 * - uploadFile: upload a PDF to a target folder
 * - findExistingFile: search for a file by name pattern (versioning)
 * - updateFileContent: replace an existing file's content (re-upload)
 * - resolveTargetFolder: map SubfolderTarget to the correct Drive folder ID
 * - escapeDriveQuery: escape single quotes for Drive API queries
 *
 * All functions accept a DriveClient as a parameter for testability.
 * Falls back to getDriveClient() if no client is provided.
 *
 * Implements FILE-03 (file to correct Drive folder) and FILE-04 (handle re-uploads).
 */

import { Readable } from 'node:stream';
import { getDriveClient } from './drive-client.js';
import type { DriveClient } from './drive-client.js';
import type { SubfolderTarget } from './types.js';

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

/**
 * Escapes single quotes in Drive API query strings to prevent query injection.
 * The Drive API uses single quotes for string literals in queries.
 */
export function escapeDriveQuery(str: string): string {
  return str.replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Folder Operations
// ---------------------------------------------------------------------------

/**
 * Finds a folder by name within a parent folder.
 *
 * @param drive - Google Drive API client
 * @param name - Exact folder name to search for
 * @param parentId - Parent folder's Drive ID
 * @returns Folder ID if found, null otherwise
 */
export async function findFolder(
  drive: DriveClient,
  name: string,
  parentId: string,
): Promise<string | null> {
  const query =
    `name = '${escapeDriveQuery(name)}' and '${parentId}' in parents ` +
    `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  const files = response.data.files;
  if (files && files.length > 0 && files[0].id) {
    return files[0].id;
  }

  return null;
}

/**
 * Creates a new folder within a parent folder.
 *
 * @param drive - Google Drive API client
 * @param name - Folder name to create
 * @param parentId - Parent folder's Drive ID
 * @returns The created folder's Drive ID
 */
export async function createFolder(
  drive: DriveClient,
  name: string,
  parentId: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  const folderId = response.data.id;
  if (!folderId) {
    throw new Error(`Drive API returned no ID after creating folder "${name}"`);
  }

  return folderId;
}

/**
 * Finds an existing folder by name, or creates one if it doesn't exist.
 * Idempotent: safe to call multiple times for the same folder.
 *
 * @param drive - Google Drive API client
 * @param name - Folder name
 * @param parentId - Parent folder's Drive ID
 * @returns The folder's Drive ID (existing or newly created)
 */
export async function findOrCreateFolder(
  drive: DriveClient,
  name: string,
  parentId: string,
): Promise<string> {
  const existingId = await findFolder(drive, name, parentId);

  if (existingId) {
    console.log(`[filer] Found existing folder "${name}" (${existingId})`);
    return existingId;
  }

  const newId = await createFolder(drive, name, parentId);
  console.log(`[filer] Created new folder "${name}" (${newId})`);
  return newId;
}

// ---------------------------------------------------------------------------
// File Operations
// ---------------------------------------------------------------------------

/**
 * Uploads a PDF buffer as a file to a target Drive folder.
 *
 * @param drive - Google Drive API client
 * @param pdfBuffer - PDF file content as Buffer
 * @param filename - Target filename (e.g., "Terry - T4 2024 $16k.pdf")
 * @param parentFolderId - Target folder's Drive ID
 * @returns The uploaded file's Drive ID
 */
export async function uploadFile(
  drive: DriveClient,
  pdfBuffer: Buffer,
  filename: string,
  parentFolderId: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [parentFolderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(pdfBuffer),
    },
    fields: 'id, name, webViewLink',
  });

  const fileId = response.data.id;
  if (!fileId) {
    throw new Error(`Drive API returned no ID after uploading "${filename}"`);
  }

  console.log(
    `[filer] Uploaded "${filename}" to folder ${parentFolderId} (file ID: ${fileId})`,
  );
  return fileId;
}

/**
 * Finds an existing file by name pattern in a folder.
 * Used for versioning: detect if a document of the same type already exists.
 *
 * @param drive - Google Drive API client
 * @param filenamePattern - Substring to search for in file names
 * @param parentFolderId - Folder to search in
 * @returns File ID and name if found, null otherwise
 */
export async function findExistingFile(
  drive: DriveClient,
  filenamePattern: string,
  parentFolderId: string,
): Promise<{ id: string; name: string } | null> {
  const query =
    `name contains '${escapeDriveQuery(filenamePattern)}' ` +
    `and '${parentFolderId}' in parents and trashed = false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name, modifiedTime)',
    pageSize: 1,
  });

  const files = response.data.files;
  if (files && files.length > 0 && files[0].id && files[0].name) {
    return { id: files[0].id, name: files[0].name };
  }

  return null;
}

/**
 * Updates an existing file's content (and optionally its name).
 * Used for FILE-04: replacing an existing document with an updated version.
 *
 * @param drive - Google Drive API client
 * @param fileId - Drive ID of the file to update
 * @param pdfBuffer - New PDF content
 * @param newFilename - Optional new filename (renames the file if provided)
 */
export async function updateFileContent(
  drive: DriveClient,
  fileId: string,
  pdfBuffer: Buffer,
  newFilename?: string,
): Promise<void> {
  await drive.files.update({
    fileId,
    requestBody: newFilename ? { name: newFilename } : {},
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(pdfBuffer),
    },
  });

  console.log(
    `[filer] Updated file ${fileId}${newFilename ? ` (renamed to "${newFilename}")` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Target Folder Resolution
// ---------------------------------------------------------------------------

/** Maps SubfolderTarget values to Drive folder names */
const SUBFOLDER_NAMES: Partial<Record<SubfolderTarget, string>> = {
  subject_property: 'Property',
  non_subject_property: 'Property',
  down_payment: 'Down Payment',
  signed_docs: 'Signed Docs',
};

/** Maps person sub-target to inner borrower subfolder name */
const PERSON_INNER_FOLDERS: Record<string, string> = {
  person_id: 'ID',
  person_income: 'Income',
  person_tax: 'Tax',
};

/**
 * Resolves a SubfolderTarget to a concrete Drive folder ID.
 *
 * All paths resolve relative to baseFolderId (typically the deal folder).
 *
 * - 'root': returns baseFolderId directly (no subfolder)
 * - 'person': finds/creates a borrower subfolder (e.g., "Smith, John")
 * - 'person_id/person_income/person_tax': borrower subfolder + inner folder (ID/Income/Tax)
 * - Others: finds/creates the standard subfolder (e.g., "Property", "Down Payment")
 *
 * @param drive - Google Drive API client
 * @param baseFolderId - The base Drive folder ID (deal folder or client folder)
 * @param subfolderTarget - Target subfolder type from SUBFOLDER_ROUTING
 * @param personName - Borrower name in "LastName, FirstName" format (used for person* targets)
 * @returns The resolved Drive folder ID
 */
export async function resolveTargetFolder(
  drive: DriveClient,
  baseFolderId: string,
  subfolderTarget: SubfolderTarget,
  personName: string,
): Promise<string> {
  if (subfolderTarget === 'root') {
    return baseFolderId;
  }

  // Person targets: resolve borrower folder, then optional inner folder
  if (subfolderTarget === 'person') {
    return findOrCreateFolder(drive, personName, baseFolderId);
  }

  const innerFolder = PERSON_INNER_FOLDERS[subfolderTarget];
  if (innerFolder) {
    const borrowerFolderId = await findOrCreateFolder(drive, personName, baseFolderId);
    return findOrCreateFolder(drive, innerFolder, borrowerFolderId);
  }

  const folderName = SUBFOLDER_NAMES[subfolderTarget];
  if (!folderName) {
    throw new Error(`Unknown subfolder target: ${subfolderTarget}`);
  }

  return findOrCreateFolder(drive, folderName, baseFolderId);
}
