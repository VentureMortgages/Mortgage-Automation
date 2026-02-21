/**
 * Checklist Generation Engine — Core Pure Function
 *
 * Takes a raw Finmo API response and produces a structured GeneratedChecklist.
 *
 * Design principles:
 * - PURE FUNCTION: No side effects, no external state, deterministic with fixed date
 * - CHKL-03: All PRE and FULL stage items appear in a single output (no stage filtering)
 * - CHKL-04: per_borrower rules evaluated per borrower, producing duplicate items per person
 * - CHKL-05: excludeWhen prevents excluded items from appearing
 * - CHKL-06: internalOnly items route to internalFlags, not client-facing output
 * - Error resilient: Rule evaluation errors produce warnings, not crashes
 * - No PII in warnings: References rule IDs and field names, never borrower names or SINs
 */

import type {
  FinmoApplicationResponse,
  FinmoAddress,
  ChecklistRule,
  RuleContext,
  GeneratedChecklist,
  BorrowerChecklist,
  PropertyChecklist,
  ChecklistItem,
  InternalFlag,
  ChecklistStats,
} from '../types/index.js';
import { allRules } from '../rules/index.js';
import { buildBorrowerContexts, findSubjectProperty } from './build-context.js';
import { deduplicateItems } from './deduplicate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable property description from address data.
 *
 * Looks up the property's addressId in the response addresses array and
 * formats as "{streetNumber} {streetName} {streetType}, {city}".
 * Falls back to "Subject Property" or "Property {index}" if no address found.
 */
function buildPropertyDescription(
  propertyId: string,
  addresses: FinmoAddress[],
  addressId: string | null,
  isSubjectProperty: boolean,
  nonSubjectIndex: number,
  nonSubjectCount: number
): string {
  if (addressId) {
    const addr = addresses.find((a) => a.id === addressId);
    if (addr) {
      const parts: string[] = [];
      if (addr.streetNumber) parts.push(addr.streetNumber);
      if (addr.streetName) parts.push(addr.streetName);
      if (addr.streetType) parts.push(addr.streetType);

      if (parts.length > 0 && addr.city) {
        return `${parts.join(' ')}, ${addr.city}`;
      }
      if (parts.length > 0) {
        return parts.join(' ');
      }
      if (addr.city) {
        return addr.city;
      }
    }
  }

  if (isSubjectProperty) return 'Subject Property';
  return nonSubjectCount > 1
    ? `Additional Property ${nonSubjectIndex + 1}`
    : 'Additional Property';
}

/**
 * Evaluate a single rule against a context, producing a ChecklistItem or null.
 *
 * Wraps condition and excludeWhen calls in try/catch for error resilience.
 * Adds warnings for errors instead of crashing.
 *
 * @returns [item or null, warning or null]
 */
