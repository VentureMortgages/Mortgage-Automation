// ============================================================================
// Scanner Search — Stage-based opportunity search for reminder scanning
// ============================================================================
//
// Provides a search function that finds opportunities by pipeline stage
// without requiring a contactId. Used by the reminder scanner to find all
// opportunities in the "Collecting Documents" stage.

import { crmConfig } from '../crm/config.js';
import { CrmApiError, CrmAuthError, CrmRateLimitError } from '../crm/errors.js';
import type { CrmOpportunity } from '../crm/types/index.js';
import { PIPELINE_IDS } from '../crm/types/index.js';

/**
 * Searches for opportunities in a specific pipeline stage.
 *
 * Uses the GHL search API with pipeline_id and pipeline_stage_id parameters.
 * This is different from the existing searchOpportunities() which requires a contactId.
 *
 * @param stageId - The pipeline stage ID to search for
 * @param pipelineId - The pipeline ID (defaults to Live Deals)
 * @returns Array of matching opportunities
 */
export async function searchOpportunitiesByStage(
  stageId: string,
  pipelineId: string = PIPELINE_IDS.LIVE_DEALS,
): Promise<CrmOpportunity[]> {
  const params = new URLSearchParams({
    location_id: crmConfig.locationId,
    pipeline_id: pipelineId,
    pipeline_stage_id: stageId,
    limit: '100',
  });

  const url = `${crmConfig.baseUrl}/opportunities/search?${params}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${crmConfig.apiKey}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
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

  const data = (await response.json()) as { opportunities: CrmOpportunity[] };
  return data.opportunities ?? [];
}
