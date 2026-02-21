/**
 * Feedback Utilities — Shared helpers for the feedback module
 */

import type { ApplicationContext } from './types.js';

/**
 * Build a human-readable context summary for embedding.
 *
 * Examples:
 * - "Single purchase, salaried, owner-occupied"
 * - "Couple purchase, salaried + self-employed, gift DP, owner-occupied"
 * - "Single refinance, salaried, investment property, rental income"
 */
export function buildContextText(ctx: ApplicationContext): string {
  const parts: string[] = [];

  // Borrower count
  parts.push(ctx.borrowerCount === 1 ? 'Single' : 'Couple');

  // Goal
  parts.push(ctx.goal);

  // Income types (deduplicate and simplify)
  const incomes = [...new Set(ctx.incomeTypes.map(simplifyIncome))];
  parts.push(incomes.join(' + '));

  // Special flags
  if (ctx.hasGiftDP) parts.push('gift DP');
  if (ctx.hasRentalIncome) parts.push('rental income');

  // Property types
  const props = [...new Set(ctx.propertyTypes)].map(simplifyPropertyType);
  if (props.length > 0) parts.push(props.join(' + '));

  return parts.join(', ');
}

function simplifyIncome(income: string): string {
  if (income.startsWith('employed')) return 'salaried';
  if (income.startsWith('self-employed') || income.startsWith('self_employed')) return 'self-employed';
  return income.split('/')[0];
}

function simplifyPropertyType(use: string): string {
  if (use === 'owner_occupied') return 'owner-occupied';
  if (use === 'investment') return 'investment property';
  return use;
}
