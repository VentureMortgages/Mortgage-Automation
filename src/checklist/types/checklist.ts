/**
 * Checklist Rule Engine & Output Type Definitions
 *
 * Defines the contract for:
 * - Rule definitions (ChecklistRule) with condition/exclusion functions
 * - Rule evaluation context (RuleContext) with per-borrower data
 * - Generated checklist output (GeneratedChecklist) structured for both email and CRM
 * - Internal flags for deferred docs and manual verification items
 *
 * Consumers:
 * - Phase 03 Plan 02: Rule definitions will implement ChecklistRule[]
 * - Phase 03 Plan 03: Engine will evaluate rules against RuleContext
 * - Phase 04: CRM integration will consume GeneratedChecklist
 * - Phase 05: Email drafting will consume BorrowerChecklist / ChecklistItem
 */

import type {
  FinmoApplication,
  FinmoBorrower,
  FinmoIncome,
  FinmoAsset,
  FinmoProperty,
  FinmoLiability,
} from './finmo.js';

// ---------------------------------------------------------------------------
// Rule Definition
// ---------------------------------------------------------------------------

/** Stage classification for when a document should be collected */
export type ChecklistStage =
  | 'PRE'
  | 'FULL'
  | 'LATER'
  | 'CONDITIONAL'
  | 'LENDER_CONDITION';

/** Scope of a rule — determines how it is evaluated and grouped in output */
export type ChecklistScope = 'per_borrower' | 'per_property' | 'shared';

/**
 * A single checklist rule definition.
 *
 * Rules are evaluated against a RuleContext. If `condition` returns true
 * and `excludeWhen` (if present) returns false, the rule produces a
 * ChecklistItem in the generated checklist.
 */
export interface ChecklistRule {
  /** Unique rule identifier, e.g., "s1_employed_paystub" */
  id: string;
  /** Section grouping, e.g., "1_income_employed_salary" */
  section: string;
  /** Internal document name: "Recent paystub (within 30 days)" */
  document: string;
  /** Email-friendly display: "2 recent pay stubs (must show YTD earnings)" */
  displayName: string;
  /** When this document should be collected */
  stage: ChecklistStage;
  /** How this rule is scoped for evaluation */
  scope: ChecklistScope;
  /** Returns true if this rule applies to the given context */
  condition: (ctx: RuleContext) => boolean;
  /**
   * CHKL-05: Returns true if this rule should be EXCLUDED despite condition match.
   * Example: Don't request T2125 separately if T1 is already requested.
   */
  excludeWhen?: (ctx: RuleContext) => boolean;
  /** Context-dependent display name override (e.g., LOE with bonus details when borrower has bonuses) */
  displayNameFn?: (ctx: RuleContext) => string;
  /** Conditional note to include in email (e.g., "if NOA shows amount owing...") */
  notes?: string;
  /**
   * CHKL-06: If true, this item is tracked internally but NOT sent to client.
   * Examples: "Verify T1 includes T2125", "Verify T2 includes Schedule 50"
   */
  internalOnly?: boolean;
  /** Note for internal checks (e.g., "Verify T1 includes T2125") */
  internalCheckNote?: string;
}

// ---------------------------------------------------------------------------
// Rule Evaluation Context
// ---------------------------------------------------------------------------

/**
 * Context provided to each rule's condition/excludeWhen function.
 *
 * For per_borrower rules, `borrower` and `borrowerIncomes` etc. represent
 * the CURRENT borrower being evaluated. For shared rules, `borrower` is
 * set to the main borrower by convention.
 */
export interface RuleContext {
  /** Top-level application data */
  application: FinmoApplication;
  /** Current borrower being evaluated (for per_borrower rules) */
  borrower: FinmoBorrower;
  /** Income entries belonging to the current borrower */
  borrowerIncomes: FinmoIncome[];
  /** All borrowers on the application */
  allBorrowers: FinmoBorrower[];
  /** All income entries across all borrowers */
  allIncomes: FinmoIncome[];
  /** All assets on the application */
  assets: FinmoAsset[];
  /** Assets owned by the current borrower */
  borrowerAssets: FinmoAsset[];
  /** All properties on the application */
  properties: FinmoProperty[];
  /** The subject property (linked via application.propertyId), or null */
  subjectProperty: FinmoProperty | null;
  /** All liabilities on the application */
  liabilities: FinmoLiability[];
  /** Liabilities owned by the current borrower */
  borrowerLiabilities: FinmoLiability[];
  /** Current date — used for dynamic tax year calculation and time-based rules */
  currentDate: Date;
}

