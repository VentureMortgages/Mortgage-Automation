// ============================================================================
// Checklist Filter — Removes items already on file from the checklist
// ============================================================================
//
// Given a generated checklist and a list of existing docs from Drive scan,
// produces a filtered checklist with on-file items removed. The removed items
// are returned separately for the "already on file" email section and CRM sync.

import type {
  GeneratedChecklist,
  ChecklistItem,
  BorrowerChecklist,
} from '../checklist/types/index.js';
import type { DocumentType } from '../classification/types.js';
import { DOC_TYPE_LABELS } from '../classification/types.js';
import type { ExistingDoc } from './folder-scanner.js';
import { isDocStillValid, PROPERTY_SPECIFIC_TYPES } from './doc-expiry.js';

// ============================================================================
// Types
// ============================================================================

export interface AlreadyOnFileDoc {
  checklistItem: ChecklistItem;
  driveFileId: string;
  borrowerName: string;
}

export interface FilterResult {
  /** Checklist with on-file items removed */
  filteredChecklist: GeneratedChecklist;
  /** Items that were on file and removed */
  alreadyOnFile: AlreadyOnFileDoc[];
  /** Items scanned but expired / not matched */
  expiredDocs: ExistingDoc[];
}

// ============================================================================
// Matching helpers
// ============================================================================

/** Known aliases for matching doc types to checklist item names */
const ITEM_MATCH_ALIASES: Partial<Record<DocumentType, string[]>> = {
  photo_id: ['id', 'photo id', 'government-issued'],
  second_id: ['second id', 'second form of id'],
  pay_stub: ['pay stub', 'paystub'],
  loe: ['letter of employment', 'employment letter', 'loe'],
  noa: ['notice of assessment', 'noa'],
  void_cheque: ['void cheque', 'direct deposit'],
  bank_statement: ['bank statement', '90-day bank'],
  pr_card: ['pr card', 'permanent resident'],
};

/**
 * Checks if a DocumentType matches a ChecklistItem by comparing the doc type
 * label against the item's document name and displayName.
 */
function doesDocTypeMatchItem(docType: DocumentType, item: ChecklistItem): boolean {
  const label = DOC_TYPE_LABELS[docType];
  if (!label) return false;

  const labelLower = label.toLowerCase();
  const docNameLower = item.document.toLowerCase();
  const displayLower = item.displayName.toLowerCase();

  // Prefix match on item.document or item.displayName
  if (docNameLower.startsWith(labelLower) || displayLower.startsWith(labelLower)) {
    return true;
  }

  // Contains match (for labels >= 3 chars)
  if (labelLower.length >= 3) {
    if (docNameLower.includes(labelLower) || displayLower.includes(labelLower)) {
      return true;
    }
  }

  // Alias match
  const aliases = ITEM_MATCH_ALIASES[docType];
  if (aliases) {
    for (const alias of aliases) {
      const aliasLower = alias.toLowerCase();
      if (docNameLower.includes(aliasLower) || displayLower.includes(aliasLower)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Filters a checklist by removing items that are already on file in Drive.
 *
 * For each valid existing document, finds and removes the matching checklist
 * item from the appropriate borrower's checklist or shared items.
 *
 * @param checklist - The full generated checklist
 * @param existingDocs - Documents found in the client's Drive folder
 * @param currentDate - Current date for expiry checks
 * @returns FilterResult with filtered checklist, on-file items, and expired docs
 */
export function filterChecklistByExistingDocs(
  checklist: GeneratedChecklist,
  existingDocs: ExistingDoc[],
  currentDate: Date,
): FilterResult {
  const alreadyOnFile: AlreadyOnFileDoc[] = [];
  const expiredDocs: ExistingDoc[] = [];

  // Skip property-specific types and check expiry
  const validDocs: ExistingDoc[] = [];
  for (const doc of existingDocs) {
    if (PROPERTY_SPECIFIC_TYPES.has(doc.documentType)) {
      continue; // silently skip — these are never reusable
    }
    if (!isDocStillValid(doc, currentDate)) {
      expiredDocs.push(doc);
      continue;
    }
    validDocs.push(doc);
  }

  // Deep clone the checklist's mutable parts
  const filteredBorrowerChecklists: BorrowerChecklist[] = checklist.borrowerChecklists.map(bc => ({
    ...bc,
    items: [...bc.items],
  }));
  let filteredSharedItems = [...checklist.sharedItems];

  // For each valid doc, find and remove matching checklist item
  for (const doc of validDocs) {
    let matched = false;

    // Try borrower checklists first (match by borrower name + doc type)
    for (const bc of filteredBorrowerChecklists) {
      const bcFirstName = bc.borrowerName.split(' ')[0].toLowerCase();
      if (bcFirstName !== doc.borrowerName.toLowerCase()) continue;

      const itemIdx = bc.items.findIndex(item =>
        item.forEmail && doesDocTypeMatchItem(doc.documentType, item),
      );
      if (itemIdx >= 0) {
        alreadyOnFile.push({
          checklistItem: bc.items[itemIdx],
          driveFileId: doc.fileId,
          borrowerName: doc.borrowerName,
        });
        bc.items.splice(itemIdx, 1);
        matched = true;
        break;
      }
    }

    // Try shared items if no borrower match
    if (!matched) {
      const sharedIdx = filteredSharedItems.findIndex(item =>
        item.forEmail && doesDocTypeMatchItem(doc.documentType, item),
      );
      if (sharedIdx >= 0) {
        alreadyOnFile.push({
          checklistItem: filteredSharedItems[sharedIdx],
          driveFileId: doc.fileId,
          borrowerName: doc.borrowerName,
        });
        filteredSharedItems.splice(sharedIdx, 1);
        matched = true;
      }
    }
  }

  // Recompute stats
  const allFilteredItems = [
    ...filteredBorrowerChecklists.flatMap(bc => bc.items),
    ...checklist.propertyChecklists.flatMap(pc => pc.items),
    ...filteredSharedItems,
  ];

  const filteredChecklist: GeneratedChecklist = {
    ...checklist,
    borrowerChecklists: filteredBorrowerChecklists,
    sharedItems: filteredSharedItems,
    stats: {
      ...checklist.stats,
      totalItems: allFilteredItems.length + checklist.internalFlags.length,
      preItems: allFilteredItems.filter(i => i.stage === 'PRE').length,
      fullItems: allFilteredItems.filter(i => i.stage === 'FULL').length,
      perBorrowerItems: filteredBorrowerChecklists.reduce((sum, bc) => sum + bc.items.length, 0),
      sharedItems: filteredSharedItems.length,
    },
  };

  return { filteredChecklist, alreadyOnFile, expiredDocs };
}
