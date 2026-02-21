# Venture Mortgages Automation — Comprehensive Technical Report

**Prepared for:** Taylor Atkinson
**Date:** February 18, 2026
**Project Duration:** February 9 – 18, 2026 (10 calendar days)

---

## 1. Project Stats at a Glance

| Metric | Value |
|--------|-------|
| **Total lines of code** | 26,099 |
| Production code | 12,809 lines |
| Automated tests | 10,451 lines |
| E2E test scripts | 2,839 lines |
| **Source files** | 142 TypeScript files |
| **Test files** | 37 |
| **Automated tests passing** | 592 |
| **Source modules** | 9 (budget, checklist, classification, CRM, drive, email, intake, webhook, e2e) |
| **Git commits** | 117 |
| **E2E test scripts** | 16 (real API integration tests) |
| **External API integrations** | 7 |

---

## 2. Technical Services & APIs Integrated

| Service | Purpose | API Used |
|---------|---------|----------|
| **Finmo** | Mortgage application data (borrowers, income, properties, assets) | REST API v1 |
| **Google Drive** | Document filing, folder management, budget sheet storage | Drive API v3 |
| **Google Sheets** | Budget sheet creation and pre-filling | Sheets API v4 |
| **Gmail** | Email drafting, sending, attachment monitoring | Gmail API |
| **Google Gemini 2.0 Flash** | AI document classification (identify doc types from PDFs) | Generative AI API |
| **MyBrokerPro (GoHighLevel)** | CRM — contact management, custom fields, doc tracking | GHL API v2 |
| **Redis + BullMQ** | Job queues with retry, dead-letter, and concurrency control | BullMQ v5 |

### Infrastructure Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 22 |
| HTTP server | Express 5 |
| Job queue | BullMQ + Redis (ioredis) |
| AI classification | Google Gemini 2.0 Flash |
| PDF processing | pdf-lib |
| Schema validation | Zod 4 |
| Testing | Vitest |
| Auth | Google OAuth2 + Service Account with domain-wide delegation |

---

## 3. What Was Built (Feature Breakdown)

### Phase 1: Webhook Foundation
- Express webhook receiver with Finmo signature verification
- BullMQ async job queue with exponential backoff retries
- Dead-letter queue for failed jobs (manual review)
- PII sanitizer — no sensitive borrower data in logs
- Global kill switch via environment variable
- Health check endpoint

### Phase 2-3: Checklist Generation Engine
- 103 rules implementing the full Canadian mortgage doc checklist
- Handles: employed, self-employed, pension, commission, rental income
- Co-borrower support with per-borrower doc separation
- Down payment source detection (savings, RRSP, FHSA, TFSA, gift, sale proceeds)
- Property-specific docs (purchase agreement, MLS, tax bills)
- Situational docs (separation, divorce, bankruptcy, non-resident)
- PRE vs FULL staging (internal tracking)
- Deduplication of multi-income items

### Phase 4: CRM Integration
- Contact upsert from Finmo application data
- Custom field mapping for checklist tracking (received/missing/total counts)
- Stage-aware status computation
- Name-based CRM contact lookup (fallback for forwarded emails)
- Sender domain filtering for security

### Phase 5: Email Drafting
- HTML email generation with professional formatting
- Per-borrower doc request sections
- "Already on file" section for returning clients
- BCC send tracking
- Draft-first workflow (Cat reviews before sending)
- Cat's formatting feedback incorporated

### Phase 6: Document Intake Monitor
- Gmail polling for docs@venturemortgages.com inbox
- Attachment extraction (PDF, images, Word docs)
- Clients email admin@ or taylor@ — Cat/Taylor forward to docs@ for processing
- Only processes emails forwarded from @venturemortgages.com senders
- PDF conversion for non-PDF attachments
- Encrypted PDF handling

### Phase 7: AI Classification & Filing
- Gemini 2.0 Flash classifies documents into 30+ types
- Confidence scoring with manual review queue for low confidence
- Filename generation following Cat's naming convention
- Subfolder routing (person, subject property, down payment, etc.)
- Document versioning (update existing vs. upload new)
- CRM tracking auto-update on filing

