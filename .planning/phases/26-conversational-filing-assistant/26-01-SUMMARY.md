---
phase: 26-conversational-filing-assistant
plan: 01
subsystem: email, matching
tags: [redis, gmail-api, fuzzy-matching, mime, bullmq]

# Dependency graph
requires:
  - phase: 25-smart-forwarding-filing-feedback
    provides: "Filing confirmation email infrastructure (MIME threading, Redis tracking, Gmail compose)"
provides:
  - "FolderSearchResult type with allMatches for ambiguous folder matches"
  - "AutoCreateAmbiguousResult for propagating folder ambiguity to classification worker"
  - "buildQuestionBody for conversational numbered-option question emails"
  - "storePendingChoice / getPendingChoice / deletePendingChoice for Redis pending choice storage"
  - "sendQuestionEmail for in-thread question emails to Cat"
  - "Classification worker wiring for question emails on both contact-level and folder-level ambiguity"
affects: [26-02 (reply detection in intake worker), 26-03 (AI reply parser + deferred filing execution)]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Pending choice Redis storage with 24h TTL keyed by threadId", "Ambiguous result propagation from folder-search through auto-create to classification-worker"]

key-files:
  created: []
  modified:
    - "src/matching/folder-search.ts"
    - "src/matching/__tests__/folder-search.test.ts"
    - "src/matching/auto-create.ts"
    - "src/matching/__tests__/auto-create.test.ts"
    - "src/email/filing-confirmation.ts"
    - "src/email/__tests__/filing-confirmation.test.ts"
    - "src/classification/classification-worker.ts"

key-decisions:
  - "FolderSearchResult returns {match, allMatches} -- match is null for 0 or 2+ matches, allMatches always populated"
  - "AutoCreateAmbiguousResult includes contactId so classification worker can associate pending choice with CRM contact"
  - "Question email sent non-fatally in both needs_review/conflict and auto_created ambiguous paths"
  - "Pending choice keyed by threadId (not gmailMessageId) so reply detection can match on thread"

patterns-established:
  - "Ambiguous result type: return {ambiguous: true, ...} and check via 'ambiguous' in result"
  - "Question email follows same MIME threading pattern as filing confirmation"

requirements-completed: [CONV-01]

# Metrics
duration: 6min
completed: 2026-03-06
---

# Phase 26 Plan 01: Question Emails for Ambiguous Filing Summary

**FolderSearchResult with allMatches, question email builder with numbered options, pending choice Redis storage, and classification worker wiring for both contact-level and folder-level ambiguity**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-06T19:31:47Z
- **Completed:** 2026-03-06T19:37:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- `searchExistingFolders` now returns `FolderSearchResult` with `allMatches` array, enabling downstream consumers to see all fuzzy folder matches instead of just the single best or null
- `autoCreateFromDoc` returns `AutoCreateAmbiguousResult` when 2+ folders fuzzy-match, propagating folder options to the classification worker
- New `buildQuestionBody` produces conversational plain-text email listing folder options as numbered list with natural reply instructions
- Pending choices stored in Redis with 24h TTL keyed by threadId, ready for Plan 02's reply detection
- Classification worker sends question emails for both contact-level ambiguity (needs_review/conflict with 2+ candidates) and folder-level ambiguity (auto_created with 2+ fuzzy matches)
- Full test suite: 1064 tests passing across 62 files

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify folder-search to return full match list and update auto-create consumer** - `5b15a76` (feat)
2. **Task 2: Add question email builder, pending choice storage, and wire into classification worker** - `0545b4c` (feat)

## Files Created/Modified
- `src/matching/folder-search.ts` - Added FolderSearchResult interface, changed return type from single match to {match, allMatches}
- `src/matching/__tests__/folder-search.test.ts` - Updated all tests for FolderSearchResult shape, added 2+ match allMatches test
- `src/matching/auto-create.ts` - Added AutoCreateAmbiguousResult, returns ambiguous result for 2+ fuzzy matches
- `src/matching/__tests__/auto-create.test.ts` - Added ambiguous result test, updated mock return values for FolderSearchResult
- `src/email/filing-confirmation.ts` - Added PendingChoice type, buildQuestionBody, storePendingChoice, getPendingChoice, deletePendingChoice, sendQuestionEmail
- `src/email/__tests__/filing-confirmation.test.ts` - Added tests for buildQuestionBody (2 and 3 options), pending choice CRUD, sendQuestionEmail threading
- `src/classification/classification-worker.ts` - Wired question emails into needs_review/conflict and auto_created ambiguous paths

## Decisions Made
- FolderSearchResult returns `{match, allMatches}` where match is null for 0 or 2+ matches, and allMatches always contains the full list. This avoids breaking the "no match" case (allMatches is empty) while exposing options for the "ambiguous" case.
- AutoCreateAmbiguousResult includes `contactId` so the classification worker can associate the pending choice with the CRM contact that was created before folder search.
- Question email is non-fatal in both code paths (try/catch wrapping). If email sending fails, the doc is still in Needs Review and the CRM task still exists.
- Pending choice is keyed by `threadId` (not `gmailMessageId`) because Cat's reply will be a new message in the same thread.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pending choice Redis storage is ready for Plan 02 to detect replies in the intake worker
- `getPendingChoice` and `deletePendingChoice` are exported and ready for the reply handler
- Plan 02 needs to add reply detection in the intake worker (check threadId against pending choices)
- Plan 03 needs to add AI reply parsing and deferred filing execution

---
*Phase: 26-conversational-filing-assistant*
*Completed: 2026-03-06*
