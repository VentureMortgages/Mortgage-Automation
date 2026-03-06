# Document Automation — How It Works

**For:** Cat & Taylor | **Last updated:** March 2026

---

## The Basics

Forward client documents to **docs@venturemortgages.com**. The system does the rest.

It classifies the document, figures out which client it belongs to, renames it using your naming convention, files it to the right folder in Google Drive, and updates the checklist in MyBrokerPro. The original file is always saved in the deal's `1. Originals/` folder as a safety net.

The system checks docs@ every 2 minutes. Once processed, the email moves from Inbox to the **Processed** label in docs@.

---

## What's Automated

### 1. New Application (Finmo)
When a Finmo application comes in:
- Client contact created/updated in MyBrokerPro (main borrower + co-borrowers)
- Personalized doc checklist generated based on employment type
- Email draft created in admin@'s Gmail
- CRM task created: **"Review doc request — [Client Name]"**

**Cat's action:** Open the draft in Gmail, review it, send it.

### 2. Document Filing
When Cat forwards a document email to docs@:
- Document classified (T4, pay stub, bank statement, LOE, etc.)
- Matched to the correct client by reading the name on the document
- Renamed (e.g., "Brenda - T4 2024.pdf")
- Filed to the correct Drive subfolder inside the deal folder (Income/, Property/, etc.)
- Original saved to deal's `1. Originals/` folder
- CRM checklist updated

**Cat's action:** Forward the email. That's it.

