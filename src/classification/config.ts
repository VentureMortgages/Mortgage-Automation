/**
 * Classification & Filing Configuration
 *
 * Centralizes all environment variable access for the classification pipeline.
 * Follows the same pattern as src/config.ts and src/crm/config.ts.
 *
 * Environment variables:
 * - GEMINI_API_KEY: Required Google AI API key for Gemini classification
 * - CLASSIFICATION_MODEL: Gemini model ID (default: gemini-2.0-flash)
 * - CLASSIFICATION_CONFIDENCE_THRESHOLD: Min confidence to auto-file (default: 0.7)
 * - CLASSIFICATION_MAX_PAGES: Max PDF pages to send for classification (default: 3)
 * - DRIVE_ROOT_FOLDER_ID: Google Drive "Mortgage Clients" folder ID (optional during setup)
 * - CLASSIFICATION_ENABLED: Kill switch (default: true)
 * - DRIVE_IMPERSONATE_AS: Email to impersonate for Drive API operations
 */

import 'dotenv/config';

export interface ClassificationConfig {
  /** Google AI API key for Gemini classification */
  geminiApiKey: string;
  /** Gemini model ID for classification (default: gemini-2.0-flash) */
  model: string;
  /** Confidence threshold below which documents go to manual review (default: 0.7) */
  confidenceThreshold: number;
  /** Maximum pages to send for classification (default: 3) */
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
  geminiApiKey: requiredEnv('GEMINI_API_KEY'),
  model: optionalEnv('CLASSIFICATION_MODEL', 'gemini-2.0-flash'),
  confidenceThreshold: parseFloat(optionalEnv('CLASSIFICATION_CONFIDENCE_THRESHOLD', '0.7')),
  maxClassificationPages: parseInt(optionalEnv('CLASSIFICATION_MAX_PAGES', '3'), 10),
  driveRootFolderId: optionalEnv('DRIVE_ROOT_FOLDER_ID'),
  enabled: process.env.CLASSIFICATION_ENABLED !== 'false',
  driveImpersonateAs: optionalEnv(
    'DRIVE_IMPERSONATE_AS',
    isDev ? 'dev@venturemortgages.com' : 'admin@venturemortgages.com'
  ),
};
