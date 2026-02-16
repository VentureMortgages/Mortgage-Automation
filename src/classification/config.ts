/**
 * Classification & Filing Configuration
 *
 * Centralizes all environment variable access for the classification pipeline.
 * Follows the same pattern as src/config.ts and src/crm/config.ts.
 *
 * Environment variables:
 * - ANTHROPIC_API_KEY: Required Anthropic API key for Claude classification
 * - CLASSIFICATION_MODEL: Claude model ID (default: claude-haiku-4-5-20241022)
 * - CLASSIFICATION_CONFIDENCE_THRESHOLD: Min confidence to auto-file (default: 0.7)
 * - CLASSIFICATION_MAX_PAGES: Max PDF pages to send to Claude (default: 3)
 * - DRIVE_ROOT_FOLDER_ID: Google Drive "Mortgage Clients" folder ID (optional during setup)
 * - CLASSIFICATION_ENABLED: Kill switch (default: true)
 * - DRIVE_IMPERSONATE_AS: Email to impersonate for Drive API operations
 */

import 'dotenv/config';

export interface ClassificationConfig {
  /** Anthropic API key for Claude classification */
  anthropicApiKey: string;
  /** Claude model ID for classification (default: claude-haiku-4-5-20241022) */
  model: string;
  /** Confidence threshold below which documents go to manual review (default: 0.7) */
  confidenceThreshold: number;
  /** Maximum pages to send to Claude for classification (default: 3) */
  maxClassificationPages: number;
  /** Google Drive root folder ID for "Mortgage Clients" folder */
  driveRootFolderId: string;
  /** Whether classification is enabled (kill switch) */
  enabled: boolean;
  /** Email to impersonate for Drive API operations */
  driveImpersonateAs: string;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Copy .env.example to .env and fill in the required values.`
    );
  }
  return value;
}

function optionalEnv(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

const isDev = (optionalEnv('APP_ENV', 'development')) !== 'production';

export const classificationConfig: ClassificationConfig = {
  anthropicApiKey: requiredEnv('ANTHROPIC_API_KEY'),
  model: optionalEnv('CLASSIFICATION_MODEL', 'claude-haiku-4-5-20241022'),
  confidenceThreshold: parseFloat(optionalEnv('CLASSIFICATION_CONFIDENCE_THRESHOLD', '0.7')),
  maxClassificationPages: parseInt(optionalEnv('CLASSIFICATION_MAX_PAGES', '3'), 10),
  driveRootFolderId: optionalEnv('DRIVE_ROOT_FOLDER_ID'),
  enabled: process.env.CLASSIFICATION_ENABLED !== 'false',
  driveImpersonateAs: optionalEnv(
    'DRIVE_IMPERSONATE_AS',
    isDev ? 'dev@venturemortgages.com' : 'admin@venturemortgages.com'
  ),
};
