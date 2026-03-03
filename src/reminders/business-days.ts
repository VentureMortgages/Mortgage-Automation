// ============================================================================
// Business Day Utilities — Date math that respects weekends
// ============================================================================
//
// Pure functions for counting and navigating business days (Mon-Fri).
// Used by the reminder scanner to determine when follow-ups are due.

// Re-export addBusinessDays from crm/tasks for convenience
export { addBusinessDays } from '../crm/tasks.js';

/**
 * Returns true if the given date falls on a weekday (Monday-Friday).
 *
 * Uses getUTCDay() for timezone-independent results.
 */
export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  // 0 = Sunday, 6 = Saturday
  return day !== 0 && day !== 6;
}

/**
 * Counts the number of business days (weekdays) between two dates.
 *
 * Exclusive of `from`, counts each weekday up to and including `to`.
 * Example: Monday to Wednesday = 2 (Tuesday + Wednesday).
 *
 * Returns 0 if `to <= from` or if no business days fall in the range.
 *
 * @param from - Start date (exclusive)
 * @param to - End date (inclusive for business day counting)
 * @returns Number of business days elapsed
 */
export function countBusinessDays(from: Date, to: Date): number {
  if (to <= from) {
    return 0;
  }

  // If `from` is not a business day, advance to the next business day first.
  // This means: if a doc request was "sent" on Saturday (edge case),
  // the clock starts on Monday, and Monday itself = 0 elapsed business days.
  const effectiveFrom = new Date(from);
  while (!isBusinessDay(effectiveFrom)) {
    effectiveFrom.setUTCDate(effectiveFrom.getUTCDate() + 1);
  }

  // If advancing past `to`, no business days have elapsed
  if (effectiveFrom >= to) {
    return 0;
  }

  let count = 0;
  // Walk day by day from the day after effectiveFrom up to `to`
  const cursor = new Date(effectiveFrom);

  while (true) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor > to) break;
    if (isBusinessDay(cursor)) {
      count++;
    }
  }

  return count;
}
