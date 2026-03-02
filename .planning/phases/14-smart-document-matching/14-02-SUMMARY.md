---
phase: 14-smart-document-matching
plan: 02
subsystem: matching
tags: [gemini, agentic-loop, crm-search, function-calling, signal-collection, co-borrower, phone-fallback]

# Dependency graph
requires:
  - phase: 14-smart-document-matching/01
    provides: "Types (MatchSignal, MatchDecision), config, thread-store, decision-log"
provides:
  - "matchDocument() — main entry point for document-to-contact matching"
  - "Signal collectors: collectThreadSignal, collectSenderSignal, collectEmailMetadataSignals"
  - "Agent tools: MATCHING_TOOLS declarations, executeToolCall dispatcher"
  - "findContactByPhone — CRM phone number search (FOLD-02)"
  - "lookup_co_borrowers — Finmo borrower list for co-borrower routing (FOLD-03)"
affects: [14-smart-document-matching/03, classification-worker, intake-worker]

# Tech tracking
tech-stack:
  added: ["@google/generative-ai (function calling)"]
  patterns: ["Agentic Gemini loop with CRM tool calls", "Pre-collected deterministic signals + agent reasoning", "Conflict detection on Tier 1 signal disagreement"]

key-files:
  created:
    - src/matching/signal-collectors.ts
    - src/matching/agent-tools.ts
    - src/matching/agent.ts
    - src/matching/__tests__/signal-collectors.test.ts
    - src/matching/__tests__/agent.test.ts
  modified:
    - src/matching/index.ts
    - src/crm/contacts.ts
    - src/crm/index.ts

key-decisions:
  - "Gemini tools use simplified schema (cast to any) rather than importing SchemaType enum — runtime-compatible and avoids brittle coupling to SDK version"
  - "Conflict detection checks Tier 1 signals only — weaker signals do not trigger escalation"
  - "Max iterations returns needs_review (not auto_created) to ensure Cat reviews unresolved docs"
  - "Phone normalization uses last-10-digit comparison to handle +1 prefix and formatting variants"
  - "Co-borrower lookup traverses contact -> opportunities -> Finmo app -> borrowers chain"

patterns-established:
  - "Signal collector pattern: deterministic pre-collection before agentic loop"
  - "Tool dispatch pattern: switch-case with try/catch returning JSON error strings"
  - "Agentic loop pattern: multi-turn Content[] history with function call/response pairs"

requirements-completed: [MATCH-01, MATCH-02, MATCH-05, FOLD-02, FOLD-03]

# Metrics
duration: 8min
completed: 2026-03-02
---

# Phase 14 Plan 02: Matching Agent Summary

**Agentic Gemini matching loop with 6 CRM/Finmo tools, 4-tier signal collection, conflict detection, phone fallback, and co-borrower routing**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-02T19:59:23Z
- **Completed:** 2026-03-02T20:07:31Z
- **Tasks:** 2
- **Files modified:** 8
- **Tests added:** 30 (19 signal/tools + 11 agent)
- **Total tests:** 806 passing (51 files)

## Accomplishments
- Signal collectors pre-collect Tier 1 (thread, sender) and Tier 3 (CC, subject) signals before agent loop
- Matching agent uses Gemini function calling with 6 tools (email/name/phone search, contact details, opportunities, co-borrower lookup)
- Conflict detection escalates when sender signal and agent decision point to different contacts
- findContactByPhone added to CRM module with last-10-digit normalization (FOLD-02)
- Co-borrower routing traverses contact -> opportunity -> Finmo app -> borrower list to find primary borrower (FOLD-03)
- Disabled mode falls back to legacy resolveContactId for zero-risk rollback

## Task Commits

Each task was committed atomically:

1. **Task 1: Signal collectors and agent tool definitions** - `eaa6ed1` (feat)
2. **Task 2: Gemini matching agent with agentic loop** - `9eb9696` (feat)

## Files Created/Modified
- `src/matching/signal-collectors.ts` - Thread, sender, and email metadata signal collectors
- `src/matching/agent-tools.ts` - 6 Gemini function-calling tool definitions + executeToolCall dispatcher
- `src/matching/agent.ts` - Main matchDocument() with agentic Gemini loop, conflict detection, and disabled fallback
- `src/matching/__tests__/signal-collectors.test.ts` - 19 tests for signal collectors and agent tools
- `src/matching/__tests__/agent.test.ts` - 11 tests for matching agent scenarios
- `src/matching/index.ts` - Updated barrel export with new modules
- `src/crm/contacts.ts` - Added findContactByPhone with last-10-digit normalization
- `src/crm/index.ts` - Exported findContactByPhone

## Decisions Made
- Gemini tools use simplified schema (cast to `any`) rather than importing `SchemaType` enum — runtime-compatible and avoids brittle coupling to SDK version changes
- Conflict detection checks Tier 1 signals only — weaker CC/subject signals do not trigger escalation to Cat
- Max iterations returns `needs_review` (not `auto_created`) so Cat always reviews unresolved docs
- Phone normalization uses last-10-digit comparison to handle +1 prefix and formatting variants (e.g., "(416) 555-1234" vs "14165551234")
- Co-borrower lookup traverses the chain: contact -> active opportunities -> Finmo application ID custom field -> Finmo API borrowers list

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Max iterations outcome was auto_created instead of needs_review**
- **Found during:** Task 2 (agent tests)
- **Issue:** When the agent exhausted iterations, the outcome logic fell through to `auto_created` because `chosenContactId` was null
- **Fix:** Added `exhaustedIterations` flag to distinguish "agent decided no match" from "agent ran out of iterations"
- **Files modified:** src/matching/agent.ts
- **Verification:** Max iterations test now passes with `needs_review` outcome
- **Committed in:** `9eb9696` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix ensures Cat reviews docs when the agent is uncertain, rather than auto-creating a new contact. No scope creep.

## Issues Encountered
- TypeScript strict types for Gemini `@google/generative-ai` SDK required casting tool declarations and using proper `Content`/`Part` types — resolved with targeted type imports and `any` cast for tools array

## User Setup Required
None - no external service configuration required. Uses existing GEMINI_API_KEY env var.

## Next Phase Readiness
- matchDocument() is ready for integration into the classification worker (Plan 14-03)
- All 6 tools tested and working with mock CRM/Finmo
- MATCHING_ENABLED=false provides safe rollback to legacy behavior

## Self-Check: PASSED

- All 8 files verified present on disk
- Commit eaa6ed1 (Task 1) verified in git log
- Commit 9eb9696 (Task 2) verified in git log
- 806 tests passing, 0 TypeScript errors

---
*Phase: 14-smart-document-matching*
*Completed: 2026-03-02*
