# External Integrations

**Analysis Date:** 2026-01-22

## APIs & External Services

**Email & Notifications:**
- Gmail API — Email monitoring and folder management for Cat's inbox
  - SDK/Client: Python `google-auth`, `google-api-python-client` or Node `googleapis`
  - Auth: Service account JSON key file
  - Purpose: Monitor for attachments, extract sender email, move unmatched emails to review folder, read/write access required

**CRM & Client Management:**
- MyBrokerPro (GoHighLevel) — Client records, email matching, doc checklist status, pipeline management
  - SDK/Client: GoHighLevel REST API
  - Auth: API key and custom integration token (OAuth2)
  - Purpose: Store client info, match incoming emails to clients, update doc checklist status, generate checklists
  - Env vars: `MYBROKER_PRO_API_KEY`, `MYBROKER_PRO_API_URL`

**Application Data:**
- Finmo API — Application submission data
  - SDK/Client: Finmo REST API (verify webhook support)
  - Auth: API key
  - Purpose: Pull client name, emails, application type, employment type, down payment source on submission
  - Trigger: Webhook on application submit OR polling
  - Env var: `FINMO_API_KEY`, `FINMO_WEBHOOK_SECRET`

**Document Processing & Classification:**
- Google Document AI — Document type classification and metadata extraction
  - SDK/Client: Python `google-cloud-documentai` or REST API
  - Auth: Service account with Document AI API access
  - Purpose: Classify document type (paystub, LOE, T4, bank statement, etc.), extract metadata for naming
  - Alternative: Claude API or GPT-4 Vision if Document AI unavailable
  - Env var: `DOCUMENT_AI_PROJECT_ID`

**Notifications:**
- Twilio SMS — Text notifications to Cat for unmatched emails
  - SDK/Client: Python `twilio` or Node `twilio`
  - Auth: Account SID and Auth Token
  - Purpose: Alert Cat when document arrives from unknown sender
  - Alternative: Slack, email, or MyBrokerPro in-app notifications
  - Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `NOTIFICATION_PHONE`

## Data Storage

**Databases:**
- Not applicable — Using third-party services for data

**File Storage:**
- Google Drive — Primary document storage
  - Connection: Service account with Editor role on "Mortgage Clients" folder
  - Client: Python `google-auth`, `googleapiclient.discovery` or Node `googleapis`
  - Folder structure: Mortgage Clients / [Client Name] / [Subfolders by doc type]
  - _Raw Uploads subfolder: Stores original files before processing (for auditability)
  - Env var: `GOOGLE_DRIVE_SERVICE_ACCOUNT` (JSON key file)

**Metadata Storage:**
- MyBrokerPro (CRM) — Client emails, doc checklist status, Drive folder links
- Google Docs (temporary) — Doc checklist tracking (to be replaced by CRM)

**Caching:**
- None — Real-time operations, no caching layer

## Authentication & Identity

**Auth Providers:**
- Google (Gmail, Drive, Document AI) — Service account authentication
  - Implementation: OAuth2 service account flow
  - Credentials: JSON key file stored in secure secrets manager
  - Scopes: `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/drive`

- MyBrokerPro/GoHighLevel — API key + OAuth2
  - Implementation: API key in Authorization header or OAuth2 bearer token
  - Credentials: Stored in secrets manager

- Finmo — API key
  - Implementation: API key in header or query parameter
  - Credentials: Stored in secrets manager

**No user authentication required** — Automation runs as service accounts with delegated authority

## Monitoring & Observability

**Error Tracking:**
- Not yet configured
- Recommendation: Sentry or cloud logging (Google Cloud Logging)
  - Capture failures in email matching, doc classification, API errors
  - Alert on repeated failures (e.g., Finmo API down)
  - Avoid logging PII or document contents

**Logs:**
- Orchestration platform logs (n8n, Make) — Task execution, API responses
- Google Cloud Audit Logs (Drive API access, Document AI usage)
- Custom application logs (metadata only: doc type, client name, filename, status)

**Metrics to Track:**
- Documents processed per day
- Email matching success rate
- Unmatched email volume
- API errors by service
- Processing time per document

## CI/CD & Deployment

**Hosting:**
- Cloud orchestration platform:
  - n8n (self-hosted on AWS/GCP/VPS) — Preferred for control and cost
  - Make/Integromat (cloud SaaS) — Simpler but less control
  - Zapier (cloud SaaS) — Simplest but least customizable

**CI Pipeline:**
- Not applicable for workflow automation
- Version control: Git for n8n workflows (JSON export)
- Staging environment: Test workflows against sandbox Gmail/Drive folders before production

