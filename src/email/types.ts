/**
 * Email Module Type Definitions
 *
 * Types for:
 * - Email body generation context (EmailContext)
 * - MIME message construction (MimeMessageInput)
 * - Email configuration with dev safety (EmailConfig)
 * - Gmail draft creation and sending (CreateEmailDraftInput/Result, SendResult)
 *
 * Consumers:
 * - Phase 05 Plan 01: body.ts, mime.ts, config.ts
 * - Phase 05 Plan 02: gmail-client.ts, draft.ts
 */

import type { GeneratedChecklist } from '../checklist/types/index.js';
import type { AlreadyOnFileDoc } from '../drive/checklist-filter.js';
import type { ApplicationContext } from '../feedback/types.js';

// ---------------------------------------------------------------------------
// Email Body Generation
// ---------------------------------------------------------------------------

/** Context needed to generate the email body */
export interface EmailContext {
  /** Borrower first names for greeting, e.g., ["Megan", "Cory"] */
  borrowerFirstNames: string[];
  /** The email address clients should send docs to */
  docInboxEmail: string;
  /** Documents already on file from a previous application (optional) */
  alreadyOnFile?: AlreadyOnFileDoc[];
}

// ---------------------------------------------------------------------------
// MIME Message
// ---------------------------------------------------------------------------

/** Input for MIME message construction */
export interface MimeMessageInput {
  to: string;
  from: string;
  subject: string;
  body: string;
  bcc?: string;
  /** Custom X- headers for tracking (e.g., X-Venture-Contact-Id) */
  customHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Email Configuration
// ---------------------------------------------------------------------------

/** Email configuration (dev safety + sender info) */
export interface EmailConfig {
  isDev: boolean;
  senderAddress: string;
  recipientOverride: string | null;
  subjectPrefix: string;
  docInbox: string;
  /** BCC address for send confirmation tracking (copy arrives in monitored inbox) */
  bccAddress: string;
}

// ---------------------------------------------------------------------------
// Gmail Draft / Send
// ---------------------------------------------------------------------------

/** Input for creating a Gmail draft from a generated checklist */
export interface CreateEmailDraftInput {
  checklist: GeneratedChecklist;
  recipientEmail: string;
  borrowerFirstNames: string[];
  contactId: string;
  /** Documents already on file from a previous application (optional) */
  alreadyOnFile?: AlreadyOnFileDoc[];
  /** Application context for feedback capture (goal, income types, etc.) */
  applicationContext?: ApplicationContext;
}

/** Result of creating a Gmail draft */
export interface CreateEmailDraftResult {
  draftId: string;
  subject: string;
  recipientEmail: string;
  bodyPreview: string;
}

/** Result of sending a draft */
export interface SendResult {
  messageId: string;
  threadId?: string;
}
