// ============================================================================
// Tests: Business Day Utilities
// ============================================================================
//
// Pure date math tests — no mocks needed. Uses fixed dates for determinism.

import { describe, test, expect } from 'vitest';
import { countBusinessDays, isBusinessDay } from '../business-days.js';

// ============================================================================
// Helper: Create specific dates for clarity
// ============================================================================

/** Creates a date at midnight UTC for a known day of the week */
function d(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

// Reference week: 2026-03-02 (Monday) through 2026-03-08 (Sunday)
const MON = d(2026, 3, 2);   // Monday
const TUE = d(2026, 3, 3);   // Tuesday
const WED = d(2026, 3, 4);   // Wednesday
const THU = d(2026, 3, 5);   // Thursday
const FRI = d(2026, 3, 6);   // Friday
const SAT = d(2026, 3, 7);   // Saturday
const SUN = d(2026, 3, 8);   // Sunday
const NEXT_MON = d(2026, 3, 9);   // Next Monday
const NEXT_FRI = d(2026, 3, 13);  // Next Friday

// ============================================================================
// isBusinessDay
// ============================================================================

describe('isBusinessDay', () => {
  test('Monday is a business day', () => {
    expect(isBusinessDay(MON)).toBe(true);
  });

  test('Tuesday is a business day', () => {
    expect(isBusinessDay(TUE)).toBe(true);
  });

  test('Wednesday is a business day', () => {
    expect(isBusinessDay(WED)).toBe(true);
  });

  test('Thursday is a business day', () => {
    expect(isBusinessDay(THU)).toBe(true);
  });

  test('Friday is a business day', () => {
    expect(isBusinessDay(FRI)).toBe(true);
  });

  test('Saturday is NOT a business day', () => {
    expect(isBusinessDay(SAT)).toBe(false);
  });

  test('Sunday is NOT a business day', () => {
    expect(isBusinessDay(SUN)).toBe(false);
  });
});

// ============================================================================
// countBusinessDays
// ============================================================================

describe('countBusinessDays', () => {
  test('Monday to Wednesday = 2 business days', () => {
    expect(countBusinessDays(MON, WED)).toBe(2);
  });

  test('Friday to Monday = 1 business day (skips Sat/Sun)', () => {
    expect(countBusinessDays(FRI, NEXT_MON)).toBe(1);
  });

  test('Friday to next Friday = 5 business days', () => {
    expect(countBusinessDays(FRI, NEXT_FRI)).toBe(5);
  });

  test('Saturday to Monday = 0 business days', () => {
    expect(countBusinessDays(SAT, NEXT_MON)).toBe(0);
  });

  test('same day to same day = 0', () => {
    expect(countBusinessDays(MON, MON)).toBe(0);
  });

  test('to < from returns 0 (no negative days)', () => {
    expect(countBusinessDays(WED, MON)).toBe(0);
  });

  test('Monday to Tuesday = 1 business day', () => {
    expect(countBusinessDays(MON, TUE)).toBe(1);
  });

  test('Monday to Friday = 4 business days', () => {
    expect(countBusinessDays(MON, FRI)).toBe(4);
  });

  test('Monday to Saturday = 4 business days (Saturday not counted)', () => {
    expect(countBusinessDays(MON, SAT)).toBe(4);
  });

  test('Monday to Sunday = 4 business days (weekend not counted)', () => {
    expect(countBusinessDays(MON, SUN)).toBe(4);
  });

  // Cross-boundary edge cases
  test('crossing month boundary works correctly', () => {
    // 2026-02-27 (Friday) to 2026-03-03 (Tuesday) = 2 business days
    const feb27 = d(2026, 2, 27); // Friday
    const mar03 = d(2026, 3, 3);  // Tuesday
    expect(countBusinessDays(feb27, mar03)).toBe(2);
  });

  test('crossing year boundary works correctly', () => {
    // 2025-12-31 (Wednesday) to 2026-01-02 (Friday) = 2 business days
    const dec31 = d(2025, 12, 31); // Wednesday
    const jan02 = d(2026, 1, 2);   // Friday
    expect(countBusinessDays(dec31, jan02)).toBe(2);
  });

  test('full two-week span = 10 business days', () => {
    // Monday 2026-03-02 to Monday 2026-03-16 = 10 business days
    const twoWeeksLater = d(2026, 3, 16);
    expect(countBusinessDays(MON, twoWeeksLater)).toBe(10);
  });

  test('Sunday to next Sunday = 4 business days (weekend start, clock starts Monday)', () => {
    const thisSun = SUN;
    const nextSun = d(2026, 3, 15);
    // effectiveFrom=Mon, count Tue+Wed+Thu+Fri = 4
    expect(countBusinessDays(thisSun, nextSun)).toBe(4);
  });

  test('Saturday to next Saturday = 4 business days (weekend start, clock starts Monday)', () => {
    const thisSat = SAT;
    const nextSat = d(2026, 3, 14); // Next Saturday
    // effectiveFrom=Mon, count Tue+Wed+Thu+Fri = 4
    expect(countBusinessDays(thisSat, nextSat)).toBe(4);
  });
});