function evaluateRule(
  rule: ChecklistRule,
  ctx: RuleContext
): [ChecklistItem | null, string | null] {
  // Evaluate condition
  let conditionResult: boolean;
  try {
    conditionResult = rule.condition(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [null, `Rule ${rule.id} condition error: ${message}`];
  }

  if (!conditionResult) return [null, null];

  // Check excludeWhen (CHKL-05)
  if (rule.excludeWhen) {
    let excludeResult: boolean;
    try {
      excludeResult = rule.excludeWhen(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return [null, `Rule ${rule.id} excludeWhen error: ${message}`];
    }
    if (excludeResult) return [null, null];
  }

  // Build ChecklistItem
  const item: ChecklistItem = {
    ruleId: rule.id,
    document: rule.document,
    displayName: rule.displayName,
    stage: rule.stage,
    forEmail: !rule.internalOnly && rule.stage !== 'LENDER_CONDITION',
    section: rule.section,
  };

  if (rule.notes) {
    item.notes = rule.notes;
  }

  return [item, null];
}

/**
 * Convert an internal-only ChecklistItem into an InternalFlag.
 */
function toInternalFlag(
  item: ChecklistItem,
  rule: ChecklistRule,
  borrowerName?: string
): InternalFlag {
  return {
    ruleId: item.ruleId,
    description: item.document,
    type: rule.internalCheckNote ? 'internal_check' : 'deferred_doc',
    ...(borrowerName ? { borrowerName } : {}),
    ...(rule.internalCheckNote ? { checkNote: rule.internalCheckNote } : {}),
  };
}

/**
 * Find the rule definition by ID from the rules array.
 */
function findRule(
  rules: ChecklistRule[],
  ruleId: string
): ChecklistRule | undefined {
  return rules.find((r) => r.id === ruleId);
}

// ---------------------------------------------------------------------------
// Main Engine
// ---------------------------------------------------------------------------

/**
 * Generate a document checklist from a Finmo application response.
 *
 * This is the core pure function of the checklist engine.
 *
 * @param response - Full Finmo API response
 * @param rules - Optional rule override (defaults to allRules). Allows testing with subsets.
 * @param currentDate - Optional date override (defaults to new Date()). Allows deterministic testing.
 * @returns GeneratedChecklist with borrower, property, shared items, internal flags, and warnings
 */
export function generateChecklist(
  response: FinmoApplicationResponse,
  rules: ChecklistRule[] = allRules,
  currentDate: Date = new Date()
): GeneratedChecklist {
  // 1. Build borrower contexts (one per borrower, main first)
  const borrowerContexts = buildBorrowerContexts(response, currentDate);

  // 2. Initialize output collectors
  const borrowerChecklists: BorrowerChecklist[] = [];
  const propertyChecklists: PropertyChecklist[] = [];
  const sharedItems: ChecklistItem[] = [];
  const internalFlags: InternalFlag[] = [];
  const warnings: string[] = [];

  // 3. Separate rules by scope
  const perBorrowerRules = rules.filter((r) => r.scope === 'per_borrower');
  const perPropertyRules = rules.filter((r) => r.scope === 'per_property');
  const sharedRules = rules.filter((r) => r.scope === 'shared');

  // Add warning if no subject property found
  const subjectProperty = findSubjectProperty(response);
  if (!subjectProperty && response.application.propertyId) {
    warnings.push(
      `Subject property not found: application.propertyId "${response.application.propertyId}" does not match any property in response`
    );
  }

  // 4. Evaluate per-borrower rules FOR EACH borrower (CHKL-04)
  for (const ctx of borrowerContexts) {
    const borrowerName = `${ctx.borrower.firstName} ${ctx.borrower.lastName}`;
    const rawItems: ChecklistItem[] = [];

    for (const rule of perBorrowerRules) {
      const [item, warning] = evaluateRule(rule, ctx);
      if (warning) warnings.push(warning);
      if (item) rawItems.push(item);
    }

    // Deduplicate within this borrower (multi-income handling)
    const dedupedItems = deduplicateItems(rawItems);

    // Separate internal-only from client-facing
    const clientItems: ChecklistItem[] = [];
    for (const item of dedupedItems) {
      if (!item.forEmail) {
        const rule = findRule(rules, item.ruleId);
        if (rule) {
          internalFlags.push(toInternalFlag(item, rule, borrowerName));
        }
      } else {
        clientItems.push(item);
      }
    }

    borrowerChecklists.push({
      borrowerId: ctx.borrower.id,
      borrowerName,
      isMainBorrower: ctx.borrower.isMainBorrower,
      items: clientItems,
    });
  }

  // 5. Evaluate per-property rules FOR EACH property
  const mainBorrowerCtx = borrowerContexts[0];
  if (mainBorrowerCtx) {
    const nonSubjectProperties = response.properties.filter(
      (p) => p.id !== response.application.propertyId
    );
    let nonSubjectIdx = 0;

    for (let i = 0; i < response.properties.length; i++) {
      const property = response.properties[i];
      const isSubject = property.id === response.application.propertyId;

      // Build property description from address data
      const description = buildPropertyDescription(
        property.id,
        response.addresses,
        property.addressId,
        isSubject,
        isSubject ? 0 : nonSubjectIdx,
        nonSubjectProperties.length
      );
      if (!isSubject) nonSubjectIdx++;

      // Reuse main borrower context for property rule evaluation
      const rawItems: ChecklistItem[] = [];

      for (const rule of perPropertyRules) {
        const [item, warning] = evaluateRule(rule, mainBorrowerCtx);
        if (warning) warnings.push(warning);
        if (item) rawItems.push(item);
      }

      const dedupedItems = deduplicateItems(rawItems);

      // Separate internal-only from client-facing
      const clientItems: ChecklistItem[] = [];
      for (const item of dedupedItems) {
        if (!item.forEmail) {
          const rule = findRule(rules, item.ruleId);
          if (rule) {
            internalFlags.push(toInternalFlag(item, rule));
          }
        } else {
          clientItems.push(item);
        }
      }

      // Only add property checklist if it has items
      if (clientItems.length > 0) {
        propertyChecklists.push({
          propertyId: property.id,
          propertyDescription: description,
          items: clientItems,
        });
      }
    }
  }

  // 6. Evaluate shared rules (using main borrower context)
  if (mainBorrowerCtx) {
    const rawItems: ChecklistItem[] = [];

    for (const rule of sharedRules) {
      const [item, warning] = evaluateRule(rule, mainBorrowerCtx);
      if (warning) warnings.push(warning);
      if (item) rawItems.push(item);
    }

    const dedupedItems = deduplicateItems(rawItems);

    for (const item of dedupedItems) {
      if (!item.forEmail) {
        const rule = findRule(rules, item.ruleId);
        if (rule) {
          internalFlags.push(toInternalFlag(item, rule));
        }
      } else {
        sharedItems.push(item);
      }
    }
  }

  // 7. Compute stats
  const allClientItems = [
    ...borrowerChecklists.flatMap((bc) => bc.items),
    ...propertyChecklists.flatMap((pc) => pc.items),
    ...sharedItems,
  ];

  const stats: ChecklistStats = {
    totalItems: allClientItems.length + internalFlags.length,
    preItems: allClientItems.filter((i) => i.stage === 'PRE').length,
    fullItems: allClientItems.filter((i) => i.stage === 'FULL').length,
    perBorrowerItems: borrowerChecklists.reduce(
      (sum, bc) => sum + bc.items.length,
      0
    ),
    sharedItems: sharedItems.length,
    internalFlags: internalFlags.length,
    warnings: warnings.length,
  };

  // 8. Return GeneratedChecklist
  return {
    applicationId: response.application.id,
    generatedAt: currentDate.toISOString(),
    borrowerChecklists,
    propertyChecklists,
    sharedItems,
    internalFlags,
    warnings,
    stats,
  };
}
