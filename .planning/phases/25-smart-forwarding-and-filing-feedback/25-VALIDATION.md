---
phase: 25
slug: smart-forwarding-and-filing-feedback
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest implied from package.json |
| **Quick run command** | `npx vitest run -x` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run -x`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 1 | FWD-01 | unit | `npx vitest run src/intake/__tests__/body-extractor.test.ts -x` | Partial | ⬜ pending |
| 25-01-02 | 01 | 1 | FWD-01 | unit | `npx vitest run src/intake/__tests__/body-extractor.test.ts -x` | ❌ W0 | ⬜ pending |
| 25-02-01 | 02 | 1 | FWD-02 | unit | `npx vitest run src/matching/__tests__/folder-search.test.ts -x` | ❌ W0 | ⬜ pending |
| 25-02-02 | 02 | 1 | FWD-02 | unit | `npx vitest run src/matching/__tests__/auto-create.test.ts -x` | Partial | ⬜ pending |
| 25-03-01 | 03 | 2 | FWD-03 | unit | `npx vitest run src/email/__tests__/filing-confirmation.test.ts -x` | ❌ W0 | ⬜ pending |
| 25-03-02 | 03 | 2 | FWD-03 | unit | `npx vitest run src/email/__tests__/filing-confirmation.test.ts -x` | ❌ W0 | ⬜ pending |
| 25-04-01 | 04 | 1 | FWD-04 | manual | One-time script run | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/intake/__tests__/body-extractor.test.ts` — add AI parser tests (FWD-01)
- [ ] `src/matching/__tests__/folder-search.test.ts` — new file for fuzzy folder matching (FWD-02)
- [ ] `src/email/__tests__/filing-confirmation.test.ts` — new file for confirmation email (FWD-03)

*Existing infrastructure covers framework and fixtures.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wong-Ranasinghe folder linked to CRM contacts | FWD-04 | One-time data fix, not repeatable | Run linking script, verify in GHL contact custom fields |
| E2E: Cat re-forwards Wong-Ranasinghe email | FWD-01+02+03 | Requires real Gmail + Drive + Gemini | Forward test email to docs@, verify filing + confirmation |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
