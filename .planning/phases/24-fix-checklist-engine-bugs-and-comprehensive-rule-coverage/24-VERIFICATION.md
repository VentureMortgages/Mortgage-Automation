---
phase: 24-fix-checklist-engine-bugs-and-comprehensive-rule-coverage
verified: 2026-03-04T21:30:00Z
status: passed
score: 10/10 must-haves verified
re_verification: null
gaps: []
human_verification: []
---

# Phase 24: Fix Checklist Engine Bugs and Comprehensive Rule Coverage — Verification Report

**Phase Goal:** Fix all 9 known bugs in the checklist engine and CRM contact handling, activate dormant auto-detectable rules, harden fragile detection patterns, and audit every Finmo UI field for complete rule coverage

**Verified:** 2026-03-04T21:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Per-property rules evaluate against the specific property, not all properties globally | VERIFIED | `generate-checklist.ts` lines 312-316: spreads `mainBorrowerCtx` with `currentProperty: property` per loop iteration; `variable-income.ts` `hasRentalIncome` branches on `ctx.currentProperty`; 3 passing tests in "BUG 1: Per-property rental rule evaluation" |
| 2 | Purchase applications with downPayment > 0 but empty assets array still request bank statements | VERIFIED | `down-payment.ts` lines 41-44: explicit `if (ctx.application.goal === 'purchase' && ctx.application.downPayment > 0) return true` before assets check; 3 passing tests in "BUG 2: DP bank statement with empty assets" |
| 3 | Gift detection checks asset.type first, falls back to description | VERIFIED | `down-payment.ts` lines 68-74: checks `a.type === 'gift'`, `a.type === 'gift_family'`, `a.type === 'gift_from_immediate_family_member'` before `a.description?.toLowerCase().includes('gift')`; 4 passing tests in "BUG 3: Gift detection uses asset.type" |
| 4 | Pension, CPP, and OAS income source values trigger retired income rules | VERIFIED | `income-other.ts` lines 23-28: `RETIRED_SOURCES = ['retired', 'pension', 'cpp', 'oas', 'canada_pension_plan', 'old_age_security']` used in `isRetired()`; 6 passing tests in "BUG 4: Pension/CPP/OAS income detection" |
| 5 | Child Support, Spousal Support, and CCB income types fire their respective rules when detected | VERIFIED | `variable-income.ts` lines 56-61: `SUPPORT_SOURCES = ['child_support', 'spousal_support']` in `isReceivingSupport()`; lines 222-228: `CCB_SOURCES = ['ccb', 'canada_child_benefit']` in `hasChildBenefit()`; 5 passing tests in "BUG 5: Activated support and CCB rules" |
| 6 | Owner Occupied / Rental property use type triggers rental docs | VERIFIED | `variable-income.ts` line 32: `RENTAL_USE_TYPES = ['owner_occupied_rental', 'rental_investment', 'rental']`; `property.ts` line 91: `RENTAL_USE_TYPES = ['rental', 'investment', 'rental_investment', 'owner_occupied_rental']`; 4 passing tests in "BUG 7: Owner-occupied/rental property use type" |
| 7 | Borrower contacts created from Finmo applications have Contact type set to Client | VERIFIED | `worker.ts` lines 101 and 126: both main borrower and co-borrower upserts include `tags: ['Client']`; `contacts.ts` lines 76: `...(input.tags ? { tags: input.tags } : {})` in upsert body; 2 passing tests in "BUG-08: borrower contact type tags" |
| 8 | Realtors and Lawyers from Finmo applications are upserted as MBP contacts with correct contact type | VERIFIED | `contacts.ts` lines 414-415: `trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()` capitalizes tag; `worker.ts` calls `assignContactType(agent.email, agent.fullName, agent.type, { phone, company })`; 4 passing tests in "BUG-09: professional contact sync" |
| 9 | BUG 6 (TFSA/FHSA) is documented as N/A with rationale | VERIFIED | `FIELD-AUDIT.md` Step 4 section documents TFSA/FHSA as "N/A — not in Finmo asset dropdown; s14_dp_bank_statement covers same docs"; Bug Resolution Summary row for BUG 6 present with explanation |
| 10 | Every Finmo UI field from Steps 1-6 is mapped to a checklist rule or documented as N/A | VERIFIED | `FIELD-AUDIT.md` Status: "AUDIT COMPLETE"; Coverage Summary table shows 76 total fields, 47 MAPPED, 29 N/A, 0 Gaps; Steps 1-6 all present in document with field-to-rule or N/A entries |

