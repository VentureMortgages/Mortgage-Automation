---
phase: 13-original-document-preservation
verified: 2026-03-02T10:45:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
notes:
  - "REQUIREMENTS.md traceability table lists ORIG-01/02/03 under 'Phase 15' header — stale label, does not match ROADMAP.md or implementation. Checkboxes are correctly marked [x]. Minor documentation drift, no action needed."
---

# Phase 13: Original Document Preservation — Verification Report

**Phase Goal:** Cat can always find the original file a client submitted, even if AI classification was wrong or the file was renamed -- safety net before smart matching
**Verified:** 2026-03-02T10:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Every document received appears in `ClientFolder/Originals/` with its original filename before classification | VERIFIED | `storeOriginal` called in `classification-worker.ts` line 285, before `resolveTargetFolder`. Uses `clientFolderId` (not deal subfolder). Non-fatal try/catch. |
| 2 | Low-confidence documents are preserved in Needs Review/ (not deleted from temp storage until safely stored) | VERIFIED | Low-confidence handler (lines 95-177) creates `Needs Review/` folder via `findOrCreateFolder`, uploads with original filename, then cleans up temp. Non-fatal on upload failure. |
| 3 | Low-confidence CRM task includes filename AND direct Drive link | VERIFIED | Task body at line 145-147: `File: ${originalFilename}\nDrive link: https://drive.google.com/file/d/${needsReviewFileId}/view`. Falls back to no-link body if upload failed. |
| 4 | When a client re-uploads a document, both versions coexist in Originals/ (no overwrite) | VERIFIED | `storeOriginal` is write-once: never checks for existing files, timestamp prefix (`YYYY-MM-DD_filename.pdf`) ensures natural differentiation. Confirmed in `originals.ts` lines 100-102. |
| 5 | All standard subfolders pre-created when client folder is created in webhook | VERIFIED | `worker.ts` step 3a (lines 89-98): `preCreateSubfolders(getDriveClient(), clientFolderId)` called after `findOrCreateFolder` for client folder, inside non-fatal try/catch. |
| 6 | Subfolder pre-creation is idempotent (no duplicates on second run) | VERIFIED | Delegates to `findOrCreateFolder` (finds existing or creates new). Tested in `originals.test.ts`. |
| 7 | storeOriginal failure does not block classification pipeline | VERIFIED | Belt-and-suspenders try/catch at lines 283-288 in `classification-worker.ts`. `storeOriginal` itself also internally catches all errors and returns null. |
| 8 | Subfolder pre-creation failure does not block webhook pipeline | VERIFIED | `worker.ts` lines 90-98: entire call wrapped in try/catch, error logged, pipeline continues. |
| 9 | CRM notes for successfully classified docs do NOT mention Originals/ | VERIFIED | `storeOriginal` result is ignored in the success path — not referenced in any CRM update call. Confirmed by code inspection and CONTEXT.md decision. |

**Score:** 9/9 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/drive/originals.ts` | `storeOriginal`, `preCreateSubfolders`, `CLIENT_SUBFOLDERS` | VERIFIED | 113 lines. All three exports present. Exports confirmed in file. |
| `src/drive/__tests__/originals.test.ts` | Tests for both functions, min 80 lines | VERIFIED | 193 lines, 11 tests covering success/partial/full-failure for both functions and CLIENT_SUBFOLDERS count. |
| `src/drive/index.ts` | Barrel exports for new functions | VERIFIED | Line 26: `export { storeOriginal, preCreateSubfolders, CLIENT_SUBFOLDERS } from './originals.js'` |
| `src/webhook/worker.ts` | Calls `preCreateSubfolders` after client folder creation | VERIFIED | Import at line 36, call at step 3a (lines 89-98). |
| `src/classification/classification-worker.ts` | Calls `storeOriginal` before filing + Needs Review routing | VERIFIED | Import at line 34. `storeOriginal` called at line 285 before `resolveTargetFolder`. Low-confidence Needs Review handler at lines 95-177. |
| `src/classification/__tests__/classification-worker.test.ts` | Tests for originals + Needs Review routing, min 200 lines | VERIFIED | 859 lines, 36 tests total. ORIG-01 describe block (4 tests) at line 504, ORIG-02 describe block (4+ tests) at line 579. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/webhook/worker.ts` | `src/drive/originals.ts` | `preCreateSubfolders` import | WIRED | `import { preCreateSubfolders } from '../drive/originals.js'` at line 36; called at line 91 |
| `src/drive/originals.ts` | `src/classification/filer.ts` | `findOrCreateFolder` + `uploadFile` | WIRED | `import { findOrCreateFolder, uploadFile } from '../classification/filer.js'` at line 16; both used in function bodies |
| `src/classification/classification-worker.ts` | `src/drive/originals.ts` | `storeOriginal` import | WIRED | `import { storeOriginal } from '../drive/originals.js'` at line 34; called at lines 134 and 285 |
| `src/classification/classification-worker.ts` | `src/classification/filer.ts` | `findOrCreateFolder` + `uploadFile` for Needs Review | WIRED | `findOrCreateFolder` and `uploadFile` in existing import at line 33; used at lines 125-126 in low-confidence handler |

