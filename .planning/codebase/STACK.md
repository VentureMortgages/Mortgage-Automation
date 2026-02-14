# Technology Stack

**Analysis Date:** 2026-01-22

## Languages

**Primary:**
- Not applicable — this is a workflow automation + integration project, not traditional software development

**Secondary:**
- Python (planned) — For document processing, AI classification, orchestration scripts
- Node.js/JavaScript (planned) — For webhooks and Google Apps Script integrations
- Google Apps Script (GAS) — For Gmail automation and Google Drive interaction

## Runtime

**Environment:**
- Cloud-based integrations (no on-premise infrastructure)
- Email processing via Gmail API
- Document storage via Google Drive API
- CRM operations via GoHighLevel/MyBrokerPro API

**Package Manager:**
- Not yet determined — depends on final orchestration platform choice

## Frameworks

**Core:**
- None (integration-focused, not application development)

**Automation/Orchestration (TBD):**
- n8n (self-hosted option) — Open-source workflow automation platform
- Make/Integromat (cloud option) — Commercial workflow automation
- Zapier (cloud option) — Pre-built integrations, limited customization
- Custom Python/Node scripts (if lightweight enough)

**AI/Document Processing:**
- Google Document AI (preferred) — For document classification and metadata extraction
- Claude API (alternative) — For document analysis and metadata extraction
- GPT-4 Vision (alternative) — For document classification

**PDF Processing:**
- img2pdf (Python library) — Convert images to PDF format
- Google Drive native conversion — Built-in PDF conversion via Drive API

## Key Dependencies

**Critical:**
- Gmail API — Email monitoring and folder management
  - Service account or OAuth2 token required
  - Must have read/write access to Cat's inbox

- Google Drive API — Folder creation and file upload
  - Credentials: Service account with Drive Editor role
  - Batch operations capability required

- MyBrokerPro API (GoHighLevel) — CRM client matching and checklist updates
  - REST API with OAuth2
  - Custom fields and pipeline management required

- Finmo API — Application data retrieval on submission
  - Webhook or polling for new applications
  - Client info, application type, employment details

**Infrastructure:**
- Google Workspace (Gmail, Drive, Docs) — Already in use
- MyBrokerPro (GoHighLevel) — In transition/setup
- Finmo — Application platform (active)
- Ownwell — Post-funding automation (no integration needed yet)

## Configuration

**Environment:**
- Automation requires service accounts and API keys:
  - Google Service Account (JSON key file for Drive/Gmail)
  - MyBrokerPro API credentials
  - Finmo API credentials
  - Document AI API key (if using Google AI)

**Environment Variables Required:**
```
GMAIL_SERVICE_ACCOUNT_JSON     # Service account for Gmail API
GOOGLE_DRIVE_SERVICE_ACCOUNT   # Service account for Drive API
MYBROKER_PRO_API_KEY           # CRM API credentials
MYBROKER_PRO_API_URL           # GoHighLevel API endpoint
FINMO_API_KEY                  # Finmo API key
FINMO_WEBHOOK_SECRET           # For secure webhook handling
DOCUMENT_AI_PROJECT_ID         # Google Document AI project
NOTIFICATION_PHONE             # Cat's phone for SMS alerts (Twilio)
TWILIO_ACCOUNT_SID             # Twilio SMS service
TWILIO_AUTH_TOKEN              # Twilio credentials
```

**Build:**
- No traditional build process
- Deployment via orchestration platform (n8n, Make) or container (Docker for custom scripts)
- Configuration stored in secure secrets manager (Google Cloud Secret Manager or orchestration platform's vault)

## Platform Requirements

**Development:**
- API access to: Gmail, Google Drive, MyBrokerPro, Finmo
- Service accounts created and configured with least-privilege access
- Test Gmail inbox and test Drive folder for development/staging
- Document AI project enabled (if using Google Document AI)

**Production:**
- Cloud orchestration platform (n8n self-hosted, Make, or Zapier)
- Google Workspace (already in use)
- MyBrokerPro CRM (in setup)
- Notification service for Cat (SMS via Twilio or in-app notifications)
- Document processing service (Google Document AI or Claude API access)

## Deployment Model

**Trigger Points:**
1. Finmo webhook notification when application submitted
2. Gmail polling/push notification for incoming attachments
3. Manual triggers for re-processing unmatched emails

**State Management:**
- CRM (MyBrokerPro) is source of truth for client records
- Google Drive is source of truth for document storage
- _Raw Uploads folder preserves original files (reversible operations)
- Unmatched emails held in Gmail "Unmatched - Review" folder for manual review

## Security Posture

**Authentication:**
- Service accounts with scoped permissions (not user credentials)
- OAuth2 for third-party integrations
- Webhook signatures validated for Finmo callbacks

**Data Handling:**
- No client PII stored in automation logs (metadata only)
- No document contents in logs (filename, doc type, date only)
- Raw files preserved in _Raw Uploads for audit trail
- All operations reversible; human review queue for edge cases

**Compliance:**
- Mortgage documents contain sensitive information (PII, financial data)
- Audit trail required: who processed document, when, classification result
- Manual review queue (Unmatched folder) for uncertain matches
- Kill switch: disable automation, revert to manual process

---

*Stack analysis: 2026-01-22*
