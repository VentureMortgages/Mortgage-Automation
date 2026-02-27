# Phase 13: Original Document Preservation - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Store every incoming document in its original form before any classification, renaming, or filing. Pre-create a consistent subfolder structure in each client folder. Route low-confidence docs to a review folder with CRM task for Cat. This is the safety net that makes Phase 14 (smart matching) safe to deploy.

</domain>

<decisions>
## Implementation Decisions

### Storage location & structure
- Originals/ folder lives at the **client folder level** (not per-deal)
- All subfolders are **pre-created on webhook** when the client folder is created — not lazily on first doc
- Pre-create folders matching Cat's doc categories: Income/, Property/, Down Payment/, ID/, Originals/, Needs Review/, and deal subfolder
- Exact subfolder list should be derived from DOC_CHECKLIST_RULES_V2 categories + Originals/ + Needs Review/
- Folder name is plain "Originals" (no underscore prefix) — visible and browsable

### Naming & dedup on re-uploads
- Original files saved with **timestamp prefix**: `2026-02-27_originalfilename.pdf`
- Preserves original filename for searchability, timestamp prevents collisions and shows chronological order
- **Keep all versions** — if client sends updated pay stub, both originals are stored (timestamps differentiate)
- **No duplicate detection** — even identical files are stored again. Drive storage is cheap, simplicity wins
- Originals are saved **after client matching** (not to a staging area). If matching fails, doc stays in temp processing like today

### Low-confidence doc handling
- Below **0.8 confidence threshold** → route to `ClientFolder/Needs Review/` (not Originals/)
- CRM task created for Cat: filename + direct Drive link to the file in Needs Review/
- No AI description or thumbnail in the CRM task — just filename and link
- **Cat files manually** after review — she drags it from Needs Review/ to the correct subfolder
- System does NOT auto-file after Cat's review (no CRM-triggered re-classification)
- Files in Needs Review/ **accumulate** — no automatic cleanup. Useful audit trail of what AI couldn't classify

### Visibility to Cat
- Originals/ is a **silent safety net** — no CRM notes mention it for successfully classified docs
- CRM note for auto-filed docs just says "T4 filed to Income/" — no mention of Originals/ copy
- **Completely invisible** unless Cat browses the client folder or something goes wrong
- System is **write-once** to Originals/ — never reads back, never cares if Cat moves or deletes files in there
- Will be documented in SOP but no ongoing notifications

### Claude's Discretion
- Exact implementation of subfolder pre-creation (Drive API batch vs sequential)
- How to handle the rare case where client folder already exists but subfolders don't (backfill logic)
- Error handling if Drive folder creation fails mid-way (partial subfolder set)

</decisions>

<specifics>
## Specific Ideas

- All folders the system might ever need should be pre-created upfront — Cat should see a clean, consistent structure from day one
- Needs Review/ is separate from Originals/ — it's a working folder for Cat, not an archive
- The 0.8 confidence threshold should match the Phase 14 smart matching threshold for consistency

</specifics>

<deferred>
## Deferred Ideas

- Subfolder pre-creation for deal-specific subfolders (Income/, Property/ within deal subfolder) — evaluate during Phase 14
- Auto-filing after Cat's CRM review of low-confidence docs — could be added later if Cat wants it
- Originals/ cleanup/retention policy — revisit if Drive storage becomes a concern

</deferred>

---

*Phase: 13-original-document-preservation*
*Context gathered: 2026-02-27*
