/**
 * Context Factory — Transforms raw Finmo response into per-borrower RuleContext objects.
 *
 * Each borrower gets their own RuleContext with their specific incomes, assets,
 * and liabilities pre-filtered. This enables per-borrower rule evaluation (CHKL-04).
 *
 * The main borrower's context is always first in the returned array.
 *
 * Resilience: If borrowers array is empty (incomplete submission), creates a
 * synthetic borrower from applicant data so base-pack rules still fire.
 */

import type {
  FinmoApplicationResponse,
  FinmoBorrower,
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
): { contexts: RuleContext[]; warnings: string[] } {
  const subjectProperty = findSubjectProperty(response);
  const warnings: string[] = [];

  // Resilience: if borrowers array is empty, synthesize from applicant data
  let borrowers = response.borrowers;
  if (!borrowers || borrowers.length === 0) {
    if (response.applicant) {
      warnings.push(
        'No borrowers in application — synthesized from applicant data. Some income-specific rules may not fire.'
      );
      const syntheticBorrower: FinmoBorrower = {
        id: response.applicant.id,
        applicationId: response.application.id,
        firstName: response.applicant.firstName,
        lastName: response.applicant.lastName,
        email: response.applicant.email,
        phone: response.applicant.phoneNumber,
        workPhone: null,
        firstTime: false,
        sinNumber: '',
        marital: 'single',
        birthDate: null,
        dependents: 0,
        isMainBorrower: true,
        relationshipToMainBorrower: null,
        incomes: [],
        addressSituations: [],
        addresses: [],
        creditReports: [],
        kycMethod: null,
        kycCompleted: null,
        isBusinessLegalEntity: false,
        pepAffiliated: false,
        createdAt: new Date().toISOString(),
      };
      borrowers = [syntheticBorrower];
    } else {
      warnings.push(
        'No borrowers and no applicant in application — cannot generate borrower-specific checklist items.'
      );
      return { contexts: [], warnings };
    }
  }

  const contexts: RuleContext[] = borrowers.map((borrower) => {
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
      allBorrowers: borrowers,
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

  return { contexts, warnings };
}
