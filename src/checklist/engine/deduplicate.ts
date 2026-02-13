/**
 * Deduplication logic for checklist items.
 *
 * When a borrower has multiple income entries of the same type (e.g., Karen has
 * 2 salaried jobs), income rules are evaluated for EACH income entry. This can
 * produce duplicate ChecklistItems (e.g., two "Recent pay stub" items).
 *
 * Deduplication operates WITHIN a single borrower only — co-borrowers each get
 * their own items (CHKL-04 compliance). Cross-borrower duplicates are intentional.
 */

import type { ChecklistItem } from '../types/index.js';

/**
 * Deduplicate checklist items by ruleId within a single borrower.
 *
 * If multiple items share the same ruleId but have different notes,
 * the notes are merged with " / " separator before deduplication.
 *
 * @param items - Items for a single borrower (or property, or shared scope)
 * @returns Deduplicated items, preserving first occurrence order
 */
export function deduplicateItems(items: ChecklistItem[]): ChecklistItem[] {
  // First pass: merge notes for items with the same ruleId
  const merged = mergeNotes(items);

  // Second pass: keep only first occurrence of each ruleId
  const seen = new Set<string>();
  const result: ChecklistItem[] = [];

  for (const item of merged) {
    if (!seen.has(item.ruleId)) {
      seen.add(item.ruleId);
      result.push(item);
    }
  }

  return result;
}

/**
 * Merge notes for items that share the same ruleId but have different notes.
 *
 * This is rare but can happen when different income entries trigger the same
 * rule with context-specific notes. The merged note uses " / " separator.
 *
 * @param items - Raw items that may contain duplicates with different notes
 * @returns Items with merged notes (still may contain ruleId duplicates)
 */
export function mergeNotes(items: ChecklistItem[]): ChecklistItem[] {
  // Group by ruleId to find items that need note merging
  const byRuleId = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    const existing = byRuleId.get(item.ruleId);
    if (existing) {
      existing.push(item);
    } else {
      byRuleId.set(item.ruleId, [item]);
    }
  }

  // For groups with different notes, merge into the first item
  const result: ChecklistItem[] = [];
  for (const group of byRuleId.values()) {
    const first = group[0];

    // Collect unique, non-empty notes across duplicates
    const uniqueNotes = new Set<string>();
    for (const item of group) {
      if (item.notes) {
        uniqueNotes.add(item.notes);
      }
    }

    if (uniqueNotes.size > 1) {
      // Multiple distinct notes — merge them
      result.push({
        ...first,
        notes: [...uniqueNotes].join(' / '),
      });
    } else {
      // Zero or one unique note — keep original items (dedup happens later)
      result.push(...group);
    }
  }

  return result;
}
