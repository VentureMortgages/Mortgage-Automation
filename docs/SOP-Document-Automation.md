# Document Automation SOP

**For:** Cat (and Taylor)
**System:** Venture Mortgages Doc Automation
**Last updated:** March 2026

---

## What This System Does

When you forward client documents to **docs@venturemortgages.com**, the system automatically:

1. **Classifies** the document (T4, pay stub, bank statement, LOE, etc.)
2. **Matches** it to the correct client using name extraction + CRM lookup
3. **Renames** it using your naming convention (e.g., "Brenda - T4 2024.pdf")
4. **Files** it to the correct client folder and subfolder in Google Drive
5. **Updates** the client's doc checklist in MyBrokerPro
6. **Preserves** the original file in the client's `Originals/` folder (safety net)

The system checks docs@ every 2 minutes. After processing, emails move from Inbox to the **Processed** label.

---

## How to Forward Documents

1. Receive a client email with document attachments (in admin@)
2. **Forward the email** to **docs@venturemortgages.com**
3. That's it. The system handles the rest.

**Supported formats:** PDF, images (JPG/PNG), Word docs, ZIP files (auto-extracted)

**What gets filed where:**
| Document Type | Drive Subfolder |
|---|---|
| T4, T1, NOA, pay stub, LOE, employment contract | `Income/` |
| Bank statement, RRSP, TFSA, FHSA, void cheque | `Income/` |
| Purchase agreement, MLS listing, home insurance | `Property/` |
| Gift letter, down payment proof | `Down Payment/` |
| Photo ID, passport, PR card | Client root folder |
| Signed docs | `Signed Docs/` |
| Unknown / low confidence | `Needs Review/` |

---

## What Happens Automatically (New Applications)

When a new Finmo application comes in:

1. System creates/updates the client contact in MyBrokerPro
2. Generates a personalized doc checklist based on employment type
3. Creates an **email draft** in admin@'s Gmail inbox
4. Creates a **"Review doc request"** task in MyBrokerPro assigned to you

**Your step:** Open the draft in Gmail, review/edit it, then send it to the client.

---

## How to Handle "Needs Review" Tasks

If the system can't confidently match a document to a client, it:
- Files the doc to the **Needs Review/** folder in Drive
- Creates a CRM task: **"Match Review: [filename]"**
- The task body shows the best guess, confidence %, and a link to the file

**Your step:**
1. Open the Drive link in the task
2. Look at the document to identify which client it belongs to
3. Move the file from `Needs Review/` to the correct client folder manually
4. Mark the CRM task as complete

---

## Reminders

If a client has outstanding documents for 3+ days:
- A CRM task appears with the list of missing docs and a draft follow-up message
- You also get an email: **"Follow up: Need docs - [Client Name]"**
- Copy/paste the draft message to send to the client

If docs are still missing 3 days later, the task updates (no duplicates).
When all docs arrive, reminder tasks auto-close.

---

## Edge Cases & Common Questions

### "I forwarded the same email twice by accident"
No problem. If the same doc type already exists in the client's Drive folder, the system **overwrites** it with the newer version. The original is still in `Originals/`. No duplicates are created.

### "A client folder already has some docs filed manually"
The system checks if a file with the same doc type label already exists before uploading. If it finds one (e.g., "T4 2024" already in `Income/`), it **updates** that file instead of creating a duplicate. If the existing file was manually named differently, the system creates a new file alongside it — you may want to delete the old manual copy.

### "An employer/bank/third party sent docs directly to docs@"
The system **only processes emails from @venturemortgages.com senders**. External emails sent directly to docs@ are ignored. The third party needs to send to you (admin@) or Taylor, and then you forward to docs@.

### "A document has multiple people's names on it"
The system extracts the borrower name from the document content. If there's ambiguity (e.g., a joint bank statement with two names), the system uses the matching agent to figure out who it belongs to. For joint applications, docs route to the **primary borrower's folder**.

### "A co-borrower sends their own documents"
The system detects co-borrowers through the Finmo application data. If Jane is a co-borrower on John's application, Jane's documents are routed to **John's folder** (the primary borrower). Each person's docs go into a person-specific subfolder within Income/ (e.g., `Income/Jane/`).

### "The system classified a document as the wrong type"
The original is always preserved in `Originals/` with its original filename. You can:
1. Go to the client's `Originals/` folder to find the original file
2. Rename and move it to the correct subfolder manually
3. Delete the incorrectly filed version

### "An email has multiple attachments"
Each attachment is classified and filed **independently**. A single email with a T4, a bank statement, and a pay stub will produce three separate files in the correct subfolders.

### "An email has a ZIP file attached"
ZIP files are automatically extracted. Each file inside the ZIP is processed individually — classified, matched, and filed as if it were a separate attachment.

### "A document is too large"
The system has a 25 MB limit per attachment (matching Gmail's limit). Oversized files are skipped, but other attachments in the same email still process normally.

### "A Word document (.docx) was attached"
Word documents are currently skipped with a note. Convert the Word doc to PDF manually before forwarding, or ask the client to resend as PDF.

### "The document is a photo/image (not PDF)"
Images (JPG, PNG) are automatically converted to PDF before classification. No action needed — just forward the email as usual.

### "I cloned/copied a client folder in Drive"
The system files to the folder linked in the CRM contact's custom field, not by folder name. Cloning a folder in Drive doesn't affect the system — it will continue filing to the original folder. If you want the system to use a different folder, the CRM contact's Drive folder ID field needs to be updated.

### "What if the system is down or Railway has issues?"
Emails stay in docs@ inbox until the system processes them. Nothing is lost. When the system comes back up, it picks up where it left off using Gmail's history tracking.

---

## How to Disable the System

If anything goes wrong and you need to stop all automation:

**Option 1 — Tell Luca** to set the kill switch on Railway.

**Option 2 — Railway dashboard:**
1. Go to Railway project settings
2. Set environment variable: `AUTOMATION_KILL_SWITCH=true`
3. The system stops processing immediately
4. To re-enable: set it back to `false`

The system will NOT lose any emails — they stay in docs@ inbox and will be processed when you re-enable.

---

## Troubleshooting

| Problem | What to check |
|---|---|
| Document not showing up in Drive | Wait 2-3 minutes (system polls every 120s). Check the Processed label in docs@ — if the email moved there, it was processed. |
| Document filed to wrong client | Check `Originals/` folder for the original. Move it manually. Edge cases with common names may need manual routing. |
| Document classified as wrong type | Original is always in `Originals/`. Rename and move manually. |
| No email draft appeared | Check if the Finmo application triggered. Look for the CRM task "Review doc request". |
| System seems stuck | Check docs@ inbox — are emails piling up without moving to Processed? Contact Luca. |
| CRM task but no file in Drive | Check the global `Needs Review/` folder — low-confidence docs land there. |

---

## Contact

**System issues:** Luca (luca@lucacardelli.dev)
**Application questions:** Taylor