### Phase 8: Tracking Integration
- Real-time CRM updates as documents arrive
- Doc-type matcher maps classified docs to checklist items
- Audit trail via CRM notes
- PRE-readiness milestone detection

### Drive-Aware Checklist (Post-Phase 8)
- Scans returning client Drive folders for existing documents
- Filename parser handles Cat's naming convention + shorthand aliases
- Document expiry rules (30-day, 90-day, 1-year, 5-year, tax-year, never-expires)
- Property-specific docs excluded (always re-requested per deal)
- Flexible fallback parsing for non-standard filenames
- Filters checklist to remove on-file items from email
- Pre-marks received docs in CRM

### Budget Sheet Automation
- Copies master template (9 tabs) to client Drive folder
- Tab selection based on goal + use (Purchase, Refinance, Sell+Buy, Investment, Debt Consolidation)
- Pre-fills: purchase price, down payment, amortization, FTHB status, province/location, condo fees, insurance, utilities, property taxes
- Dedup check (skips if budget already exists)
- Kill switch support

---

## 4. Test Coverage

| Module | Tests |
|--------|-------|
| Checklist engine | 230+ |
| CRM integration | 80+ |
| Email generation | 50+ |
| Drive scanner + filter | 68 |
| Classification worker | 18 |
| Budget sheet | 30+ |
| Webhook worker | 25+ |
| Other modules | 90+ |
| **Total** | **592** |

Every feature has automated tests. Tests run in under 2 seconds.

---

## 5. Time Investment

### Hours Breakdown

| Date | Hours | Category |
|------|-------|----------|
| Jan 7 | 1.5 | Meeting + strategy |
| Jan 19 | 1.0 | Planning session |
| Jan 21 | 1.5 | In-person meeting |
| Jan 22 | 1.3 | Strategy + research |
| Feb 9 | 1.0 | Strategy + checklist review |
| Feb 10 | 1.0 | Project init + roadmap |
| Feb 11 | 0.5 | Build |
| Feb 12 | 1.0 | Build |
| Feb 13 | 3.0 | Build |
| Feb 15 | 0.5 | Build |
| Feb 16 | 8.0 | Build |
| Feb 17 | 2.0 | Build |
| Feb 18 | 0.5 | Build |
| **Total** | **22.8** | |

**Breakdown by type:**
- Strategy, meetings, research: **7.3 hours**
- Building + testing: **15.5 hours**

---

## 6. Development Speed Comparison

### What was delivered
- 9 integrated modules spanning 7 external APIs
- 12,800+ lines of production code
- 592 automated tests
- 16 E2E integration test scripts
- Full Canadian mortgage domain logic (103 checklist rules)
- AI-powered document classification pipeline
- Real-time CRM sync

### Typical industry timeline for equivalent scope

To put this in perspective, here's what each module typically costs in development time when built from scratch by a professional team:

| Work Area | Typical Hours | Notes |
|-----------|---------------|-------|
| Discovery & requirements | 40–80 | Stakeholder interviews, mortgage domain research, workflow mapping |
| Architecture & design | 30–50 | System design, API evaluation, security planning |
| API integrations (7 services) | 100–180 | Each API requires auth setup, error handling, rate limit management, testing. Finmo, Drive, Sheets, Gmail, Gemini, GoHighLevel, Redis/BullMQ |
| Checklist engine (103 rules) | 60–100 | Canadian mortgage doc requirements are complex — employment types, co-borrowers, down payment sources, situational docs |
| Email drafting system | 30–50 | HTML generation, per-borrower sections, template logic, draft/send flow |
| AI classification pipeline | 80–120 | Prompt engineering, confidence tuning, filename generation, subfolder routing, manual review queue |
| CRM integration | 50–80 | Custom field mapping, contact upsert, status computation, tracking sync |
| Drive integration | 40–70 | Folder scanning, filename parsing, expiry rules, checklist filtering, flexible matching |
| Budget sheet automation | 20–40 | Template copying, tab selection, cell mapping, dedup |
| Test suite (592 tests) | 80–140 | Unit tests, integration tests, mock setups, edge cases |
| E2E testing & verification | 30–50 | Real API integration scripts, debugging, iteration |
| Documentation & SOPs | 20–40 | Per-automation documentation, troubleshooting guides |

