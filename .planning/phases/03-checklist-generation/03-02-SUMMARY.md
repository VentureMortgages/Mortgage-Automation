---
phase: 03-checklist-generation
plan: 02
subsystem: checklist
tags: [typescript, mortgage-docs, checklist-rules, finmo-api, domain-logic]

# Dependency graph
requires:
  - "03-01: TypeScript project bootstrap + type definitions (ChecklistRule, RuleContext, Finmo types)"
provides:
  - "103 typed ChecklistRule objects covering all 18 DOC_CHECKLIST_RULES_V2 sections"
  - "getTaxYears() utility for dynamic tax year calculation in display names"
  - "allRules combined array for engine evaluation"
  - "manualFlagSections documenting which sections need Cat's manual activation"
  - "Individual rule array exports for targeted testing"
affects: [03-checklist-generation-plan-03, 03-checklist-generation-plan-04, 04-crm-integration, 05-email-drafting]

# Tech tracking
tech-stack:
  added: []
  patterns: [getter-display-names, helper-condition-functions, dormant-manual-flag-rules, internal-only-checks]

key-files:
  created:
    - src/checklist/utils/tax-years.ts
    - src/checklist/rules/base-pack.ts
    - src/checklist/rules/income-employed.ts
    - src/checklist/rules/income-self-employed.ts
    - src/checklist/rules/income-other.ts
    - src/checklist/rules/variable-income.ts
    - src/checklist/rules/liabilities.ts
    - src/checklist/rules/situations.ts
    - src/checklist/rules/down-payment.ts
    - src/checklist/rules/property.ts
    - src/checklist/rules/residency.ts
    - src/checklist/rules/index.ts
  modified: []

key-decisions:
  - "Used getter displayName properties for dynamic tax year rendering at evaluation time"
  - "Sole prop vs incorporated detection uses businessType and selfPayType heuristics with safe fallback (request both if uncertain)"
  - "Dormant rules pattern: condition always returns false for non-detectable sections (maternity, probation, stated income, bankruptcy, residency)"
  - "103 total rules (higher than plan estimate of 80-90) — faithful to every item in DOC_CHECKLIST_RULES_V2"

patterns-established:
  - "Getter displayName: rules use `get displayName()` to generate dynamic tax year references via getTaxYears()"
  - "Dormant rule pattern: non-detectable conditions return false; manualFlagSections array documents which sections need manual activation"
  - "Internal-only pattern: internalOnly=true + internalCheckNote for items Cat verifies but never sends to client"
  - "Helper function pattern: each rule file defines typed helpers (isSelfEmployed, hasCommission, etc.) used by condition functions"

# Metrics
duration: 6min
completed: 2026-02-13
---

# Phase 03 Plan 02: Checklist Rule Definitions Summary

**103 typed ChecklistRule objects encoding all 18 sections of Cat-approved DOC_CHECKLIST_RULES_V2.md with dynamic tax years, sole prop/incorporated detection, and dormant manual-flag sections**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-13T21:28:05Z
- **Completed:** 2026-02-13T21:34:01Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Encoded all 18 sections (0-17) of DOC_CHECKLIST_RULES_V2.md as 103 typed ChecklistRule objects
- Created getTaxYears() utility for dynamic tax year references in display names
- Implemented sole proprietor vs incorporated detection with safe fallback (both requested when uncertain)
- All 13 CHKL-05 exclusions verified absent from client-facing rules
- Gift letter correctly marked as internalOnly with stage LATER (CHKL-06)
- T2125, T776, and Schedule 50 internal checks implemented as internalOnly rules
- 9 manual-flag sections documented for non-detectable conditions requiring Cat's input

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tax year utility and rule files for Sections 0-6 (Base + Income)** - `d66e91b` (feat)
2. **Task 2: Create rule files for Sections 7-17 (Remaining Income + All Other Sections)** - `95c7d96` (feat)

