/**
 * Context Factory — Transforms raw Finmo response into per-borrower RuleContext objects.
 *
 * Each borrower gets their own RuleContext with their specific incomes, assets,
 * and liabilities pre-filtered. This enables per-borrower rule evaluation (CHKL-04).
 *
 * The main borrower's context is always first in the returned array.
 */

import type {
  FinmoApplicationResponse,
  FinmoProperty,
  RuleContext,
} from '../types/index.js';

/**
 * Find the subject property linked to the application.
 *
 * @returns The matching property, or null if not found or propertyId is null.
 */
export function findSubjectProperty(
  response: FinmoApplicationResponse
): FinmoProperty | null {
  const { propertyId } = response.application;
  if (!propertyId) return null;
  return response.properties.find((p) => p.id === propertyId) ?? null;
}

/**
 * Build one RuleContext per borrower from the raw Finmo response.
 *
 * For each borrower:
 * - Filters incomes by borrowerId
 * - Filters assets by owners array containing borrowerId
 * - Filters liabilities by owners array containing borrowerId
 * - Resolves the subject property from application.propertyId
 *
 * @returns Array of RuleContext objects, main borrower first.
 */
export function buildBorrowerContexts(
  response: FinmoApplicationResponse,
  currentDate: Date
): RuleContext[] {
  const subjectProperty = findSubjectProperty(response);

  const contexts: RuleContext[] = response.borrowers.map((borrower) => {
    const borrowerIncomes = response.incomes.filter(
      (inc) => inc.borrowerId === borrower.id
    );
    const borrowerAssets = response.assets.filter(
      (asset) => asset.owners.includes(borrower.id)
    );
    const borrowerLiabilities = response.liabilities.filter(
      (liability) => liability.owners.includes(borrower.id)
    );

    return {
      application: response.application,
      borrower,
      borrowerIncomes,
      allBorrowers: response.borrowers,
      allIncomes: response.incomes,
      assets: response.assets,
      borrowerAssets,
      properties: response.properties,
      subjectProperty,
      liabilities: response.liabilities,
      borrowerLiabilities,
      currentDate,
    };
  });

  // Sort: main borrower first, preserving relative order of others
  contexts.sort((a, b) => {
    if (a.borrower.isMainBorrower && !b.borrower.isMainBorrower) return -1;
    if (!a.borrower.isMainBorrower && b.borrower.isMainBorrower) return 1;
    return 0;
  });

  return contexts;
}
