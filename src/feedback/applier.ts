/**
 * Feedback Applier — Applies past edits to new checklists
 *
 * Given matching feedback records, applies Cat's historical edits to a new
 * checklist. Conservative by default: only auto-applies when multiple
 * matches agree (minMatchesForAutoApply, default 2).
 *
 * Modifications:
 * - Items consistently removed across N+ matches → remove from checklist
 * - Items consistently reworded across N+ matches → apply text modification
 * - Items added are logged but NOT auto-added (too risky without context)
 *
 * Returns a modified copy — the original checklist is not mutated.
 *
 * Consumers: worker.ts (Phase B integration)
 */

import { feedbackConfig } from './config.js';
import type { GeneratedChecklist, ChecklistItem } from '../checklist/types/index.js';
import type { FeedbackMatch } from './types.js';

/**
 * Apply feedback from similar past edits to a checklist.
 *
 * @param checklist - The generated checklist to modify
 * @param matches - Similar feedback records from RAG retrieval
 * @returns Modified checklist with feedback applied
 */
export function applyFeedbackToChecklist(
  checklist: GeneratedChecklist,
  matches: FeedbackMatch[],
): GeneratedChecklist {
  const minMatches = feedbackConfig.minMatchesForAutoApply;

  // Count how many times each item was removed
  const removalCounts = new Map<string, number>();
  for (const match of matches) {
    for (const item of match.record.edits.itemsRemoved) {
      const key = item.toLowerCase();
      removalCounts.set(key, (removalCounts.get(key) ?? 0) + 1);
    }
  }

  // Items to remove: appeared in N+ matches
  const itemsToRemove = new Set<string>();
  for (const [item, count] of removalCounts) {
    if (count >= minMatches) {
      itemsToRemove.add(item);
    }
  }

  // Count rewordings
  const rewordMap = new Map<string, Map<string, number>>();
  for (const match of matches) {
    for (const rw of match.record.edits.itemsReworded) {
      const key = rw.original.toLowerCase();
      if (!rewordMap.has(key)) rewordMap.set(key, new Map());
      const modMap = rewordMap.get(key)!;
      modMap.set(rw.modified, (modMap.get(rw.modified) ?? 0) + 1);
    }
  }

  // Rewords to apply: same reword appeared in N+ matches
  const rewordsToApply = new Map<string, string>();
  for (const [original, modMap] of rewordMap) {
    for (const [modified, count] of modMap) {
      if (count >= minMatches) {
        rewordsToApply.set(original, modified);
        break; // Take the first reword that meets threshold
      }
    }
  }

  if (itemsToRemove.size === 0 && rewordsToApply.size === 0) {
    return checklist;
  }

  // Deep copy and modify
  const modified: GeneratedChecklist = {
    ...checklist,
    borrowerChecklists: checklist.borrowerChecklists.map(bc => ({
      ...bc,
      items: filterAndReword(bc.items, itemsToRemove, rewordsToApply),
    })),
    propertyChecklists: checklist.propertyChecklists.map(pc => ({
      ...pc,
      items: filterAndReword(pc.items, itemsToRemove, rewordsToApply),
    })),
    sharedItems: filterAndReword(checklist.sharedItems, itemsToRemove, rewordsToApply),
  };

  // Log what was applied
  if (itemsToRemove.size > 0) {
    console.log('[feedback] Auto-removed items based on past edits', {
      items: [...itemsToRemove],
    });
  }
  if (rewordsToApply.size > 0) {
    console.log('[feedback] Auto-reworded items based on past edits', {
      count: rewordsToApply.size,
    });
  }

  return modified;
}

function filterAndReword(
  items: ChecklistItem[],
  toRemove: Set<string>,
  toReword: Map<string, string>,
): ChecklistItem[] {
  return items
    .filter(item => !shouldRemove(item, toRemove))
    .map(item => applyReword(item, toReword));
}

function shouldRemove(item: ChecklistItem, toRemove: Set<string>): boolean {
  const displayLower = item.displayName.toLowerCase();
  const docLower = item.document.toLowerCase();

  for (const removal of toRemove) {
    if (displayLower.includes(removal) || removal.includes(displayLower) ||
        docLower.includes(removal) || removal.includes(docLower)) {
      return true;
    }
  }
  return false;
}

function applyReword(
  item: ChecklistItem,
  toReword: Map<string, string>,
): ChecklistItem {
  const displayLower = item.displayName.toLowerCase();

  for (const [original, modified] of toReword) {
    if (displayLower.includes(original) || original.includes(displayLower)) {
      return { ...item, displayName: modified };
    }
  }
  return item;
}
