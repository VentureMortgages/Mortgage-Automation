/**
 * PII Sanitization for Safe Logging
 *
 * Replaces sensitive Finmo API fields with '[REDACTED]' before writing to logs.
 * This is the safety-critical layer that prevents mortgage client PII
 * (SIN numbers, income, addresses, credit scores) from leaking into logs.
 *
 * Design decisions:
 * - Arrays are replaced with '[Array(N)]' summaries (never iterated into,
 *   because array elements could contain PII objects)
 * - firstName/lastName are NOT redacted (needed for borrower identification in logs)
 * - Depth limit of 10 prevents infinite recursion on circular-ish structures
 */

/** Set of field names whose values must never appear in logs */
export const PII_FIELDS: ReadonlySet<string> = new Set([
  'sinNumber',
  'email',
  'phone',
  'workPhone',
  'phoneNumber',
  'birthDate',
  'income',
  'incomePeriodAmount',
  'balance',
  'creditLimit',
  'monthlyPayment',
  'creditScore',
  'line1',
  'line2',
  'streetNumber',
  'streetName',
  'postCode',
  'ipAddress',
  'location',
]);

const MAX_DEPTH = 10;
const REDACTED = '[REDACTED]';

/**
 * Recursively sanitize an object for safe logging.
 *
 * - Primitives pass through unchanged
 * - PII field values are replaced with '[REDACTED]'
 * - Arrays are replaced with '[Array(N)]' (never iterated)
 * - Objects deeper than MAX_DEPTH are replaced with '[Object]'
 *
 * @param obj - The value to sanitize (any type)
 * @param depth - Current recursion depth (internal use)
 * @returns A new object with PII fields redacted
 */
export function sanitizeForLog(obj: unknown, depth = 0): unknown {
  // Null/undefined: return as-is
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Primitives: return as-is
  if (typeof obj !== 'object') {
    return obj;
  }

  // Arrays: return summary string (never iterate into contents)
  if (Array.isArray(obj)) {
    return `[Array(${obj.length})]`;
  }

  // Depth guard: prevent excessive recursion
  if (depth >= MAX_DEPTH) {
    return '[Object]';
  }

  // Objects: iterate keys, redact PII, recurse into non-PII values
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_FIELDS.has(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = sanitizeForLog(value, depth + 1);
    }
  }

  return result;
}
