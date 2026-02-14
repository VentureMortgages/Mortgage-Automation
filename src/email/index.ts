// ============================================================================
// Email Module — Barrel Export
// ============================================================================
//
// Public API for the email module. All downstream consumers should import
// from this barrel rather than individual files.
//
// NOT exported:
// - Gmail API client internals (getGmailClient, createGmailDraft, sendGmailDraft)
//   — internal implementation details, same pattern as crm/client.ts

// Email types
export type {
  EmailConfig,
  EmailContext,
  MimeMessageInput,
  CreateEmailDraftInput,
  CreateEmailDraftResult,
  SendResult,
} from './types.js';

// Configuration
export { emailConfig } from './config.js';

// Pure functions
export { generateEmailBody } from './body.js';
export { encodeMimeMessage } from './mime.js';

// Gmail API operations
export { createEmailDraft } from './draft.js';
export { sendEmailDraft } from './send.js';
export { GmailAuthError } from './gmail-client.js';
