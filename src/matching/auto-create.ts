/**
 * Auto-Create Utility — Creates CRM contact + Drive folder for zero-match documents
 *
 * When the matching agent finds no existing CRM contact for an incoming document,
 * this utility:
 * 1. Creates a new CRM contact from the name extracted by classification
 * 2. Creates a client Drive folder under DRIVE_ROOT_FOLDER_ID
 * 3. Stores the folder ID on the new contact
 * 4. Pre-creates standard subfolders (Income, Property, etc.)
 * 5. Creates a CRM task for Cat: "New contact created from incoming doc — please verify"
 *
 * All operations are wrapped in try/catch (non-fatal pattern). If any critical step
 * fails (contact creation, folder creation), returns null.
 *
 * Implements MATCH-02 edge case: zero-match auto-creation.
 */

import { upsertContact } from '../crm/contacts.js';
import { crmConfig } from '../crm/config.js';
import { createReviewTask } from '../crm/tasks.js';
import { getDriveClient } from '../classification/drive-client.js';
import { findOrCreateFolder } from '../classification/filer.js';
import { searchExistingFolders } from './folder-search.js';
import { preCreateSubfolders } from '../drive/originals.js';
import { classificationConfig } from '../classification/config.js';
import type { ClassificationResult } from '../classification/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoCreateResult {
  contactId: string;
  driveFolderId: string;
}

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Creates a new CRM contact and Drive folder for a document with no matching contact.
 *
 * @param input - Classification result, sender email, and original filename
 * @returns { contactId, driveFolderId } on success, null if name unavailable or on error
 */
export async function autoCreateFromDoc(input: {
  classificationResult: ClassificationResult;
  senderEmail: string | null;
  originalFilename: string;
}): Promise<AutoCreateResult | null> {
  const { classificationResult, senderEmail, originalFilename } = input;

  // 1. Extract name from classification — can't create contact without a name
  const firstName = classificationResult.borrowerFirstName;
  const lastName = classificationResult.borrowerLastName;

  if (!firstName || !lastName) {
    console.log('[auto-create] No borrower name in classification, cannot auto-create contact');
    return null;
  }

  try {
    // 2. Create CRM contact
    // Never use internal @venturemortgages.com emails (Cat/Taylor forwarding) as contact email.
    // GHL upsertContact would match/overwrite the team member's contact record.
    const isInternalSender = senderEmail?.toLowerCase().endsWith('@venturemortgages.com');
    const email = (senderEmail && !isInternalSender)
      ? senderEmail
      : `${firstName.toLowerCase()}.${lastName.toLowerCase()}@placeholder.venturemortgages.com`;
    const contactResult = await upsertContact({
      email,
      firstName,
      lastName,
      source: 'doc-automation',
    });

    const contactId = contactResult.contactId;

    // 3. Create client folder in Drive under root: "LastName, FirstName"
    //    Phase 25-02: First search for existing folders via fuzzy match to prevent duplicates
    const drive = getDriveClient();
    const folderName = `${lastName}, ${firstName}`;
    const rootFolderId = classificationConfig.driveRootFolderId;

    let driveFolderId: string;
    try {
      const existingFolder = await searchExistingFolders(drive, folderName, rootFolderId);
      if (existingFolder) {
        console.log('[auto-create] Found existing folder via fuzzy match:', {
          searchedFor: folderName,
          foundFolder: existingFolder.folderName,
          folderId: existingFolder.folderId,
        });
        driveFolderId = existingFolder.folderId;
      } else {
        driveFolderId = await findOrCreateFolder(drive, folderName, rootFolderId);
      }
    } catch (err) {
      console.error('[auto-create] Fuzzy search failed, falling back to findOrCreate (non-fatal):', {
        error: err instanceof Error ? err.message : String(err),
      });
      driveFolderId = await findOrCreateFolder(drive, folderName, rootFolderId);
    }

    // 4. Store folder ID on the contact
    try {
      await upsertContact({
        email,
        firstName,
        lastName,
        customFields: [{ id: crmConfig.driveFolderIdFieldId, field_value: driveFolderId }],
      });
    } catch (err) {
      console.error('[auto-create] Failed to store folder ID on contact (non-fatal):', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 5. Pre-create standard subfolders
    try {
      await preCreateSubfolders(drive, driveFolderId);
    } catch (err) {
      console.error('[auto-create] Failed to pre-create subfolders (non-fatal):', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 6. Create CRM task for Cat
    try {
      await createReviewTask(
        contactId,
        'New contact created from incoming doc — please verify',
        `File: ${originalFilename}\nSender: ${senderEmail ?? 'unknown'}\nDoc type: ${classificationResult.documentType}\n\nA new contact was auto-created from an incoming document. Please verify the contact details and folder setup.`,
      );
    } catch (err) {
      console.error('[auto-create] Failed to create CRM task (non-fatal):', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 7. Return result
    console.log('[auto-create] Created new contact + folder:', {
      contactId,
      driveFolderId,
      folderName,
    });

    return { contactId, driveFolderId };
  } catch (err) {
    console.error('[auto-create] Failed to auto-create contact/folder:', {
      error: err instanceof Error ? err.message : String(err),
      originalFilename,
    });
    return null;
  }
}
