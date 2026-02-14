---
phase: 05-email-drafting
plan: 02
subsystem: email
tags: [gmail-api, googleapis, service-account, domain-wide-delegation, jwt, draft, send, barrel-export]

# Dependency graph
requires:
  - phase: 05-email-drafting
    plan: 01
    provides: "generateEmailBody, encodeMimeMessage, emailConfig, email types"
  - phase: 03-checklist-generation
    provides: "GeneratedChecklist type for draft input"
provides:
  - "createEmailDraft: orchestrator that ties checklist -> body -> MIME -> Gmail draft"
  - "sendEmailDraft: sends a previously created draft by ID"
  - "GmailAuthError: typed auth error for INFRA-05 alerting"
  - "Email barrel export (src/email/index.ts) for single-import downstream consumption"
affects: [01-webhook-handler, infra-05-alerting]

# Tech tracking
tech-stack:
  added: [googleapis, google-auth-library]
  patterns:
    - "Service account JWT auth with domain-wide delegation for Gmail API"
    - "Lazy singleton Gmail client (same pattern as CRM client)"
    - "GmailAuthError class for typed auth error detection (401/403/delegation denied)"
    - "Barrel export pattern matching crm/index.ts (internal modules not re-exported)"

key-files:
  created:
    - src/email/gmail-client.ts
    - src/email/draft.ts
    - src/email/send.ts
    - src/email/index.ts
    - src/email/__tests__/draft.test.ts
  modified:
    - package.json
    - package-lock.json
    - .env.example

key-decisions:
  - "Lazy singleton for Gmail client (cached after first initialization, same pattern as CRM)"
  - "GmailAuthError with code property for typed error detection in INFRA-05 alerting"
  - "Auth error detection checks status codes (401/403) and message patterns (Delegation denied)"
  - "Internal Gmail client functions not exported from barrel (implementation detail)"
  - "Dev mode safety verified in tests (recipient override, subject prefix)"

patterns-established:
  - "wrapAuthError helper: checks status codes and message patterns before re-throwing"
  - "loadServiceAccountKey: base64 decode env var -> JSON parse -> validate required fields"
  - "Draft orchestrator as composition function: pure functions + API call in sequence"

# Metrics
duration: 3min
completed: 2026-02-14
---

# Phase 5 Plan 2: Gmail API Integration + Barrel Export Summary

**Gmail API draft creation via service account delegation with typed auth errors and barrel export for Phase 1 webhook handler**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T01:17:54Z
- **Completed:** 2026-02-14T01:21:13Z
- **Tasks:** 2
- **Files created:** 5
- **Files modified:** 3

## Accomplishments
- Gmail client authenticates via service account JWT with domain-wide delegation to impersonate admin@venturemortgages.com
- Draft orchestrator ties together body generation, MIME encoding, and Gmail API into single createEmailDraft entry point
- GmailAuthError class enables downstream INFRA-05 alerting for delegation/credential failures
- Email barrel export provides clean single-import surface for Phase 1 webhook handler
- 10 new tests with mocked Gmail API (124 total, zero regressions)
- Dev mode safety verified in tests (recipient override to dev@, [TEST] subject prefix)

## Task Commits

Each task was committed atomically:

1. **Task 1: Gmail client, draft orchestrator, send module** - `476f3e1` (feat)
2. **Task 2: Barrel export and draft orchestrator tests** - `d268186` (feat)

## Files Created/Modified
- `src/email/gmail-client.ts` - Authenticated Gmail client via service account + domain-wide delegation, GmailAuthError class
- `src/email/draft.ts` - createEmailDraft orchestrator: checklist -> body -> MIME -> Gmail draft
- `src/email/send.ts` - sendEmailDraft: sends a previously created draft by ID
- `src/email/index.ts` - Email module barrel export (types, config, pure functions, API operations)
- `src/email/__tests__/draft.test.ts` - 10 tests: draft creation, send, dev mode safety, MIME content verification
- `package.json` - Added googleapis + google-auth-library dependencies
- `.env.example` - Added GOOGLE_SERVICE_ACCOUNT_KEY entry with generation instructions

## Decisions Made
- Lazy singleton pattern for Gmail client (cached after first init), matching the CRM client pattern
- GmailAuthError extends Error with a `code` property for typed detection in INFRA-05 alerting
- Auth error detection checks both HTTP status codes (401, 403) and message patterns ("Delegation denied", "Not Authorized")
- Internal Gmail client functions (getGmailClient, createGmailDraft, sendGmailDraft) not exported from barrel -- same encapsulation pattern as crm/client.ts
- loadServiceAccountKey validates both client_email and private_key fields after base64 decode

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

Gmail API requires service account configuration before runtime operations will work:

1. **Google Cloud Console:** Create GCP project (if not existing), enable Gmail API
2. **Service Account:** Create service account with domain-wide delegation enabled
3. **Workspace Admin:** Authorize service account Client ID for `https://www.googleapis.com/auth/gmail.compose` scope in Google Workspace Admin Console
4. **Environment Variable:** Base64-encode the service account JSON key file and set `GOOGLE_SERVICE_ACCOUNT_KEY` env var

See `.env.example` for generation instructions.

## Next Phase Readiness
- Phase 5 (Email Drafting) is fully complete: body generation, MIME encoding, Gmail API integration, and barrel export
- `createEmailDraft` is the main entry point for the Phase 1 webhook handler (called after CRM sync)
- `sendEmailDraft` provides the draft-to-sent pathway (called after Cat approves the draft)
- `GmailAuthError` enables INFRA-05 alerting for auth/delegation failures
- Import surface: `import { createEmailDraft, sendEmailDraft, GmailAuthError } from './email/index.js'`
- Gmail API requires service account setup before live testing (see User Setup Required above)

## Self-Check: PASSED
