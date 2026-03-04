# Document Automation — How It Works

**For:** Cat & Taylor | **Last updated:** March 2026

---

## The Basics

Forward client documents to **docs@venturemortgages.com**. The system does the rest.

It classifies the document, figures out which client it belongs to, renames it using your naming convention, files it to the right folder in Google Drive, and updates the checklist in MyBrokerPro. The original file is always saved in the client's `Originals/` folder as a safety net.

The system checks docs@ every 2 minutes. Once processed, the email moves from Inbox to the **Processed** label in docs@.

---

## What's Automated

### 1. New Application (Finmo)
When a Finmo application comes in:
- Client contact created/updated in MyBrokerPro
- Personalized doc checklist generated based on employment type
- Email draft created in admin@'s Gmail
- CRM task created: **"Review doc request — [Client Name]"**

**Cat's action:** Open the draft in Gmail, review it, send it.

### 2. Document Filing
When Cat forwards a document email to docs@:
- Document classified (T4, pay stub, bank statement, LOE, etc.)
- Matched to the correct client by reading the name on the document
- Renamed (e.g., "Brenda - T4 2024.pdf")
- Filed to the correct Drive subfolder (Income/, Property/, Down Payment/, etc.)
- Original saved to client's `Originals/` folder
- CRM checklist updated

**Cat's action:** Forward the email. That's it.

### 3. Needs Review
When the system isn't confident about a match or classification:
- Document filed to **Needs Review/** folder (in Mortgage Clients root or inside the client's folder)
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

## Supported Formats

PDF, images (JPG/PNG), Word docs, ZIP files (auto-extracted). Each attachment in a multi-attachment email is processed independently.

---

## Where Documents Get Filed

| Document Type | Subfolder |
|---|---|
| T4, T1, NOA, pay stub, LOE, bank statement, RRSP, TFSA, void cheque | `Income/` |
| Purchase agreement, MLS listing, home insurance | `Property/` |
| Gift letter, down payment proof | `Down Payment/` |
| Photo ID, passport, PR card | Client root |
| Signed docs | `Signed Docs/` |
| Low confidence / unknown | `Needs Review/` |

---

## Edge Cases

**Forwarded same email twice?** The system overwrites the previous version. No duplicates.

**Folder already has that doc type?** The system updates the existing file instead of creating a second copy.

**Employer/bank sent docs directly to docs@?** Ignored — the system only processes emails from @venturemortgages.com. Have them send to you, then forward to docs@.

**Co-borrower docs?** Routed to the primary borrower's folder automatically.

**Wrong classification?** Original is always in `Originals/`. Rename and move manually.

**System is down?** Emails stay in docs@ inbox. Nothing is lost. The system catches up when it's back.

---

## Kill Switch

If anything goes wrong:
1. Tell Luca, or
2. On Railway, set `AUTOMATION_KILL_SWITCH=true`

Emails stay safe in docs@ and will be processed when re-enabled.

---

## Contact

**System issues:** Luca
**Application questions:** Taylor
