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
- Files the doc to the global **Needs Review/** folder in Drive
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
| Document not showing up in Drive | Wait 2-3 minutes (system polls every 120 seconds). Check the Processed label in docs@ — if the email moved there, it was processed. |
| Document filed to wrong client | Check `Originals/` folder for the original file. Move it manually. The system learns from name extraction, so edge cases with common names may need manual routing. |
| Document classified as wrong type | The original is always in `Originals/`. Rename and move the file manually. |
| No email draft appeared | Check if the Finmo application triggered. Look for the CRM task "Review doc request". |
| System seems stuck | Check docs@ inbox — are emails piling up without moving to Processed? Contact Luca. |

---

## Contact

**System issues:** Luca (luca@lucacardelli.dev)
**Application questions:** Taylor
