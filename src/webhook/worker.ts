/**
 * BullMQ Worker — Pipeline Orchestrator
 *
 * The core of the automation system. When a Finmo webhook enqueues a job,
 * this worker processes it through the full pipeline:
 *
 *   1. Fetch full application from Finmo API
 *   2. Generate document checklist (Phase 3 engine)
 *   3. Sync checklist to CRM (Phase 4 orchestrator)
 *   4. Create email draft in Gmail (Phase 5 drafting)
 *
 * Design:
 * - processJob is extracted as a named function for testability
 * - Worker uses lazy singleton pattern (same as queue.ts)
 * - Concurrency 1 (appropriate for <10 webhooks/day)
 * - Kill switch checked at worker level (belt-and-suspenders with webhook layer)
 * - Only metadata is logged — never raw Finmo data (PII protection)
 *
 * Failure handling:
 * - BullMQ retries with exponential backoff (configured in queue.ts)
 * - Failed jobs are preserved for manual review (dead-letter pattern)
 * - Each step's error propagates naturally for BullMQ retry
 */

import { Worker, Job } from 'bullmq';
import { createRedisConnection, QUEUE_NAME } from './queue.js';
import { appConfig } from '../config.js';
import { fetchFinmoApplication } from './finmo-client.js';
import { generateChecklist } from '../checklist/engine/index.js';
import { syncChecklistToCrm } from '../crm/index.js';
import { createEmailDraft } from '../email/index.js';
import { createBudgetSheet, buildClientFolderName, budgetConfig } from '../budget/index.js';
import { getDriveClient } from '../classification/drive-client.js';
import { findOrCreateFolder } from '../classification/filer.js';
import type { JobData, ProcessingResult } from './types.js';

let _worker: Worker | null = null;

/**
 * Process a single job through the full pipeline.
 *
 * Exported for testing (allows calling without BullMQ Worker infrastructure).
 *
 * @param job - BullMQ job containing applicationId
 * @returns ProcessingResult with metadata from each pipeline step
 * @throws Error if any pipeline step fails (BullMQ handles retry)
 */
export async function processJob(job: Job<JobData>): Promise<ProcessingResult> {
  const { applicationId } = job.data;
  console.log(`[worker] Processing job ${job.id}`, { applicationId, attempt: job.attemptsMade + 1 });

  // Kill switch check (belt-and-suspenders — also checked at webhook layer)
  if (appConfig.killSwitch) {
    throw new Error('Automation disabled by kill switch');
  }

  // 1. Fetch full application from Finmo API
  const finmoApp = await fetchFinmoApplication(applicationId);

  // 2. Generate checklist
  const checklist = generateChecklist(finmoApp);
  console.log('[worker] Checklist generated', {
    applicationId,
    totalItems: checklist.stats.totalItems,
    borrowers: checklist.borrowerChecklists.length,
  });

  // 3. Sync to CRM
  const mainBorrower = finmoApp.borrowers.find(b => b.isMainBorrower);
  if (!mainBorrower) {
    throw new Error(`No main borrower found for application ${applicationId}`);
  }

  const crmResult = await syncChecklistToCrm({
    checklist,
    borrowerEmail: mainBorrower.email,
    borrowerFirstName: mainBorrower.firstName,
    borrowerLastName: mainBorrower.lastName,
    borrowerPhone: mainBorrower.phone ?? undefined,
    finmoDealId: applicationId,
  });

  console.log('[worker] CRM synced', {
    applicationId,
    contactId: crmResult.contactId,
    fieldsUpdated: crmResult.fieldsUpdated,
    errors: crmResult.errors.length,
  });

  // 4. Create email draft
  const emailResult = await createEmailDraft({
    checklist,
    recipientEmail: mainBorrower.email,
    borrowerFirstNames: finmoApp.borrowers.map(b => b.firstName),
    contactId: crmResult.contactId,
  });

  console.log('[worker] Email draft created', {
    applicationId,
    draftId: emailResult.draftId,
    subject: emailResult.subject,
  });

  // 5. Create budget sheet (non-fatal — errors logged but don't fail the job)
  let budgetSheetId: string | null = null;
  try {
    if (budgetConfig.enabled) {
      const driveRootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
      if (driveRootFolderId) {
        const clientFolderName = buildClientFolderName(finmoApp.borrowers);
        const clientFolderId = await findOrCreateFolder(getDriveClient(), clientFolderName, driveRootFolderId);
        const budgetResult = await createBudgetSheet(finmoApp, clientFolderId);
        budgetSheetId = budgetResult.spreadsheetId;
        console.log('[worker] Budget sheet created', { applicationId, spreadsheetId: budgetSheetId });
      } else {
        console.log('[worker] Budget sheet skipped (DRIVE_ROOT_FOLDER_ID not set)');
      }
    }
  } catch (err) {
    console.error('[worker] Budget sheet creation failed (non-fatal)', {
      applicationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    applicationId,
    contactId: crmResult.contactId,
    draftId: emailResult.draftId,
    budgetSheetId,
    warnings: checklist.warnings,
    errors: crmResult.errors,
  };
}

/**
 * Create and start the BullMQ worker (lazy singleton).
 *
 * The worker listens on the finmo-webhooks queue and processes jobs
 * through the full pipeline. Only one worker instance is created.
 *
 * @returns The BullMQ Worker instance
 */
export function createWorker(): Worker<JobData, ProcessingResult> {
  if (_worker) return _worker;

  _worker = new Worker<JobData, ProcessingResult>(QUEUE_NAME, processJob, {
    connection: createRedisConnection(),
    concurrency: 1,
  });

  _worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`, {
      applicationId: job.data.applicationId,
    });
  });

  _worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed`, {
      applicationId: job?.data?.applicationId,
      error: err.message,
      attempt: job?.attemptsMade,
      maxAttempts: job?.opts?.attempts,
    });
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      console.error(`[worker] Job ${job.id} exhausted all retries — now in dead-letter`, {
        applicationId: job.data.applicationId,
      });
    }
  });

  console.log('[worker] Started, listening for jobs on queue:', QUEUE_NAME);
  return _worker;
}

/**
 * Close the worker for graceful shutdown.
 *
 * Finishes current job processing, then stops accepting new jobs.
 * Resets the singleton so a new worker can be created if needed.
 */
export async function closeWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
