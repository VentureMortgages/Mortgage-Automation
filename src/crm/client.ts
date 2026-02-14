import { HighLevel } from '@gohighlevel/api-client';
import { crmConfig } from './config.js';

/**
 * GHL SDK client initialized with Private Integration Token (PIT) authentication.
 *
 * Usage:
 *   import { ghl } from './client.js';
 *   const response = await ghl.contacts.upsertContact({ ... });
 *
 * The SDK handles:
 * - PIT auth header injection
 * - API version header (2021-07-28)
 * - Rate limit retry (429 responses)
 * - Typed request/response payloads
 */
const ghl = new HighLevel({
  privateIntegrationToken: crmConfig.apiKey,
});

export { ghl };