**Score:** 10/10 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/checklist/types/checklist.ts` | RuleContext with currentProperty field | VERIFIED | Line 118: `currentProperty?: FinmoProperty` added with comment "BUG 1 FIX" |
| `src/checklist/engine/generate-checklist.ts` | Per-property context injection with currentProperty | VERIFIED | Lines 312-316: `const propertyCtx: RuleContext = { ...mainBorrowerCtx, currentProperty: property }` with comment "BUG 1 FIX" |
| `src/checklist/rules/down-payment.ts` | Fixed hasDownPaymentAssets and hasGift helpers | VERIFIED | Lines 41-44: BUG 2 fix; lines 68-74: BUG 3 fix; contains `asset.type` check |
| `src/checklist/rules/income-other.ts` | isRetired detects pension, cpp, oas source values | VERIFIED | Line 23: `RETIRED_SOURCES` array containing 'pension', 'cpp', 'oas' |
| `src/checklist/rules/variable-income.ts` | Activated support and CCB rules | VERIFIED | Lines 56-61: `SUPPORT_SOURCES`; lines 222-228: `CCB_SOURCES`; `isReceivingSupport` and `hasChildBenefit` use real detection |
| `src/checklist/rules/property.ts` | isInvestment detects owner_occupied_rental use type | VERIFIED | Line 91: `RENTAL_USE_TYPES` explicitly includes `'owner_occupied_rental'` |
| `src/crm/contacts.ts` | assignContactType with capitalized tag, tags in UpsertContactInput | VERIFIED | Line 20: `tags?: string[]` on `UpsertContactInput`; lines 414-415: capitalization logic; lines 423-425: phone/company passthrough |
| `src/webhook/worker.ts` | Borrower upsert includes tags=['Client'], professional phone/company passthrough | VERIFIED | Line 101: `tags: ['Client']` main borrower; line 126: `tags: ['Client']` co-borrower |
| `src/crm/__tests__/contacts.test.ts` | Tests for contact type assignment | VERIFIED | Lines 444, 449: tests verify `tags: ['Client']` in upsert body |
| `.planning/phases/24-fix-checklist-engine-bugs-and-comprehensive-rule-coverage/FIELD-AUDIT.md` | Complete field-to-rule mapping audit with "AUDIT COMPLETE" status | VERIFIED | Line 4: "Status: AUDIT COMPLETE"; all 6 steps present; 76 fields audited |
| `src/checklist/__tests__/fixtures/pension-purchase.json` | Pension income purchase fixture | VERIFIED | File exists in fixtures directory |
| `src/checklist/__tests__/fixtures/rental-mixed-use.json` | Mixed use 2-property fixture | VERIFIED | File exists in fixtures directory |
| `src/checklist/__tests__/fixtures/support-income.json` | Child support income fixture | VERIFIED | File exists in fixtures directory |
| `src/checklist/__tests__/fixtures/empty-assets-dp.json` | Empty assets with DP > 0 fixture | VERIFIED | File exists in fixtures directory |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/checklist/engine/generate-checklist.ts` | `src/checklist/types/checklist.ts` | `RuleContext.currentProperty` | VERIFIED | Line 313: `currentProperty: property` — FinmoProperty set on each iteration. Type imports confirmed at top of file. |
| `src/checklist/rules/variable-income.ts` | `src/checklist/engine/generate-checklist.ts` | `hasRentalIncome uses ctx.currentProperty` | VERIFIED | Line 41: `if (ctx.currentProperty)` branch — per-property path confirmed |
| `src/webhook/worker.ts` | `src/crm/contacts.ts` | `upsertContact and assignContactType calls` | VERIFIED | Line 39 imports both; lines 97-104: `upsertContact` with `tags: ['Client']`; professional sync loop calls `assignContactType` with phone/company |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BUG-01 | 24-01-PLAN | Per-property rules evaluate against specific property | SATISFIED | `generate-checklist.ts` per-property context injection; 3 tests pass |
| BUG-02 | 24-01-PLAN | Purchase with DP > 0 + empty assets requests bank statements | SATISFIED | `down-payment.ts` `hasDownPaymentAssets` early return; 3 tests pass |
| BUG-03 | 24-01-PLAN | Gift detection uses asset.type first | SATISFIED | `down-payment.ts` `hasGift` type-first pattern; 4 tests pass |
| BUG-04 | 24-01-PLAN | Pension/CPP/OAS income sources trigger retired rules | SATISFIED | `income-other.ts` `RETIRED_SOURCES` array; 6 tests pass |
| BUG-05 | 24-01-PLAN | Dormant support and CCB rules activated | SATISFIED | `variable-income.ts` `SUPPORT_SOURCES`, `CCB_SOURCES`; 5 tests pass |
| BUG-06 | 24-03-PLAN | TFSA/FHSA gap documented as N/A | SATISFIED | `FIELD-AUDIT.md` Step 4 and Bug Resolution Summary |
| BUG-07 | 24-01-PLAN | Owner-occupied/rental use type triggers rental docs | SATISFIED | `property.ts` and `variable-income.ts` explicit `RENTAL_USE_TYPES` arrays; 4 tests pass |
| BUG-08 | 24-02-PLAN | Borrower contacts tagged as Client | SATISFIED | `worker.ts` both upserts include `tags: ['Client']`; 2 tests pass |
| BUG-09 | 24-02-PLAN | Professional contacts upserted with capitalized role tag + phone/company | SATISFIED | `contacts.ts` capitalization + phone/company logic; 4 tests pass |
| AUDIT-01 | 24-03-PLAN | All Finmo UI fields mapped to rules or documented N/A | SATISFIED | `FIELD-AUDIT.md` AUDIT COMPLETE, 76 fields, 0 Gaps |

