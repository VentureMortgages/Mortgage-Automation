# Venture Mortgages — Document Automation Overview

**Prepared for:** Taylor Atkinson & Cat
**Date:** February 2026

---

## What We're Building

An automation system that handles your document collection workflow end-to-end. When a client submits a Finmo application, the system automatically:

1. **Generates a personalized doc request** based on the application (employed vs self-employed, purchase vs refinance, etc.)
2. **Creates a draft email for Cat to review** before it goes to the client
3. **Receives and organizes incoming documents** — classifies them, renames them, and files them to the right Google Drive folder
4. **Tracks what's received and what's missing** in MyBrokerPro so Cat always has a clear picture
5. **Sends follow-up reminders** for missing docs (when you're ready to turn this on)

---

## How It Works (Day-to-Day)

**When a new Finmo application comes in:**
- System reads the application details
- Generates a checklist using your exact doc rules (the same ones Cat uses today)
- Creates a task in MyBrokerPro for Cat with the draft email attached
- Cat reviews, makes any tweaks, and hits send

**When a client sends documents:**
- Cat forwards the email to **docs@venturemortgages.co**
- System identifies each document, renames it properly, and files it to the client's Drive folder
- MyBrokerPro checklist updates automatically (no manual tracking needed)
- When all pre-approval docs are in, Taylor gets notified

**What Cat doesn't have to do anymore:**
- Build the doc checklist from scratch for each client
- Manually download, rename, and file every document
- Track received vs missing in spreadsheets
- Remember who's missing what

---

## What Stays the Same

- Cat still reviews every email before it goes out
- Taylor still makes all broker decisions
- Documents still live in your Google Drive (same folder structure)
- MyBrokerPro is still your CRM — we're adding to it, not replacing it
- All automations can be turned off instantly if needed

---

## Build Phases

| Phase | What Gets Built | What You'll See |
|-------|----------------|-----------------|
| 1 | Technical foundation | Webhook connection to Finmo is live |
| 2 | CRM review | We understand your MyBrokerPro setup |
| 3 | Checklist engine | System generates correct doc lists from Finmo apps |
| 4 | CRM integration | Tasks and tracking show up in MyBrokerPro |
| 5 | Email system | Cat can review and send doc request emails from the system |
| 6 | Doc intake | System picks up documents from docs@ email and Finmo |
| 7 | Filing | Documents are auto-classified, renamed, and filed to Drive |
| 8 | Status tracking | MyBrokerPro shows real-time received/missing per client |
| 9 | Reminders | Follow-up emails for missing docs (you enable when ready) |

**First milestone (Phases 1-5):** The doc request email flow is fully automated.
**Full system (Phases 1-9):** The entire collection pipeline runs with minimal manual work.

---

## What We Need From You

- Access to MyBrokerPro for the dev account (done)
- Access to Google Drive (done)
- Access to Finmo (done)
- Set up **docs@venturemortgages.co** email for document forwarding
- Quick walkthrough of how MyBrokerPro is currently set up (pipelines, fields, etc.)
- Feedback on the checklist rules and email templates as we build

---

## Security & Control

- No client personal information is stored in automation logs
- All emails are drafted for review — nothing sends automatically
- Every automation has a kill switch
- Your existing tools (Drive, MyBrokerPro, Finmo) remain in your control
- We use your existing admin@venturemortgages.com for sending emails
