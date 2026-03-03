// ============================================================================
// Reminders Module — Barrel Export
// ============================================================================
//
// Public API for the reminder engine. Wired into:
// - BullMQ scheduler (daily scan)
// - CRM task creation/update (dedup by title)
// - Cat email notifications
// - Auto-close in tracking-sync

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

// CRM task CRUD (Plan 02)
export { findReminderTask, createOrUpdateReminderTask, closeReminderTask } from './reminder-task.js';

// Cat email notification (Plan 02)
export { sendReminderNotification } from './notify-cat.js';

// Scheduler (Plan 02)
export { runReminderScan, startReminderScheduler, stopReminderScheduler } from './scheduler.js';
