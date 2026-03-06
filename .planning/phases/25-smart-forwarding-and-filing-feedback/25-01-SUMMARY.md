---
phase: 25-smart-forwarding-and-filing-feedback
plan: 01
subsystem: intake
tags: [gemini, ai-parsing, forwarding-notes, multi-client, structured-output]

# Dependency graph
requires:
  - phase: 23-forwarding-notes-parsing-and-backfill-script-fix
    provides: "Regex-based forwarding note parser (body-extractor.ts)"
provides:
  - "AI-powered forwarding note parser with multi-client doc assignments"
  - "Per-attachment client hints in classification pipeline"
  - "Message-ID and batch tracking fields for filing confirmation"
  - "Wong-Ranasinghe Drive folder linking script"
affects: [25-02 (Drive folder fuzzy matching), 25-03 (filing confirmation email)]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Gemini Flash structured output for NLP parsing (same pattern as classifier.ts)"]

key-files:
  created:
    - src/admin/link-wong-ranasinghe.ts
  modified:
    - src/intake/body-extractor.ts
    - src/intake/__tests__/body-extractor.test.ts
    - src/intake/intake-worker.ts
    - src/classification/types.ts

key-decisions:
  - "AI parser uses same Gemini 2.0 Flash model as classifier.ts with responseSchema enforcement"
  - "extractForwardingNotes is now async (breaking change for callers, only intake-worker.ts)"
  - "Per-attachment client assignment uses filename-to-doctype substring matching from AI docs[]"
  - "Wong-Ranasinghe script uses direct GHL API call instead of upsertContact (no email for dedup)"

patterns-established:
  - "AI fallback pattern: try AI parser, catch errors, fall back to regex (non-fatal)"
  - "Per-attachment metadata enrichment from shared forwarding note parse result"

requirements-completed: [FWD-01, FWD-04]

# Metrics
duration: 5min
completed: 2026-03-06
---

# Phase 25 Plan 01: AI Forwarding Note Parser Summary

**Gemini Flash AI parser for multi-client forwarding notes with per-attachment client assignment and Wong-Ranasinghe data fix script**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-06T01:49:21Z
- **Completed:** 2026-03-06T01:54:31Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Replaced regex-only forwarding note parser with AI-powered Gemini Flash parser that handles multi-client notes
- Each attachment in a multi-client forwarded email now gets its own client hint based on AI-parsed doc assignments
- Added Message-ID and batch tracking fields to classification pipeline for Phase 25 Plan 03 (filing confirmation)
- Created Wong-Ranasinghe Drive folder linking script ready to run

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand ForwardingNotes interface and implement AI parser with tests (TDD):**
   - `b40d319` (test: add failing tests for AI forwarding note parser)
   - `525df57` (feat: implement AI forwarding note parser with multi-client support)
2. **Task 2: Update intake worker for per-attachment client assignment + Wong-Ranasinghe data fix** - `5327340` (feat)

## Files Created/Modified
- `src/intake/body-extractor.ts` - Added ForwardingNoteDoc type, parseForwardingNoteAI() with Gemini structured output, made extractForwardingNotes() async with AI-first + regex fallback
- `src/intake/__tests__/body-extractor.test.ts` - Added 15 new tests for AI parser (single-client, multi-client, email, fallback, error handling), updated existing tests for async
- `src/intake/intake-worker.ts` - Await async extractForwardingNotes, per-attachment client assignment from docs[], extract Message-ID header, pass totalAttachmentCount
- `src/classification/types.ts` - Added gmailMessageRfc822Id and totalAttachmentCount fields to ClassificationJobData
- `src/admin/link-wong-ranasinghe.ts` - One-time script to link Drive folder to both Wong-Ranasinghe CRM contacts

## Decisions Made
- AI parser uses same Gemini 2.0 Flash model and structured output pattern as classifier.ts for consistency
- extractForwardingNotes changed from sync to async -- only one caller (intake-worker.ts) needed updating
- Per-attachment client assignment uses filename-to-doctype case-insensitive substring match from AI docs[] array
- When multiple clients but no filename-to-doc match, client hint is left undefined (matching agent handles it)
- Wong-Ranasinghe script uses direct GHL API PUT instead of upsertContact because contacts already exist and upsertContact requires email for dedup

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Gemini SDK mock needed to use `class` syntax (not `vi.fn()`) because GoogleGenerativeAI is called with `new` - fixed by using `class MockGoogleGenerativeAI` in vi.mock

## User Setup Required
None - no external service configuration required. The Wong-Ranasinghe script is ready to run when needed: `npx tsx src/admin/link-wong-ranasinghe.ts`

## Next Phase Readiness
- AI parser and per-attachment client hints are ready for production
- Message-ID and totalAttachmentCount fields are plumbed through for Plan 03 (filing confirmation email)
- Plan 02 (Drive folder fuzzy matching) can proceed independently
- Plan 03 (filing confirmation email) depends on gmailMessageRfc822Id from this plan

## Self-Check: PASSED

All 5 created/modified files verified. All 3 task commits found.

---
*Phase: 25-smart-forwarding-and-filing-feedback*
*Completed: 2026-03-06*