// ---------------------------------------------------------------------------
// Generated Checklist Output
// ---------------------------------------------------------------------------

/**
 * The complete generated checklist for an application.
 *
 * Structured to support:
 * - Email generation (Phase 5): iterate borrowerChecklists for per-borrower sections
 * - CRM integration (Phase 4): use stats + flat item lists
 * - Internal review: internalFlags for items Cat should verify manually
 */
export interface GeneratedChecklist {
  /** Finmo application ID this checklist was generated for */
  applicationId: string;
  /** ISO timestamp of when the checklist was generated */
  generatedAt: string;
  /** Per-borrower document checklists */
  borrowerChecklists: BorrowerChecklist[];
  /** Per-property document checklists (e.g., condo docs, rental property docs) */
  propertyChecklists: PropertyChecklist[];
  /** Shared items not specific to a single borrower or property */
  sharedItems: ChecklistItem[];
  /** Internal flags for Cat / Taylor — NOT sent to client */
  internalFlags: InternalFlag[];
  /** Warnings about unknown field values, ambiguous data, or rule evaluation issues */
  warnings: string[];
  /** Summary statistics for downstream consumers (CRM, logging) */
  stats: ChecklistStats;
}

/** Document checklist for a single borrower */
export interface BorrowerChecklist {
  /** Finmo borrower ID */
  borrowerId: string;
  /** Display name, e.g., "Lyndon Cameron" */
  borrowerName: string;
  /** Whether this is the main borrower */
  isMainBorrower: boolean;
  /** Checklist items specific to this borrower */
  items: ChecklistItem[];
}

/** Document checklist for a single property */
export interface PropertyChecklist {
  /** Finmo property ID */
  propertyId: string;
  /** Human-readable description, e.g., "4940 Daryl Road, Kelowna" or "Subject Property" */
  propertyDescription: string;
  /** Checklist items specific to this property */
  items: ChecklistItem[];
}

/**
 * A single item in the generated checklist.
 *
 * Represents one document that should be collected (or verified internally).
 */
export interface ChecklistItem {
  /** Rule ID that produced this item */
  ruleId: string;
  /** Internal document name */
  document: string;
  /** Email-friendly display name */
  displayName: string;
  /** When this document should be collected */
  stage: ChecklistStage;
  /** Conditional note (if any) */
  notes?: string;
  /** false = internalOnly items that should NOT appear in client email */
  forEmail: boolean;
  /** Original section for grouping in output */
  section: string;
}

// ---------------------------------------------------------------------------
// Internal Flags
// ---------------------------------------------------------------------------

/** Type of internal flag */
export type InternalFlagType = 'deferred_doc' | 'internal_check' | 'manual_flag';

/**
 * An internal flag for broker/assistant review.
 *
 * These are never sent to the client. They track things like:
 * - Deferred docs: "Gift letter -- collect when lender picked"
 * - Internal checks: "Verify T1 includes T2125"
 * - Manual flags: "Multiple income types detected, review carefully"
 */
export interface InternalFlag {
  /** Rule ID that produced this flag */
  ruleId: string;
  /** Human-readable description */
  description: string;
  /** Classification of the flag */
  type: InternalFlagType;
  /** Borrower name if this flag is per-borrower */
  borrowerName?: string;
  /** Specific verification note (e.g., "Verify T1 includes T2125") */
  checkNote?: string;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Summary statistics for a generated checklist.
 *
 * Useful for downstream consumers (CRM, logging, quality checks).
 */
export interface ChecklistStats {
  /** Total checklist items generated (email + internal) */
  totalItems: number;
  /** Items with stage PRE */
  preItems: number;
  /** Items with stage FULL */
  fullItems: number;
  /** Items scoped per-borrower */
  perBorrowerItems: number;
  /** Shared items (not per-borrower or per-property) */
  sharedItems: number;
  /** Number of internal flags generated */
  internalFlags: number;
  /** Number of warnings generated */
  warnings: number;
}
