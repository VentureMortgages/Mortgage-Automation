/**
 * Smart Document Matching Configuration
 *
 * Centralizes all environment variable access for the matching pipeline.
 * Follows the same pattern as src/classification/config.ts.
 *
 * Environment variables:
 * - GEMINI_MODEL: Gemini model ID (default: gemini-2.0-flash)
 * - MATCHING_ENABLED: Kill switch (default: true)
 */

import 'dotenv/config';

export interface MatchingConfig {
  /** Confidence threshold for auto-filing (>= this = auto-file, < this = Cat reviews) */
  autoFileThreshold: number;
  /** Maximum iterations for the agentic matching loop */
  maxAgentIterations: number;
  /** TTL for decision log entries in Redis (90 days) */
  decisionLogTtlSeconds: number;
  /** TTL for thread->contact mappings in Redis (30 days) */
  threadMappingTtlSeconds: number;
  /** Gemini model ID for matching agent */
  model: string;
  /** Kill switch — set MATCHING_ENABLED=false to disable */
  enabled: boolean;
}

function optionalEnv(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const matchingConfig: MatchingConfig = {
  autoFileThreshold: 0.8,
  maxAgentIterations: 5,
  decisionLogTtlSeconds: 90 * 24 * 60 * 60,
  threadMappingTtlSeconds: 30 * 24 * 60 * 60,
  model: optionalEnv('GEMINI_MODEL', 'gemini-2.0-flash'),
  enabled: process.env.MATCHING_ENABLED !== 'false',
};
