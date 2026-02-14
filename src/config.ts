/**
 * Shared Application Configuration
 *
 * Centralizes all environment variable access for the webhook infrastructure.
 * Follows the same pattern as src/crm/config.ts and src/email/config.ts.
 *
 * Environment variables:
 * - AUTOMATION_KILL_SWITCH: Set to 'true' to disable all automation processing
 * - REDIS_URL / REDIS_HOST / REDIS_PORT / REDIS_PASSWORD: Redis connection
 * - FINMO_API_KEY: Required Finmo API key
 * - FINMO_API_BASE: Finmo API base URL (defaults to production)
 * - FINMO_RESTHOOK_PUBLIC_KEY: Optional webhook signature verification key
 * - PORT: HTTP server port (default 3000)
 */

import 'dotenv/config';

export interface AppConfig {
  isDev: boolean;
  killSwitch: boolean;
  redis: {
    url: string | undefined;
    host: string;
    port: number;
    password: string | undefined;
  };
  finmo: {
    apiKey: string;
    apiBase: string;
    resthookPublicKey: string | undefined;
  };
  server: {
    port: number;
  };
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

export const appConfig: AppConfig = {
  isDev,
  killSwitch: process.env.AUTOMATION_KILL_SWITCH === 'true',
  redis: {
    url: process.env.REDIS_URL ?? undefined,
    host: optionalEnv('REDIS_HOST', 'localhost'),
    port: parseInt(optionalEnv('REDIS_PORT', '6379'), 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
  },
  finmo: {
    apiKey: requiredEnv('FINMO_API_KEY'),
    apiBase: optionalEnv('FINMO_API_BASE', 'https://app.finmo.ca/api/v1'),
    resthookPublicKey: process.env.FINMO_RESTHOOK_PUBLIC_KEY ?? undefined,
  },
  server: {
    port: parseInt(optionalEnv('PORT', '3000'), 10),
  },
};
