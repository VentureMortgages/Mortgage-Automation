# Codebase Concerns

**Analysis Date:** 2026-01-22

## Overview

This is a consulting/automation engagement for Taylor Atkinson (mortgage broker). The project involves designing and building automation systems to reduce manual workload, particularly for Cat (assistant) managing document intake and client file organization. This analysis covers architectural risks, design fragility, security considerations, and dependency concerns for the proposed automation system.

---

## Security Considerations

**PII Handling in Logs & Automation:**
- Risk: Mortgage documents contain sensitive personal information (income, bank accounts, employment, social security numbers). Uncontrolled logging could expose this data.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Data Flow), `PROJECT_DOC.md` (Section: G - Risks & Compliance)
- Current mitigation: `CLAUDE.md` states "Never store client PII in automation logs" and recommends storing only metadata (doc type, date, filename).
- Recommendations:
  - Implement structured logging that explicitly excludes document contents
  - Use metadata-only approach: store only filename, doc type, received date, status
  - Audit logs quarterly for any PII leakage
  - Use separate logging destination with restricted access (not general application logs)

**Email-Based Client Matching Risk:**
- Risk: Automation relies on matching sender email to CRM records. Spouse/partner emails, alternate work emails, or forwarded emails could cause misfiling to wrong client folder.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Trigger 2 - Email Matching), `PROJECT_DOC.md` (Section: G - Risks)
- Current mitigation: Unmatched queue + Cat manual review before auto-filing.
- Recommendations:
  - Require Cat to confirm fuzzy matches (not just exact email matches) before auto-filing
  - Implement secondary match signals: document content hints, historical sender patterns
  - Preserve unmatched queue even after automation scales
  - Add audit trail: log every email-to-client match decision for compliance review

**Unencrypted Drive Folder Links in CRM:**
- Risk: CRM will store Google Drive folder URLs as custom fields. If CRM is compromised, attackers have direct links to all client files.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Data Model)
- Current mitigation: None specified.
- Recommendations:
  - Store Drive folder IDs, not full URLs (regenerate URLs on demand)
  - Restrict CRM API access to service account only (not Taylor or Cat's personal accounts)
  - Enable Drive API audit logging
  - Consider storing Drive folder links in separate encrypted vault, not CRM

---

## Architectural Fragility

**Unmatched Email Queue Scalability:**
- Issue: `FLOW_EMAIL_TO_DRIVE.md` describes manual review queue for emails that don't match any CRM client. Relies on Cat manually reviewing Gmail "Unmatched - Review" folder.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Unmatched Email Flow)
- Impact: Bottleneck. If automation works well, unmatched queue will grow faster than Cat can handle. Risk of queue backlog → missed docs.
- Fix approach:
  - Implement weekly digest report to Cat (instead of per-email notification)
  - Add fuzzy matching with confidence scores before sending to unmatched queue
  - Build dashboard showing unmatched queue status + SLA (max 24hr turnaround)
  - Consider secondary match source: shared Google Docs lists mentioned in `PROJECT_DOC.md` as current tracking method

**Finmo Application → CRM → Drive Orchestration Dependency:**
- Issue: The entire automation pipeline depends on successful completion of Trigger 1 (Finmo app submitted → CRM record created → Drive folder created → Checklist generated). Failure at any step breaks downstream document filing.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Trigger 1), `PROJECT_DOC.md` (Section: D - Automation Backlog)
- Impact: One failed Finmo webhook or CRM API error = client's documents won't auto-file correctly; manual recovery required.
- Fix approach:
  - Implement idempotent operations: creating CRM record twice should not create duplicate
  - Add retry logic with exponential backoff (3 retries, max 1 hour)
  - Store failed Finmo app IDs in dead-letter queue + alert Cat/Taylor
  - Test end-to-end pipeline in sandbox before production deployment

**Checklist Rule Logic Hard-Coded:**
- Issue: Project doc references "dynamic doc checklist based on app type" but no central source of truth for what documents are required by application type.
- Files: `NEEDS_FROM_CLIENT.md` (Question 5: "Doc checklist rules by application type?"), `PROJECT_DOC.md` (Section: C - Time Sinks, rows 103-104)
- Impact: If rules are hard-coded in Python/Node script, changing mortgage lending requirements requires code changes + deployment.
- Fix approach:
  - Store checklist rules in MyBrokerPro custom fields or separate config table (JSON, YAML, or Sheets)
  - Rule format: `{ appType: "Purchase", employmentType: "Employed", requiredDocs: ["Paystub", "LOE", "T4"] }`
  - Allow Cat to edit rules via UI without code changes
  - Version rules with effective dates (handle mid-year requirement changes)

