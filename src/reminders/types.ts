// ============================================================================
// Reminder Types — Core type definitions for the reminder engine
// ============================================================================

import { crmConfig } from '../crm/config.js';
import type { MissingDocEntry } from '../crm/types/index.js';

// ============================================================================
// Configuration
// ============================================================================

/** Reminder engine configuration, loaded from environment */
export interface ReminderConfig {
  /** Number of business days between reminders (default: 3) */
  intervalBusinessDays: number;
  /** Master kill switch for the reminder engine (default: true) */
  enabled: boolean;
}

/** Runtime reminder config — reads from environment variables */
export const reminderConfig: ReminderConfig = {
  intervalBusinessDays: parseInt(process.env.REMINDER_INTERVAL_DAYS ?? '3', 10) || 3,
  enabled: (process.env.REMINDER_ENABLED ?? 'true').toLowerCase() !== 'false',
};

// ============================================================================
// Scan Result Types
// ============================================================================

/** A single opportunity that has overdue documents */
export interface OverdueOpportunity {
  opportunityId: string;
  contactId: string;
  borrowerName: string;
  borrowerEmail: string;
  missingDocs: MissingDocEntry[];
  /** ISO date string of when the doc request email was sent */
  emailSentDate: string;
  /** Number of business days since the doc request was sent */
  businessDaysOverdue: number;
  /** Which reminder cycle this is (1 = first reminder at 3 days, 2 = second at 6 days, etc.) */
  reminderCycle: number;
}

/** Result of scanning for overdue reminders */
export interface ReminderScanResult {
  /** Opportunities with overdue docs that need follow-up */
  overdue: OverdueOpportunity[];
  /** Total number of opportunities scanned */
  scannedCount: number;
  /** Number of opportunities skipped due to terminal stage */
  skippedTerminal: number;
}

// ============================================================================
// Terminal Stage Detection
// ============================================================================

/**
 * Checks if a pipeline stage ID is a terminal stage where reminders should stop.
 *
 * Terminal stages: All Docs Received (docs complete), and future stages like
 * cancelled/funded/withdrawn when those IDs are added to crmConfig.
 *
 * NOTE: When additional terminal stage IDs are known (cancelled, funded, withdrawn),
 * add them to crmConfig.stageIds and include them here.
 */
export function isTerminalStage(stageId: string): boolean {
  // All Docs Received = no more docs needed
  if (stageId === crmConfig.stageIds.allDocsReceived) {
    return true;
  }

  // Future: add crmConfig.stageIds.cancelled, .funded, .withdrawn here
  return false;
}
