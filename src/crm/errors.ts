// ============================================================================
// CRM Error Types — Typed errors for API call failures
// ============================================================================

/**
 * Base error for all CRM API errors.
 * Includes the HTTP status code and response body for debugging.
 * NEVER includes PII (emails, phone numbers, names) in messages.
 */
export class CrmApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'CrmApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/**
 * Thrown on HTTP 429 (Too Many Requests).
 * Upstream callers should handle this with retry + backoff.
 */
export class CrmRateLimitError extends CrmApiError {
  constructor(responseBody: string) {
    super('CRM API rate limit exceeded (429). Retry after backoff.', 429, responseBody);
    this.name = 'CrmRateLimitError';
  }
}

/**
 * Thrown on HTTP 401 (Unauthorized).
 * Indicates the API key is invalid, expired, or missing required scopes.
 */
export class CrmAuthError extends CrmApiError {
  constructor(responseBody: string) {
    super(
      'CRM API authentication failed (401). Check that GHL_API_KEY is valid and has required scopes.',
      401,
      responseBody,
    );
    this.name = 'CrmAuthError';
  }
}