| Approach | Estimated Hours | Calendar Time | Estimated Cost |
|----------|----------------|---------------|----------------|
| Solo senior developer | 500–700 hours | 4–6 months | $75k–$120k |
| Small team (2-3 devs) | 500–800 hours | 2–4 months | $75k–$150k |
| Outsourced/agency | 800–1,200 hours | 4–8 months | $120k–$250k |
| **This project** | **22.8 hours** | **10 days** | — |

*Cost estimates based on $125–$175/hr for senior developers, $150–$250/hr for agencies.*

> **Note on the solo dev estimate:** Honestly, 350–500 hours would be conservative for a solo dev. Consider what they'd actually face:
>
> - **Domain learning curve** — they don't know what a T4A is, what FTHB means, that T2125 lives inside the T1 package, or that gift letters are collected later when the lender is picked. That knowledge took multiple meetings with you and Cat plus research. A new dev would need weeks of back-and-forth just to get the 103 checklist rules right.
> - **7 API integrations from scratch** — Finmo's API isn't well-documented. GoHighLevel V2 has quirks. Google's auth setup (OAuth2 + service account + domain-wide delegation) is notoriously painful. Each integration is easily 2-3 days of trial and error.
> - **Cat's naming conventions** — a dev wouldn't just know that "YE Pay Stub" means year-end pay stub, or that "CRA SOA" means CRA Statement of Account. We only figured that out by scanning real folders today.
> - **592 tests** — that's easily 100+ hours of test writing alone at normal dev speed.
>
> 500–700 hours is more honest for a solo senior dev.

### Why the difference

The primary multiplier is AI-assisted development (Claude Code), which handles:
- Boilerplate generation and API integration code
- Test writing (592 tests would typically take 80-140 hours alone)
- Domain research (Canadian mortgage doc requirements, tax rules, expiry logic)
- Cross-module refactoring and consistency
- Real-time debugging and code review
- Documentation and type safety enforcement

**Effective speedup: ~15-22x** compared to a skilled solo developer, **~22-35x** compared to a typical team engagement.

### What the hours DON'T include
- The AI tool cost (Claude Code subscription)
- Your existing domain expertise (mortgage industry knowledge that would take a new team weeks to acquire through stakeholder interviews and research)
- Google Workspace setup and admin configuration (done separately)
- The fact that a new team would need to learn Taylor and Cat's specific workflows, naming conventions, and preferences — institutional knowledge that informed every design decision

---

## 7. Architecture Quality Indicators

| Indicator | Status |
|-----------|--------|
| Type safety | Full TypeScript strict mode |
| Test coverage | 592 tests, all passing |
| Security | PII sanitization, input escaping, domain filtering |
| Reliability | Retry with backoff, dead-letter queue, kill switches |
| Human-in-the-loop | All client emails drafted for review |
| Modularity | 9 independent modules with clean interfaces |
| Observability | Structured logging (metadata only, no PII) |
| Idempotency | Webhook dedup, budget sheet dedup, doc versioning |

---

## 8. What Still Needs to Be Adjusted & Verified

The system is built and tested against real data, but going from "built" to "running in your day-to-day business" requires validation and tuning. Here's what we need to work through together:

### Cat's Review (Blocking)

| Item | What We Need | Why It Matters |
|------|-------------|----------------|
| **Draft email review** | Cat reviews the 11 draft emails sitting in admin@ Gmail | These are the actual emails clients will receive. Tone, wording, and completeness need to match how Cat would write them. |
| **Checklist accuracy** | Cat spot-checks a few checklists against what she'd request manually | Our 103 rules were built from Cat's V2 doc, but real applications may surface gaps — docs she'd request that we don't, or docs we request that she wouldn't. |
| **Naming convention coverage** | Cat confirms the scanner handles her patterns | We tested 5 real folders today and improved the parser, but she may have other naming variations we haven't seen. |

### Taylor's Review

