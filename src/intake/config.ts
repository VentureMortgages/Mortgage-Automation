/**
 * Intake Module Configuration
 *
 * Provides configuration for the document intake pipeline:
 * - Polling interval for Gmail inbox monitoring
 * - Maximum attachment size
 * - Supported MIME types and their conversion strategies
 * - Docs inbox address (docs@venturemortgages.co in production)
 * - Enable/disable toggle (kill switch for intake monitoring)
 *
 * Follows the same pattern as src/email/config.ts and src/config.ts.
 */

import 'dotenv/config';

import type { ConversionStrategy } from './types.js';

// ---------------------------------------------------------------------------
// Config Interface
// ---------------------------------------------------------------------------

export interface IntakeConfig {
  /** Polling interval in milliseconds (default: 120000 = 2 minutes) */
  pollIntervalMs: number;
  /** Maximum attachment size in bytes (default: 25MB, matching Gmail's limit) */
  maxAttachmentBytes: number;
  /** The inbox to monitor for incoming documents */
  docsInbox: string;
  /** Whether intake monitoring is enabled */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// MIME Type Mapping
// ---------------------------------------------------------------------------

/** Supported MIME types and their conversion strategies */
export const SUPPORTED_MIME_TYPES = new Map<string, ConversionStrategy>([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'image-to-pdf'],
  ['image/png', 'image-to-pdf'],
  ['image/tiff', 'image-to-pdf'],
  ['image/webp', 'image-to-pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word-to-pdf'],
  ['application/msword', 'word-to-pdf'],
]);

/**
 * Returns the conversion strategy for a given MIME type.
 * Returns 'unsupported' for unrecognized MIME types.
 */
export function getConversionStrategy(mimeType: string): ConversionStrategy {
  return SUPPORTED_MIME_TYPES.get(mimeType) ?? 'unsupported';
}

// ---------------------------------------------------------------------------
// Config Instance
// ---------------------------------------------------------------------------

const isDev = (process.env.APP_ENV ?? 'development') !== 'production';

export const intakeConfig: IntakeConfig = {
  pollIntervalMs: parseInt(process.env.INTAKE_POLL_INTERVAL_MS ?? '120000', 10),
  maxAttachmentBytes: parseInt(process.env.INTAKE_MAX_ATTACHMENT_BYTES ?? String(25 * 1024 * 1024), 10),
  docsInbox: process.env.DOC_INBOX ?? (isDev ? 'dev@venturemortgages.com' : 'docs@venturemortgages.co'),
  enabled: process.env.INTAKE_ENABLED !== 'false', // Enabled by default
};
