/**
 * Fuzzy Drive Folder Search Module
 *
 * Before creating a new Drive folder, searches for existing folders with
 * fuzzy name matching. Prevents duplicate folder creation for clients with
 * hyphenated names, compound names, or different name orderings.
 *
 * Example: Searching for "RANASINGHE, SRIMAL" finds existing folder
 * "Wong-Ranasinghe, Carolyn/Srimal" because both "ranasinghe" and "srimal"
 * appear as tokens in the folder name.
 *
 * Implements FWD-02 (Drive folder matching before auto-create).
 */

import { escapeDriveQuery } from '../classification/filer.js';
import type { DriveClient } from '../classification/drive-client.js';

// ---------------------------------------------------------------------------
// Name Normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a name into an array of lowercase word tokens.
 *
 * Handles: hyphens, commas, slashes, periods, extra whitespace.
 * e.g., "Wong-Ranasinghe, Carolyn/Srimal" -> ["wong", "ranasinghe", "carolyn", "srimal"]
 *
 * @param name - Raw name string (any case/format)
 * @returns Array of lowercase name tokens
 */
export function normalizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[,/.\-()]/g, ' ')   // Replace punctuation with spaces
    .split(/\s+/)                  // Split on whitespace
    .filter((token) => token.length > 0);  // Remove empty strings
}

// ---------------------------------------------------------------------------
// Fuzzy Name Matching
// ---------------------------------------------------------------------------

/**
 * Checks if all tokens from the search name appear as exact words in the folder name.
 *
 * This is intentionally strict: "john" does NOT match "jonathan" because we
 * require exact token equality, not substring matching.
 *
 * @param searchName - The name being searched for (e.g., "RANASINGHE, SRIMAL")
 * @param folderName - The existing folder name (e.g., "Wong-Ranasinghe, Carolyn/Srimal")
 * @returns true if ALL search tokens are found in folder name tokens
 */
export function fuzzyNameMatch(searchName: string, folderName: string): boolean {
  const searchTokens = normalizeName(searchName);
  const folderTokens = new Set(normalizeName(folderName));

  if (searchTokens.length === 0) return false;

  return searchTokens.every((token) => folderTokens.has(token));
}

// ---------------------------------------------------------------------------
// Return Type
// ---------------------------------------------------------------------------

/**
 * Result from searching existing Drive folders.
 *
 * - `match`: the single unambiguous folder match, or null if 0 or 2+ matches
 * - `allMatches`: every folder that fuzzy-matched (used to present options when ambiguous)
 */
export interface FolderSearchResult {
  match: { folderId: string; folderName: string } | null;
  allMatches: Array<{ folderId: string; folderName: string }>;
}

// ---------------------------------------------------------------------------
// Drive API Search
// ---------------------------------------------------------------------------

/**
 * Searches the Drive root folder for existing folders that fuzzy-match the client name.
 *
 * Strategy:
 * 1. Extract the last name (first token) from the client name
 * 2. Query Drive API with `name contains '{lastName}'` for broad candidate retrieval
 * 3. Apply fuzzyNameMatch() on each candidate for precise filtering
 * 4. Return FolderSearchResult with match (if exactly 1) and allMatches (all candidates)
 *
 * @param drive - Google Drive API client
 * @param clientName - Client name in "LastName, FirstName" format
 * @param rootFolderId - Drive root folder ID to search within
 * @returns FolderSearchResult with match and allMatches
 */
export async function searchExistingFolders(
  drive: DriveClient,
  clientName: string,
  rootFolderId: string,
): Promise<FolderSearchResult> {
  try {
    // Extract last name (first token of the normalized name, since format is "LastName, FirstName")
    const tokens = normalizeName(clientName);
    if (tokens.length === 0) return { match: null, allMatches: [] };

    // Use the first token (last name) for the broad Drive API search
    const lastName = tokens[0];

    const query =
      `name contains '${escapeDriveQuery(lastName)}' ` +
      `and '${rootFolderId}' in parents ` +
      `and mimeType = 'application/vnd.google-apps.folder' ` +
      `and trashed = false`;

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      pageSize: 100,
    });

    const candidates = response.data.files ?? [];

    // Apply fuzzy matching to filter candidates
    const matches = candidates.filter(
      (f) => f.id && f.name && fuzzyNameMatch(clientName, f.name),
    );

    const allMatches = matches.map((m) => ({
      folderId: m.id!,
      folderName: m.name!,
    }));

    if (matches.length === 0) {
      return { match: null, allMatches: [] };
    }

    if (matches.length === 1) {
      return {
        match: { folderId: matches[0].id!, folderName: matches[0].name! },
        allMatches,
      };
    }

    // Multiple matches — ambiguous, return all matches but no single match
    console.warn('[folder-search] Multiple fuzzy matches found, returning null (ambiguous)', {
      searchName: clientName,
      matches: matches.map((m) => ({ id: m.id, name: m.name })),
    });
    return { match: null, allMatches };
  } catch (err) {
    console.error('[folder-search] Drive search failed (non-fatal):', {
      error: err instanceof Error ? err.message : String(err),
      clientName,
    });
    return { match: null, allMatches: [] };
  }
}