**AI Document Classification Confidence Threshold:**
- Issue: `FLOW_EMAIL_TO_DRIVE.md` (Phase 3, Section: Doc type classification) plans to use AI to classify documents and route to subfolders. No threshold specified for "confident enough to auto-file."
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Trigger 2, Phase 3), `PROJECT_DOC.md` (Section: G - Risk: AI misclassifies doc type)
- Impact: Low-confidence classifications could misfold documents (e.g., income doc in Property folder). Manual correction adds work.
- Fix approach:
  - Set minimum 85% confidence threshold for auto-filing
  - Documents below 85% confidence go to "_Review" folder + Cat notified
  - Maintain feedback loop: Cat's corrections retrain/calibrate AI model
  - Log all classifications + confidence scores for audit trail

---

## Tech Debt & Design Shortcuts

**Dual Source of Truth: Google Docs vs MyBrokerPro:**
- Issue: Currently, document tracking lives in two Google Docs ("Document Collection" for pre-live, "Live Deals" for post-submission). Project plans to move this to MyBrokerPro CRM custom fields.
- Files: `NEEDS_FROM_CLIENT.md` (Question 3: "Keep doc tracking in Google Docs vs move to MyBrokerPro?"), `PROJECT_DOC.md` (Section: B - Systems Inventory)
- Impact: Until migration complete, two tracking systems create inconsistency risk. Manual updates required in both places. High risk during transition.
- Fix approach:
  - Set hard migration date: build CRM checklist → export data from Sheets → import to CRM → disable Sheets updates
  - During transition window, require updates in CRM only (read-only copy pushed to Sheets for backup)
  - Run parallel validation weekly (checklist in CRM = checklist in Sheets) until fully cutover
  - Archive old Sheets as read-only historical records

**Manual Drive Folder Creation Process:**
- Issue: Currently, Google Drive folders are created manually when client first sends documents. Project plans to auto-create on Finmo app submit.
- Files: `NEEDS_FROM_CLIENT.md` (Question 1: "At what stage is client folder created in Drive?"), `PROJECT_DOC.md` (Section: B - Drive Structure)
- Impact: During transition, some clients will have auto-created folders, others manual. No single process. Confusion about "where is this client's folder?"
- Fix approach:
  - Build one-time migration script: scan all existing client folders in Drive → create CRM records with folder links
  - Going forward, only Finmo apps create folders (enforce this rule)
  - Implement audit dashboard: "Folders without CRM records" and "CRM records without folders" to catch mismatches

**Incomplete Access & Permissions Plan:**
- Issue: Project requires access to Gmail, Drive, MyBrokerPro, Finmo APIs. `NEEDS_FROM_CLIENT.md` lists all as "PENDING" status. No clear plan for service account creation, OAuth scopes, or permission boundaries.
- Files: `NEEDS_FROM_CLIENT.md` (Section: Access Checklist), `PROJECT_DOC.md` (Section: D - Action Items)
- Impact: When access is finally granted, risk of over-permissioning (service account gets full admin) or under-permissioning (automation fails silently). No audit trail if developer account is personal.
- Fix approach:
  - Create dedicated service account: `automation@venturemortgages.com` (not developer's personal account)
  - Define minimal OAuth scopes per integration:
    - Gmail: Read-only access to Cat's inbox + modify labels only
    - Drive: Editor access to "Mortgage Clients" folder only (not entire Drive)
    - MyBrokerPro: Custom API key with contacts:read, contacts:write, customfields:read
    - Finmo: Read-only API key for application data pull
  - Document scopes in `ACCESS_CHECKLIST.md` before deployment
  - Implement quarterly permission audit

---

## Missing Critical Features

**No Rollback or Kill Switch Mechanism:**
- Issue: `CLAUDE.md` (Operating Principles) states "Every automation needs a kill switch" but `FLOW_EMAIL_TO_DRIVE.md` and `PROJECT_DOC.md` don't define one.
- Files: `FLOW_EMAIL_TO_DRIVE.md`, `PROJECT_DOC.md`
- Impact: If automation begins misfiling documents or creates duplicate CRM records, no way to pause without code change.
- Fix approach:
  - Implement feature flag: `AUTOMATION_ENABLED = true/false` in CRM (editable by Taylor/Cat)
  - Add dead-letter queue: all failed processing goes here, can be replayed manually
  - Create "Disable Automation" SOP (what to do if things go wrong)
  - Implement 24-hour rollback: keep copy of unfiled raw documents for 24 hours (allows manual recovery)

**No Notification Delivery Confirmation:**
- Issue: Automation will text/notify Cat on unmatched emails. No mechanism to confirm Cat received notification or track if Cat actually processes the unmatched email.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Unmatched Email Flow, "Send text/notification to Cat")
- Impact: Cat misses notification → unmatched queue grows silently → documents pile up.
- Fix approach:
  - Use two-way SMS (Twilio) with Cat's response required: "Send 'ACK' to confirm"
  - If no response in 2 hours, escalate to Taylor
  - Maintain notification log: what time Cat was notified, response time, whether processed
  - Weekly report: "Unmatched emails waiting review > 24hrs"

