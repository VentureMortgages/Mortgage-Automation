# Email-to-Drive Automation Flow

**Last Updated:** 2026-01-19
**Status:** Design Phase

---

## Overview

Automate the process of receiving client documents via email, classifying them, and filing them to the correct Google Drive folder — while tracking status in MyBrokerPro.

---

## Trigger 1: New Finmo Application Submitted

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FINMO APPLICATION SUBMITTED                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Finmo sends email notification│
              │  (or webhook if available)     │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Pull application data via    │
              │  Finmo API:                   │
              │  • Client name                │
              │  • Client email(s)            │
              │  • Application type           │
              │  • Employment type            │
              │  • Down payment source        │
              │  • # of borrowers             │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Create client record in      │
              │  MyBrokerPro (CRM):           │
              │  • Name                       │
              │  • Email(s)                   │
              │  • Application type           │
              │  • Drive folder link (TBD)    │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Create Google Drive folder:  │
              │  Mortgage Clients / [Name]    │
              │  + subfolders:                │
              │    • Borrower 1               │
              │    • Borrower 2 (if needed)   │
              │    • Subject Property         │
              │    • Non-Subject Property     │
              │    • Down Payment             │
              │    • Signed Docs              │
              │    • Investments-HNW          │
              │    • _Raw Uploads             │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Update CRM record with       │
              │  Drive folder link            │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Generate dynamic doc         │
              │  checklist based on app type  │
              │  (stored in CRM)              │
              └───────────────────────────────┘
```

---

## Trigger 2: Email with Attachment Received

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  EMAIL WITH ATTACHMENT ARRIVES (Cat's inbox)                                │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Extract sender email address │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Query CRM: find client by    │
              │  sender email                 │
              └───────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Match found?   │
                    └─────────────────┘
                     │             │
                    YES            NO
                     │             │
                     ▼             ▼
    ┌─────────────────────┐    ┌─────────────────────────────────┐
    │  Get client's Drive │    │  UNMATCHED EMAIL FLOW           │
    │  folder link from   │    │  (see below)                    │
    │  CRM                │    └─────────────────────────────────┘
    └─────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │  Download attachment│
    └─────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │  Save RAW copy to   │
    │  _Raw Uploads folder│
    └─────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │  AI ANALYSIS:       │
    │  • Doc type (T1,    │
    │    paystub, LOE,    │
    │    bank stmt, etc.) │
    │  • Extract metadata │
    │    for naming       │
    └─────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │  Convert to PDF     │
    │  (if not already)   │
    └─────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │  Rename per naming  │
    │  convention:        │
    │  Income: Name -     │
    │   [item] [date] [$] │
    │  Property: Street - │
    │   [item] [date]     │
    │  Bank: Bank - [type]│
    │   [last4] [period]  │
    │   [balance]         │
    └─────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │  Determine subfolder│
    │  based on doc type  │
    └─────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │  Upload renamed doc │
    │  to correct folder  │
    └─────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │  Update CRM:        │
    │  Mark doc as        │
    │  "Received" in      │
    │  checklist          │
    └─────────────────────┘
```

---

## Unmatched Email Flow (Manual Review Queue)

When sender email doesn't match any client in CRM:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  NO CLIENT MATCH FOUND                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Move email to Gmail folder:  │
              │  "Unmatched - Review"         │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Send text/notification to    │
              │  Cat:                         │
              │  "Doc received from           │
              │  [email] - couldn't match     │
              │  to client. Please review."   │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Cat manually:                │
              │  1. Identifies correct client │
              │  2. Adds email to client      │
              │     record in CRM (so future  │
              │     emails match)             │
              │  3. Moves email back to inbox │
              │     OR triggers reprocess     │
              └───────────────────────────────┘
```

**Common unmatched scenarios:**
- Spouse/partner using different email
- Client using alternate email (work vs personal)
- New client not yet in system
- Realtor/lawyer sending on behalf of client

---

## Data Model

### CRM (MyBrokerPro) Client Record
```
Client Name:        "John Smith"
Primary Email:      "john.smith@email.com"
Secondary Emails:   ["jane.smith@email.com", "john.work@company.com"]
Application Type:   "Purchase"
Employment Type:    "Employed"
Commission Income:  No
Down Payment Source: "RRSP + Savings"
Drive Folder URL:   "https://drive.google.com/..."
Pipeline Stage:     "Doc Collection"
Doc Checklist:      [
  { doc: "Paystub", status: "Received", date: "2026-01-15" },
  { doc: "LOE", status: "Requested", date: null },
  { doc: "T4 2024", status: "Requested", date: null },
  { doc: "T4 2025", status: "Requested", date: null },
  ...
]
```

---

## Technical Components Required

| Component | Purpose | Options |
|-----------|---------|---------|
| Email monitoring | Watch Cat's inbox for attachments | Gmail API, Google Apps Script |
| CRM integration | Query/update client records | MyBrokerPro/GoHighLevel API |
| Finmo integration | Pull application data | Finmo API |
| Document AI | Classify doc type, extract metadata | Google Document AI, Claude, GPT-4 Vision |
| PDF conversion | Convert images to PDF | img2pdf, Google Drive conversion |
| Drive integration | Create folders, upload files | Google Drive API |
| Notifications | Alert Cat on unmatched emails | Twilio SMS, Slack, or GHL notifications |
| Orchestration | Tie it all together | n8n, Make, or custom Python/Node |

---

## Open Design Questions

| # | Question | Options | Decision |
|---|----------|---------|----------|
| 1 | Where does the automation run? | n8n (self-hosted), Make, Zapier, custom code | TBD |
| 2 | How to handle multi-page docs sent as separate images? | Combine into single PDF? Flag for review? | TBD |
| 3 | How to handle docs for Borrower 1 vs Borrower 2? | AI detection by name on doc? | TBD |
| 4 | What if AI can't confidently classify a doc? | Save to "Review" folder + notify Cat | TBD |
| 5 | How to handle re-processing after Cat matches an email? | Manual trigger? Move to specific folder? | TBD |

---

## Phased Implementation

### Phase 1: Foundation
- [ ] Get all access (dev email, Drive, CRM, Finmo)
- [ ] Map Finmo fields → doc checklist rules
- [ ] Set up Gmail folder structure ("Unmatched - Review")
- [ ] Basic email monitoring (detect attachments)

### Phase 2: Client Matching + Filing
- [ ] CRM query for client matching
- [ ] Drive folder creation on Finmo app submit
- [ ] Basic filing (raw copy to client folder)
- [ ] Unmatched email flow + Cat notification

### Phase 3: AI Classification + Renaming
- [ ] Doc type classification
- [ ] Metadata extraction
- [ ] Auto-rename per naming convention
- [ ] Subfolder routing

### Phase 4: Checklist Integration
- [ ] Dynamic checklist generation from Finmo data
- [ ] Auto-update checklist on doc received
- [ ] Dashboard/visibility for Cat
