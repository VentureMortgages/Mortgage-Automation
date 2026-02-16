---
phase: 07-classification-filing
plan: 03
subsystem: classification
tags: [anthropic-sdk, claude-api, structured-output, pdf-classification, file-naming, subfolder-routing, tdd, vitest]

# Dependency graph
requires:
  - phase: 07-classification-filing
    plan: 01
    provides: DOCUMENT_TYPES, ClassificationResultSchema, SUBFOLDER_ROUTING, DOC_TYPE_LABELS, ClassificationConfig
provides:
  - classifyDocument function (Buffer -> ClassificationResult via Claude Haiku 4.5)
  - truncatePdf function (large PDF truncation before classification)
  - generateFilename function (ClassificationResult -> Cat-convention filename)
  - sanitizeFilename helper (filesystem-safe filenames)
  - routeToSubfolder function (DocumentType -> SubfolderTarget)
  - getPersonSubfolderName helper (first name or fallback for person subfolders)
affects: [07-04-filer, 07-05-worker]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Claude structured output with zodOutputFormat for guaranteed-valid JSON classification", "PDF truncation via pdf-lib before Claude API call to limit token cost", "Pure-function naming and routing modules with lookup-table pattern"]

key-files:
  created:
    - src/classification/classifier.ts
    - src/classification/naming.ts
    - src/classification/router.ts
    - src/classification/__tests__/classifier.test.ts
    - src/classification/__tests__/naming.test.ts
    - src/classification/__tests__/router.test.ts
  modified: []

key-decisions:
  - "zodOutputFormat takes single argument (Zod schema) in @anthropic-ai/sdk v0.74.0 (plan referenced two-arg version from older docs)"
  - "Classifier validates response with ClassificationResultSchema.parse() after JSON.parse (belt-and-suspenders validation)"
  - "Person subfolder names use first name only per Drive conventions (Terry/, Kathy/, Susan/)"
  - "sanitizeFilename preserves $, +, () characters that appear in Cat's naming (e.g., $630k+)"

patterns-established:
  - "Lazy singleton Anthropic client with configurable API key (same pattern as Gmail/CRM clients)"
  - "PDF truncation before AI classification to control token cost (~3k tokens/page)"
  - "Pure-function modules for naming and routing (no I/O, no side effects, fully testable)"
  - "Lookup-table routing pattern: SUBFOLDER_ROUTING[docType] for clean doc-type-to-folder mapping"

# Metrics
duration: 4min
completed: 2026-02-16
---

# Phase 7 Plan 03: Classifier, Naming & Router Summary

**Claude Haiku 4.5 document classifier with structured output, Cat-convention filename generator, and subfolder routing table covering all 36 doc types**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-16T01:48:12Z
- **Completed:** 2026-02-16T01:52:24Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Document classifier sends PDF to Claude API with structured output (zodOutputFormat), returns validated ClassificationResult
- Large PDFs truncated to first N pages before classification to control token cost
- Naming module generates filenames matching Cat's Drive conventions: "Name - DocType [Institution] [Year] [Amount].pdf"
- Subfolder router maps all 36 document types to correct Drive subfolder targets
- 42 new tests (10 classifier + 16 naming + 16 router), all TDD (tests written first)
- 312 total tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Build classifier with Claude API structured output (TDD)** - `b9862ab` (feat)
2. **Task 2: Build naming module and subfolder router (TDD)** - `addd36f` (feat)

_Note: TDD tasks — tests written first (RED), then implementation (GREEN), committed together per task._

## Files Created/Modified
- `src/classification/classifier.ts` - Claude API classification (PDF -> ClassificationResult via structured output), PDF truncation
- `src/classification/naming.ts` - generateFilename (Cat's naming convention), sanitizeFilename helper
- `src/classification/router.ts` - routeToSubfolder (DocumentType -> SubfolderTarget), getPersonSubfolderName
- `src/classification/__tests__/classifier.test.ts` - 10 tests: classification, base64 encoding, structured output config, model, truncation, errors, filename hint
- `src/classification/__tests__/naming.test.ts` - 16 tests: all doc type patterns (T4, T4RIF, pay stub, ID, T5, etc.), fallback names, property docs, sanitization
- `src/classification/__tests__/router.test.ts` - 16 tests: income, property, down payment, residency, business, situation, non-subject, person naming

## Decisions Made
- **zodOutputFormat signature:** Takes single argument (Zod schema) in SDK v0.74.0. Plan referenced two-arg version `zodOutputFormat(schema, 'name')` from older docs. Corrected to `zodOutputFormat(ClassificationResultSchema)`.
- **Belt-and-suspenders validation:** Response is both JSON.parsed and schema-validated with `ClassificationResultSchema.parse()`. Structured output guarantees valid JSON, but the parse step provides runtime type safety.
- **Person subfolder names:** Use first name only per DRIVE_STRUCTURE.md analysis ("Terry/", "Kathy/", "Susan/"). lastName parameter kept in interface for future flexibility but unused.
- **Filename sanitization preserves special chars:** `$`, `+`, `()` are preserved since Cat uses them (e.g., "$630k+", "Document (1).pdf"). Only filesystem-forbidden chars (`/\:*?"<>|`) are replaced.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required at this stage. ANTHROPIC_API_KEY must be set in .env before live classification (Plan 05 worker).

## Next Phase Readiness
- Classifier, naming, and router modules ready for consumption by Plan 04 (Drive filer) and Plan 05 (classification worker)
- classifyDocument(buffer, hint?) -> ClassificationResult ready for worker pipeline
- generateFilename(classification, fallback) -> string ready for Drive file upload
- routeToSubfolder(docType) -> SubfolderTarget ready for Drive folder routing
- All 312 existing tests still pass

## Self-Check: PASSED

- [x] src/classification/classifier.ts exists (146 lines, min 60)
- [x] src/classification/naming.ts exists (75 lines, min 50)
- [x] src/classification/router.ts exists (61 lines, min 30)
- [x] src/classification/__tests__/classifier.test.ts exists (275 lines, min 60)
- [x] src/classification/__tests__/naming.test.ts exists (195 lines, min 80)
- [x] src/classification/__tests__/router.test.ts exists (134 lines, min 40)
- [x] Commit b9862ab exists (classifier TDD)
- [x] Commit addd36f exists (naming + router TDD)
- [x] 312 tests pass (no regressions)
- [x] TypeScript compiles (no new errors)

---
*Phase: 07-classification-filing*
*Completed: 2026-02-16*
