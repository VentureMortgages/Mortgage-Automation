// ============================================================================
// Tests: CRM Tasks Utilities — Business day calculation
// ============================================================================
//
// Tests addBusinessDays — a pure utility function.
// No mocks needed.
//
// NOTE: All Date constructors use 'T12:00:00Z' (noon UTC) to prevent
// timezone-related day-of-week shifts when running in non-UTC timezones.
// getDay()/setDate() operate in local time, so midnight UTC can shift
// the local day backward in Western Hemisphere timezones.

import { describe, test, expect } from 'vitest';
import { addBusinessDays } from '../tasks.js';

// Helper to extract YYYY-MM-DD from a Date using local date parts
// (matches how getDay/setDate operate in addBusinessDays)
function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ============================================================================
// addBusinessDays
// ============================================================================

describe('addBusinessDays', () => {
  test('Monday + 1 = Tuesday', () => {
    const monday = new Date('2026-02-16T12:00:00Z'); // Monday
    expect(toLocalDate(addBusinessDays(monday, 1))).toBe('2026-02-17');
  });

  test('Friday + 1 = Monday', () => {
    const friday = new Date('2026-02-13T12:00:00Z'); // Friday
    expect(toLocalDate(addBusinessDays(friday, 1))).toBe('2026-02-16');
  });

  test('Saturday + 1 = Monday', () => {
    const saturday = new Date('2026-02-14T12:00:00Z'); // Saturday
    expect(toLocalDate(addBusinessDays(saturday, 1))).toBe('2026-02-16');
  });

  test('Sunday + 1 = Monday', () => {
    const sunday = new Date('2026-02-15T12:00:00Z'); // Sunday
    expect(toLocalDate(addBusinessDays(sunday, 1))).toBe('2026-02-16');
  });

  test('Friday + 2 = Tuesday', () => {
    const friday = new Date('2026-02-13T12:00:00Z');
    expect(toLocalDate(addBusinessDays(friday, 2))).toBe('2026-02-17');
  });

  test('Wednesday + 5 = Wednesday next week', () => {
    const wed = new Date('2026-02-11T12:00:00Z'); // Wednesday
    expect(toLocalDate(addBusinessDays(wed, 5))).toBe('2026-02-18');
  });

  test('Monday + 0 = Monday', () => {
    const monday = new Date('2026-02-16T12:00:00Z');
    expect(toLocalDate(addBusinessDays(monday, 0))).toBe('2026-02-16');
  });

  test('Thursday + 1 = Friday', () => {
    const thursday = new Date('2026-02-12T12:00:00Z');
    expect(toLocalDate(addBusinessDays(thursday, 1))).toBe('2026-02-13');
  });
});
