---
phase: 05-email-drafting
plan: 01
subsystem: email
tags: [mime, base64url, rfc2822, email-template, pure-function, tdd]

# Dependency graph
requires:
  - phase: 03-checklist-generation
    provides: "GeneratedChecklist, BorrowerChecklist, PropertyChecklist, ChecklistItem types"
provides:
  - "generateEmailBody: pure function transforming GeneratedChecklist into formatted email text"
  - "encodeMimeMessage: base64url RFC 2822 MIME encoder for Gmail API raw field"
  - "EmailContext, MimeMessageInput, EmailConfig, CreateEmailDraftInput/Result, SendResult types"
  - "emailConfig with dev mode safety (recipient override, subject prefix)"
affects: [05-02-gmail-draft, 01-webhook-handler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure function email body generator with section-based string concatenation"
    - "Named template constants (INTRO_PARAGRAPH, CLOSING_TEMPLATE) for easy editing"
    - "Base64url MIME encoding using Node.js Buffer (no external deps)"
    - "Dev mode email safety: recipientOverride + subjectPrefix in config"

key-files:
  created:
    - src/email/types.ts
    - src/email/config.ts
    - src/email/body.ts
    - src/email/mime.ts
    - src/email/__tests__/body.test.ts
    - src/email/__tests__/mime.test.ts
  modified: []

key-decisions:
  - "Section-based body generation (array of sections joined by blank lines) for clean separation"
  - "Named constants for intro and closing paragraphs (easy for Cat to edit wording)"
  - "Body uses \\n internally; MIME encoder converts to CRLF (separation of concerns)"
  - "Test greeting assertion checks greeting line only, not full body (avoids false positives from 'and' in prose)"

patterns-established:
  - "formatItemSection helper: header + items with optional indented notes"
  - "makeItem test factory: destructure required fields, spread rest for overrides"
  - "emailConfig mirrors crmConfig pattern (isDev, optionalEnv, dotenv/config)"

# Metrics
duration: 4min
completed: 2026-02-13
---

# Phase 5 Plan 1: Email Body Generator + MIME Encoder Summary

**Pure-function email body generator matching Cat's doc request template with base64url MIME encoder for Gmail API**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T17:11:50Z
- **Completed:** 2026-02-13T17:15:33Z
- **Tasks:** 1 (TDD: RED -> GREEN -> REFACTOR)
- **Files created:** 6

## Accomplishments
- Email body generator produces formatted text matching all 6 sections of Cat's EMAIL_TEMPLATE_REFERENCE: greeting, intro, per-borrower, per-property, shared "Other", closing
- MIME encoder produces valid base64url-encoded RFC 2822 content with CRLF headers suitable for Gmail API raw field
- Full TDD cycle: 21 failing tests written first, all pass after implementation
- Complete type definitions for email module (types, config, draft input/result, send result)
- Dev mode safety: automatic recipient override and subject prefix in development

## Task Commits

Each task was committed atomically (TDD RED -> GREEN -> REFACTOR):

1. **Task 1 RED: Failing tests** - `9de45a1` (test)
2. **Task 1 GREEN: Implementation** - `8c90c2a` (feat)
3. **Task 1 REFACTOR: TS strict fix** - `ffc43cb` (refactor)

## Files Created/Modified
- `src/email/types.ts` - EmailContext, MimeMessageInput, EmailConfig, CreateEmailDraftInput/Result, SendResult
- `src/email/config.ts` - emailConfig with dev mode safety (recipientOverride, subjectPrefix, docInbox)
- `src/email/body.ts` - generateEmailBody pure function: GeneratedChecklist + EmailContext -> formatted email string
- `src/email/mime.ts` - encodeMimeMessage: MimeMessageInput -> base64url-encoded RFC 2822 MIME string
- `src/email/__tests__/body.test.ts` - 11 tests: greeting, intro, per-borrower, per-property, shared, notes, closing, edge cases
- `src/email/__tests__/mime.test.ts` - 10 tests: base64url format, CRLF, headers, body, special chars, multi-line

## Decisions Made
- Section-based body generation using array of section strings joined by `\n\n` for clean blank-line separation between sections
- Named constants `INTRO_PARAGRAPH` and `CLOSING_TEMPLATE` at module scope so Cat can easily edit wording without changing logic
- Body text uses `\n` internally; MIME encoder handles `\n` -> `\r\n` conversion (clean separation of concerns)
- Test for single borrower greeting checks only the greeting line, not the full body, to avoid false positives from "and" appearing in prose

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed overly broad test assertion for single borrower greeting**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test `expect(body).not.toContain('and')` failed because "and" appears in the intro paragraph ("budget and it will also")
- **Fix:** Changed assertion to extract greeting line (`body.split('\n')[0]`) and check `greetingLine.not.toContain(' and ')`
- **Files modified:** src/email/__tests__/body.test.ts
- **Verification:** All 11 body tests pass
- **Committed in:** `8c90c2a` (GREEN commit)

**2. [Rule 1 - Bug] Fixed TypeScript strict mode TS2783 in test factory**
- **Found during:** Task 1 REFACTOR phase (tsc --noEmit)
- **Issue:** `makeItem` factory had `displayName` set explicitly AND in `...overrides` spread, triggering TS2783
- **Fix:** Destructured `displayName` from overrides before spreading rest to avoid duplicate property
- **Files modified:** src/email/__tests__/body.test.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** `ffc43cb` (REFACTOR commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both were test code quality fixes. No scope change.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required. These are pure functions with no API dependencies.

## Next Phase Readiness
- `generateEmailBody` and `encodeMimeMessage` are ready for Plan 02 (Gmail API draft creation)
- Types (`CreateEmailDraftInput`, `CreateEmailDraftResult`, `SendResult`) are exported for Plan 02 consumption
- `emailConfig` provides dev mode safety for Plan 02's Gmail API integration
- Plan 02 will need: `googleapis` + `google-auth-library` npm install, service account credentials

## Self-Check: PASSED

- All 7 files verified present on disk
- All 3 commits verified in git log (9de45a1, 8c90c2a, ffc43cb)

---
*Phase: 05-email-drafting*
*Completed: 2026-02-13*
