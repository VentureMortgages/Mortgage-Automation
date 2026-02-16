---
phase: 07-classification-filing
plan: 01
subsystem: classification
tags: [anthropic-sdk, zod, claude-api, document-classification, google-drive, typescript-types]

# Dependency graph
requires:
  - phase: 06-document-intake
    provides: IntakeDocument type, IntakeSource type consumed by ClassificationJobData
provides:
  - DOCUMENT_TYPES constant (36 mortgage doc types) with DocumentType union
  - ClassificationResultSchema (Zod schema for Claude structured output)
  - SUBFOLDER_ROUTING table (DocumentType -> SubfolderTarget mapping)
  - DOC_TYPE_LABELS (human-readable labels for filename generation)
  - FilingDecision, ClassificationJobData, ClassificationJobResult interfaces
  - ClassificationConfig with Anthropic API key, model, confidence threshold, Drive settings
  - "@anthropic-ai/sdk" and "zod" production dependencies
affects: [07-02-classifier, 07-03-naming-router, 07-04-filer, 07-05-worker]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/sdk@0.74.0", "zod@4.3.6"]
  patterns: ["Zod schema for Claude structured output via zodOutputFormat", "Classification config with kill switch and env var pattern"]

key-files:
  created:
    - src/classification/types.ts
    - src/classification/config.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Zod v4 (4.3.6) installed as dependency of @anthropic-ai/sdk, compatible with zodOutputFormat helper"
  - "36 document types (not 33 as estimated) covering all mortgage doc categories from DRIVE_STRUCTURE analysis"
  - "driveRootFolderId optional in config (populated by setup script or env var, not required at load time)"
  - "Kill switch at config level (CLASSIFICATION_ENABLED=false) following same pattern as webhook kill switch"

patterns-established:
  - "DOCUMENT_TYPES as const array with DocumentType union: type-safe document type handling across all Phase 7 modules"
  - "SUBFOLDER_ROUTING lookup table: clean mapping from doc type to Drive subfolder target (person, subject_property, etc.)"
  - "DOC_TYPE_LABELS lookup table: doc type to human-readable label for Cat's naming convention"
  - "ClassificationConfig: same requiredEnv/optionalEnv pattern as config.ts and crm/config.ts"

# Metrics
duration: 4min
completed: 2026-02-15
---

# Phase 7 Plan 01: Classification Types & Config Summary

**Zod schema + 36 document types + subfolder routing table + classification config for Claude-based PDF classification pipeline**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-16T01:35:34Z
- **Completed:** 2026-02-16T01:39:09Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Installed @anthropic-ai/sdk (v0.74.0) and zod (v4.3.6) as production dependencies
- Created comprehensive type system covering 36 mortgage document types with Zod schema for Claude structured output
- Established subfolder routing table and doc type labels matching Cat's Drive folder conventions
- Classification config with kill switch, confidence threshold, model selection, and Drive settings

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @anthropic-ai/sdk and zod dependencies** - `2089eb0` (chore)
2. **Task 2: Create classification types and config modules** - `ccbd80c` (feat)

## Files Created/Modified
- `src/classification/types.ts` - 36 document types, Zod ClassificationResultSchema, SUBFOLDER_ROUTING, DOC_TYPE_LABELS, FilingDecision, ClassificationJobData, ClassificationJobResult
- `src/classification/config.ts` - ClassificationConfig with Anthropic API key, model, confidence threshold, Drive root folder ID, kill switch, impersonation email
- `package.json` - Added @anthropic-ai/sdk and zod dependencies
- `package-lock.json` - Lock file updated with 5 new packages

## Decisions Made
- **Zod v4 compatibility:** zod@4.3.6 (v4) installed as transitive dependency of @anthropic-ai/sdk. Compatible with zodOutputFormat helper. skipLibCheck handles internal .d.cts locale warnings in NodeNext mode.
- **36 document types vs plan's 33:** Actual count from the research spec lists 36 types. Plan's "33 entries" was an estimate. All types from the research are included.
- **driveRootFolderId optional:** Config allows empty string (populated by setup script or env var later). Required at runtime, not at config load time. Follows same pattern as CRM field IDs.
- **Kill switch pattern:** `CLASSIFICATION_ENABLED !== 'false'` (enabled by default), matching the webhook AUTOMATION_KILL_SWITCH pattern.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in `src/email/setup/test-draft.ts` (8 errors about ChecklistItem shape). These are not related to this plan and exist on the previous commit. No new errors introduced.

## User Setup Required

None - no external service configuration required at this stage. ANTHROPIC_API_KEY and DRIVE_ROOT_FOLDER_ID will be needed when the classifier (Plan 02) and filer (Plan 04) are implemented.

## Next Phase Readiness
- Types and config modules ready for consumption by Plans 02-05
- ClassificationResultSchema ready for zodOutputFormat in classifier.ts (Plan 02)
- SUBFOLDER_ROUTING and DOC_TYPE_LABELS ready for naming.ts (Plan 03) and router.ts (Plan 03)
- ClassificationJobData ready for classification-worker.ts (Plan 05)
- All 241 existing tests still pass

## Self-Check: PASSED

- [x] src/classification/types.ts exists (232 lines, min 80)
- [x] src/classification/config.ts exists (64 lines, min 30)
- [x] Commit 2089eb0 exists (chore: install dependencies)
- [x] Commit ccbd80c exists (feat: types and config modules)
- [x] 241 tests pass (no regressions)
- [x] TypeScript compiles (no new errors)

---
*Phase: 07-classification-filing*
*Completed: 2026-02-15*
