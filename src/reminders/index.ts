// ============================================================================
// Reminders Module — Barrel Export
// ============================================================================
//
// Public API for the reminder engine. Used by Plan 02 to wire into
// the BullMQ scheduler and CRM task creation.

// Types
export type {
  ReminderConfig,
  OverdueOpportunity,
  ReminderScanResult,
} from './types.js';

export { reminderConfig, isTerminalStage } from './types.js';

// Business day math
export { countBusinessDays, isBusinessDay, addBusinessDays } from './business-days.js';

// Scanner
export { scanForOverdueReminders } from './scanner.js';

// Follow-up text generation
export { generateFollowUpText, generateReminderTaskBody } from './follow-up-text.js';
