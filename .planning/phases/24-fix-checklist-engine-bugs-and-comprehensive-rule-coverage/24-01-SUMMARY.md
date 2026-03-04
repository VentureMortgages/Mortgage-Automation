---
phase: 24-fix-checklist-engine-bugs-and-comprehensive-rule-coverage
plan: 01
subsystem: checklist
tags: [checklist-engine, rule-evaluation, finmo, tdd, bug-fix]

# Dependency graph
requires:
  - phase: 03-checklist-rules
    provides: "ChecklistRule definitions, RuleContext, generateChecklist engine"
provides:
  - "Per-property rule evaluation via RuleContext.currentProperty"
  - "Hardened detection patterns for gift, inheritance, borrowed DP (type-first, description-fallback)"
  - "Expanded pension/CPP/OAS income source detection"
  - "Activated support and CCB income rules (no longer dormant)"
  - "Explicit rental use type matching for investment property detection"
  - "Unrecognized value warnings for income source, property use, asset type"
affects: [checklist-generation, email-drafting, crm-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-property context injection via RuleContext.currentProperty"
    - "Type-first detection with description fallback for asset classification"
    - "Unrecognized field value warnings in checklist output"

key-files:
  created:
    - src/checklist/__tests__/fixtures/pension-purchase.json
    - src/checklist/__tests__/fixtures/rental-mixed-use.json
    - src/checklist/__tests__/fixtures/support-income.json
    - src/checklist/__tests__/fixtures/empty-assets-dp.json
  modified:
    - src/checklist/types/checklist.ts
    - src/checklist/engine/generate-checklist.ts
    - src/checklist/rules/down-payment.ts
    - src/checklist/rules/income-other.ts
    - src/checklist/rules/variable-income.ts
    - src/checklist/rules/property.ts
    - src/checklist/__tests__/generate-checklist.test.ts
    - src/checklist/__tests__/fixtures/index.ts

key-decisions:
  - "Per-property evaluation uses context spread with currentProperty injection (not separate context builder)"
  - "Gift detection uses type-first pattern: asset.type checked for gift/gift_family/gift_from_immediate_family_member before description fallback"
  - "isInvestment uses explicit inclusion of rental use types (not negation of owner_occupied)"
  - "Support and CCB rules activated directly into client-facing output (no staging as internal-only)"
  - "hasOtherIncome left dormant (disability, social assistance, trust, investment not auto-detectable from Finmo)"

patterns-established:
  - "Per-property context: spread mainBorrowerCtx + set currentProperty for per_property scope rules"
  - "Type-first detection: check asset.type/income.source for explicit values, fallback to description/text matching"
  - "Known value constants: RETIRED_SOURCES, SUPPORT_SOURCES, CCB_SOURCES, RENTAL_USE_TYPES defined as module-level arrays"

requirements-completed: [BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-07]

# Metrics
duration: 6min
completed: 2026-03-04
---

# Phase 24 Plan 01: Fix Checklist Engine Bugs Summary

**Fixed 6 checklist engine bugs (BUG 1-5, 7) with TDD approach: per-property evaluation, empty-assets DP, gift type detection, pension/CPP/OAS sources, support/CCB activation, and rental use type matching -- 88 tests passing, zero regressions**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-04T20:56:17Z
- **Completed:** 2026-03-04T21:02:52Z
- **Tasks:** 1 (TDD task with RED + GREEN phases)
- **Files modified:** 12

## Accomplishments
- Fixed per-property rental rule evaluation -- rental docs now only appear on the rental property, not the owner-occupied subject property
- Fixed empty assets DP detection -- purchase with downPayment > 0 always requests bank statements even when assets array is empty
- Hardened gift/inheritance/borrowed detection with type-first pattern (asset.type checked before description fallback)
- Expanded pension income detection to all Finmo source values: retired, pension, cpp, oas, canada_pension_plan, old_age_security
- Activated dormant support rules (child_support, spousal_support) and CCB rules (ccb, canada_child_benefit)
- Fixed investment property detection to use explicit rental use type inclusion instead of negation
- Added unrecognized value warnings for income source, property use, and asset type monitoring
- All 88 checklist tests pass with zero regressions

## Task Commits

Each task was committed atomically (TDD RED + GREEN):

1. **Task 1 RED: Add failing tests for bugs 1-5, 7** - `ad4233a` (test)
2. **Task 1 GREEN: Fix all 6 bugs + add unrecognized value warnings** - `fa9d23d` (feat)

## Files Created/Modified
- `src/checklist/types/checklist.ts` - Added currentProperty field to RuleContext for per-property evaluation
- `src/checklist/engine/generate-checklist.ts` - Per-property context injection + unrecognized value warnings
- `src/checklist/rules/down-payment.ts` - BUG 2 (empty DP assets) + BUG 3 (gift/inheritance/borrowed type-first detection)
- `src/checklist/rules/income-other.ts` - BUG 4 (pension/CPP/OAS source detection via RETIRED_SOURCES array)
- `src/checklist/rules/variable-income.ts` - BUG 1 (per-property hasRentalIncome) + BUG 5 (activated support/CCB rules) + BUG 7 (rental use types)
- `src/checklist/rules/property.ts` - BUG 7 (explicit RENTAL_USE_TYPES inclusion for isInvestment)
- `src/checklist/__tests__/generate-checklist.test.ts` - 25 new test cases across 6 bug-specific test suites
- `src/checklist/__tests__/fixtures/index.ts` - Exports for 4 new test fixtures
- `src/checklist/__tests__/fixtures/pension-purchase.json` - Pension income purchase fixture (BUG 4)
- `src/checklist/__tests__/fixtures/rental-mixed-use.json` - Mixed use 2-property fixture (BUG 1, 7)
- `src/checklist/__tests__/fixtures/support-income.json` - Child support income fixture (BUG 5)
- `src/checklist/__tests__/fixtures/empty-assets-dp.json` - Empty assets with DP > 0 fixture (BUG 2)

## Decisions Made
- Per-property evaluation uses context spread (`{ ...mainBorrowerCtx, currentProperty: property }`) rather than a new builder function -- simpler, no refactoring needed in build-context.ts
- Gift detection uses type-first pattern (gift, gift_family, gift_from_immediate_family_member) with description fallback for backward compatibility with existing data
- isInvestment uses explicit inclusion of known rental use types rather than negation of owner_occupied -- prevents second_home from incorrectly triggering investment rules
- Support and CCB rules activated directly into client-facing output (no staging period as internal-only) per user decision in 24-CONTEXT.md
- hasOtherIncome left dormant (disability, social assistance, trust, investment) as these are not auto-detectable from Finmo dropdown values

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed excludeWhen for s10_rental_tax with per-property context**
- **Found during:** Task 1 GREEN phase
- **Issue:** The excludeWhen on s10_rental_tax checked all properties globally for isSelling, but with per-property context it needed to check only the current property
- **Fix:** Added currentProperty-aware branch to excludeWhen: checks currentProperty.isSelling when set, falls back to global check otherwise
- **Files modified:** src/checklist/rules/variable-income.ts
- **Verification:** All 88 tests pass
- **Committed in:** fa9d23d (GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correctness fix for per-property evaluation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 core checklist engine bugs fixed and proven by tests
- Ready for Plan 02 (new rules for coverage gaps) and Plan 03 (CRM bugs 8-9)
- Unrecognized value warnings provide monitoring foundation for catching new Finmo API values

## Self-Check: PASSED

All 12 created/modified files verified present. Both commits (ad4233a, fa9d23d) verified in git log. 88 tests passing, zero regressions.

---
*Phase: 24-fix-checklist-engine-bugs-and-comprehensive-rule-coverage*
*Completed: 2026-03-04*
