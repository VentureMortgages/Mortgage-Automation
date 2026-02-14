/**
 * Finmo API Client
 *
 * Fetches the full application from Finmo's REST API by applicationId.
 * Used by the worker to get complete borrower, income, property, and asset
 * data needed for checklist generation.
 *
 * Security:
 * - Only logs non-PII metadata (applicationId, borrower count, goal, status)
 * - Never logs the raw API response (contains SIN numbers, addresses, income)
 * - Uses bearer token auth from FINMO_API_KEY env var
 */

import type { FinmoApplicationResponse } from '../checklist/types/index.js';
import { appConfig } from '../config.js';

/**
 * Fetch a full Finmo application by ID.
 *
 * Makes a GET request to the Finmo REST API and returns the typed response
 * containing all borrowers, incomes, properties, assets, and liabilities.
 *
 * @param applicationId - The Finmo application ID to fetch
 * @returns The complete application response
 * @throws Error if the API returns a non-OK status
 */
export async function fetchFinmoApplication(applicationId: string): Promise<FinmoApplicationResponse> {
  const url = `${appConfig.finmo.apiBase}/applications/${applicationId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${appConfig.finmo.apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Finmo API error: ${response.status} ${response.statusText} for application ${applicationId}`);
  }

  const data = await response.json() as FinmoApplicationResponse;

  // Log metadata only (never log raw response — contains PII)
  console.log('[finmo] Fetched application', {
    applicationId,
    borrowerCount: data.borrowers?.length ?? 0,
    goal: data.application?.goal,
    status: data.application?.applicationStatus,
  });

  return data;
}
