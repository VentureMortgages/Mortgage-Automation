---
phase: 06-document-intake
plan: 02
subsystem: intake
tags: [pdf-lib, pdf-conversion, image-to-pdf, tdd]

# Dependency graph
requires:
  - phase: 06-document-intake/01
    provides: "IntakeDocument types, ConversionStrategy type, SUPPORTED_MIME_TYPES"
provides:
  - "convertToPdf pure function for image-to-PDF conversion"
  - "ConversionResult interface for conversion output"
  - "ConversionError class with typed code property (WORD_MANUAL_REVIEW, UNSUPPORTED_TYPE, CONVERSION_FAILED)"
affects: [06-document-intake/04, 07-classification-filing]

# Tech tracking
tech-stack:
  added: [pdf-lib]
  patterns: [Buffer-to-Uint8Array for pdf-lib compat, ConversionError with typed code]

key-files:
  created:
    - "src/intake/pdf-converter.ts"
    - "src/intake/__tests__/pdf-converter.test.ts"
  modified:
    - "package.json"
    - "package-lock.json"

key-decisions:
  - "Buffer-to-Uint8Array conversion before passing to pdf-lib (pdf-lib marker scanning fails on Node.js Buffer)"
  - "Word documents throw ConversionError instead of auto-converting (LibreOffice system dependency deferred)"
  - "Minimal valid JPEG/PNG hex fixtures for deterministic tests (no external test image files)"

patterns-established:
  - "ConversionError with code property: typed error class for conversion pipeline error handling"
  - "Uint8Array wrapping: always convert Buffer to new Uint8Array(buffer) before pdf-lib operations"

# Metrics
duration: 5min
completed: 2026-02-14
---

# Phase 6 Plan 02: PDF Converter Summary

**Pure-function PDF converter using pdf-lib: JPEG/PNG to PDF, PDF passthrough, Word rejection with typed ConversionError**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-14T05:53:29Z
- **Completed:** 2026-02-14T05:58:24Z
- **Tasks:** 1 (TDD: RED -> GREEN)
- **Files modified:** 4

## Accomplishments
- convertToPdf function handles all five cases: JPEG, PNG, PDF passthrough, Word rejection, unsupported rejection
- ConversionError class with typed code property for downstream error handling
- 15 comprehensive tests covering all conversion paths plus edge cases (empty buffer, corrupt data)
- pdf-lib installed as pure JS dependency (no native dependencies)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for PDF converter** - `e5c6716` (test)
2. **Task 1 (GREEN): Implement PDF converter** - `9977b62` (feat)

_TDD task with RED -> GREEN commits. No refactor needed._

## Files Created/Modified
- `src/intake/pdf-converter.ts` - convertToPdf function and ConversionError class
- `src/intake/__tests__/pdf-converter.test.ts` - 15 tests covering all conversion paths
- `package.json` - Added pdf-lib dependency
- `package-lock.json` - Lock file update

## Decisions Made
- **Buffer-to-Uint8Array for pdf-lib:** pdf-lib's internal JPEG/PNG parsers use array indexing that fails on Node.js Buffer (which extends Uint8Array but has different internal memory layout). Converting to `new Uint8Array(buffer)` before passing to embedJpg/embedPng resolves the issue.
- **Word documents deferred:** Word-to-PDF conversion requires LibreOffice system dependency. Instead, Word MIME types throw ConversionError with code 'WORD_MANUAL_REVIEW', flagging them for Cat's manual conversion. This aligns with the plan's recommendation and keeps Phase 6 free of native dependencies.
- **Minimal hex fixtures:** Tests use hardcoded minimal valid JPEG (333 bytes) and PNG (69 bytes) hex strings rather than external fixture files. These were validated against pdf-lib's parsers during development.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Buffer-to-Uint8Array conversion for pdf-lib compatibility**
- **Found during:** Task 1 (GREEN phase - implementation)
- **Issue:** pdf-lib's embedJpg/embedPng throw "SOI not found" or undefined reference errors when receiving Node.js Buffer directly, despite Buffer extending Uint8Array
- **Fix:** Added `new Uint8Array(buffer)` conversion before all pdf-lib embed calls
- **Files modified:** src/intake/pdf-converter.ts
- **Verification:** All 15 tests pass including JPEG and PNG conversion
- **Committed in:** 9977b62

**2. [Rule 1 - Bug] Fixed test fixture hex strings**
- **Found during:** Task 1 (GREEN phase - tests initially failed with invalid fixtures)
- **Issue:** Initial minimal JPEG/PNG hex strings were malformed (incorrect segment lengths, missing required JPEG tables, wrong PNG zlib compression)
- **Fix:** Generated correct minimal JPEG (full JFIF with DQT/SOF0/DHT/SOS) and PNG (proper zlib-compressed IDAT with correct CRC32) validated against pdf-lib
- **Files modified:** src/intake/__tests__/pdf-converter.test.ts
- **Verification:** Both image types embed successfully into PDF, output starts with %PDF magic bytes
- **Committed in:** 9977b62

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- convertToPdf ready for intake-worker.ts (Plan 04) integration
- ConversionError provides typed error handling for the intake pipeline
- All 198 total tests pass (183 prior + 15 new)

---
*Phase: 06-document-intake*
*Completed: 2026-02-14*
