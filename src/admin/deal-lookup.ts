/**
 * Deal Lookup — BRXM Deal ID → Finmo Application UUID
 *
 * When Cat pastes a BRXM-style deal ID (e.g., "BRXM-F051356") into the
 * Process Deal form, we need to resolve it to a Finmo application UUID.
 *
 * Strategy:
 * 1. Search CRM opportunities by name containing the BRXM ID
 * 2. Read the finmoApplicationId custom field from the matched opportunity
 * 3. Return the UUID, or null if not found
 *
 * Consumers: POST /admin/process-deal route (server.ts)
 */

import { crmConfig } from '../crm/config.js';
import { PIPELINE_IDS, EXISTING_OPP_FIELDS } from '../crm/types/index.js';
import { getOpportunityFieldValue } from '../crm/opportunities.js';
import type { CrmOpportunity } from '../crm/types/index.js';

/** Pattern for BRXM deal IDs (e.g., BRXM-F051356) */
export const BRXM_PATTERN = /^BRXM-[A-Z]\d{5,}$/i;

/**
 * Search CRM opportunities by text query across the Live Deals pipeline.
 * Uses GHL search with `q` parameter (no contactId required).
 */
async function searchOpportunitiesByQuery(query: string): Promise<CrmOpportunity[]> {
  const params = new URLSearchParams({
    location_id: crmConfig.locationId,
    pipeline_id: PIPELINE_IDS.LIVE_DEALS,
    q: query,
    limit: '10',
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
    console.error('[deal-lookup] CRM search failed:', response.status, response.statusText);
    return [];
  }

  const data = (await response.json()) as { opportunities: CrmOpportunity[] };
  return data.opportunities ?? [];
}

/**
 * Look up a Finmo application UUID by BRXM deal reference.
 *
 * Searches CRM opportunities whose name contains the BRXM ID,
 * then reads the Finmo Application ID custom field.
 *
 * @param dealRef - BRXM deal ID (e.g., "BRXM-F051356")
 * @returns Finmo application UUID, or null if not found
 */
export async function lookupApplicationIdByDealRef(dealRef: string): Promise<string | null> {
  console.log('[deal-lookup] Searching for deal reference:', dealRef);

  const opportunities = await searchOpportunitiesByQuery(dealRef);

  if (opportunities.length === 0) {
    console.log('[deal-lookup] No opportunities found for:', dealRef);
    return null;
  }

  // Find the opportunity whose name contains the deal reference
  const match = opportunities.find(opp =>
    opp.name?.toUpperCase().includes(dealRef.toUpperCase()),
  );

  const target = match ?? opportunities[0];

  // Read the Finmo Application ID custom field
  const applicationId = getOpportunityFieldValue(
    target,
    EXISTING_OPP_FIELDS.FINMO_APPLICATION_ID,
  );

  if (typeof applicationId === 'string' && applicationId.length > 0) {
    console.log('[deal-lookup] Resolved:', { dealRef, applicationId });
    return applicationId;
  }

  console.log('[deal-lookup] Opportunity found but no Finmo Application ID field:', {
    dealRef,
    opportunityId: target.id,
    opportunityName: target.name,
  });
  return null;
}

/**
 * Detect the input type from user input.
 *
 * @returns Object with type and resolved applicationId (if extractable)
 */
export function detectInputType(input: string): {
  type: 'url' | 'uuid' | 'brxm' | 'unknown';
  applicationId?: string;
  dealRef?: string;
} {
  const trimmed = input.trim();

  // UUID pattern (global to find all UUIDs)
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

  // Check for Finmo URL containing a UUID
  // URL format: https://app.finmo.ca/teams/{teamId}/deals/{applicationId}
  // The application ID is the LAST UUID in the URL (first is teamId)
  if (trimmed.includes('finmo.ca') || trimmed.includes('finmo.') || trimmed.startsWith('http')) {
    const allUuids = trimmed.match(UUID_RE);
    if (allUuids && allUuids.length > 0) {
      // Use the last UUID — in /teams/{teamId}/deals/{appId}, appId is last
      return { type: 'url', applicationId: allUuids[allUuids.length - 1] };
    }
  }

  // Check for BRXM deal ID
  if (BRXM_PATTERN.test(trimmed)) {
    return { type: 'brxm', dealRef: trimmed.toUpperCase() };
  }

  // Check for raw UUID
  const uuidMatch = trimmed.match(UUID_RE);
  if (uuidMatch) {
    return { type: 'uuid', applicationId: uuidMatch[0] };
  }

  return { type: 'unknown' };
}