### 3. Needs Review
When the system isn't confident about a match or classification:
- Document filed to **2. Needs Review/** folder (inside the deal folder, or Mortgage Clients root if no deal)
- CRM task created: **"Match Review: [filename]"** or **"Manual Review: [filename]"**
- Task includes best guess, confidence %, and a Drive link to the file

**Cat's action:** Click the Drive link, look at the doc, move it to the right folder, mark the task done.

### 4. Reminders
When a client has outstanding docs for 3+ days:
- CRM task created with the list of missing docs and a draft follow-up message
- Email sent to Cat: **"Follow up: Need docs - [Client Name]"**
- If still missing 3 days later, the task updates (no duplicates)
- When all docs arrive, reminder tasks auto-close

**Cat's action:** Copy/paste the draft follow-up and send to the client.

### 5. PRE-Approval Ready
When all pre-approval documents are received:
- CRM task created for Taylor: **"PRE docs complete — [Client Name]"**

**Taylor's action:** Schedule the budget call.

---

## Co-Borrowers (Joint Applications)

### Checklist & Email
Each borrower gets their own doc list. If John & Jane are both employed, the email lists T4/pay stub/LOE under "John" and again under "Jane" — separate sections with first-name headers.

### Drive Filing
All documents are filed inside the deal folder. Each borrower gets a named folder with ID, Income, and Tax subfolders:
```
Smith, John/                          ← client folder (linked in CRM)
  BRXM-F051307/                       ← deal folder
    1. Originals/                      ← safety net (timestamped copies)
    2. Needs Review/                   ← low-confidence docs
    Down Payment/
    Property/
    Signed Docs/
    Smith, John/                       ← borrower folder
      ID/
      Income/
      Tax/
    Doe, Jane/                         ← co-borrower folder
      ID/
      Income/
      Tax/
```

### Matching
If a doc arrives from co-borrower Jane's email, the system looks up the Finmo application, sees Jane is a co-borrower on John's deal, and routes to John's (primary borrower's) folder — then files into the `Jane/` subfolder based on the name on the document.

### CRM Tracking
Per-opportunity. Missing docs field tracks per-borrower: "T4 (John), Pay Stub (John), T4 (Jane), Pay Stub (Jane)". When Jane's T4 arrives, her row updates across all open deals.

---

## Supported Formats

PDF, images (JPG/PNG), Word docs, ZIP files (auto-extracted). Each attachment in a multi-attachment email is processed independently.

---

## Where Documents Get Filed

All docs file inside the **deal folder** (e.g., `BRXM-F051307/`). Falls back to client folder if no deal exists yet.

| Document Type | Subfolder (inside deal folder) |
|---|---|
| Pay stub, LOE, employment contract, commission, pension | `Smith, John/Income/` |
| T4, T1, T4A, T5, NOA, T4RIF, T2, CRA statement | `Smith, John/Tax/` |
| Photo ID, passport, PR card, work permit | `Smith, John/ID/` |
| Articles of incorporation, financial statement, separation/divorce | `Smith, John/` (borrower root) |
| Purchase agreement, MLS listing, home insurance, lease, mortgage stmt | `Property/` |
| Bank statement, RRSP, TFSA, FHSA, gift letter | `Down Payment/` |
| Signed docs | `Signed Docs/` |
| Void cheque, unclassified | Deal folder root |
| Low confidence / unknown | `2. Needs Review/` |

---

## Edge Cases

**Forwarded same email twice?** The system overwrites the previous version. No duplicates.

**Folder already has that doc type?** The system updates the existing file instead of creating a second copy.

**Client folder is in Pre-Approved or Funded subfolder?** Doesn't matter. The system uses the folder ID stored in the CRM, not the folder name or location. Moving a folder around in Drive doesn't break anything.

**Two folders with the same client name?** The system always files to whichever folder the CRM contact is linked to. It doesn't search by name.

**Employer/bank sent docs directly to docs@?** Ignored — the system only processes emails from @venturemortgages.com. Have them send to Cat, then forward to docs@.

**Wrong classification?** Original is always in `1. Originals/`. Rename and move manually.

**Client uploads docs to Finmo?** Being wired up now (Phase 17.1). Once live, Finmo doc uploads will be auto-detected and processed the same as email forwards. Until then, Cat downloads from Finmo and forwards to docs@ manually.

**Docs arrive before MyBrokerPro updates?** Documents file to Drive immediately — they never wait for the CRM. The system retries CRM sync over 35 minutes (5/10/20 min intervals). When the opportunity appears, it catches up and picks up all docs already filed. Nothing is lost.

**System is down?** Emails stay in docs@ inbox. Nothing is lost. The system catches up when it's back.

---

## Kill Switch

If anything goes wrong:
1. Tell Lucas, or
2. On Railway, set `AUTOMATION_KILL_SWITCH=true`

Emails stay safe in docs@ and will be processed when re-enabled.

---

## Known Gaps (Being Fixed — Phase 17.1)

These are actively being built. Until shipped, here's what to expect and workarounds:

### 1. Co-Borrower CRM Contacts
**Gap:** Only the main borrower gets a CRM contact when a Finmo application comes in. Co-borrowers exist in the checklist and email, but not in MyBrokerPro as separate contacts.

**Impact:** If a co-borrower emails their docs directly, the system can't match by sender email. It falls back to reading the name off the document — which usually works but is less reliable. Some co-borrower docs may land in Needs Review.

**Workaround:** Forward co-borrower docs the same way — the system reads the name off the document and usually matches correctly via the Finmo application data.

**Fix:** Phase 17.1 — system will create CRM contacts for all borrowers on joint applications, linked to the same Drive folder.

### 2. Existing Clients Missing Drive Folder Links
**Gap:** Clients who were in MyBrokerPro before go-live don't have their Drive folder linked in the CRM. New clients (via Finmo) get linked automatically.

**Impact:** Docs for existing clients may file to the root Mortgage Clients folder instead of the client's subfolder. Cat would need to move these manually.

**Workaround:** If a doc lands at the root level, move it to the correct client folder.

**Fix:** Phase 17.1 — a backfill spreadsheet with best-guess matchings is being reviewed by Taylor. Once confirmed, all existing clients will be linked.

### 3. Finmo Document Uploads
**Gap:** When clients upload docs directly in Finmo (not via email), the system doesn't detect them automatically yet.

**Impact:** Cat still needs to download docs from Finmo and forward to docs@.

**Workaround:** Download from Finmo, forward to docs@venturemortgages.com.

**Fix:** Phase 17.1 — Finmo document upload webhook being wired up. Once live, uploads go through the same classify/match/file pipeline automatically.

---

## Contact

**System issues:** Lucas
**Application questions:** Taylor
