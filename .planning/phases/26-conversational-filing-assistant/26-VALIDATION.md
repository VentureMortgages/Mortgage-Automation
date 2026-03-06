---
phase: 26
slug: conversational-filing-assistant
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
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
| 26-01-01 | 01 | 1 | CONV-01 | unit | `npx vitest run src/matching/__tests__/folder-search.test.ts -x` | Modify | ⬜ pending |
| 26-01-02 | 01 | 1 | CONV-01 | unit | `npx vitest run src/email/__tests__/filing-confirmation.test.ts -x` | Modify | ⬜ pending |
| 26-02-01 | 02 | 1 | CONV-02, CONV-03 | unit | `npx vitest run src/intake/__tests__/reply-parser.test.ts -x` | ❌ W0 | ⬜ pending |
| 26-02-02 | 02 | 1 | CONV-02 | unit | `npx vitest run src/intake/__tests__/intake-worker.test.ts -x` | Modify | ⬜ pending |
| 26-03-01 | 03 | 2 | CONV-04 | unit | `npx vitest run src/classification/__tests__/filer.test.ts -x` | Modify | ⬜ pending |
| 26-03-02 | 03 | 2 | CONV-04 | unit | `npx vitest run src/email/__tests__/filing-confirmation.test.ts -x` | Modify | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/intake/__tests__/reply-parser.test.ts` — new file for reply parsing + choice selection (CONV-03)

*Existing infrastructure covers framework and fixtures.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| E2E: Cat replies to ambiguous confirmation | CONV-02+03+04 | Requires real Gmail + Drive + Gemini | Forward ambiguous doc, receive options email, reply naturally, verify filing + follow-up |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