**Deployment Process:**
- Export workflow JSON from development n8n instance
- Import into production n8n instance
- Test with sample emails before enabling auto-processing
- Kill switch: Pause workflow in orchestration platform

## Environment Configuration

**Required Environment Variables:**
```
GMAIL_SERVICE_ACCOUNT_JSON        # Google service account (JSON key file)
GOOGLE_DRIVE_SERVICE_ACCOUNT      # Can be same as Gmail
MYBROKER_PRO_API_KEY              # GoHighLevel API key
MYBROKER_PRO_API_URL              # e.g., https://api.gohighlevel.com/v1
FINMO_API_KEY                     # Finmo API credentials
FINMO_WEBHOOK_SECRET              # For HMAC verification
DOCUMENT_AI_PROJECT_ID            # Google Cloud project ID
GOOGLE_CLOUD_PROJECT              # GCP project for Document AI
TWILIO_ACCOUNT_SID                # Twilio SMS service
TWILIO_AUTH_TOKEN                 # Twilio auth
NOTIFICATION_PHONE                # Cat's phone number for SMS
DRIVE_FOLDER_ID                   # Root "Mortgage Clients" folder ID
UNMATCHED_EMAIL_LABEL             # Gmail folder label for unmatched emails
ENVIRONMENT                       # dev / staging / prod
```

**Secrets Location:**
- Google Cloud Secret Manager (preferred if self-hosted n8n on GCP)
- n8n Vault (if using n8n SaaS or self-hosted)
- Environment variables (acceptable for orchestration platform SaaS)
- Never commit credentials to git

**Sensitive Configs:**
- Service account JSON keys — Use Secret Manager, rotate quarterly
- API keys — Use Secret Manager, rotate if compromised
- Webhook secrets — Use for HMAC verification, store securely
- Never log API keys, client PII, or document contents

## Webhooks & Callbacks

**Incoming Webhooks:**
- Finmo application submission webhook
  - Endpoint: `https://[orchestration-platform]/webhook/finmo-app-submit`
  - Method: POST
  - Payload: Application data (client name, email, app type, employment)
  - Signature: HMAC-SHA256 verification required
  - Purpose: Trigger client creation and Drive folder setup

**Outgoing Webhooks:**
- None currently planned
- Future: Post status to Taylor's inbox or dashboard

**Email Triggers (Push vs Poll):**
- Gmail API supports push notifications via Cloud Pub/Sub
- Alternative: Poll Gmail API every 5-10 minutes (cheaper, slower)
- Recommendation: Start with polling, upgrade to push if latency becomes issue

## Data Flow

**Application Submission Flow:**
```
Finmo submit → Webhook/Email → Pull app data via Finmo API
→ Create MyBrokerPro record → Create Drive folder + subfolders
→ Generate doc checklist → Ready for doc collection
```

**Document Receipt Flow:**
```
Email w/ attachment → Gmail API detects → Extract sender email
→ Query MyBrokerPro for client match → If match: Download → Save raw copy → Classify → Rename → Upload to subfolder → Update checklist
→ If no match: Move to Unmatched folder → SMS to Cat → Cat matches manually
```

**Edge Cases:**
- Spouse/partner email not in CRM → Unmatched queue → Cat adds secondary email to CRM
- AI can't classify document → Save to "Review" subfolder → Cat classifies manually
- Multi-page document as separate images → Combine into single PDF OR save separately with relation tag
- Finmo API down → Queue in Dead Letter folder → Retry with exponential backoff

## Integration Readiness

**Status:**
| Integration | Readiness | Blocker | Notes |
|------------|-----------|---------|-------|
| Gmail API | Ready | None | Service account needed |
| Google Drive API | Ready | None | Service account needed |
| MyBrokerPro API | In Setup | API credentials | Requires GoHighLevel account configuration |
| Finmo API | Pending | API access | Need to verify webhook support |
| Document AI | Ready | GCP project | Need to enable API and create processor |
| Twilio SMS | Optional | Twilio account | Alternative: email or CRM notifications |

**Access Checklist (Outstanding):**
- [ ] Dev email account created (dev@venturemortgages.com)
- [ ] Google Drive invite for "Mortgage Clients" folder
- [ ] Google Cloud Project created for service accounts
- [ ] MyBrokerPro API credentials (API key + custom fields config)
- [ ] Finmo API access + webhook configuration
- [ ] Document AI processor configured in GCP
- [ ] Twilio account (if using SMS notifications)
- [ ] Gmail "Unmatched - Review" folder created and shared

---

*Integration audit: 2026-01-22*
