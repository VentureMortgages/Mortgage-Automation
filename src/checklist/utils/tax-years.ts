/**
 * Dynamic Tax Year Calculation
 *
 * Tax documents (T4, NOA, T1, etc.) reference specific years.
 * Rather than hardcoding years, we calculate them based on the current date
 * so display names stay correct as time progresses.
 *
 * Key rule: T4s for a given year are typically available after April of the
 * following year. Before April, we reference the previous year as "current".
 */

/** Tax year context for generating dynamic display names */
export interface TaxYearInfo {
  /** The most recent completable tax year (year - 1 if before May, else year) */
  currentTaxYear: number;
  /** One year before currentTaxYear */
  previousTaxYear: number;
  /** Two years before currentTaxYear */
  twoYearsAgo: number;
  /** Whether T4s for the currentTaxYear are likely available (after April) */
  t4Available: boolean;
}

/**
 * Calculate tax year references based on a given date.
 *
 * Before May (months 1-4): currentTaxYear = year - 1 (T4s not yet available)
 * May onwards (months 5-12): currentTaxYear = year (T4s available)
 *
 * @param currentDate - The reference date (typically today)
 * @returns TaxYearInfo with all derived year values
 */
export function getTaxYears(currentDate: Date): TaxYearInfo {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1; // getMonth() is 0-indexed

  // T4s for a tax year are typically available after April of the next year
  const t4Available = month > 4;
  const currentTaxYear = t4Available ? year : year - 1;

  return {
    currentTaxYear,
    previousTaxYear: currentTaxYear - 1,
    twoYearsAgo: currentTaxYear - 2,
    t4Available,
  };
}
