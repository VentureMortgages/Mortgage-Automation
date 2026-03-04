# Venture Mortgages — Doc Collection Automation

## What This Is

An automation platform for Venture Mortgages (Taylor Atkinson's brokerage) that handles the end-to-end document collection workflow. When a client submits a Finmo mortgage application, the system generates a personalized document request, tracks incoming documents, files them to Google Drive, and follows up on missing items — replacing hours of manual work by assistant Cat.

The system is **live in production** as of 2026-02-25 — drafts in admin@'s Gmail, real borrower recipients, BCC to docs@, opportunity-level tracking in MBP.

## Core Value

When a Finmo application comes in, the right documents get requested, tracked, filed, and followed up on — with minimal human effort and zero missed items.

## Current Milestone: v1.2 Production Go-Live

**Goal:** Deploy, configure, battle-test, and verify the full pipeline end-to-end so Cat can start forwarding docs to docs@ tomorrow morning.

**Target features:**
- Deploy latest code to Railway + verify environment configuration
- Battle-test intake pipeline with real Gmail messages (classify → match → file → CRM)
- Verify every scenario: known client, unknown, co-borrower, ambiguous, multi-doc, T1 naming
- Data prep: backfill Drive folder links, clean up test data in MBP
- Verify reminder system fires correctly
- Cat handoff: SOP + testing instructions

## Requirements

### Validated

- ✓ Auto-generate personalized doc checklist from Finmo application data — v1.0
- ✓ Create draft task in MyBrokerPro for Cat to review and send — v1.0
- ✓ Send doc request email from admin@venturemortgages.com — v1.0
- ✓ Monitor email (docs@) for incoming client documents — v1.0
- ✓ Monitor Finmo uploads for incoming client documents — v1.0
- ✓ Classify received documents by type (income, property, ID, etc.) — v1.0
- ✓ Rename documents to consistent naming convention — v1.0
- ✓ File documents to correct client folder in Google Drive — v1.0
- ✓ Track checklist status (received/missing) per deal in CRM — v1.0
- ✓ Opportunity-level doc tracking with cross-deal reuse — v1.0
- ✓ Drive folder IDs stored on CRM, deal-specific subfolders — v1.0
- ✓ Feedback loop: Cat's email edits auto-applied to future similar apps — v1.0
- ✓ CRM pipeline stage automation (auto-move, auto-complete tasks) — v1.1
- ✓ Deduplicate review tasks across Leads/Live Deals pipelines — v1.1
- ✓ Robust client folder matching (email, phone, CRM contact ID) — v1.1
- ✓ Multi-borrower folder naming and matching — v1.1
- ✓ Handle docs uploaded before MBP opportunity sync — v1.1
- ✓ Original document preservation (Originals/ subfolder) — v1.1
- ✓ Automated reminders via CRM tasks + Cat email notifications — v1.1
- ✓ Realtor contact type assignment from Finmo app — v1.1
- ✓ Doc subfolder pre-creation timing — v1.1

### Active

- [ ] Deploy latest code + verify Railway environment configuration
- [ ] Battle-test doc intake pipeline with real messages end-to-end
- [ ] Verify all scenario paths (known client, unknown, co-borrower, ambiguous, multi-doc)
- [ ] Data prep: backfill Drive folder links, clean up test contacts/opps
- [ ] Verify reminder system fires in production
- [ ] Cat handoff: SOP + testing instructions

### Out of Scope

- WhatsApp/text doc intake — clients use email and Finmo only for now
- Lender submission automation — downstream of doc collection, future phase
- Budget call scheduling — Taylor handles manually
- Ownwell integration — post-funding only, separate concern
- Building flows in GHL's visual builder — all automation is custom code via API
- Auto-sending emails without Cat review — human-in-the-loop is non-negotiable

## Context

**Client team:**
- Taylor Atkinson — mortgage broker, handles client calls and underwriting decisions
- Cat — assistant, handles doc collection, filing, chasing, and fulfillment
- Cat is thorough and responsive; Taylor delegates doc ops to her entirely
- Cat reviewed all 11 draft emails and approved (only fix was bonus letter merge)

**Production state (as of 2026-02-25):**
- Railway hosting: `doc-automation-production.up.railway.app`
- `APP_ENV=production`, `EMAIL_SENDER=admin@venturemortgages.com`
- Finmo webhook registered and firing on Venture Mortgages team apps
- 705+ tests passing across 46 test files
- Gmail polling docs@ every 120 seconds for intake
- Redis on Railway for BullMQ queues + feedback store

**Known issues being addressed in v1.1:**
- Finmo creates 2 MBP opportunities (Leads + Live Deals) — duplicate review tasks
- MBP opportunity creation lags Finmo webhook by 4-15+ min — race condition for CRM sync
- Client folder matching by name alone is fragile (marriages, coincidences)
- Multi-borrower folders use "LastName/LastName, FirstName/FirstName" format
- Low-confidence docs deleted from temp (Cat gets CRM task but file is gone)
- No pipeline stage automation (manual moves)

**CRM:**
- MyBrokerPro (white-labeled GoHighLevel) — fully operational
- API V2, custom fields on contacts + opportunities
- Finmo-managed fields: Deal ID, Application ID, Deal Link (never overwrite)

**Mortgage platform:**
- Finmo (finmo.ca) — application intake, webhook on submit
- Resthook fires on FULL submit only (not page 1 signup)
- `finmoDealId` in payload used for deal subfolder naming

## Constraints

- **Security**: Mortgage docs contain sensitive PII — no PII in logs, least-privilege access, audit trail
- **Human-in-the-loop**: Cat reviews all client-facing communications before they go out (draft-first)
- **Hosting**: Railway VPS, ~$5-10/mo
- **Tech stack**: Node.js/TypeScript, custom code via APIs
- **Email sender**: admin@venturemortgages.com for all automated communications
- **Compliance**: Canadian mortgage industry — documents must be handled securely
- **Budget**: Consulting engagement ~1hr/week, prioritize ROI
- **Reliability**: Must handle failures gracefully — retries, idempotency, manual review fallback
- **SPF/DKIM/DMARC**: NOT configured on venturemortgages.com — Taylor action item

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Custom code over n8n/Make | Client wants programmatic control, not visual builders | ✓ Good |
| GoHighLevel API over native workflows | Automation logic lives in our code, CRM is for task/contact management | ✓ Good |
| Draft-to-CRM over auto-send | Human-in-the-loop default, Cat reviews before sending | ✓ Good |
| Simple VPS over serverless | Multiple integrations benefit from persistent process, easier to debug | ✓ Good |
| Node.js/TypeScript | GHL API, Gmail API, Drive API all have good Node SDKs; mortgage.ai Python code not needed | ✓ Good |
| Opportunity-level tracking | Multi-deal clients need per-deal checklists; contact-level was too flat | ✓ Good |
| CRM-stored Drive folder IDs | Eliminated fragile name-based folder matching for known contacts | ✓ Good |
| Feedback loop via BCC detection | Gmail strips tracking metadata; subject→contactId Redis mapping works | ✓ Good |
| Reminders: CRM task + email to Cat | Simpler than auto-send reminders; Cat copy/pastes from task; refreshed every 3 days | — Pending |
| Multi-borrower folders: "Last/Last, First/First" | Matches Cat's existing Drive convention | — Pending |

---
*Last updated: 2026-03-04 after milestone v1.2 initialization*
