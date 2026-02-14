# Architecture

**Analysis Date:** 2026-01-22

## Pattern Overview

**Overall:** Event-driven integration automation with manual review queue fallback

**Key Characteristics:**
- Trigger-based workflows (Finmo submission, email arrival)
- Multi-system orchestration (Finmo → CRM → Drive)
- Human-in-the-loop for uncertain matches (unmatched email queue)
- Document classification and metadata extraction layer
- Idempotent processing with raw file preservation

---

## Layers

**Trigger Layer:**
- Purpose: Detect significant events that initiate automation
- Location: Email inbox monitoring (Gmail), Finmo webhook/API polling
- Contains: Email attachment detection, Finmo application submission events
- Depends on: Gmail API, Finmo API
- Used by: Client matching and document filing workflows

**Integration Layer:**
- Purpose: Query and synchronize data across systems
- Location: CRM (MyBrokerPro), Gmail, Google Drive, Finmo
- Contains: Client record lookups, document status updates, folder creation
- Depends on: APIs for each service
- Used by: All orchestration workflows

**Classification & Processing Layer:**
- Purpose: Analyze document content and extract metadata
- Location: Document AI/Claude analysis stage
- Contains: Doc type detection, metadata extraction (date, amount, account type)
- Depends on: Vision/document AI models, document content
- Used by: File naming, subfolder routing

**Filing Layer:**
- Purpose: Store documents in correct locations with proper naming
- Location: Google Drive folder structure
- Contains: Raw uploads preservation, renamed file storage, organized subfolders
- Depends on: Drive API, classification results
- Used by: Document availability, manual review

**Notification Layer:**
- Purpose: Alert team members of significant events
- Location: SMS/Slack/CRM notifications
- Contains: Unmatched email alerts, all-docs-received notifications, overdue reminders
- Depends on: Twilio/Slack APIs, notification preferences
- Used by: Human workflow activation

---

## Data Flow

**Flow 1: New Client Application Submitted**

