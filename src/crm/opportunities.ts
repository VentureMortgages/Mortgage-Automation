// ============================================================================
// CRM Opportunities Service — Search, read, update opportunity operations
// ============================================================================

import { crmConfig, devPrefix } from './config.js';
import { PIPELINE_IDS, EXISTING_OPP_FIELDS } from './types/index.js';
import type { CrmOpportunity, CrmOpportunityCustomField, CrmCustomFieldUpdate } from './types/index.js';
import { CrmApiError, CrmAuthError, CrmRateLimitError } from './errors.js';

// ============================================================================
// New Functions — Opportunity search, get, and update
// ============================================================================

/**
 * Searches for opportunities by contactId and pipelineId.
 *
 * CRITICAL: GHL search params use underscores (location_id, pipeline_id, contact_id),
 * not camelCase. Returns all matching opportunities.
 */
export async function searchOpportunities(
  contactId: string,
  pipelineId: string,
): Promise<CrmOpportunity[]> {
  const params = new URLSearchParams({
    location_id: crmConfig.locationId,
    pipeline_id: pipelineId,
    contact_id: contactId,
    limit: '20',
  });

  const response = await oppFetch(`/opportunities/search?${params}`, {
    method: 'GET',
  });

  const data = (await response.json()) as {
    opportunities: CrmOpportunity[];
  };

  return data.opportunities ?? [];
}

/**
 * Retrieves a single opportunity by ID, including custom fields.
 */
export async function getOpportunity(opportunityId: string): Promise<CrmOpportunity> {
  const response = await oppFetch(`/opportunities/${opportunityId}`, {
    method: 'GET',
  });

  const data = (await response.json()) as { opportunity: CrmOpportunity };
  return data.opportunity;
}

/**
 * Updates custom fields on an opportunity.
 *
 * Write format uses `{ id, field_value }` (same as contacts).
 */
export async function updateOpportunityFields(
  opportunityId: string,
  customFields: CrmCustomFieldUpdate[],
): Promise<void> {
  await oppFetch(`/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify({ customFields }),
  });
}

/**
 * Updates the pipeline stage on an opportunity.
 */
export async function updateOpportunityStage(
  opportunityId: string,
  stageId: string,
): Promise<void> {
  await oppFetch(`/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify({ pipelineStageId: stageId }),
  });
}

/**
 * Finds an opportunity by Finmo Application ID within a contact's opportunities
 * in a given pipeline.
 *
 * Strategy:
 * 1. Search opportunities by contactId + pipelineId
 * 2. Client-side filter by matching EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID custom field
 * 3. If no match but only one opportunity exists, return it (single-deal fallback per OPP-08)
 * 4. If multiple opportunities and no match, return null (ambiguous)
 */
export async function findOpportunityByFinmoId(
  contactId: string,
  pipelineId: string,
  finmoApplicationId: string,
): Promise<CrmOpportunity | null> {
  const opportunities = await searchOpportunities(contactId, pipelineId);

  if (opportunities.length === 0) {
    return null;
  }

  // Try to match by Finmo Application ID custom field
  const match = opportunities.find((opp) => {
    const fieldValue = getOpportunityFieldValue(opp, EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID);
    return fieldValue === finmoApplicationId;
  });

  if (match) {
    return match;
  }

  // Single-deal fallback: if only one opportunity, return it
  if (opportunities.length === 1) {
    return opportunities[0];
  }

  // Multiple opportunities, no match — ambiguous
  return null;
}

/**
 * Extracts a field value from a CrmOpportunity's customFields array.
 *
 * Handles the opportunity-specific response format where values are stored
 * in typed fields: fieldValueString, fieldValueNumber, fieldValueDate.
 * Returns the value from whichever typed field is present, or undefined
 * if the field is not found.
 */
export function getOpportunityFieldValue(
  opp: CrmOpportunity,
  fieldId: string,
): string | number | undefined {
  if (!opp.customFields) {
    return undefined;
  }

  const field = opp.customFields.find((f) => f.id === fieldId);
  if (!field) {
    return undefined;
  }

  // Return whichever typed field has a value
  if (field.fieldValueString !== undefined && field.fieldValueString !== null) {
    return field.fieldValueString;
  }
  if (field.fieldValueNumber !== undefined && field.fieldValueNumber !== null) {
    return field.fieldValueNumber;
  }
  if (field.fieldValueDate !== undefined && field.fieldValueDate !== null) {
    return field.fieldValueDate;
  }

  return undefined;
}

// ============================================================================
// Deprecated Functions — Kept for backward compatibility (Plan 10-05 removes)
// ============================================================================

/**
 * Creates or updates an opportunity in a MyBrokerPro pipeline.
 *
 * Uses the GHL upsert endpoint which deduplicates by contactId + pipelineId,
 * making this operation idempotent and safe for retries.
 *
 * @deprecated Use searchOpportunities + updateOpportunityFields instead.
 * Upsert overwrites Finmo-created opportunities. Plan 10-05 removes this.
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
    pipelineStageId: input.stageId,
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
 * @deprecated Use findOpportunityByFinmoId + updateOpportunityStage instead.
 * Plan 10-05 removes this.
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
 * @deprecated Use findOpportunityByFinmoId + updateOpportunityStage instead.
 * Plan 10-05 removes this.
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
