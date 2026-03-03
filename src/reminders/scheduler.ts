// ============================================================================
// Reminder Scheduler — Daily scan orchestrator + BullMQ repeatable job
// ============================================================================
//
// Orchestrates the daily reminder scan:
// 1. Run scanForOverdueReminders to find overdue opportunities
// 2. For each: create/update CRM task + send Cat email notification
// 3. Log outcomes (no PII — only contactId, oppId, cycle number, doc count)
//
// BullMQ integration:
// - startReminderScheduler: registers a repeatable job (9 AM UTC, Mon-Fri)
// - stopReminderScheduler: removes the repeatable job (graceful shutdown)
//
// Non-fatal per-opportunity: one failure does not block processing others.

import { getWebhookQueue } from '../webhook/queue.js';
import { scanForOverdueReminders } from './scanner.js';
import { generateFollowUpText, generateReminderTaskBody } from './follow-up-text.js';
import { createOrUpdateReminderTask } from './reminder-task.js';
import { sendReminderNotification } from './notify-cat.js';
import { reminderConfig } from './types.js';

/** Cron pattern: 9 AM UTC, Monday through Friday */
const REMINDER_CRON = '0 9 * * 1-5';

/** Key for the repeatable job (used for removal on shutdown) */
let repeatableJobKey: string | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Runs a single reminder scan cycle.
 *
 * For each overdue opportunity:
 * 1. Generate follow-up text
 * 2. Generate task body
 * 3. Create/update CRM task (dedup by title)
 * 4. Send Cat email notification
 *
 * @param today - Override for testing (defaults to current date)
 * @returns Processed count and error count
 */
export async function runReminderScan(
  today?: Date,
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  // Check kill switch
  if (!reminderConfig.enabled) {
    console.log('[reminder-scheduler] Reminders disabled, skipping scan');
    return { processed: 0, errors: 0 };
  }

  console.log('[reminder-scheduler] Starting daily reminder scan');

  const scanResult = await scanForOverdueReminders(today);

  console.log('[reminder-scheduler] Scan complete', {
    overdue: scanResult.overdue.length,
    scanned: scanResult.scannedCount,
    skippedTerminal: scanResult.skippedTerminal,
  });

  for (const opp of scanResult.overdue) {
    try {
      // Extract first name for greeting
      const firstName = opp.borrowerName.split(' ')[0] || opp.borrowerName;

      // Generate content
      const followUpText = generateFollowUpText(firstName, opp.missingDocs);
      const taskBody = generateReminderTaskBody(
        opp.borrowerName,
        opp.borrowerEmail,
        opp.missingDocs,
        opp.businessDaysOverdue,
        followUpText,
      );

      // Create/update CRM task
      await createOrUpdateReminderTask(opp.contactId, opp.borrowerName, taskBody);

      // Send Cat email notification
      await sendReminderNotification(
        opp.borrowerName,
        opp.borrowerEmail,
        opp.missingDocs.length,
        opp.businessDaysOverdue,
      );

      processed++;

      // Log outcome (no PII)
      console.log('[reminder-scheduler] Reminder processed', {
        contactId: opp.contactId,
        opportunityId: opp.opportunityId,
        cycle: opp.reminderCycle,
        missingDocCount: opp.missingDocs.length,
      });
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[reminder-scheduler] Failed to process reminder', {
        contactId: opp.contactId,
        opportunityId: opp.opportunityId,
        error: message,
      });
    }
  }

  console.log('[reminder-scheduler] Scan cycle complete', { processed, errors });
  return { processed, errors };
}

/**
 * Registers the daily reminder scan as a BullMQ repeatable job.
 *
 * Runs at 9 AM UTC, Monday through Friday. The scanner also has a
 * weekend guard (isBusinessDay) as a safety belt.
 *
 * Call this once during application startup.
 */
export async function startReminderScheduler(): Promise<void> {
  if (!reminderConfig.enabled) {
    console.log('[reminder-scheduler] Reminders disabled, skipping scheduler setup');
    return;
  }

  try {
    const queue = getWebhookQueue();
    const job = await queue.add('reminder-scan', {}, {
      repeat: { pattern: REMINDER_CRON },
    });

    // Store the key for removal during shutdown
    repeatableJobKey = `reminder-scan:::${REMINDER_CRON}`;

    console.log('[reminder-scheduler] Scheduler registered', {
      cron: REMINDER_CRON,
      jobId: job.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[reminder-scheduler] Failed to register scheduler (non-fatal)', {
      error: message,
    });
  }
}

/**
 * Removes the repeatable reminder job from the queue.
 *
 * Call this during graceful shutdown.
 */
export async function stopReminderScheduler(): Promise<void> {
  if (!repeatableJobKey) return;

  try {
    const queue = getWebhookQueue();

    // Get all repeatable jobs and find ours
    const repeatableJobs = await queue.getRepeatableJobs();
    const ourJob = repeatableJobs.find((j) => j.name === 'reminder-scan');

    if (ourJob) {
      await queue.removeRepeatableByKey(ourJob.key);
      console.log('[reminder-scheduler] Scheduler stopped');
    }

    repeatableJobKey = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[reminder-scheduler] Failed to stop scheduler (non-fatal)', {
      error: message,
    });
  }
}
