# Venture Mortgages Automation — Status Report

**Prepared for:** Taylor Atkinson & Cat
**Date:** February 18, 2026

---

## What We've Built

We've built a complete automation system that handles the most time-consuming parts of your document collection workflow. Here's what it does:

### 1. Automatic Document Checklist Generation
When a new Finmo application comes in, the system automatically generates a personalized list of required documents based on the borrower's situation — employment type, co-borrowers, down payment source, property type, and more. This replaces the manual process of reviewing each application and figuring out what to request.

### 2. Draft Email to Client
The system generates a professional doc-request email listing exactly what's needed, formatted clearly with sections for each borrower. These emails are created as **drafts for Cat to review** before sending — nothing goes out without human approval.

### 3. CRM Tracking (MyBrokerPro)
When a checklist is generated, the system automatically creates or updates the client's contact in MyBrokerPro with:
- Full checklist of required documents
- Tracking fields showing received vs. missing docs
- Status updates as documents come in

### 4. Document Classification & Filing
When Cat or Taylor forwards client emails to docs@, the system:
- Detects new attachments automatically
- Uses AI to identify what type of document it is (T4, pay stub, ID, etc.)
- Renames it using Cat's naming convention
- Files it to the correct subfolder in Google Drive
- Updates the CRM to mark it as received

### 5. Smart Returning Client Detection
For returning clients who already have documents on file from a previous application, the system scans their existing Drive folder and:
- Identifies which requested docs are already on file and still valid
- Removes those from the email request (so clients aren't asked for things you already have)
- Adds an "Already on file" section to the email so everyone knows what's covered
- Pre-marks those docs as received in the CRM

### 6. Budget Sheet Automation
When a new application arrives, the system automatically:
- Creates a copy of Taylor's master budget template in the client's Drive folder
- Selects the correct tab (Purchase, Refinance, Sell+Buy, Investment, etc.)
- Pre-fills purchase price, down payment, amortization, FTHB status, location, and other defaults

---

## How This Helps Cat

| Before | After |
|--------|-------|
| Manually review each Finmo app to determine required docs | Automatic checklist generated in seconds |
| Type out doc request emails from scratch | Draft email ready for review — just hit send |
| Manually download email attachments and upload to Drive | Forward to docs@ and documents are auto-classified, renamed, and filed |
| Track received/missing docs in Google Docs lists | CRM auto-updates as docs come in |
| Re-request docs from returning clients that you already have | System knows what's on file and skips them |
| Create budget sheet from template and fill in basics | Budget sheet auto-created with Finmo data pre-filled |

**Estimated time savings:** 15-30 minutes per new application, plus ongoing time saved on doc tracking and filing.

---

## How This Helps Taylor

- Budget sheets arrive pre-filled — just add mortgage rates and adjust estimates
- CRM shows real-time doc collection status per client
- PRE-readiness milestone alerts when enough docs are in for the budget call
- Less back-and-forth with Cat on "what docs do we still need?"

---

## What We're Waiting On

**Cat needs to review the latest draft emails.** On February 16, we generated 11 draft emails from real Finmo applications and sent them to admin@venturemortgages.com for Cat's review. We need her feedback on:
- Are the document descriptions clear?
- Is anything missing or incorrectly requested?
- Does the tone and formatting look right?

This is the last step before we can turn on the email drafting for new applications.

---

## What Needs to Be Verified Before Going Live

The system is built and tested against real data, but a few things need your sign-off before it runs day-to-day:

**Cat:**
- Review the 11 draft emails in admin@ Gmail — are the doc requests clear and complete?
- Spot-check a few checklists against what you'd normally request
- Flag any naming patterns in Drive folders that look "off" in the scanner results

**Taylor:**
- Open a test budget sheet and confirm the values are in the right cells
- Confirm the defaults still match your preferences (30yr amortization, $100 insurance, $200 utilities)
- Verify tab selection: purchase → Purchase Budget, rental → Investment, refinance → Refinance, etc.

**First few weeks live:**
- Cat reviews every email draft before sending (this is already the workflow — nothing auto-sends)
- Flag any docs that are requested but shouldn't be, or missing docs that should be requested
- Flag any documents that get filed to the wrong folder or misclassified
- We'll tune the rules and thresholds based on real usage

**Safety net:** The kill switch instantly stops all automation if anything goes wrong. Manual process continues as before.

---

## Known Edge Cases (Not Blockers — Flagged for Later)

A few scenarios the system doesn't fully handle yet. None of these prevent going live, but they'll need attention as usage grows:

- **Returning clients with a new application** — The CRM tracking fields get overwritten with the new checklist. Previous application data is lost. We'll need per-deal tracking if this comes up often.
- **Two applications back to back from the same client** — Similar issue. The budget sheet dedup also incorrectly skips the second one.
- **Client folder naming** — If Cat's existing Drive folder for a client is named slightly differently than what the system generates, a duplicate folder gets created. Cat should flag these and we'll tune the matching.
- **Doc filing location** — Classified documents currently file to the top-level Drive folder, not inside the specific client's subfolder. This is a known gap that will be fixed.
- **Doc forwarding pipeline** — The full chain (forward email to docs@ → AI classification → rename → file to Drive → update CRM) has not been tested end-to-end with a real email yet. Unit tests pass, but we need a live test before relying on it.

---

## What's Next on the Roadmap

1. **Cat's email review** — incorporate feedback and finalize the email template
2. **Taylor reviews a test budget sheet** — confirm cell mappings and defaults
3. **Full pipeline verification** — end-to-end test with a live Finmo application
4. **Test doc forwarding pipeline** — forward a real client email to docs@ and verify the full chain
5. **Cat workflow training** — 30 min walkthrough of the new process
6. **Monitor first 2 weeks** — tune rules and thresholds based on real usage
7. **Custom GPTs for Taylor** — purpose-built AI assistants for Taylor's workflow
8. **Email automation for Taylor** — streamline Taylor's email workflows
9. **Automated reminders (Phase 9)** — gentle follow-up emails for missing docs (on hold pending Taylor's go-ahead)
10. **Address edge cases** — as they come up in real usage
