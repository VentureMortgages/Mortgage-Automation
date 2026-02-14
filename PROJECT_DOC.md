# Taylor Atkinson Automation Project

**Client:** Taylor Atkinson (Mortgage Broker) + Cat (Assistant)
**Engagement:** ~1 hr/week, billed hourly
**Primary Focus:** Reduce Cat's workload through automation + AI
**Last Updated:** 2026-01-19

---

## A) Workflow Summary

### Current State (Manual)

```
1. LEAD INTAKE → APPLICATION
   Lead arrives → Taylor sends Finmo link → Client fills application → Finmo emails notification

2. PRELIMINARY DOCS → BUDGET CALL
   Cat requests docs → Client emails docs → Cat downloads & uploads to Drive → Cat tracks in Google Doc
   → Minimum docs received → Taylor underwrites + budget (Sheets) → Loom or call

3. HOUSE HUNTING (PAUSE)
   File pauses until property found (days to months)

4. PROPERTY FOUND → LENDER SUBMISSION
   Cat collects updated docs → Prepares file → Submit to lender

5. LIVE DEAL → FUNDING
   Lender sends conditions → Cat tracks in Live Deals doc → Cat chases docs → Conditions cleared → FUNDED
```

### Future State (Automated)

```
1. FINMO APP SUBMITTED (Trigger)
   └─► Pull application data via Finmo API
   └─► Create client record in MyBrokerPro (CRM)
   └─► Auto-create Google Drive folder + subfolders
   └─► Generate dynamic doc checklist based on app type (purchase/refi, employed/self-employed, etc.)

2. EMAIL WITH ATTACHMENT ARRIVES (Trigger)
   └─► Query CRM by sender email
   └─► IF MATCH:
       └─► Download attachment
       └─► Save raw copy to _Raw Uploads
       └─► AI classifies doc type + extracts metadata
       └─► Convert to PDF (if needed)
       └─► Rename per naming convention
       └─► Save to correct subfolder
       └─► Update CRM checklist (Requested → Received)
   └─► IF NO MATCH:
       └─► Move email to "Unmatched - Review" Gmail folder
       └─► Text Cat: "Doc from [email] couldn't match to client"
       └─► Cat manually matches + adds secondary email to CRM

3. CHECKLIST COMPLETE → NOTIFY
   └─► All required docs received → Notify Cat/Taylor file is ready for budget call
```

**See:** `FLOW_EMAIL_TO_DRIVE.md` for detailed technical flow diagrams.

---

## B) Systems Inventory

| System | Purpose | Role in Automation | Status |
|--------|---------|-------------------|--------|
| Gmail (Cat) | Doc collection, follow-ups | Monitor for attachments, unmatched queue | Active |
| Gmail (Taylor) | Lead intake, client comms | Future: AI triage | Active |
| Finmo | Application portal | **Source of app data** — API pulls client info, app type, employment | Active |
| Google Drive | Document storage | **File destination** — auto-create folders, store docs | Active |
| MyBrokerPro | CRM (GoHighLevel) | **Source of truth** — client list, email matching, checklist status, Drive folder links | In Setup |
| Google Docs | Doc tracking (current) | **Being replaced** by CRM checklist | Active (deprecated) |
| Google Sheets | Budget creation | No change | Active |
| Loom | Budget walkthroughs | No change | Active |
| Ownwell | Post-funding | No change | Active |

### Drive Structure (Auto-Created)
```
Mortgage Clients/
└── [Client Name]/
    ├── Borrower 1/
    ├── Borrower 2/ (if applicable)
    ├── Subject Property/
    ├── Non-Subject Property/
    ├── Down Payment/
    ├── Signed Docs/
    ├── Investments-HNW/
    └── _Raw Uploads/          ← NEW: stores original files before rename
```

### File Naming Conventions (AI applies these)
- **Income:** `Name - [item] [date] [$ amount]` → "John Smith - LOE Dec 7 $125k"
- **Property:** `Street Name - [item] [date]` → "123 Gordon Drive - Mortgage Statement 2024"
- **Down Payment:** `Bank - [acct type] [last4] [period] [balance]` → "CIBC - TFSA 90 days $89k"

---

## C) Time Sinks → Automation Mapping

| Cat's Pain Point | Automation Solution | Phase |
|-----------------|---------------------|-------|
| Tracking required docs | Dynamic checklist auto-generated from Finmo app data | 1-2 |
| Chasing missing docs | Auto-reminders from CRM when docs overdue | 2 |
| Re-familiarizing with stale files | Client status visible in CRM dashboard | 2 |
| Manual download/upload | Email-to-Drive automation | 2-3 |
| Validating doc requirements | AI doc classification | 3 |
| Organizing docs in Drive | Auto-filing to correct subfolder | 3 |
| Converting non-PDF | Auto-convert in pipeline | 2 |
| Renaming files | AI extracts metadata + applies naming convention | 3 |

---

## D) Automation Backlog

### Primary Initiative: Email-to-Drive Automation

**Goal:** When a client emails a document, automatically file it to the correct Drive folder and update the checklist — with human review queue for edge cases.