**No Document Versioning or Duplicate Detection:**
- Issue: If client sends same paystub twice (attached to two different emails), automation files both as separate documents. Cat has to manually delete duplicates.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Trigger 2 - Upload renamed doc)
- Impact: Drive folders get cluttered with duplicates. Time waste.
- Fix approach:
  - Before filing, compute file hash (SHA-256) of document
  - Query CRM: has this hash been seen before?
  - If yes, check timestamp: if within 7 days, flag as duplicate → save to "Duplicates" folder instead
  - Require Cat to confirm before deleting duplicate (in case it's a newer version)

**No SOP Documentation for the Automation Itself:**
- Issue: `CLAUDE.md` requires "Every automation needs a short SOP: what it does, how to use, how to disable, troubleshooting." None exist yet for email-to-Drive automation.
- Files: All project docs are design/strategy, no operations documentation
- Impact: When automation is live, Cat and Taylor won't know how to troubleshoot failures or disable if needed.
- Fix approach:
  - Create `EMAIL_TO_DRIVE_SOP.md` covering:
    - What does it do (30-second overview)
    - How does it work (example: email arrives → 5 minutes → file appears in Drive)
    - How to check status (dashboard, logs, alerts)
    - How to disable (feature flag, revert code)
    - Common failures & recovery (unmatched email, slow filing, duplicate detection)
    - Troubleshooting checklist for Cat
  - Update project documentation before go-live

---

## Testing & Validation Gaps

**No Sandbox/Testing Strategy Defined:**
- Issue: Complex integration between Finmo, MyBrokerPro, Gmail, Drive, and AI classification. No documented testing plan before production deployment.
- Files: `PROJECT_DOC.md` (Section: G - Risks), `FLOW_EMAIL_TO_DRIVE.md` (Phased Implementation)
- Impact: Risk of production bugs affecting real clients.
- Fix approach:
  - Create test plan covering:
    - Unit tests: email matching logic, doc type classification, naming convention
    - Integration tests: end-to-end flow with mock Finmo app submit
    - Sandbox environment: separate CRM instance, test Drive folder, test email inbox
    - Cat user acceptance test (UAT): Cat tests with 5 real test clients before go-live
  - Define "success criteria" for each phase before moving to next
  - Document rollback procedure if UAT fails

**No Metrics or Success Measurement:**
- Issue: Project aims to reduce Cat's workload (stated in `CLAUDE.md`), but no baseline metrics defined (time per document now vs after automation).
- Files: `CLAUDE.md` (engagement goal), `PROJECT_DOC.md` (Section: C - Time Sinks)
- Impact: Can't measure ROI of automation investment. Can't tell if it actually saved time.
- Fix approach:
  - Baseline measurement (before automation):
    - Time to download, organize, rename, file one document
    - Frequency of unmatched emails requiring Cat intervention
  - Post-automation measurement (3 months after go-live):
    - Time to manually review/correct filed documents
    - % of documents auto-filed correctly without correction
    - Time spent on exception handling (unmatched queue)
  - Calculate: hours saved per week, ROI vs development cost

---

## Dependency Risks

**Reliance on Finmo API Stability:**
- Risk: Entire application pipeline triggered by Finmo webhook (or polling). If Finmo API changes or goes down, automation breaks.
- Files: `PROJECT_DOC.md` (Section: B - Systems Inventory, Finmo role), `FLOW_EMAIL_TO_DRIVE.md` (Trigger 1)
- Current status: "Finmo API available? **ANSWERED** - Yes, Finmo has API" but no API documentation or SLA agreement reviewed.
- Mitigation:
  - Document Finmo API contract: endpoints, webhook delivery guarantees, rate limits, SLA
  - Implement fallback: if Finmo webhook fails, poll API every 15 minutes for new apps
  - Add monitoring: alert if Finmo webhook hasn't fired in 2 hours
  - Plan upgrade path if Finmo changes API (vendor lock-in risk)

**MyBrokerPro Customization Risk:**
- Risk: CRM automation depends on custom fields, pipelines, workflows, and API. If MyBrokerPro doesn't support required features, entire design changes.
- Files: `WEDNESDAY_MEETING_QUESTIONS.md` (all questions target this uncertainty), `PROJECT_DOC.md` (Section: E - Open Questions, #6)
- Current status: Meeting scheduled but no answers documented yet.
- Mitigation:
  - Confirm in writing: MyBrokerPro supports custom fields, API, webhooks, batch operations
  - Request: API documentation, rate limits, terms of service
  - Plan fallback: if MyBrokerPro can't deliver, use alternative CRM (Pipedrive, HubSpot)
  - Don't build automation on features marked "coming soon" — wait for release

**Third-Party API Rate Limits Not Addressed:**
- Risk: Email-to-Drive automation will make multiple API calls per document: Gmail API (download), Drive API (create folder, upload file), MyBrokerPro API (query + update), Finmo API (query app data).
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Technical Components)
- Impact: If rate limits are hit, documents queue up, Cat doesn't receive notifications.
- Mitigation:
  - Document all API rate limits: Finmo, MyBrokerPro, Google (Drive, Gmail), document AI service
  - Calculate peak load: assume 10 documents/day = 40+ API calls
  - Implement request queuing with backoff: if rate limit hit, retry with exponential delay
  - Monitor API usage: alert if approaching 80% of quota

**Vendor Lock-In: Google Drive Folder ID Dependency:**
- Risk: Automation stores Google Drive folder IDs in CRM. If switching to OneDrive or another storage, requires data migration.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Data Model), `PROJECT_DOC.md` (Section: B - Drive Structure)
- Impact: Hard to switch storage providers once automation lives in production.
- Mitigation:
  - Use abstraction layer: store "client_file_storage_id" + "storage_provider" (not hardcoded Drive folder ID)
  - Allow future switching to OneDrive/Dropbox without code changes
  - Document: what would migration to OneDrive require (API changes, folder structure translation)

