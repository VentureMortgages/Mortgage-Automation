/**
 * Webhook Type Definitions
 *
 * Defines the contract between webhook receiver, BullMQ queue, and worker.
 * These types are used across all Phase 1 modules.
 */

/** Raw webhook payload from Finmo resthook (shape may vary) */
export interface WebhookPayload {
  applicationId?: string;
  [key: string]: unknown;
}

/** Data stored in BullMQ job */
export interface JobData {
  applicationId: string;
  receivedAt: string; // ISO timestamp of webhook receipt
}

/** Result returned by worker after processing a job */
export interface ProcessingResult {
  applicationId: string;
  contactId: string;
  draftId: string;
  budgetSheetId?: string | null;
  warnings: string[];
  errors: string[];
}
