# Needs from Taylor & Cat

**Last Updated:** 2026-02-09

---

## Action Items (Things We Need)

| # | Request | Owner | Status | Notes |
|---|---------|-------|--------|-------|
| 1 | Create dev@venturemortgages.com | Taylor | **DONE** | Created, credentials received |
| 2 | Google Drive invite | Taylor | **DONE** | Editor access granted |
| 3 | MyBrokerPro access | Taylor | **DONE** | Login shared (Taylor@VentureMortgages.com). **ACTION: Change password after first login.** |
| 4 | Finmo access | Taylor | **DONE** | Access granted |
| 5 | Review DOC_CHECKLIST_RULES | Cat | **DONE** | Cat reviewed, annotated PDF returned. V2 created with corrections. |
| 6 | Reply to Cat re: PRE/FULL question | Luca | **TODO** | See draft below |

---

## Cat's Open Question (Needs Response)

**Cat asked:** "Are the PRE/FULL notations for internal use to check if we at least have all the PRE docs, or will different lists be sent out based on whether it is a pre-approval or not?"

**Proposed answer:** The initial email will request ALL docs (full list). PRE/FULL is internal only — used to:
1. Track when enough docs are in for pre-approval
2. Prioritize follow-up reminders (chase PRE docs first)
3. Notify Taylor when pre-approval-ready

---

## Questions — ANSWERED

| # | Question | Answer |
|---|----------|--------|
| 1 | Client folder creation timing | Auto-create folder when Finmo app submitted |
| 2 | Finmo doc retrieval | Pull via API, process same as email |
| 3 | Doc tracking location | MyBrokerPro (not Google Docs) |
| 4 | Finmo API available? | YES — REST API + webhooks |
| 5 | Repeat clients | Each app gets own folder, old archived |
| 6 | Multi-page docs | Merge into single PDF, store originals in _Raw |
| 7 | PRE vs FULL in checklist | Cat added tags. All requested upfront; PRE/FULL for internal tracking |

---

## Questions — Still Pending

| # | Question | Status |
|---|----------|--------|
| 1 | MyBrokerPro: How to structure custom fields for doc checklist? | Explore now that we have access |
| 2 | Budget spreadsheet template location | Need link/path from Taylor |
| 3 | Cat's preferred email signature for auto-drafts | Need example |

---

## First Automation Scope (Confirmed)

**Trigger:** Finmo application submitted (webhook)

**Process:**
1. Pull application data via Finmo API
2. Find or create client in MyBrokerPro
3. Create Google Drive folder (if new client)
4. Generate document checklist based on application fields + V2 rules
5. Auto-draft email to client with personalized checklist
6. **First month:** Cat reviews drafts before sending
7. **After validation:** Auto-send enabled

**Email sent from:** CRM (MyBrokerPro) — appears from Cat's email

---

## Access Checklist

| System | Status | Notes |
|--------|--------|-------|
| dev@venturemortgages.com | **DONE** | Created |
| Google Drive | **DONE** | Editor access to Mortgage Clients |
| MyBrokerPro | **DONE** | Login shared. Change password ASAP. |
| Finmo | **DONE** | Access granted |
| Gmail (Cat's inbox) | NOT STARTED | Phase 2 — email-to-Drive automation |

---

## Checklist Rules Status

| Version | File | Status |
|---------|------|--------|
| V1 (original) | DOC_CHECKLIST_RULES.md | Superseded |
| V1 CSV | DOC_CHECKLIST_RULES.csv | Superseded |
| **V2 (Cat-reviewed)** | **DOC_CHECKLIST_RULES_V2.md** | **CURRENT — Ready for build** |

---

*Updated 2026-02-09 with Taylor/Cat responses*