#### Phase 1: Foundation
| Task | Status | Blocked By |
|------|--------|------------|
| Get dev email created | PENDING | Taylor |
| Get Google Drive access | PENDING | Taylor/Cat |
| Get MyBrokerPro access | PENDING | Taylor |
| Get Finmo access | PENDING | Taylor |
| Get doc checklist rules from Cat/Taylor | PENDING | Cat/Taylor |
| Set up Gmail folder "Unmatched - Review" | NOT STARTED | Gmail access |
| Map Finmo fields → checklist logic | NOT STARTED | Finmo access + rules |

#### Phase 2: Client Matching + Basic Filing
| Task | Status | Blocked By |
|------|--------|------------|
| Email monitoring (detect attachments) | NOT STARTED | Phase 1 |
| CRM query for client matching by email | NOT STARTED | MyBrokerPro API |
| Drive folder auto-creation on Finmo submit | NOT STARTED | Finmo + Drive API |
| Basic filing (raw copy to client folder) | NOT STARTED | Phase 1 |
| Unmatched email flow + Cat notification | NOT STARTED | Phase 1 |

#### Phase 3: AI Classification + Renaming
| Task | Status | Blocked By |
|------|--------|------------|
| Doc type classification (AI) | NOT STARTED | Phase 2 |
| Metadata extraction for naming | NOT STARTED | Phase 2 |
| Auto-rename per naming convention | NOT STARTED | Phase 2 |
| Subfolder routing based on doc type | NOT STARTED | Phase 2 |
| PDF conversion for images | NOT STARTED | Phase 2 |

#### Phase 4: Checklist Integration + Notifications
| Task | Status | Blocked By |
|------|--------|------------|
| Dynamic checklist generation from Finmo | NOT STARTED | Phase 1 |
| Auto-update checklist on doc received | NOT STARTED | Phase 2 |
| "All docs received" notification | NOT STARTED | Phase 3 |
| Overdue doc reminders | NOT STARTED | Phase 3 |

### Secondary Initiatives (Future)
| Initiative | Target | Phase |
|-----------|--------|-------|
| Taylor inbox AI triage | Inbox overwhelm | Future |
| Lender policy knowledge base | Underwriting questions | Future |
| Budget template automation | Sheets + Loom | Future |

---

## E) Open Questions

| # | Question | Status | Answer |
|---|----------|--------|--------|
| 1 | Client folder subfolder structure | **ANSWERED** | See Drive Structure above |
| 2 | When is client folder created in Drive? | **ANSWERED** | Manual — when client first sends docs. **NEW PLAN:** Auto-create on Finmo submit |
| 3 | Finmo API available? | **ANSWERED** | Yes, Finmo has API |
| 4 | How does Cat retrieve docs uploaded to Finmo? | PENDING | Need to understand this flow |
| 5 | Doc checklist rules by app type? | PENDING | Need from Cat/Taylor |
| 6 | MyBrokerPro config (pipelines, custom fields, API)? | PENDING | Wednesday onboarding |
| 7 | Keep tracking in Google Docs vs move to CRM? | PENDING | Recommend CRM |
| 8 | Notification preference for Cat (SMS, email, CRM)? | PENDING | |

---

## F) Action Items

**See:** `NEEDS_FROM_CLIENT.md` for full list with status tracking.

**Summary:**
1. Dev email (dev@venturemortgages.com)
2. Google Drive invite
3. MyBrokerPro access
4. Finmo access
5. Doc checklist rules by application type

---

## G) Risks & Compliance

| Risk | Severity | Mitigation |
|------|----------|------------|
| Misfiled document (wrong client) | HIGH | Unmatched queue for uncertain matches; Cat reviews |
| Client PII in logs | HIGH | Only store metadata (doc type, date, filename) — not doc contents |
| AI misclassifies doc type | MED | Save raw copy; Cat can correct; learn from corrections |
| Automation sends to wrong folder | MED | _Raw Uploads preserves original; reversible |
| CRM not ready | MED | Phase 1 can work with Drive-only; CRM adds matching |
| Email from unknown sender | LOW | Unmatched queue + Cat notification |

---

## H) Weekly Status Template

```
### Week of [DATE]

**Hours this week:** X hrs
**Total project hours:** X hrs

#### Completed
- [ item ]

#### In Progress
- [ item ]

#### Blocked / Waiting
- [ item ] - waiting on [WHO]

#### Next Week
- [ item ]

#### Decisions Needed
- [ item ]
```

---

## I) Time Log

**See:** `TIMESHEET.md` for detailed time tracking.

**Running Total:** 4.0 hrs (4.0 billable)

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `FLOW_EMAIL_TO_DRIVE.md` | Detailed technical flow diagrams for email-to-Drive automation |
| `NEEDS_FROM_CLIENT.md` | Action items and questions pending from Taylor/Cat |
| `TIMESHEET.md` | Time tracking and billing |
| `WEDNESDAY_MEETING_QUESTIONS.md` | Questions for MyBrokerPro onboarding meeting |
| `CLAUDE.md` | Project context and operating principles |
