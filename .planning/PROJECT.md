# Venture Mortgages — Doc Collection Automation

## What This Is

An automation platform for Venture Mortgages (Taylor Atkinson's brokerage) that handles the end-to-end document collection workflow. When a client submits a Finmo mortgage application, the system generates a personalized document request, tracks incoming documents, files them to Google Drive, and follows up on missing items — replacing hours of manual work by assistant Cat.

## Core Value

When a Finmo application comes in, the right documents get requested, tracked, filed, and followed up on — with minimal human effort and zero missed items.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Auto-generate personalized doc checklist from Finmo application data
- [ ] Create draft task in MyBrokerPro (GoHighLevel) for Cat to review and send
- [ ] Send doc request email from admin@venturemortgages.com
- [ ] Monitor email (admin@) for incoming client documents
- [ ] Monitor Finmo uploads for incoming client documents
- [ ] Classify received documents by type (income, property, ID, etc.)
- [ ] Rename documents to consistent naming convention
- [ ] File documents to correct client folder in Google Drive
- [ ] Track checklist status (received/missing) per client in CRM
- [ ] Auto-follow-up reminders for missing documents (built but disabled by default)
- [ ] Kill switch for reminders (toggle on/off per client or globally)

### Out of Scope

- WhatsApp/text doc intake — clients use email and Finmo only for now
- Lender submission automation — downstream of doc collection, future phase
- Budget call scheduling — Taylor handles manually
- Ownwell integration — post-funding only, separate concern
- Building flows in GHL's visual builder — all automation is custom code via API

## Context

**Client team:**
- Taylor Atkinson — mortgage broker, handles client calls and underwriting decisions
- Cat — assistant, handles doc collection, filing, chasing, and fulfillment
- Cat is thorough and responsive; Taylor delegates doc ops to her entirely

**Current workflow (manual):**
1. Taylor sends client a Finmo application link
2. Client fills out Finmo application
3. Cat manually reviews application, builds personalized doc checklist
4. Cat emails client the doc request from admin@venturemortgages.com
5. Docs arrive by email or Finmo upload
6. Cat downloads, renames, converts to PDF, files to Google Drive
7. Cat tracks what's received vs missing in Google Docs lists
8. Cat chases missing docs by email

**Pain points:**
- Building the checklist is time-consuming and repetitive (rules are well-defined)
- Tracking received vs missing docs across clients is manual and error-prone
- Filing docs to Drive is tedious busywork
- Chasing missing docs requires remembering who owes what

**Existing assets:**
- DOC_CHECKLIST_RULES_V2.md — Cat-approved conditional doc rules for Canadian mortgages
- mortgage.ai project — PDF classification/analysis code (document type detection, email parsing) that may be reusable for doc filing
- Google Drive folder structure: "Mortgage Clients" → client folders → subfolders

**CRM:**
- MyBrokerPro (white-labeled GoHighLevel) — in transition/setup
- API V2 available (V1 is EOL)
- Custom fields, contacts, opportunities, workflows all accessible via API

**Mortgage platform:**
- Finmo (finmo.ca) — application intake
- API with bearer token auth
- Webhooks available: "Borrower application submitted", "Document request status changed"

**Access granted (all to dev@venturemortgages.com):**
- MyBrokerPro (GoHighLevel) admin access
- Google Drive editor access to "Mortgage Clients" folder
- Finmo access
- admin@venturemortgages.com email

## Constraints

- **Security**: Mortgage docs contain sensitive PII — no PII in logs, least-privilege access, audit trail
- **Human-in-the-loop**: Cat reviews all client-facing communications before they go out (draft-first)
- **Hosting**: Simple VPS (Railway or Render), ~$5-10/mo budget
- **Tech stack**: Custom code via APIs (not visual GHL workflow builder)
- **Email sender**: admin@venturemortgages.com for all automated communications
- **Compliance**: Canadian mortgage industry — documents must be handled securely
- **Budget**: Consulting engagement ~1hr/week, prioritize ROI
- **Reliability**: Must handle failures gracefully — retries, idempotency, dead-letter queue for manual review

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Custom code over n8n/Make | Client wants programmatic control, not visual builders | — Pending |
| GoHighLevel API over native workflows | Automation logic lives in our code, CRM is for task/contact management | — Pending |
| Draft-to-CRM over auto-send | Human-in-the-loop default, Cat reviews before sending | — Pending |
| Simple VPS over serverless | Multiple integrations benefit from persistent process, easier to debug | — Pending |
| Reminders built but disabled | Infrastructure ready, toggle on when team is comfortable | — Pending |
| Tech stack (Node/TS vs Python) | TBD — Node has GHL SDK, Python has better AI/PDF libs from mortgage.ai | — Pending |

---
*Last updated: 2026-02-09 after initialization*