**Requirements note:** BUG-01 through BUG-09 and AUDIT-01 are phase-internal IDs defined in ROADMAP.md for Phase 24. They do NOT appear in `.planning/REQUIREMENTS.md` (which tracks system-level requirements INFRA-xx, CHKL-xx, etc.). This is expected: these are bug-fix IDs, not new capability requirements. No orphaned requirement IDs found.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/checklist/rules/income-other.ts` | 36-37 | `isMaternity` always returns false (dormant) | INFO | Intentional — documented in-code as "requires Cat's manual activation" |
| `src/checklist/rules/income-other.ts` | 43-46 | `isProbation` always returns false (dormant) | INFO | Intentional — documented in-code as not reliably auto-detectable |
| `src/checklist/rules/variable-income.ts` | 69-71 | `hasOtherIncome` always returns false (dormant) | INFO | Intentional — documented in-code; disability/social assistance not auto-detectable |

No blockers. All "return false" patterns are intentional dormant rules left for Cat's manual activation, documented in FIELD-AUDIT.md with rationale. No placeholder, TODO, or FIXME patterns found in modified files.

---

## Human Verification Required

None. All phase 24 work is logic/rule fixes with deterministic test coverage. No visual, real-time, or external service behavior requires human verification beyond what the existing test suite covers.

---

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `src/checklist/__tests__/` (5 files) | 88 | ALL PASS |
| `src/crm/__tests__/contacts.test.ts` | ~30 (part of 83 total) | ALL PASS |
| `src/webhook/__tests__/worker.test.ts` | 83 | ALL PASS |
| Full suite (57 files) | 944 | ALL PASS |

Commits verified in git log:
- `ad4233a` — test: failing tests for checklist engine bugs 1-5, 7 (RED)
- `fa9d23d` — feat: fix all 6 bugs + unrecognized value warnings (GREEN)
- `3cf5a75` — test: failing tests for BUG-08 and BUG-09 (RED)
- `b8ac137` — feat: fix borrower contact type and professional sync (GREEN)
- `79f83ed` — docs: comprehensive Finmo UI field audit

---

## Summary

Phase 24 goal is fully achieved. All 9 known bugs are fixed in code:

- **BUG 1-5, 7** (checklist engine): Fixed in `generate-checklist.ts`, `types/checklist.ts`, `down-payment.ts`, `income-other.ts`, `variable-income.ts`, `property.ts`. Per-property context injection is architecturally sound (context spread + `currentProperty` field). Gift/inheritance/borrowed detection uses type-first pattern with description fallback for backward compatibility.

- **BUG 6** (TFSA/FHSA): Correctly documented as N/A — not fixable because Finmo's asset dropdown does not offer TFSA/FHSA options; existing `s14_dp_bank_statement` rule already covers the same documents.

- **BUG 8-9** (CRM contact type): Both main and co-borrower contacts now receive `tags: ['Client']` on upsert. Professional contacts receive capitalized role tags (Realtor, Lawyer) with phone and company data. `UpsertContactInput` supports optional `tags` field; `assignContactType` accepts optional `options` for phone/company without breaking existing callers.

- **AUDIT-01**: `FIELD-AUDIT.md` comprehensively maps all 76 Finmo UI fields (Steps 1-6) to rules or documents them as N/A with rationale. Zero undocumented gaps remain.

The TDD approach produced 25 new test cases for bug fixes on top of 63 pre-existing tests (88 total for checklist). No regressions anywhere in the 944-test suite.

---

_Verified: 2026-03-04T21:30:00Z_
_Verifier: Claude (gsd-verifier)_