1. Client submits Finmo application
2. Finmo sends webhook/email notification
3. System queries Finmo API for application data (name, email, app type, employment type, down payment source, # borrowers)
4. System creates CRM client record in MyBrokerPro with:
   - Client name + email(s)
   - Application type
   - Employment classification
   - Down payment profile
5. System creates Google Drive folder: `Mortgage Clients/[Client Name]/` with standard subfolders:
   - Borrower 1, Borrower 2 (if applicable)
   - Subject Property, Non-Subject Property
   - Down Payment, Signed Docs, Investments-HNW
   - _Raw Uploads (for original files before processing)
6. System generates dynamic doc checklist in CRM based on application type (e.g., employed purchase vs self-employed refinance)
7. System stores Drive folder link in CRM record

**Flow 2: Document Email Received**

1. Email arrives in Cat's inbox with attachment
2. System extracts sender email address
3. System queries CRM for client matching by email (primary or secondary email)
4. **If match found:**
   - System retrieves client's Drive folder from CRM
   - Downloads attachment from email
   - Saves raw copy to `_Raw Uploads` subfolder
   - AI analyzes document: detects type (paystub, LOE, T4, bank statement, mortgage statement, inspection report, etc.)
   - AI extracts metadata: names, dates, amounts, account types, last-4 digits, balance amounts
   - System converts document to PDF (if needed)
   - System applies naming convention:
     - Income: `Name - [item] [date] [$amount]` (e.g., "John Smith - LOE Dec 7 $125k")
     - Property: `Street Name - [item] [date]` (e.g., "123 Gordon Drive - Mortgage Statement 2024")
     - Bank: `Bank - [acct type] [last4] [period] [balance]` (e.g., "CIBC - TFSA 90 days $89k")
   - System determines correct subfolder based on doc type (Borrower 1, Subject Property, Down Payment, etc.)
   - System uploads renamed document to correct subfolder
   - System updates CRM checklist: marks document type as "Received" with date
   - **If checklist complete:** system notifies Cat/Taylor that file is ready for budget call
5. **If no match found:**
   - System moves email to `Unmatched - Review` Gmail folder
   - System sends SMS/notification to Cat: "Doc from [email] couldn't match to client. Please review."
   - Cat manually identifies correct client
   - Cat adds secondary email to CRM client record
   - Cat moves email back to inbox or triggers reprocessing

**State Management:**
- Client state stored in CRM (pipeline stage: "Doc Collection" → "Live Deal" → "Funded")
- Document state tracked in CRM checklist (Requested → Received)
- Raw files preserved in `_Raw Uploads` for auditability
- Unmatched emails queued in Gmail for manual review

---

## Key Abstractions

**Client Record:**
- Purpose: Single source of truth for client information across systems
- Examples: `MyBrokerPro client record`
- Pattern: Contains primary email, secondary emails, application type, employment type, down payment source, Drive folder link, doc checklist array

**Document Checklist:**
- Purpose: Dynamically generated list of required documents based on application profile
- Examples: Varies by app type (employed purchase vs self-employed refinance)
- Pattern: Array of {doc_type, status, date_received} stored as custom field in CRM

**Document Classifier:**
- Purpose: Analyze document content and return {type, metadata}
- Examples: "paystub" with {name, employer, period, gross_income}, "LOE" with {name, employer, start_date}, "bank_statement" with {bank, account_type, last_4, period, balance}
- Pattern: Takes document bytes (image or PDF) → returns structured classification result

**Filing Rules:**
- Purpose: Route classified documents to correct Drive subfolder and apply naming convention
- Examples: Income docs → Borrower 1 folder, property docs → Subject Property folder, down payment docs → Down Payment folder
- Pattern: Document type + metadata → subfolder path + filename template

---

## Entry Points

**Finmo Application Submission (Webhook/Polling):**
- Location: Finmo API listener or scheduled job
- Triggers: When client submits application in Finmo portal
- Responsibilities:
  - Pull application data from Finmo
  - Create CRM client record
  - Generate Drive folder structure
  - Create dynamic doc checklist
  - Store folder link in CRM

**Email Attachment Received (Gmail API):**
- Location: Gmail API listener or scheduled job
- Triggers: When email arrives in Cat's inbox with attachment
- Responsibilities:
  - Extract sender email
  - Query CRM for client match
  - Route to matched client flow or unmatched queue
  - Process document (classify, extract, convert, rename, file)
  - Update CRM checklist

**Unmatched Email Manual Review:**
- Location: Cat's `Unmatched - Review` Gmail folder
- Triggers: Cat opens email after receiving notification
- Responsibilities:
  - Cat identifies correct client
  - Cat adds secondary email to CRM
  - System reprocesses email with updated client record

---

## Error Handling

**Strategy:** Fail safe to manual review queue; preserve original files for audit trail

**Patterns:**
- **Email not from known client:** Move to `Unmatched - Review`, notify Cat
- **AI cannot confidently classify document:** Save to client's folder with flag, notify Cat for manual categorization
- **Multiple matches found:** Notify Cat with options, require manual selection
- **File upload fails:** Preserve raw copy in `_Raw Uploads`, retry, alert on repeated failure
- **CRM API unavailable:** Queue event for retry, don't delete email, alert team
- **Drive quota exceeded:** Notify Cat, don't file document, move email to holding folder

---

## Cross-Cutting Concerns

**Logging:**
- Only log metadata (client name, doc type, status change)
- Never log document contents or PII
- Log all classification decisions and confidence levels for debugging

**Validation:**
- Verify email sender is valid before processing
- Validate Drive folder exists before filing
- Check document type classification confidence threshold (>80% or defer to review)
- Verify CRM checklist item exists before marking received

**Authentication:**
- Service account with delegated OAuth scopes:
  - Gmail: `https://www.googleapis.com/auth/gmail.readonly` (read inbox), `https://www.googleapis.com/auth/gmail.modify` (folder operations)
  - Drive: `https://www.googleapis.com/auth/drive` (full access to Mortgage Clients folder)
  - MyBrokerPro: API key with CRM read/write permissions
  - Finmo: API key with application read permissions

**Security:**
- Store API keys in secure vault, not in code or logs
- Use least-privilege OAuth scopes per integration
- All file operations logged with metadata only (no content)
- Raw files preserved for audit trail before renaming

---

*Architecture analysis: 2026-01-22*
