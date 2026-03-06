---
phase: 26-conversational-filing-assistant
plan: 03
subsystem: intake
tags: [gmail, redis, drive-api, gemini, filing, reply-detection]

requires:
  - phase: 26-01
    provides: "PendingChoice type, storePendingChoice, getPendingChoice, deletePendingChoice, sendQuestionEmail, question email flow in classification-worker"
  - phase: 26-02
    provides: "extractReplyText, parseFilingReply, ReplyParseResult, ReplyAction types"
provides:
  - "Reply detection in intake worker processGmailSource via Redis threadId lookup"
  - "handleFilingReply function executing all 4 action paths (select/create_new/skip/unclear)"
  - "moveFile function for Drive API file moves using addParents/removeParents"
  - "buildFollowUpBody and sendFollowUpConfirmation for post-filing in-thread replies"
  - "findPlainTextBody exported from body-extractor.ts for reuse"
affects: [phase-27-production-testing, phase-28-refinements]

tech-stack:
  added: []
  patterns:
    - "Reply detection as early short-circuit in processGmailSource (after BCC check, before attachment extraction)"
    - "Low-confidence AI parse override to 'unclear' action with clarification reply"
    - "Non-fatal error handling pattern for filing reply handler (pending choice preserved on failure)"

key-files:
  created: []
  modified:
    - src/intake/intake-worker.ts
    - src/intake/body-extractor.ts
    - src/classification/filer.ts
    - src/email/filing-confirmation.ts
    - src/intake/__tests__/intake-worker.test.ts
    - src/classification/__tests__/filer.test.ts
    - src/email/__tests__/filing-confirmation.test.ts

key-decisions:
  - "Reply detection positioned after BCC check and before full message fetch for correct priority ordering"
  - "Low-confidence select (< 0.7) treated as unclear with clarification reply rather than wrong filing"
  - "Pending choice preserved for 'unclear' action so Cat can reply again without TTL reset"
  - "CRM folder linking is non-fatal in handleFilingReply (same pattern as classification-worker)"
  - "create_new action uses original filename (minus extension) as folder name for simplicity"

patterns-established:
  - "Reply detection short-circuit: check Redis pending choice by threadId before normal attachment processing"
  - "Action dispatch pattern: switch on effectiveAction after confidence threshold override"

requirements-completed: [CONV-02, CONV-04]

duration: 5min
completed: 2026-03-06
---

# Phase 26 Plan 03: Reply Detection and Deferred Filing Execution Summary

**Intake worker detects replies to pending choice threads via Redis threadId lookup, parses Cat's reply with Gemini AI, executes filing action (move/create/skip/clarify), and confirms in-thread**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-06T19:40:10Z
- **Completed:** 2026-03-06T19:45:52Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Added moveFile function to filer.ts using Drive files.update with addParents/removeParents (zero data transfer)
- Added buildFollowUpBody and sendFollowUpConfirmation for post-filing in-thread replies with action-specific messages
- Wired reply detection into processGmailSource as early short-circuit (after BCC check, before attachment extraction)
- Implemented handleFilingReply with all 4 action paths: select (move + CRM link + confirm), create_new (create folder + move + confirm), skip (confirm + cleanup), unclear (clarify + preserve pending choice)
- Low-confidence select override to unclear prevents wrong filings when AI is unsure
- Exported findPlainTextBody from body-extractor.ts for reply text extraction
- 1080 total tests passing (7 new tests for reply detection, 8 new for moveFile and follow-up confirmation)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add moveFile to filer.ts and sendFollowUpConfirmation to filing-confirmation.ts** - `65a4045` (feat)
2. **Task 2: Wire reply detection into intake worker and execute deferred filing** - `59c66d8` (feat)

## Files Created/Modified
- `src/classification/filer.ts` - Added moveFile function for Drive file moves
- `src/email/filing-confirmation.ts` - Added buildFollowUpBody and sendFollowUpConfirmation
- `src/intake/intake-worker.ts` - Added reply detection in processGmailSource + handleFilingReply function
- `src/intake/body-extractor.ts` - Exported findPlainTextBody (was private)
- `src/classification/__tests__/filer.test.ts` - Added moveFile tests
- `src/email/__tests__/filing-confirmation.test.ts` - Added buildFollowUpBody and sendFollowUpConfirmation tests
- `src/intake/__tests__/intake-worker.test.ts` - Added 7 filing reply detection tests

## Decisions Made
- Reply detection positioned after BCC check and before full message fetch -- BCC emails should not trigger reply detection even if they happen to share a threadId with a pending choice
- Low-confidence select (< 0.7) treated as unclear -- better to ask for clarification than file to the wrong folder
- Pending choice preserved for 'unclear' action -- Cat can reply again without losing the pending state (TTL still applies)
- CRM folder linking is non-fatal in handleFilingReply -- same established pattern as classification-worker
- create_new action uses original filename minus extension as folder name -- simple heuristic, can be refined later

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- MIME body is base64-encoded in Content-Transfer-Encoding, so test assertions checking decoded MIME for body text needed adjustment to decode the body part separately. Fixed immediately in tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 26 complete: all 3 plans (01, 02, 03) implemented
- Conversational filing assistant fully wired: question emails sent for ambiguous matches, Cat replies parsed by AI, filing executed automatically
- Ready for production testing and Cat handoff

## Self-Check: PASSED

All 7 modified files verified present. Both task commits (65a4045, 59c66d8) verified in git log.

---
*Phase: 26-conversational-filing-assistant*
*Completed: 2026-03-06*