---

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| ORIG-01 | 13-02 | Every received document stored in `ClientFolder/Originals/` before classification | SATISFIED | `storeOriginal(drive, clientFolderId, pdfBuffer, originalFilename)` at `classification-worker.ts:285`, before any renaming or filing. Also called for low-confidence docs at line 134. |
| ORIG-02 | 13-02 | Low-confidence documents preserved in Originals (not deleted) | SATISFIED | Low-confidence path: file saved to `Needs Review/` (lines 125-126) AND `Originals/` (line 134) before temp cleanup at line 167. CRM task includes Drive link. |
| ORIG-03 | 13-01 | Re-upload creates new original alongside existing versions (no overwrite) | SATISFIED | `storeOriginal` is write-once — timestamp prefix `YYYY-MM-DD_filename.pdf` ensures each upload is distinct. No existence check, no deduplication. |

**Note on REQUIREMENTS.md label:** The section header reads "Original Preservation (Phase 15)" and the traceability table maps ORIG-01/02/03 to "Phase 15". This is a stale label — ROADMAP.md correctly identifies these as Phase 13 requirements, both PLAN frontmatter (`requirements: [ORIG-03]` and `requirements: [ORIG-01, ORIG-02]`) and implementation evidence confirm delivery in Phase 13. The [x] checkboxes in REQUIREMENTS.md are correctly marked complete. No implementation gap — documentation drift only.

---

## Anti-Patterns Found

No anti-patterns detected in modified files.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/drive/originals.ts` | 110 | `return null` | Info | Intentional error-path return in `storeOriginal` — documented behavior, not a stub |

---

## Human Verification Required

### 1. End-to-End: Originals/ folder appears in Drive on doc submission

**Test:** Submit a test email with a PDF attachment to the docs@ intake worker. Wait for classification. Browse the client's Google Drive folder.
**Expected:** `ClientFolder/Originals/2026-03-02_originalfilename.pdf` exists alongside the classified file in its subfolder.
**Why human:** Cannot verify Drive folder contents programmatically without live credentials.

### 2. Needs Review/ folder and CRM task on low-confidence doc

**Test:** Submit a document that will score below the 0.8 confidence threshold (e.g., an unrecognizable file or blank PDF).
**Expected:** File appears in `ClientFolder/Needs Review/` with original filename; CRM task created with title "Manual Review: [filename]" and body containing a clickable `https://drive.google.com/file/d/...` link.
**Why human:** Requires live Gemini classification + Drive + CRM interaction.

### 3. Subfolder pre-creation on new client webhook

**Test:** Submit a fresh Finmo application (new client). Check the created Drive client folder.
**Expected:** Seven subfolders exist: Income/, Property/, Down Payment/, ID/, Originals/, Needs Review/, Signed Docs/.
**Why human:** Requires live webhook trigger and Drive inspection.

### 4. Re-upload coexistence (ORIG-03)

**Test:** Submit the same document filename twice from the same client. Inspect `ClientFolder/Originals/`.
**Expected:** Two files exist with different date prefixes, neither overwrites the other.
**Why human:** Requires two live intake events and Drive folder inspection.

---

## Git Commit Verification

All four commits documented in SUMMARY files verified in git history:

| Commit | Description | Verified |
|--------|-------------|---------|
| `25be2f7` | feat(13-01): create originals module with storeOriginal and preCreateSubfolders | YES |
| `bef4c2e` | feat(13-01): wire preCreateSubfolders into webhook worker | YES |
| `a08b316` | feat(13-02): wire storeOriginal + Needs Review routing into classification worker | YES |
| `c222d70` | test(13-02): add tests for originals storage and Needs Review routing | YES |

---

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| `src/drive/__tests__/originals.test.ts` | 11/11 | PASSED |
| `src/webhook/__tests__/worker.test.ts` | 32/32 | PASSED |
| `src/classification/__tests__/classification-worker.test.ts` | 36/36 | PASSED |
| Full suite (`npx vitest run`) | 767/767 | PASSED |
| TypeScript (`npx tsc --noEmit`) | — | CLEAN |

---

## Summary

Phase 13 goal is fully achieved. The safety net is operational:

1. **Subfolder structure** — pre-created on every new client webhook (Income/, Property/, Down Payment/, ID/, Originals/, Needs Review/, Signed Docs/). Non-fatal, idempotent.

2. **Originals storage (ORIG-01)** — `storeOriginal` is called in `classification-worker.ts` before `resolveTargetFolder` for every successfully matched document. Timestamp-prefixed, client-folder-level, write-once, non-fatal. Belt-and-suspenders try/catch ensures it can never block filing.

3. **Needs Review routing (ORIG-02)** — Low-confidence documents are saved to `ClientFolder/Needs Review/` with their original filename and a direct Drive link in the CRM task for Cat. Also copied to Originals/ for audit trail. Temp file only deleted after safe storage.

4. **Re-upload coexistence (ORIG-03)** — `storeOriginal` is write-once with a date prefix. No deduplication, no overwrite. Each submission creates a distinct file.

Four items are flagged for human verification (live Drive/CRM inspection) — automated checks are exhaustive but cannot observe the actual Google Drive folder contents without live credentials.

---

_Verified: 2026-03-02T10:45:00Z_
_Verifier: Claude (gsd-verifier)_
