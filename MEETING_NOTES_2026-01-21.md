# Meeting Notes — 2026-01-21

**Attendees:** Taylor, Cat, Luca (+ Sarah from MyBrokerPro later)
**Duration:** ~75 minutes

---

## Key Decisions

### 1. First Automation: Document Checklist Email
**Confirmed as priority #1.** After Finmo application submitted:
1. Pull application data (purchase/refinance, employed/self-employed, etc.)
2. Generate document checklist based on conditions
3. Auto-draft email to client from Cat's email (admin@venturemortgages.com)
4. **First month:** Cat reviews drafts before sending
5. **After validation:** Auto-send enabled

> "That would be an easy win... especially since we just need to go like if this then that."

### 2. Access Requirements Confirmed
- Create `dev@venturemortgages.com` email
- Invite dev@ to Google Drive "Mortgage Clients" folder
- Invite dev@ to MyBrokerPro
- Taylor will send Finmo application link for testing

### 3. Document Processing Flow Confirmed
```
Email with attachment → docs@venturemortgages.com
    ↓
Store raw copy in "_Raw Uploads" (original format preserved)
    ↓
AI classifies document (confidence score)
    ↓
If confidence < threshold → Human review queue
If confidence OK → Rename, file to correct subfolder, update checklist
```

### 4. Human Review Queue
- If AI can't confidently classify → flag for Cat to review
- **Critical:** Never ask client for document they already sent
- Cat reviews flagged documents each morning via MyBrokerPro task view

> "That's the worst part for clients... if we ask for a document they've already sent, they get super bitchy."

### 5. Document Rejection Flow
When Cat rejects a document:
1. Auto-draft email with boilerplate reason for that doc type
2. Include list of other outstanding documents
3. Cat can edit before sending (manual finesse for sensitive situations)

> "There always has to be a little finesse... you know the client, when to push, when to be gentle."

### 6. MyBrokerPro Structure
- Create client record when Finmo app comes in (if doesn't exist)
- Link Google Drive folder URL to client/application
- Document checklist stored as custom fields
- Status flow: `Requested → Pending → Review → Approved`

### 7. Parallel Running Period
- First 1-3 months: AI processes documents but Cat validates
- Compare AI classification with Cat's manual check
- Tune confidence thresholds based on accuracy
- Only go autonomous after validation period

> "We'll run robot parallel for three months... then we'll be like OK, we think it's good enough now."

---

## Folder Structure Insights

### Current Structure
```
Mortgage Clients/
├── Pre-Approval/
│   └── [Client Name]/
│       ├── Borrower 1/
│       ├── Borrower 2/
│       ├── Subject Property/
│       ├── Non-Subject Property/
│       ├── Down Payment/
│       └── Signed Docs/
├── Live Deals/
│   └── [Client Name]/
│       └── ...
└── Funded/
    └── [Client Name]/
        └── ...
```

### Proposed Changes
- Add `_Raw Uploads/` subfolder for original documents
- Auto-create budget spreadsheet template in each client folder
- Link folder to MyBrokerPro application (not just contact)
- Consider flattening Pre-Approval/Funded if MyBrokerPro search works well

### Repeat Clients
- Example: Sean Newby has 5-6 applications over multiple years
- Each new application gets current docs + references old folder
- Old docs archived but accessible for reference (commitment letters, penalties)

---

## Edge Cases Discussed

| Scenario | How to Handle |
|----------|---------------|
| Multiple images of same doc (NOA page 1, 2, 3) | Merge into single PDF |
| Docs uploaded to Finmo portal | Pull via Finmo API, process normally |
| Client fills out app twice | Rare (1/200). Accept duplicate email as acceptable glitch |
| Client marks "employed" but is self-employed | Not our error - they filled it wrong. Update checklist when discovered |
| Rental properties (up to 10 non-subjects) | Complex - lease agreement + property tax + mortgage statement × 10 |
| High net worth files | 12-month history across multiple investment accounts |
| Sensitive situations (widow, divorce) | Manual finesse required - can't automate emotional judgment |

---

## Future Features (Not Phase 1)

### Document Summarization
- Extract key data from documents (T4 income, years employed, etc.)
- Create summary notes for Taylor's underwriting
- Eventually auto-fill Finmo submission notes

> "If we could get it to summarize those documents, that would be awesome."

### Document Library
- Build landing pages on venturemortgages.com
- Examples of what each doc looks like (T4, NOA, paystub)
- Links in checklist email: "What is this? How to get it?"
- Escalating detail in reminder emails

### Automated Reminders
- Initial email: Just the list
- Follow-up emails: More detail on specific missing docs
- Progressive: "It's really easy to get your NOA, all you do is..."

### Submission Notes
- Finmo's auto-generated notes are "generic" and "wordy"
- Scotia underwriter specifically dislikes verbose notes
- Future: AI-generated notes in Taylor's style (context, not regurgitation)

---

## Finmo API Notes

**Webhooks available:**
- `Borrower application submitted` → Trigger for new app
- `Document request status changed` → When client uploads to Finmo

**API capabilities:**
- Download documents from application
- Get application data (all fields)

**Smart Docs:** Currently disabled. We're building our own classification.

---

## Action Items

| Owner | Action | Status |
|-------|--------|--------|
| Taylor | Create dev@venturemortgages.com | PENDING |
| Taylor | Invite dev@ to Google Drive | PENDING |
| Taylor | Invite dev@ to MyBrokerPro | PENDING |
| Taylor | Send Finmo test application link to Luca | PENDING |
| Luca | Create conditional checklist rules document | DONE |
| Taylor | Review/correct checklist rules | PENDING |
| Luca | Map Finmo API fields to checklist conditions | NEXT |
| Luca | Build email template with dynamic sections | NEXT |

---

## Quotes Worth Noting

On automation scope:
> "I don't need to be too ambitious. Let's automate the low hanging fruit."

On human-in-the-loop:
> "That's probably why brokers haven't been automated yet... each client's different. They need that little nuance."

On document collection friction:
> "People fill out the app, send the documents, and they're like 'oh that was a pain.' Then if they get feedback that the doc isn't correct, that's when frustration starts to boil over."

On Scotia underwriter:
> "She doesn't like this format... 'Why don't you just give me what I can't get from the application?'"

---

*Notes compiled: 2026-01-22*
