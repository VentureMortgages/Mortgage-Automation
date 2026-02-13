/**
 * Barrel export for all checklist type definitions.
 *
 * Consumers should import from this module:
 *   import type { ChecklistRule, FinmoBorrower, ... } from './types/index.js';
 */

// Finmo API types
export type {
  FinmoApplicationResponse,
  FinmoApplication,
  FinmoApplicant,
  FinmoBorrower,
  FinmoIncome,
  FinmoProperty,
  FinmoPropertyMortgage,
  FinmoAsset,
  FinmoLiability,
  FinmoAddress,
  FinmoAddressSituation,
} from './finmo.js';

// Checklist rule engine and output types
export type {
  ChecklistStage,
  ChecklistScope,
  ChecklistRule,
  RuleContext,
  GeneratedChecklist,
  BorrowerChecklist,
  PropertyChecklist,
  ChecklistItem,
  InternalFlagType,
  InternalFlag,
  ChecklistStats,
} from './checklist.js';