---

## Performance Bottlenecks

**Email Download & File Conversion Latency:**
- Problem: Each document goes through: email download → AI classification → PDF conversion → metadata extraction → file rename → Drive upload. Single large document (e.g., 50 MB bank statements) could take 10+ minutes.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Trigger 2, steps 3-6)
- Impact: If Cat sends 5 documents in an email, automation could take 1 hour to complete. Cat doesn't know if automation is working or stuck.
- Improvement path:
  - Implement asynchronous processing: email trigger → queue document → return immediately → process in background
  - Show progress to Cat: "Document 1/5: Classifying... Document 2/5: Queued..."
  - Set SLA: 95% of documents filed within 30 minutes of email received
  - Optimize: parallelize document processing (classify while converting PDF)

**AI Document Classification Response Time:**
- Problem: If using Claude API or Google Document AI, each classification call takes 2-5 seconds (network latency + model inference).
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Phase 3: Doc type classification)
- Impact: 5 documents = 10-25 seconds just for classification.
- Improvement path:
  - Batch classification: send multiple documents to AI at once (if API supports)
  - Cache classification results: same document type seen before? Skip re-classification
  - Consider local lightweight model for 80% of cases (document type heuristics), use AI only for ambiguous docs
  - Measure & monitor: log classification time per document, alert if > 10 seconds

**Drive API Quota for Folder Creation & File Upload:**
- Problem: Google Drive API has quota limits (varies by account). Mass uploading client folders + bulk document uploads could hit quota.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Trigger 1: Create folder + subfolders, Trigger 2: Upload file)
- Impact: If migration script creates 100+ client folders at once, quota exhausted → automation stops.
- Improvement path:
  - Check quotas before deployment: Document Google Drive API limits for service account
  - Implement exponential backoff: if quota error, wait 1 hour before retry
  - Batch operations: create folders in phases (10/hour, not 100 at once)
  - Monitor: track Drive API usage weekly, alert if > 80% of daily quota