| Item | What We Need | Why It Matters |
|------|-------------|----------------|
| **Budget sheet accuracy** | Taylor opens a test budget sheet and checks values are in the right cells | Cell positions are based on the current template. If the template changes, mappings need updating. |
| **Budget defaults** | Taylor confirms: 30yr amortization, $100 insurance, $200 utilities as starting defaults | These came from analyzing 10 historical sheets — but his preferences may have shifted. |
| **Tab selection logic** | Taylor verifies: purchase → Purchase Budget, rental → Buy Investment Property, refinance → Refinance Budget, selling + buying → Sell+Buy | One wrong mapping means the wrong tab gets populated. |

### Real-World Verification (First Few Weeks Live)

| Area | What Could Need Adjustment | How We'll Know |
|------|---------------------------|----------------|
| **Checklist rules** | Some docs may be requested that shouldn't be, or missing docs that should be | Cat flags them during her email review step |
| **Doc expiry rules** | Pay stubs expire after 30 days, bank statements after 90 days — are these thresholds right for your workflow? | A returning client gets asked for something Cat considers still valid, or doesn't get asked for something that's stale |
| **AI classification accuracy** | Gemini may misclassify unusual documents or low-quality scans | Docs end up in wrong folders, or too many get routed to manual review (confidence < 70%) |
| **Classification confidence threshold** | Currently set at 70% — below that, docs go to manual review instead of auto-filing | Too low = bad files get auto-filed. Too high = too many docs need manual review. Tune based on real traffic. |
| **CRM field mapping** | Custom fields in MyBrokerPro may need renaming or restructuring as Cat uses them | Cat finds the tracking fields confusing or wants different status labels |
| **Drive folder edge cases** | Files without borrower names (like "Void Cheque.pdf" or "CIBC #6937 Chequing...") can't be attributed to a specific borrower | About 15-20% of files in real folders use non-standard naming. These get skipped — not harmful, but means some on-file docs won't be detected for returning clients. |
| **Email formatting on different devices** | HTML email rendering varies across email clients (Gmail, Outlook, mobile) | Cat or a client reports the email looks broken on their device |

### Operational Readiness

| Item | Status | What's Needed |
|------|--------|---------------|
| **Production server** | Set up | Verify webhook endpoint is receiving Finmo events |
| **Redis instance** | Set up | Verify job queue is processing |
| **Monitoring & alerts** | Not set up | Need to know when jobs fail, when the kill switch activates, when classification confidence drops |
| **Error notification** | Logs only | Should alert Cat or Taylor when something needs manual attention (failed job, unclassifiable doc) |
| **Cat's workflow training** | Not done | Cat needs to know: where drafts appear, how to review and send, how to check CRM status, what to do if something looks wrong |
| **Kill switch test** | Not tested live | Flip the switch, confirm everything stops, flip it back |
| **Backup/rollback plan** | Documented in code | If anything goes wrong, kill switch stops all automation instantly. Manual process continues as before. |

### Known Limitations (By Design)

These are intentional trade-offs, not bugs:

- **Emails are always drafts** — Cat must review and send. This is the safety net.
- **Files without borrower names are skipped** by the Drive scanner — no way to attribute them. Cat can rename them to fix this.
- **Property-specific docs are always re-requested** — purchase agreements, MLS listings, property tax bills, etc. are deal-specific and never reused across applications.
- **Gift letters not requested upfront** — per Cat's instruction, these are collected later when the lender is picked.
- **No auto-reminders yet** — Phase 9 is on hold. Cat handles follow-ups manually for now.

### Known Edge Cases (Flagged for Future)

These are scenarios the system doesn't fully handle yet. None are blockers for going live — they're edge cases that will come up as usage grows and should be addressed over time.

