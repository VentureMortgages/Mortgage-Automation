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
import { createRedisConnection, QUEUE_NAME, getWebhookQueue } from './queue.js';
import { appConfig } from '../config.js';
import { fetchFinmoApplication } from './finmo-client.js';
import { generateChecklist } from '../checklist/engine/index.js';
import { syncChecklistToCrm } from '../crm/index.js';
import { createEmailDraft } from '../email/index.js';
import { createBudgetSheet, buildClientFolderName, budgetConfig } from '../budget/index.js';
import { getDriveClient } from '../classification/drive-client.js';
import { findOrCreateFolder } from '../classification/filer.js';
import { scanClientFolder, filterChecklistByExistingDocs, extractDealReference } from '../drive/index.js';
import { feedbackConfig, findSimilarEdits, applyFeedbackToChecklist, buildContextText } from '../feedback/index.js';
import { upsertContact, findContactByEmail, assignContactType } from '../crm/contacts.js';
import { findOpportunityByFinmoId, updateOpportunityFields } from '../crm/opportunities.js';
import { crmConfig } from '../crm/config.js';
import { PIPELINE_IDS } from '../crm/types/index.js';
import type { ApplicationContext } from '../feedback/types.js';
import type { FilterResult, ExistingDoc } from '../drive/index.js';
import type { JobData, CrmRetryJobData, ProcessingResult } from './types.js';

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

  // 3. Resolve client folder (needed for Drive scan + budget sheet)
  const mainBorrower = finmoApp.borrowers.find(b => b.isMainBorrower);
  if (!mainBorrower) {
    throw new Error(`No main borrower found for application ${applicationId}`);
  }

  let clientFolderId: string | null = null;
  const driveRootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (driveRootFolderId) {
    const clientFolderName = buildClientFolderName(finmoApp.borrowers);
    clientFolderId = await findOrCreateFolder(getDriveClient(), clientFolderName, driveRootFolderId);
  }

  // 3b. Store client Drive folder ID on CRM contact (DRIVE-01)
  if (clientFolderId && crmConfig.driveFolderIdFieldId) {
    try {
      await upsertContact({
        email: mainBorrower.email,
        firstName: mainBorrower.firstName,
        lastName: mainBorrower.lastName,
        customFields: [
          { id: crmConfig.driveFolderIdFieldId, field_value: `https://drive.google.com/drive/folders/${clientFolderId}` },
        ],
      });
    } catch (err) {
      console.error('[worker] Failed to store Drive folder ID on contact (non-fatal)', {
        applicationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3c. Create deal subfolder per Finmo application (DRIVE-03)
  // Prefer finmoDealId from webhook payload (available immediately).
  // Fall back to CRM opportunity lookup (may fail if MBP hasn't synced yet).
  let dealSubfolderId: string | null = null;
  if (clientFolderId) {
    try {
      let dealRef: string | null = job.data.finmoDealId ?? null;
      let opportunity: Awaited<ReturnType<typeof findOpportunityByFinmoId>> = null;

      // Look up CRM opportunity (needed to store subfolder ID + get dealRef fallback)
      const contactResult = await findContactByEmail(mainBorrower.email);
      if (contactResult) {
        opportunity = await findOpportunityByFinmoId(
          contactResult,
          PIPELINE_IDS.LIVE_DEALS,
          finmoApp.application.id,
        );
        if (!dealRef && opportunity) {
          dealRef = extractDealReference(opportunity.name, finmoApp.application.id);
        }
      }

      if (dealRef) {
        dealSubfolderId = await findOrCreateFolder(getDriveClient(), dealRef, clientFolderId);

        // Store deal subfolder link on opportunity
        if (opportunity && crmConfig.oppDealSubfolderIdFieldId) {
          await updateOpportunityFields(opportunity.id, [
            { id: crmConfig.oppDealSubfolderIdFieldId, field_value: `https://drive.google.com/drive/folders/${dealSubfolderId}` },
          ]);
        }

        console.log('[worker] Deal subfolder created', {
          applicationId,
          dealRef,
          source: job.data.finmoDealId ? 'webhook' : 'crm',
          dealSubfolderId,
        });
      }
    } catch (err) {
      console.error('[worker] Deal subfolder creation failed (non-fatal)', {
        applicationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Scan Drive folder for existing docs (non-fatal)
  let filterResult: FilterResult | null = null;
  if (clientFolderId) {
    try {
      const borrowerFirstNames = finmoApp.borrowers.map(b => b.firstName);
      const existingDocs = await scanClientFolder(getDriveClient(), clientFolderId, borrowerFirstNames);

      // Also scan deal subfolder for property-specific docs
      let dealDocs: ExistingDoc[] = [];
      if (dealSubfolderId) {
        dealDocs = await scanClientFolder(getDriveClient(), dealSubfolderId, borrowerFirstNames);
      }

      const allExistingDocs = [...existingDocs, ...dealDocs];

      if (allExistingDocs.length > 0) {
        filterResult = filterChecklistByExistingDocs(checklist, allExistingDocs, new Date());
        console.log('[worker] Drive scan found existing docs', {
          applicationId,
          clientLevel: existingDocs.length,
          dealLevel: dealDocs.length,
          onFile: filterResult.alreadyOnFile.length,
          expired: filterResult.expiredDocs.length,
        });
      }
    } catch (err) {
      console.error('[worker] Drive scan failed (non-fatal)', {
        applicationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5. Build application context for feedback capture
  const applicationContext: ApplicationContext = {
    goal: finmoApp.application.goal,
    incomeTypes: finmoApp.incomes.map(i => `${i.source}/${i.payType ?? 'none'}`),
    propertyTypes: [...new Set(finmoApp.properties.map(p => p.use).filter(Boolean))] as string[],
    borrowerCount: finmoApp.borrowers.length,
    hasGiftDP: finmoApp.assets.some(a => a.type === 'gift' && (a.downPayment ?? 0) > 0),
    hasRentalIncome: finmoApp.properties.some(p => (p.rentalIncome ?? 0) > 0),
  };

  // 6. Use filtered checklist for both email and CRM
  // The filtered checklist has on-file items removed; preReceivedDocs tells the
  // CRM mapper how many items were already received so totals are computed correctly.
  let emailChecklist = filterResult?.filteredChecklist ?? checklist;
  const alreadyOnFile = filterResult?.alreadyOnFile ?? [];
  const preReceivedDocs = alreadyOnFile.map(d => ({
    name: d.checklistItem.document,
    stage: d.checklistItem.stage,
  }));

  // 7. Apply feedback from Cat's past edits (non-fatal)
  try {
    if (feedbackConfig.enabled) {
      const contextText = buildContextText(applicationContext);
      const matches = await findSimilarEdits(contextText);
      if (matches.length > 0) {
        emailChecklist = applyFeedbackToChecklist(emailChecklist, matches);
        console.log('[worker] Feedback applied', {
          applicationId,
          matchCount: matches.length,
        });
      }
    }
  } catch (err) {
    console.error('[worker] Feedback retrieval failed (non-fatal)', {
      applicationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 8. Sync to CRM (with pre-received docs if any)
  const crmResult = await syncChecklistToCrm({
    checklist: emailChecklist,
    borrowerEmail: mainBorrower.email,
    borrowerFirstName: mainBorrower.firstName,
    borrowerLastName: mainBorrower.lastName,
    borrowerPhone: mainBorrower.phone ?? undefined,
    finmoDealId: applicationId,
    finmoApplicationId: finmoApp.application.id,
    preReceivedDocs: preReceivedDocs.length > 0 ? preReceivedDocs : undefined,
  });

  console.log('[worker] CRM synced', {
    applicationId,
    contactId: crmResult.contactId,
    trackingTarget: crmResult.trackingTarget,
    fieldsUpdated: crmResult.fieldsUpdated,
    errors: crmResult.errors.length,
  });

  // 8a. Assign contact type to professionals (non-fatal, PIPE-04)
  if (finmoApp.agents && finmoApp.agents.length > 0) {
    for (const agent of finmoApp.agents) {
      if (agent.email && agent.type) {
        try {
          await assignContactType(agent.email, agent.fullName, agent.type);
        } catch (err) {
          console.error('[worker] Professional contact type assignment failed (non-fatal)', {
            applicationId,
            agentEmail: agent.email,
            agentType: agent.type,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // 8b. Schedule CRM sync retry if opportunity wasn't found yet
  if (crmResult.trackingTarget === 'contact') {
    try {
      const retryData: CrmRetryJobData = {
        applicationId,
        finmoApplicationId: finmoApp.application.id,
        finmoDealId: job.data.finmoDealId,
        contactId: crmResult.contactId,
        dealSubfolderId: dealSubfolderId,
        borrowerEmail: mainBorrower.email,
        borrowerFirstName: mainBorrower.firstName,
        borrowerLastName: mainBorrower.lastName,
        borrowerPhone: mainBorrower.phone ?? undefined,
        retryAttempt: 1,
      };
      const queue = getWebhookQueue();
      await queue.add('crm-sync-retry', retryData, {
        delay: 5 * 60 * 1000, // 5 min
      });
      console.log('[worker] Scheduling CRM sync retry', { applicationId, retryAttempt: 1 });
    } catch (err) {
      console.error('[worker] Failed to schedule CRM sync retry (non-fatal)', {
        applicationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 9. Create email draft (uses filtered checklist + on-file section)
  const emailResult = await createEmailDraft({
    checklist: emailChecklist,
    recipientEmail: mainBorrower.email,
    borrowerFirstNames: finmoApp.borrowers.map(b => b.firstName),
    contactId: crmResult.contactId,
    alreadyOnFile: alreadyOnFile.length > 0 ? alreadyOnFile : undefined,
    applicationContext,
  });

  console.log('[worker] Email draft created', {
    applicationId,
    draftId: emailResult.draftId,
    subject: emailResult.subject,
  });

  // 10. Create budget sheet (non-fatal — errors logged but don't fail the job)
  let budgetSheetId: string | null = null;
  try {
    if (budgetConfig.enabled) {
      if (clientFolderId) {
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

/** Retry delay schedule: 5min, 10min, 20min */
const RETRY_DELAYS = [5 * 60 * 1000, 10 * 60 * 1000, 20 * 60 * 1000];
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Process a CRM sync retry job.
 *
 * Called when the initial webhook processing fell back to contact-level tracking
 * because the MBP opportunity didn't exist yet. This function:
 * 1. Looks up the opportunity again
 * 2. If found: re-fetches Finmo app, regenerates checklist, syncs to CRM at opportunity level,
 *    and stores the deal subfolder link
 * 3. If not found: re-enqueues with exponential delay (up to MAX_RETRY_ATTEMPTS)
 */
export async function processCrmRetry(job: Job<CrmRetryJobData>): Promise<void> {
  const { applicationId, finmoApplicationId, contactId, retryAttempt } = job.data;
  console.log(`[worker] CRM sync retry attempt ${retryAttempt}`, { applicationId });

  // Look up the opportunity
  const opportunity = await findOpportunityByFinmoId(
    contactId,
    PIPELINE_IDS.LIVE_DEALS,
    finmoApplicationId,
  );

  if (!opportunity) {
    if (retryAttempt < MAX_RETRY_ATTEMPTS) {
      const nextAttempt = retryAttempt + 1;
      const delay = RETRY_DELAYS[retryAttempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
      const queue = getWebhookQueue();
      await queue.add('crm-sync-retry', {
        ...job.data,
        retryAttempt: nextAttempt,
      }, { delay });
      console.log('[worker] Opportunity still not found, scheduling retry', {
        applicationId,
        nextAttempt,
        delayMs: delay,
      });
    } else {
      console.warn('[worker] CRM sync retry exhausted — contact-level tracking is permanent', {
        applicationId,
        attempts: retryAttempt,
      });
    }
    return;
  }

  // Opportunity found — re-run CRM sync at opportunity level
  console.log('[worker] Opportunity found on retry, syncing checklist', {
    applicationId,
    opportunityId: opportunity.id,
  });

  // Re-fetch Finmo app and regenerate checklist (avoids stale data)
  const finmoApp = await fetchFinmoApplication(applicationId);
  const checklist = generateChecklist(finmoApp);

  // Apply Drive scan filtering and feedback (same as initial run)
  let emailChecklist = checklist;
  const driveRootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (driveRootFolderId) {
    try {
      const clientFolderName = buildClientFolderName(finmoApp.borrowers);
      const clientFolderId = await findOrCreateFolder(getDriveClient(), clientFolderName, driveRootFolderId);
      const borrowerFirstNames = finmoApp.borrowers.map(b => b.firstName);
      const existingDocs = await scanClientFolder(getDriveClient(), clientFolderId, borrowerFirstNames);

      let dealDocs: ExistingDoc[] = [];
      if (job.data.dealSubfolderId) {
        dealDocs = await scanClientFolder(getDriveClient(), job.data.dealSubfolderId, borrowerFirstNames);
      }

      const allExistingDocs = [...existingDocs, ...dealDocs];
      if (allExistingDocs.length > 0) {
        const filterResult = filterChecklistByExistingDocs(checklist, allExistingDocs, new Date());
        emailChecklist = filterResult.filteredChecklist;
      }
    } catch (err) {
      console.error('[worker] Drive scan failed during retry (non-fatal)', {
        applicationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Apply feedback
  try {
    if (feedbackConfig.enabled) {
      const applicationContext: ApplicationContext = {
        goal: finmoApp.application.goal,
        incomeTypes: finmoApp.incomes.map(i => `${i.source}/${i.payType ?? 'none'}`),
        propertyTypes: [...new Set(finmoApp.properties.map(p => p.use).filter(Boolean))] as string[],
        borrowerCount: finmoApp.borrowers.length,
        hasGiftDP: finmoApp.assets.some(a => a.type === 'gift' && (a.downPayment ?? 0) > 0),
        hasRentalIncome: finmoApp.properties.some(p => (p.rentalIncome ?? 0) > 0),
      };
      const contextText = buildContextText(applicationContext);
      const matches = await findSimilarEdits(contextText);
      if (matches.length > 0) {
        emailChecklist = applyFeedbackToChecklist(emailChecklist, matches);
      }
    }
  } catch (err) {
    console.error('[worker] Feedback retrieval failed during retry (non-fatal)', {
      applicationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Sync checklist to CRM — this time it should find the opportunity
  // Skip task creation to avoid duplicate review tasks for Cat
  const crmResult = await syncChecklistToCrm({
    checklist: emailChecklist,
    borrowerEmail: job.data.borrowerEmail,
    borrowerFirstName: job.data.borrowerFirstName,
    borrowerLastName: job.data.borrowerLastName,
    borrowerPhone: job.data.borrowerPhone,
    finmoDealId: applicationId,
    finmoApplicationId: finmoApplicationId,
    skipTask: true,
  });

  console.log('[worker] CRM retry sync completed', {
    applicationId,
    trackingTarget: crmResult.trackingTarget,
    opportunityId: crmResult.opportunityId,
  });

  // Store deal subfolder link on opportunity
  if (job.data.dealSubfolderId && crmResult.opportunityId && crmConfig.oppDealSubfolderIdFieldId) {
    try {
      await updateOpportunityFields(crmResult.opportunityId, [
        { id: crmConfig.oppDealSubfolderIdFieldId, field_value: `https://drive.google.com/drive/folders/${job.data.dealSubfolderId}` },
      ]);
      console.log('[worker] Deal subfolder link stored on opportunity', {
        applicationId,
        opportunityId: crmResult.opportunityId,
      });
    } catch (err) {
      console.error('[worker] Failed to store deal subfolder link on retry (non-fatal)', {
        applicationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Create and start the BullMQ worker (lazy singleton).
 *
 * The worker listens on the finmo-webhooks queue and processes jobs
 * through the full pipeline. Only one worker instance is created.
 * Routes jobs by name: 'crm-sync-retry' → processCrmRetry, all others → processJob.
 *
 * @returns The BullMQ Worker instance
 */
export function createWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker(QUEUE_NAME, async (job) => {
    if (job.name === 'crm-sync-retry') {
      return processCrmRetry(job as Job<CrmRetryJobData>);
    }
    return processJob(job as Job<JobData>);
  }, {
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
