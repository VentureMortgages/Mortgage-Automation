// ============================================================================
// CRM Opportunities Service — Pipeline stage management
// ============================================================================

import { crmConfig, devPrefix } from './config.js';
import { PIPELINE_IDS } from './types/index.js';
import { CrmApiError, CrmAuthError, CrmRateLimitError } from './errors.js';

// ============================================================================
// Functions
// ============================================================================

/**
 * Creates or updates an opportunity in a MyBrokerPro pipeline.
 *
 * Uses the GHL upsert endpoint which deduplicates by contactId + pipelineId,
 * making this operation idempotent and safe for retries.
 *
 * @returns The opportunity ID
 */
export async function upsertOpportunity(input: {
  contactId: string;
  pipelineId: string;
  stageId: string;
  name: string;
}): Promise<string> {
  const body = {
    locationId: crmConfig.locationId,
    contactId: input.contactId,
    pipelineId: input.pipelineId,
    stageId: input.stageId,
    name: input.name,
    status: 'open',
  };

  const response = await oppFetch('/opportunities/upsert', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as { opportunity: { id: string } };
  return data.opportunity.id;
}

/**
 * Upserts an opportunity in the "Finmo - Live Deals" pipeline at the
 * "Collecting Documents" stage.
 *
 * Called when a new Finmo application arrives and doc collection begins.
 * In dev mode, the opportunity name is prefixed with [TEST].
 *
 * @param contactId - The CRM contact ID
 * @param borrowerName - Display name for the opportunity
 * @returns The opportunity ID
 */
export async function moveToCollectingDocs(contactId: string, borrowerName: string): Promise<string> {
  if (!crmConfig.stageIds.collectingDocuments) {
    throw new Error(
      'Collecting Documents stage ID not configured — run setup/fetch-ids.ts first',
    );
  }

  return upsertOpportunity({
    contactId,
    pipelineId: PIPELINE_IDS.LIVE_DEALS,
    stageId: crmConfig.stageIds.collectingDocuments,
    name: devPrefix(`${borrowerName} — Doc Collection`),
  });
}

/**
 * Upserts an opportunity in the "Finmo - Live Deals" pipeline at the
 * "All Docs Received" stage.
 *
 * Called when all required documents have been received (used by Phase 8
 * tracking integration). In dev mode, the opportunity name is prefixed
 * with [TEST].
 *
 * @param contactId - The CRM contact ID
 * @param borrowerName - Display name for the opportunity
 * @returns The opportunity ID
 */
export async function moveToAllDocsReceived(contactId: string, borrowerName: string): Promise<string> {
  if (!crmConfig.stageIds.allDocsReceived) {
    throw new Error(
      'All Docs Received stage ID not configured — run setup/fetch-ids.ts first',
    );
  }

  return upsertOpportunity({
    contactId,
    pipelineId: PIPELINE_IDS.LIVE_DEALS,
    stageId: crmConfig.stageIds.allDocsReceived,
    name: devPrefix(`${borrowerName} — Doc Collection`),
  });
}

// ============================================================================
// Internal — HTTP helper with error classification
// ============================================================================

async function oppFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${crmConfig.baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${crmConfig.apiKey}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });

    if (!response.ok) {
      const responseBody = await response.text();

      if (response.status === 429) {
        throw new CrmRateLimitError(responseBody);
      }
      if (response.status === 401) {
        throw new CrmAuthError(responseBody);
      }

      throw new CrmApiError(
        `CRM API error: ${response.status} ${response.statusText}`,
        response.status,
        responseBody,
      );
    }

    return response;
  } catch (error) {
    if (error instanceof CrmApiError) {
      throw error;
    }

    throw new CrmApiError(
      `CRM API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      0,
      '',
    );
  }
}