## Files Created/Modified
- `src/checklist/utils/tax-years.ts` - Dynamic tax year calculation (currentTaxYear, previousTaxYear, t4Available)
- `src/checklist/rules/base-pack.ts` - Section 0: photo ID, second ID, void cheque (3 rules)
- `src/checklist/rules/income-employed.ts` - Sections 1-2: salary/hourly + contract (9 rules)
- `src/checklist/rules/income-self-employed.ts` - Sections 3-6: general SE, sole prop, incorporated, stated (14 rules)
- `src/checklist/rules/income-other.ts` - Sections 7-9: retired, maternity, probation (9 rules)
- `src/checklist/rules/variable-income.ts` - Section 10: commission, bonus, rental, support, other (16 rules)
- `src/checklist/rules/liabilities.ts` - Section 11: mortgage statements, LOC, support (3 rules)
- `src/checklist/rules/situations.ts` - Sections 12-13: divorce/separation, bankruptcy (7 rules)
- `src/checklist/rules/down-payment.ts` - Section 14: savings, RRSP, TFSA, FHSA, gift, sale, inheritance, borrowed (16 rules)
- `src/checklist/rules/property.ts` - Section 15: purchase, refinance, condo, multi-unit, investment (11 rules)
- `src/checklist/rules/residency.ts` - Sections 16-17: newcomer, work permit, non-resident, first-time buyer (15 rules)
- `src/checklist/rules/index.ts` - Barrel export: allRules array, individual exports, manualFlagSections

## Decisions Made
- **Getter displayName for tax years:** Used `get displayName()` instead of static strings so tax year references are calculated at evaluation time via getTaxYears(). This keeps display names accurate as time progresses without rebuilding.
- **Safe fallback for SE sub-type detection:** When businessType and selfPayType are both null/empty, the borrower is treated as sole proprietor (requesting broader doc set). If incorporated is clearly detected, sole prop docs are excluded.
- **Dormant rules for non-detectable conditions:** Rather than omitting rules for maternity, probation, stated income, bankruptcy, and residency, they exist with `condition: () => false`. This preserves them as documentation and allows future manual activation.
- **103 rules vs plan estimate of 80-90:** The actual count is higher because the plan was an estimate. Every document from DOC_CHECKLIST_RULES_V2.md (excluding removed items) is faithfully represented.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed incorrect dynamic notes reference on LOE rule**
- **Found during:** Task 1
- **Issue:** LOE rule had `notes: getEmployerNote.name` which would produce the string "getEmployerNote" at runtime instead of actual employer info. The notes field is a static string, not a function.
- **Fix:** Removed the incorrect notes field. Employer name display will be handled by the rule engine (Plan 03) when building ChecklistItems from RuleContext.
- **Files modified:** src/checklist/rules/income-employed.ts
- **Verification:** tsc --noEmit passes, no unused function warnings
- **Committed in:** d66e91b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor correctness fix. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 103 rules are defined and compilable, ready for Plan 03 (rule engine that evaluates rules against RuleContext)
- allRules barrel export provides single import point for the engine
- manualFlagSections documents which sections need Cat's manual activation (useful for engine warnings)
- Individual rule array exports enable targeted testing in Plan 04
- No blockers identified for proceeding

## Self-Check: PASSED

- [x] src/checklist/utils/tax-years.ts: FOUND
- [x] src/checklist/rules/base-pack.ts: FOUND
- [x] src/checklist/rules/income-employed.ts: FOUND
- [x] src/checklist/rules/income-self-employed.ts: FOUND
- [x] src/checklist/rules/income-other.ts: FOUND
- [x] src/checklist/rules/variable-income.ts: FOUND
- [x] src/checklist/rules/liabilities.ts: FOUND
- [x] src/checklist/rules/situations.ts: FOUND
- [x] src/checklist/rules/down-payment.ts: FOUND
- [x] src/checklist/rules/property.ts: FOUND
- [x] src/checklist/rules/residency.ts: FOUND
- [x] src/checklist/rules/index.ts: FOUND
- [x] Commit d66e91b: FOUND (Task 1)
- [x] Commit 95c7d96: FOUND (Task 2)
- [x] tsc --noEmit: PASSES
- [x] Total rules: 103 (verified via grep)
- [x] All 13 CHKL-05 exclusions: absent
- [x] Gift letter (CHKL-06): internalOnly=true, stage=LATER

---
*Phase: 03-checklist-generation*
*Completed: 2026-02-13*
