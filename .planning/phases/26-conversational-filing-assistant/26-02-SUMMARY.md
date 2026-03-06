---
phase: 26-conversational-filing-assistant
plan: 02
subsystem: intake
tags: [gemini, ai, natural-language, reply-parsing, gmail]

# Dependency graph
requires:
  - phase: 25-smart-forwarding-filing-feedback
    provides: "Gemini 2.0 Flash structured output pattern (body-extractor.ts), classification config"
provides:
  - "extractReplyText function for stripping Gmail quotes/signatures from reply bodies"
  - "parseFilingReply function for AI-powered natural language reply interpretation"
  - "ReplyParseResult and ReplyAction types for downstream consumers"
affects: [26-03-PLAN, intake-worker, classification-worker]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Gemini lazy singleton for reply parsing (same as body-extractor.ts)"]

key-files:
  created:
    - src/intake/reply-parser.ts
    - src/intake/__tests__/reply-parser.test.ts
  modified: []

key-decisions:
  - "Same Gemini 2.0 Flash lazy singleton pattern as body-extractor.ts for consistency"
  - "Bounds-check selectedIndex and override to 'unclear' when out of range (defensive against hallucinated indices)"
  - "extractReplyText stops at first marker encountered (quote, >, signature) rather than stripping all markers independently"

patterns-established:
  - "Reply text extraction: line-by-line scan stopping at first Gmail quote/signature marker"
  - "ReplyParseResult interface with action enum + selectedIndex + confidence for downstream decision-making"

requirements-completed: [CONV-03]

# Metrics
duration: 2min
completed: 2026-03-06
---

# Phase 26 Plan 02: Reply Parser Summary

**Gemini 2.0 Flash AI reply parser with extractReplyText for Gmail quote stripping and parseFilingReply for natural language filing choice interpretation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-06T19:31:57Z
- **Completed:** 2026-03-06T19:34:08Z
- **Tasks:** 1
- **Files created:** 2

## Accomplishments
- Created reply-parser.ts module with two exported functions and types
- extractReplyText strips Gmail "On ... wrote:" markers, ">" quoted lines, and "--" signature delimiters
- parseFilingReply uses Gemini 2.0 Flash structured output to interpret natural language replies (numbers, names, "skip", "create new", gibberish)
- Bounds-checks selectedIndex against options array and overrides to 'unclear' on out-of-range
- Full error handling: Gemini failures return action='unclear' with confidence 0 and error message
- 21 tests covering all variations, full suite green (1055 tests, 62 files)

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1 RED: Failing tests for reply parser** - `2d442b2` (test)
2. **Task 1 GREEN: Implement reply-parser module** - `0758d9c` (feat)

## Files Created/Modified
- `src/intake/reply-parser.ts` - extractReplyText + parseFilingReply + types (ReplyAction, ReplyParseResult)
- `src/intake/__tests__/reply-parser.test.ts` - 21 unit tests (7 extractReplyText + 14 parseFilingReply)

## Decisions Made
- Used same Gemini lazy singleton pattern as body-extractor.ts for consistency across codebase
- extractReplyText stops at first marker (quote, >, signature) rather than independently stripping each type -- simpler and handles real Gmail reply format correctly
- Bounds-check selectedIndex defensively: Gemini might hallucinate an index outside the options array, so override to 'unclear' rather than crash

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- reply-parser.ts ready for import by intake-worker.ts (Plan 26-03)
- ReplyParseResult type ready for use in reply handling flow
- parseFilingReply accepts the same options format that will be stored in Redis pending choices

## Self-Check: PASSED

- [x] src/intake/reply-parser.ts -- FOUND
- [x] src/intake/__tests__/reply-parser.test.ts -- FOUND
- [x] 26-02-SUMMARY.md -- FOUND
- [x] Commit 2d442b2 -- FOUND
- [x] Commit 0758d9c -- FOUND

---
*Phase: 26-conversational-filing-assistant*
*Completed: 2026-03-06*
