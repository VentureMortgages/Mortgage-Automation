---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Production Hardening
status: in-progress
last_updated: "2026-03-03T00:48:00.000Z"
progress:
  total_phases: 13
  completed_phases: 13
  total_plans: 45
  completed_plans: 45
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** When a Finmo application comes in, the right documents get requested, tracked, filed, and followed up on -- with minimal human effort and zero missed items.
**Current focus:** Milestone v1.1 -- Production Hardening (Phase 16: Automated Reminders)

## Current Position

Phase: 16 (Automated Reminders) -- COMPLETE
Plan: 2/2
Status: Phase 16 complete (all REMIND requirements fulfilled)
Last activity: 2026-03-03 -- Executed 16-02-PLAN.md (2 tasks, 20 new tests, 895 total)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 31
- Average duration: 4 min
- Total execution time: 2.15 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03-checklist-generation | 4/4 | 21 min | 5 min |
| 04-crm-integration | 4/4 | 14 min | 4 min |
| 05-email-drafting | 2/2 | 7 min | 4 min |
| 01-webhook-foundation | 3/3 | 12 min | 4 min |
| 06-document-intake | 4/4 | 17 min | 4 min |
| 07-classification-filing | 5/5 | 20 min | 4 min |
| 08-tracking-integration | 2/2 | 10 min | 5 min |
| 10-opportunity-centric-architecture | 5/5 | 19 min | 4 min |
| 11-drive-folder-linking-deal-subfolders | 3/3 | 8 min | 3 min |
| 12-crm-pipeline-automation | 3/3 | 7 min | 2 min |
| 13-original-document-preservation | 2/2 | 7 min | 4 min |

*Updated after each plan completion*
| Phase 13 P02 | 4min | 2 tasks | 2 files |
| Phase 14 P01 | 7min | 2 tasks | 14 files |
| Phase 14 P02 | 8min | 2 tasks | 8 files |
| Phase 14 P03 | 10min | 3 tasks | 9 files |
| Phase 15 P01 | 4min | 2 tasks | 5 files |
| Phase 15 P02 | 2min | 2 tasks | 2 files |
| Phase 16 P01 | 6min | 2 tasks | 9 files |
| Phase 16 P02 | 5min | 2 tasks | 9 files |

## Accumulated Context

### Decisions

Recent decisions affecting current work:
- Reminders: CRM task + email to Cat (not auto-send to client) -- Cat copy/pastes from task
- Multi-borrower folders: "Last/Last, First/First" format matching Cat's Drive convention
- extractDriveFolderId normalizes both raw IDs and full Drive URLs to folder IDs
- All CRM persistence operations wrapped in non-fatal try/catch (failures must not block pipeline)
- Task dedup uses title pattern matching ("Review doc request") on contact tasks
- createOrUpdateReviewTask is public API; createReviewTask remains for internal use
- Professional contact type stored as GHL tag (additive merge), not custom field -- simplest for filtering
- assignContactType is non-fatal: catches all errors internally, Cat can tag manually
- Sent-detector stage move uses searchOpportunities (first result) not findOpportunityByFinmoId (lacks finmoApplicationId context)
- Review task auto-complete happens inline in sent-detector flow (step 3b), colocated with stage move
- Sequential subfolder creation (not parallel) to avoid Drive API rate limits at low volume
- preCreateSubfolders is non-fatal at both individual folder and overall function level
- storeOriginal uses write-once pattern: never checks for existing files, never reads back (ORIG-03)
- storeOriginal wrapped in belt-and-suspenders try/catch in classification worker (ORIG-01)
- Low-confidence docs get both Needs Review/ copy AND Originals/ copy for full audit trail (ORIG-02)
- CRM task for low-confidence docs includes direct Drive link for Cat to click
- Original filename preserved in Needs Review/ (not classified name)
- createGmailDraft returns { draftId, threadId } to expose Gmail API's threadId for matching
- Thread mapping stored as JSON { contactId, opportunityId? } in Redis with 30-day TTL
- Decision log uses 90-day TTL per MATCH-06 requirement
- All new ClassificationJobData fields are optional to avoid breaking Finmo source
- Gemini tools use simplified schema (cast to any) — runtime-compatible, avoids brittle SDK coupling
- Conflict detection checks Tier 1 signals only — weak CC/subject signals do not escalate
- Max iterations returns needs_review (not auto_created) so Cat reviews unresolved docs
- Phone normalization uses last-10-digit comparison for +1 prefix and formatting variants
- Co-borrower lookup traverses contact -> opportunities -> Finmo app -> borrowers chain
- CRM note (createCrmNote) for auto_filed, CRM task (createReviewTask) for needs_review/conflict/auto_created
- Global Needs Review/ at Drive root for matching-uncertain docs, per-client Needs Review/ for classification-uncertain docs
- autoCreateFromDoc returns null on failure, caller routes to global Needs Review as last resort
- Error outcome falls back to legacy resolveContactId for zero-risk graceful degradation
- createFailureTask is non-fatal (catches all errors, returns undefined) matching existing CRM task patterns
- Deal subfolder catch-up guarded on DRIVE_ROOT_FOLDER_ID to prevent undefined parent folder
- Subfolder catch-up uses actualDealSubfolderId to thread created folder ID through existing link code
- No Finmo sync-trigger API exists -- retry mechanism (15-01) is correct fallback for MBP timing gap
- Finmo API surface is data-access only (applications, documents) with no integration management
- Weekend start dates advance clock to next Monday for business day counting (Sat->Mon = 0 elapsed)
- searchOpportunitiesByStage: separate module for stage-based GHL search without contactId
- Follow-up text: plain text format (not HTML) for easy copy/paste from CRM task body
- reminderConfig reads REMINDER_ENABLED + REMINDER_INTERVAL_DAYS from env (kill switch + interval control)
- Reminder task dedup: search by title pattern "Follow up: Need docs", update body on match (not duplicate)
- Cat notification uses draft+send pattern matching existing Gmail flows
- BullMQ repeatable job cron: 0 9 * * 1-5 (9 AM UTC, Mon-Fri)
- Auto-close hook in both opportunity and contact fallback paths of tracking-sync

### Pending Todos

None yet.

### Blockers/Concerns

- SPF/DKIM/DMARC not configured on venturemortgages.com -- emails may go to spam (Taylor action item)
- Google Sheets API scope missing from domain-wide delegation -- budget sheet broken

## Session Continuity

Last session: 2026-03-03
Stopped at: Completed 16-02-PLAN.md (reminder system wiring -- phase 16 complete)
Resume file: .planning/phases/16-automated-reminders/16-02-SUMMARY.md
Next: Phase 16 complete. Await next milestone planning or production deployment.

---
*State initialized: 2026-02-09*
*Last updated: 2026-03-03 (Phase 16 complete: automated reminders with 59 tests, 895 total)*
