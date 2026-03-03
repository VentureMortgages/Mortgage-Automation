// ============================================================================
// Reminder Scanner — Identifies overdue opportunities needing follow-up
// ============================================================================
//
// The core scan logic that:
// 1. Searches for opportunities in "Collecting Documents" stage
// 2. Reads docRequestSent date from each opportunity
// 3. Counts business days elapsed
// 4. Identifies overdue opportunities with missing docs
//
// Designed to run once daily as a scheduled job. Does NOT auto-send anything --
// produces data for Plan 02 to create CRM tasks and Cat notifications.
//
// PII safety: Only document type names are surfaced. No income amounts, SINs, etc.

import { crmConfig } from '../crm/config.js';
import { getOpportunity, getOpportunityFieldValue } from '../crm/opportunities.js';
import { parseOpportunityTrackingFields } from '../crm/tracking-sync.js';
import { getContact } from '../crm/contacts.js';
import { searchOpportunitiesByStage } from './scanner-search.js';
import { countBusinessDays, isBusinessDay } from './business-days.js';
import { reminderConfig, isTerminalStage } from './types.js';
import type { ReminderScanResult, OverdueOpportunity } from './types.js';

/**
 * Scans for opportunities with overdue document requests.
 *
 * Logic:
 * 1. If reminders are disabled, return empty result.
 * 2. If today is a weekend, skip scan (Cat doesn't work weekends).
 * 3. Search for opportunities in "Collecting Documents" stage.
 * 4. For each: check stage, read sent date, count business days, check missing docs.
 * 5. Include if >= intervalBusinessDays have elapsed and docs are still missing.
 *
 * @param today - Override for testing (defaults to current date)
 * @returns Scan result with overdue opportunities and counts
 */
export async function scanForOverdueReminders(
  today: Date = new Date(),
): Promise<ReminderScanResult> {
  const result: ReminderScanResult = {
    overdue: [],
    scannedCount: 0,
    skippedTerminal: 0,
  };

  // 1. Kill switch check
  if (!reminderConfig.enabled) {
    return result;
  }

  // 2. Weekend check — don't scan on weekends
  if (!isBusinessDay(today)) {
    return result;
  }

  // 3. Search for opportunities in "Collecting Documents" stage
  const opportunities = await searchOpportunitiesByStage(
    crmConfig.stageIds.collectingDocuments,
  );

  // 4. Process each opportunity
  for (const opp of opportunities) {
    // Skip terminal stages (shouldn't appear in search, but defensive)
    if (opp.pipelineStageId && isTerminalStage(opp.pipelineStageId)) {
      result.skippedTerminal++;
      continue;
    }

    result.scannedCount++;

    // Fetch full opportunity with custom fields
    const fullOpp = await getOpportunity(opp.id);

    // Read docRequestSent date
    const sentDateRaw = getOpportunityFieldValue(
      fullOpp,
      crmConfig.opportunityFieldIds.docRequestSent,
    );

    if (!sentDateRaw || typeof sentDateRaw !== 'string') {
      // No email sent date recorded — skip
      continue;
    }

    // Parse the sent date (ISO string or YYYY-MM-DD)
    const sentDate = new Date(sentDateRaw);
    if (isNaN(sentDate.getTime())) {
      continue;
    }

    // Count business days elapsed
    const businessDaysOverdue = countBusinessDays(sentDate, today);

    // Check if overdue (>= interval)
    if (businessDaysOverdue < reminderConfig.intervalBusinessDays) {
      continue;
    }

    // Parse tracking fields for missing docs
    const tracking = parseOpportunityTrackingFields(
      fullOpp,
      crmConfig.opportunityFieldIds,
    );

    // Skip if no missing docs (all received)
    if (tracking.missingDocs.length === 0) {
      continue;
    }

    // Calculate reminder cycle number
    const reminderCycle = Math.floor(businessDaysOverdue / reminderConfig.intervalBusinessDays);

    // Fetch contact for name/email
    const contactId = fullOpp.contactId;
    if (!contactId) {
      continue;
    }

    const contact = await getContact(contactId);

    // Build overdue entry
    const entry: OverdueOpportunity = {
      opportunityId: fullOpp.id,
      contactId,
      borrowerName: `${contact.firstName} ${contact.lastName}`.trim(),
      borrowerEmail: contact.email,
      missingDocs: tracking.missingDocs,
      emailSentDate: sentDateRaw,
      businessDaysOverdue,
      reminderCycle,
    };

    result.overdue.push(entry);
  }

  return result;
}