---

## Compliance & Audit Concerns

**No Audit Trail for Document Lifecycle:**
- Issue: Once document is filed to Drive, no record of: who uploaded it, when it was uploaded, what version of automation classified it, how confident the classification was.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (all sections)
- Impact: If there's a dispute about document receipt date or classification, can't prove what happened.
- Fix approach:
  - Store metadata log in Google Sheets or database:
    - Client name, document type, sender email, received timestamp, processed timestamp, confidence score, final folder location
  - Log all AI classifications with confidence score (build audit trail)
  - Use Drive's built-in version history + revision comments ("Auto-filed by automation, confidence: 92%")
  - Implement quarterly audit: spot-check 10 random documents, verify classification accuracy

**No Retention or Purge Policy for _Raw Uploads:**
- Issue: `PROJECT_DOC.md` (Section: B - Drive Structure) mentions "_Raw Uploads" folder to preserve originals before AI processing, but no retention policy defined.
- Files: `PROJECT_DOC.md` (Section: B - Drive Structure)
- Impact: Over time, _Raw Uploads folder could consume unlimited storage. Compliance risk if old PII is retained beyond legal requirement.
- Fix approach:
  - Define retention policy: keep raw files for 90 days, then delete (after final file is confirmed)
  - Allow exception: keep some files longer if requested by Taylor
  - Implement automated purge: script runs monthly, deletes raw files older than 90 days
  - Communicate policy to Taylor/Cat: "We delete raw uploads after 90 days to manage storage"

---

## Integration Complexity Risks

**MyBrokerPro Custom Field Configuration Not Yet Designed:**
- Issue: Project assumes CRM will have fields for: secondary emails, Drive folder URL, application type, employment type, commission income, down payment source, doc checklist. None of these are confirmed to exist in MyBrokerPro.
- Files: `WEDNESDAY_MEETING_QUESTIONS.md` (Questions 4-5), `FLOW_EMAIL_TO_DRIVE.md` (Section: Data Model)
- Impact: If MyBrokerPro doesn't support custom fields, or only allows limited number, automation design won't fit.
- Fix approach:
  - Confirm in MyBrokerPro meeting (scheduled): custom fields supported, how many, what types
  - Design fallback: if limited custom fields, use JSON field to store all metadata
  - Document final design in `CRM_FIELD_MAPPING.md` before Phase 2 builds

**No Email Parsing Robustness Plan:**
- Issue: Automation extracts sender email from every email received by Cat. But forwarded emails, distribution lists, shared inboxes could have sender = "someone@company.com" instead of client email.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Section: Trigger 2, "Extract sender email address")
- Impact: High false-negative rate: client's real email not matched because it came via forwarded/shared inbox.
- Fix approach:
  - Parse email headers: check Reply-To, From, and X-Original-From
  - Implement whitelist of "trusted senders" (realtor, lawyer, accountant) who frequently forward documents
  - If forwarded, check email body for client signature or clues to actual sender
  - Log all parsing attempts → Cat reviews high-ambiguity emails

---

## Documentation & Knowledge Gaps

**No Technical Architecture Document:**
- Issue: Current docs are strategy-level (workflows, problem statements, backlog). No technical architecture covering: deployment target, database schema, API contracts, error handling strategy.
- Files: All docs are high-level; no tech design doc
- Impact: When actual coding begins, developer lacks technical blueprint. Decisions made ad-hoc during implementation.
- Fix approach:
  - Create `ARCHITECTURE.md`: deployment platform (AWS Lambda vs Heroku vs n8n?), database (Firestore vs PostgreSQL?), how components communicate
  - Define API contracts for each integration: Finmo input/output, MyBrokerPro queries/updates, Drive file structure
  - Document error handling: retry logic, dead-letter queues, human review triggers

**Finmo Document Upload Flow Still Not Documented:**
- Issue: `NEEDS_FROM_CLIENT.md` lists: "When clients upload docs to Finmo, how does Cat retrieve and save them to Drive? **PENDING**"
- Files: `NEEDS_FROM_CLIENT.md` (Question 2)
- Impact: Critical workflow gap. How are Finmo-uploaded documents different from email-uploaded documents? Do they need separate handling?
- Fix approach:
  - Get answer from Taylor/Cat: are documents currently pulled from Finmo, or only via email?
  - If Finmo upload is supported, design separate trigger: "Document uploaded to Finmo" → download → file to Drive
  - Update `FLOW_EMAIL_TO_DRIVE.md` to include Finmo upload flow

