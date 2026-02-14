---
phase: 06-document-intake
plan: 01
subsystem: intake
tags: [gmail-api, typescript, gmail-readonly, document-intake, mime-types]

# Dependency graph
requires:
  - phase: 05-email-drafting
    provides: "Gmail client infrastructure (gmail-client.ts, config.ts, types.ts)"
provides:
  - "IntakeDocument, GmailMessageMeta, AttachmentInfo type contracts for Phase 6 plans 02-04"
  - "IntakeConfig with polling interval, max attachment size, docs inbox, enable toggle"
  - "SUPPORTED_MIME_TYPES map and getConversionStrategy for PDF conversion pipeline"
  - "getGmailReadonlyClient(impersonateAs) for inbox monitoring"
  - "IntakeJobData and IntakeResult BullMQ queue contracts"
affects: [06-document-intake, 07-classification-filing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Map-based client cache keyed by scope:impersonateAs for multi-client Gmail access"
    - "Generic createGmailClientForScope factory for compose vs readonly clients"
    - "ConversionStrategy type-safe MIME mapping (Map<string, ConversionStrategy>)"

key-files:
  created:
    - src/intake/types.ts
    - src/intake/config.ts
  modified:
    - src/email/gmail-client.ts

key-decisions:
  - "Map-based client cache replacing single-variable singleton for multi-scope/multi-user Gmail clients"
  - "loadServiceAccountKey extracted as shared helper for both compose and readonly client creation"
  - "OAuth2 mode warning (not error) when impersonateAs differs from token user — fails at API call time"
  - "ConversionStrategy as union type (not enum) for consistency with project's type patterns"

patterns-established:
  - "Multi-scope Gmail client pattern: getGmailClient() for compose, getGmailReadonlyClient() for reading"
  - "MIME type lookup map with getConversionStrategy fallback to 'unsupported'"

# Metrics
duration: 3min
completed: 2026-02-13
---

# Phase 6 Plan 01: Intake Foundation Summary

**Intake type contracts (IntakeDocument, AttachmentInfo, IntakeJobData) and Gmail readonly client with mailbox impersonation for docs@ inbox monitoring**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T05:48:35Z
- **Completed:** 2026-02-14T05:51:13Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- IntakeDocument type system established with all interfaces needed for Phase 6 plans 02-04 and Phase 7
- Gmail client refactored to support both compose (Phase 5) and readonly (Phase 6) scopes with per-user impersonation
- MIME type mapping covers all required document formats (PDF, JPEG, PNG, TIFF, WebP, DOCX, DOC)
- All 183 existing tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create intake types and configuration module** - `886bf07` (feat)
2. **Task 2: Refactor Gmail client to support readonly scope and mailbox impersonation** - `1babf4c` (feat)

## Files Created/Modified
- `src/intake/types.ts` - IntakeDocument, GmailMessageMeta, AttachmentInfo, ConversionStrategy, IntakeSource, IntakeJobData, IntakeResult
- `src/intake/config.ts` - IntakeConfig with polling interval, max attachment size, docs inbox, enabled toggle; SUPPORTED_MIME_TYPES map; getConversionStrategy
- `src/email/gmail-client.ts` - Refactored: extracted createGmailClientForScope, Map-based client cache, added getGmailReadonlyClient(impersonateAs)

## Decisions Made
- **Map-based client cache:** Replaced single `gmailClient` variable with `Map<string, GmailClient>` keyed by `scope:impersonateAs`. Supports multiple cached clients (compose for admin@, readonly for docs@) without collision.
- **loadServiceAccountKey extraction:** Service account key loading/validation extracted as a shared helper. Both compose and readonly JWT creation reuse it, eliminating code duplication.
- **OAuth2 warning, not error:** When getGmailReadonlyClient is called with an impersonateAs address that differs from the token's authorized user, a console.warn is logged rather than throwing. The actual failure happens at API call time, which is acceptable for dev testing.
- **ConversionStrategy as union type:** Used `type ConversionStrategy = 'pdf' | 'image-to-pdf' | 'word-to-pdf' | 'unsupported'` instead of enum, consistent with project's existing union type patterns (IntakeSource, etc).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Gmail readonly scope and docs@ mailbox delegation will be needed when live testing begins (Phase 6 plans 02-04).

## Next Phase Readiness
- Type contracts ready for Phase 6 Plan 02 (Gmail monitor / attachment extraction)
- getGmailReadonlyClient ready for inbox polling
- IntakeConfig provides all tunables for BullMQ job scheduler setup
- SUPPORTED_MIME_TYPES ready for PDF conversion pipeline

## Self-Check: PASSED

- [x] src/intake/types.ts exists
- [x] src/intake/config.ts exists
- [x] src/email/gmail-client.ts exists
- [x] Commit 886bf07 (Task 1) found
- [x] Commit 1babf4c (Task 2) found
- [x] 183/183 tests passing
- [x] No TypeScript errors in new/modified files

---
*Phase: 06-document-intake*
*Completed: 2026-02-13*
