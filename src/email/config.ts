/**
 * Email Module Configuration
 *
 * Dev mode safety: In development, all emails are sent to dev@venturemortgages.com
 * with a [TEST] subject prefix, preventing accidental emails to real clients.
 *
 * Reads APP_ENV from process.env (same pattern as crmConfig).
 */

import 'dotenv/config';

import type { EmailConfig } from './types.js';

const isDev = (process.env.APP_ENV ?? 'development') === 'development';

export const emailConfig: EmailConfig = {
  isDev,
  senderAddress: 'admin@venturemortgages.com',
  recipientOverride: isDev ? 'dev@venturemortgages.com' : null,
  subjectPrefix: isDev ? '[TEST] ' : '',
  docInbox: process.env.DOC_INBOX ?? 'dev@venturemortgages.com',
};