---

## Data Quality & Consistency Risks

**No Validation Rules for Document Requirements:**
- Issue: Checklist for each application type (e.g., "Purchase, Employed") lists required documents, but no rules for when optional docs become required (e.g., if commission income detected, add "Commission Statement" to required list).
- Files: `PROJECT_DOC.md` (Section: C - Time Sinks, row 107), `NEEDS_FROM_CLIENT.md` (Question 6)
- Impact: If rules are incomplete or ambiguous, Cat has to manually override checklist frequently.
- Fix approach:
  - When building checklist logic, document conditional rules:
    ```
    IF employment_type = "Self-Employed" THEN add "Tax Return" + "T776" to required
    IF down_payment_source = "Gift" THEN add "Gift Letter" to required
    IF commission_income = true THEN add "Commission Statement" + "2-year average" to required
    ```
  - Store rules in editable config (JSON or CRM), not hard-coded
  - Version rules: effective dates, change history

**No Duplicate Client Prevention:**
- Issue: When Finmo app is submitted, automation creates CRM record. But what if same client applies twice (e.g., refinance 6 months later)? Risk of duplicate CRM records, both with separate Drive folders.
- Files: `FLOW_EMAIL_TO_DRIVE.md` (Trigger 1: Create client record), `PROJECT_DOC.md` (Section: D - Risks)
- Impact: Multiple Drive folders for one client → confusion about which folder is current.
- Fix approach:
  - Query CRM before creating: does client (by email or name) already exist?
  - If exists, create new record but link to previous: "client.previous_version_id"
  - Allow Taylor/Cat to manually merge duplicate records if they occur
  - Dashboard report: "Duplicate clients" flagged for review weekly

---

## Change Management & Governance Gaps

**No Change Control Process for Automation Updates:**
- Issue: Once automation is live, if Finmo API changes or Cat requests new checklist rules, how are changes tested and deployed?
- Files: None address this
- Impact: Risk of untested changes breaking production automation.
- Fix approach:
  - Define change control board: who approves changes (Taylor, Cat, developer)?
  - Require: test in sandbox first, UAT sign-off from Cat, rollback plan documented
  - Implement: feature flags for gradual rollout (test with 10% of emails first)
  - Document: all changes in CHANGELOG.md with version numbers

**No Stakeholder Communication Plan:**
- Issue: When automation fails or documents are delayed, Cat and Taylor won't know why. No status dashboard or alert system defined.
- Files: `PROJECT_DOC.md` mentions "cat notification" but no formal alerting strategy
- Impact: Silent failures, trust issues with automation.
- Fix approach:
  - Implement notification dashboard: automation status (healthy/degraded/down), unmatched queue size, SLA compliance (% docs filed within 30 min)
  - Weekly report to Taylor/Cat: automation metrics, issues, action items
  - Monthly review: Is automation actually saving time? ROI vs cost?

---

## Summary of Highest-Priority Concerns

| Concern | Severity | Impact | Fix Timeline |
|---------|----------|--------|--------------|
| PII in logs/data storage | HIGH | Regulatory, client trust | Phase 1 (before build) |
| Email matching misfiles docs to wrong client | HIGH | Client data leakage, rework | Phase 2 (before testing) |
| No rollback/kill switch | HIGH | Can't disable if broken | Phase 1 (before build) |
| Unmatched email queue becomes bottleneck | HIGH | Cat workload increases | Phase 2 (before scale) |
| Finmo API dependency fragility | MEDIUM | Automation stops silently | Phase 1 (before build) |
| No testing/validation plan | MEDIUM | Production bugs | Phase 2 (before UAT) |
| No SOP documentation | MEDIUM | Cat can't troubleshoot | Before go-live |
| MyBrokerPro capability gaps uncertain | MEDIUM | Design invalidation | Immediate (before Phase 2) |
| Dual source of truth (Sheets vs CRM) | MEDIUM | Data sync failures | During transition |
| No metrics/baseline for ROI | MEDIUM | Can't prove value | Immediate (baseline now) |

---

*Concerns audit: 2026-01-22*
