---
phase: 06-document-intake
plan: 03
subsystem: intake
tags: [gmail-api, typescript, history-api, mime-parsing, attachment-extraction, base64url]

# Dependency graph
requires:
  - phase: 06-document-intake
    plan: 01
    provides: "IntakeDocument, GmailMessageMeta, AttachmentInfo types; getGmailReadonlyClient; IntakeConfig"
provides:
  - "pollForNewMessages with history API delta reads and stale historyId recovery"
  - "getMessageDetails with From header parsing for sender email extraction"
  - "getInitialHistoryId for first-startup historyId seeding"
  - "extractAttachments recursive MIME part walker for all attachment types"
  - "downloadAttachment base64url decoder for Gmail attachment data"
  - ".eml (message/rfc822) detection for manual review flagging"
affects: [06-document-intake, 07-classification-filing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gmail history.list API for efficient inbox delta polling (vs full scan)"
    - "Stale historyId fallback pattern: 404 -> messages.list newer_than:1d + fresh profile historyId"
    - "Recursive MIME part walker for arbitrarily nested multipart email structures"
    - "Gmail client passed as parameter (pure functions, testable without module mocking)"

key-files:
  created:
    - src/intake/gmail-reader.ts
    - src/intake/attachment-extractor.ts
    - src/intake/__tests__/gmail-reader.test.ts
    - src/intake/__tests__/attachment-extractor.test.ts
  modified: []

key-decisions:
  - "Gmail client as parameter (not imported internally) for pure, testable functions"
  - "Stale historyId detected by 404 code or 'notFound' in error message"
  - "Fallback uses Promise.all for messages.list + getProfile in parallel"
  - "Parts without filename skipped (inline text/HTML are not attachments)"
  - "Parts without attachmentId skipped (may be inline data, not downloadable)"
  - "Default mimeType to application/octet-stream when MIME part has no mimeType"

patterns-established:
  - "Mock Gmail client factory pattern: createMockGmailClient() with vi.fn() for each API method"
  - "parseEmailFromHeader extracts address from Name <email> format"

# Metrics
duration: 3min
completed: 2026-02-14
---

# Phase 6 Plan 03: Gmail Reader & Attachment Extractor Summary

**Gmail history-based inbox polling with stale ID recovery and recursive MIME part walker for attachment extraction from arbitrarily nested email structures**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T06:01:00Z
- **Completed:** 2026-02-14T06:04:06Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Gmail inbox polling via history.list API with efficient delta reads (not full inbox scan)
- Stale historyId recovery falls back to messages.list newer_than:1d with fresh profile historyId
- Recursive MIME part walker handles arbitrarily nested multipart structures
- Attachment data downloaded and decoded from base64url to Buffer
- .eml attachments (message/rfc822) detected by mimeType for downstream manual review flagging
- 25 new tests (12 gmail-reader + 13 attachment-extractor), 223 total pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Gmail reader with history-based polling** - `b3d5525` (feat)
2. **Task 2: Create attachment extractor with MIME part walking** - `c43ecb5` (feat)

## Files Created/Modified
- `src/intake/gmail-reader.ts` - getInitialHistoryId, pollForNewMessages (with stale recovery), getMessageDetails (with From header parsing)
- `src/intake/attachment-extractor.ts` - extractAttachments (recursive MIME walker), downloadAttachment (base64url decode)
- `src/intake/__tests__/gmail-reader.test.ts` - 12 tests: history polling, empty results, dedup, stale recovery (404 + notFound), header parsing, missing headers
- `src/intake/__tests__/attachment-extractor.test.ts` - 13 tests: single/multiple/nested/empty attachments, .eml detection, filename skipping, binary decode, missing data

## Decisions Made
- **Gmail client as parameter:** All functions accept the gmail client as first parameter instead of importing/calling getGmailReadonlyClient internally. This makes functions pure and testable with mock objects, no module-level mocking needed.
- **Stale historyId detection:** Checks for HTTP 404 code OR "notFound" in error message. Gmail may return either depending on the error path.
- **Parallel fallback:** When stale historyId is detected, messages.list and getProfile are called in parallel with Promise.all for efficiency.
- **Parts without filename skipped:** Inline text/HTML parts often have no filename. Only parts with both filename AND attachmentId are treated as downloadable file attachments.
- **Default mimeType fallback:** Parts with missing mimeType default to application/octet-stream (defensive, prevents undefined propagation).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Gmail readonly access and docs@ mailbox delegation are needed when live testing begins (Plan 04 intake monitor).

## Next Phase Readiness
- pollForNewMessages + getMessageDetails + extractAttachments + downloadAttachment cover the full Gmail reading pipeline
- Plan 04 (intake worker/monitor) can now schedule polling and process incoming messages
- getInitialHistoryId provides first-run seeding for the historyId state
- All functions tested with mocked Gmail client, ready for integration

## Self-Check: PASSED

- [x] src/intake/gmail-reader.ts exists
- [x] src/intake/attachment-extractor.ts exists
- [x] src/intake/__tests__/gmail-reader.test.ts exists
- [x] src/intake/__tests__/attachment-extractor.test.ts exists
- [x] Commit b3d5525 (Task 1) found
- [x] Commit c43ecb5 (Task 2) found
- [x] 223/223 tests passing (25 new + 198 existing)
- [x] No new TypeScript errors

---
*Phase: 06-document-intake*
*Completed: 2026-02-14*