| Edge Case | What Happens | Risk Level | Fix Complexity |
|-----------|-------------|------------|----------------|
| **Returning client, new application** | CRM checklist fields get overwritten with the new application's checklist. Previous application's tracking data is lost. | Medium — affects returning clients only | Medium — need per-deal tracking (CRM custom objects or separate fields per deal) |
| **Two applications back to back** | Second webhook overwrites the first's CRM fields. Two email drafts get created (Cat sees both). Budget sheet dedup incorrectly skips the second one (thinks it's a duplicate). | Medium — rare but confusing when it happens | Medium — need application-aware dedup (not just "does a budget sheet exist?") |
| **Email draft accumulation** | If a job is re-processed (manual re-queue, retry after 24h dedup window), a second draft is created alongside the first. Cat sees multiple drafts for the same client with no indication which is current. | Low — dedup prevents most cases | Low — check for existing drafts before creating new ones |
| **Borrower with no email in Finmo** | CRM upsert sends an empty email to GoHighLevel (likely rejected). Email draft fails (empty To: header). The whole job fails and goes to dead-letter queue. | Low — most Finmo apps have email | Low — add null guard, skip email step, flag for manual handling |
| **Drive folder name mismatch** | If Cat's existing folder is named differently than what the system generates (e.g., "Bennett, Andrew & Tabitha" vs "Bennett, Andrew/Tabitha"), the system creates a new folder instead of finding the existing one. Client now has two folders. | Medium — depends on Cat's naming consistency | Low — fuzzy folder matching or manual folder ID mapping |
| **Budget sheet template changes** | If Taylor modifies the master template (adds rows, rearranges cells), the hardcoded cell positions break silently. Data gets written to wrong cells with no error. | Medium — one wrong template edit breaks all future sheets | Medium — add template version check or read-back validation |
| **Doc filing goes to root folder** | Classified documents currently file to the Drive root folder, not the specific client subfolder. The worker creates subfolders inside root instead of inside "LastName, FirstName/". This is a known TODO from Phase 8. | Medium — docs get filed but not to the right client folder | Medium — need client folder resolution in classification worker |
| **Missed Finmo webhooks** | If Finmo's webhook delivery fails (server restart, network issue), the application never gets processed. No catch-up mechanism exists. | Low — Finmo webhooks are generally reliable | Medium — add periodic Finmo API poll to detect unprocessed applications |
| **Multiple clients' docs in one email** | If Cat forwards an email with attachments for multiple clients, all docs get attributed to the same source. System can't split them across clients. | Low — Cat typically forwards per-client | N/A — Cat should forward separately (SOP item) |
| **Co-borrower as separate CRM contact** | If a co-borrower was previously a main borrower on their own deal, they have their own CRM contact. Doc tracking only updates the main borrower's contact for the current deal — the co-borrower's separate contact stays stale. | Low — uncommon scenario | Medium — cross-reference co-borrower contacts during sync |

### Not Yet Tested End-to-End

| Pipeline | Unit Tested | Live Tested | Notes |
|----------|-------------|-------------|-------|
| Finmo webhook → checklist → CRM → email draft | Yes (592 tests) | Partially — 11 drafts generated from real apps, but not triggered by a live webhook | Need to submit a test Finmo app and watch the full pipeline fire |
| Doc forwarding → intake → classification → filing | Yes (unit tests) | **No** | Never forwarded a real email to docs@ and watched it process through AI classification → rename → Drive filing → CRM update |
| Budget sheet creation | Yes (unit + E2E script) | E2E script against real Finmo app | Created and verified a real spreadsheet, but not triggered by a live webhook |
| Returning client Drive scan → filtered email | Yes (unit + E2E script) | E2E script against real folders | Scanned 5 real client folders, but not tested as part of the full webhook pipeline |

---

## 9. Current Status & Next Steps

### Waiting On
- **Cat's review** of 11 draft emails (sent to admin@ Gmail on Feb 16)

### Roadmap
1. Incorporate Cat's email feedback and adjust checklist/template as needed
2. Taylor reviews a test budget sheet for accuracy
3. Full pipeline E2E verification with a live Finmo application
4. Test the doc forwarding → classification → filing pipeline end-to-end
5. Cat workflow training — 30 min walkthrough of the new process
6. Monitor first 2 weeks of live usage, tune rules and thresholds
7. Custom GPTs for Taylor
8. Email automation for Taylor
9. Phase 9: Automated reminders (on hold pending Taylor's go-ahead)
10. Address flagged edge cases as they come up in real usage
