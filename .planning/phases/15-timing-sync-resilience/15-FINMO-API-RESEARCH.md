# Finmo API Research: External System Sync Endpoint

**Date:** 2026-03-02
**Requirement:** SYNC-03
**Verdict:** NO -- No sync-trigger endpoint exists

## Summary

Finmo's REST API does not expose any endpoint to trigger a CRM/external-system sync on demand. All 29 probed endpoints (across v1 and v2 namespaces) returned HTTP 404. The API surface is limited to application data retrieval and document management. The retry mechanism implemented in Phase 15-01 is confirmed as the correct fallback for handling the MBP timing gap.

## Endpoints Tested

| # | Method | Endpoint | Status | Verdict |
|---|--------|----------|--------|---------|
| 1 | GET | `/api/v1/` | 404 | not found |
| 2 | GET | `/api/v2/` | 404 | not found |
| 3 | GET | `/api/v1/integrations` | 404 | not found |
| 4 | GET | `/api/v1/external-systems` | 404 | not found |
| 5 | GET | `/api/v1/connectors` | 404 | not found |
| 6 | GET | `/api/v1/applications/{id}/sync` | 404 | not found |
| 7 | POST | `/api/v1/applications/{id}/sync` | 404 | not found |
| 8 | GET | `/api/v1/applications/{id}/external-sync` | 404 | not found |
| 9 | POST | `/api/v1/applications/{id}/external-sync` | 404 | not found |
| 10 | POST | `/api/v1/applications/{id}/trigger-sync` | 404 | not found |
| 11 | GET | `/api/v1/applications/{id}/integrations` | 404 | not found |
| 12 | GET | `/api/v1/applications/{id}/events` | 404 | not found |
| 13 | GET | `/api/v1/applications/{id}/actions` | 404 | not found |
| 14 | GET | `/api/v1/applications/{id}/status` | 404 | not found |
| 15 | GET | `/api/v1/webhooks` | 404 | not found |
| 16 | GET | `/api/v1/resthooks` | 404 | not found |
| 17 | GET | `/api/v1/resthooks/subscriptions` | 404 | not found |
| 18 | GET | `/api/v1/settings` | 404 | not found |
| 19 | GET | `/api/v1/team` | 404 | not found |
| 20 | GET | `/api/v1/team/settings` | 404 | not found |
| 21 | GET | `/api/v1/team/integrations` | 404 | not found |
| 22 | GET | `/api/v1/crm` | 404 | not found |
| 23 | GET | `/api/v1/crm/sync` | 404 | not found |
| 24 | GET | `/api/v1/pipeline` | 404 | not found |
| 25 | GET | `/api/v1/pipeline/sync` | 404 | not found |
| 26 | GET | `/api/v2/integrations` | 404 | not found |
| 27 | GET | `/api/v2/applications/{id}/sync` | 404 | not found |
| 28 | GET | `/api/v2/webhooks` | 404 | not found |
| 29 | GET | `/api/v2/resthooks` | 404 | not found |

## Findings

1. **API surface is narrow.** Only the previously-known endpoints work: `/applications/{id}`, `/document-requests`, `/documents/application-document`. The API is designed for application data retrieval and document management, not integration orchestration.

2. **No v2 API exists.** All `/api/v2/` paths return 404, indicating Finmo has not released a newer API version.

3. **No auth-blocked endpoints.** Zero 401/403 responses -- the endpoints genuinely do not exist (vs being permission-restricted).

4. **No API discovery document.** The API root (`/api/v1/`) returns 404, meaning there is no OpenAPI spec or endpoint listing available.

5. **CRM sync is server-side only.** The Finmo-to-MBP sync (which creates the opportunity) is handled internally by Finmo's backend, triggered by application submission. There is no external API to trigger or expedite this process.

## Viable Endpoint?

**NO.**

No endpoint exists to trigger MBP sync on demand. The sync between Finmo and MyBrokerPro (GoHighLevel) is an internal Finmo server-side process with no external API surface.

## Recommendation

1. **Close SYNC-03 as "researched, retry mechanism sufficient."** The Phase 15-01 retry mechanism (exponential backoff, 5 attempts over ~4 minutes) correctly handles the timing gap.

2. **No further API work needed.** The Finmo API is a data-access API, not an integration management API.

3. **If the timing gap becomes a bigger problem in the future,** the options are:
   - Request a feature from Finmo (sync-trigger API or faster webhook delivery)
   - Create the MBP contact/opportunity ourselves via GHL API (bypassing Finmo's sync entirely)
   - Both are out of scope for the current phase

## Test Script

The exploration was performed using `scripts/explore-finmo-api.ts`. The script:
- Probes 29 endpoints systematically
- Uses Bearer token auth matching the production config pattern
- Logs only endpoint metadata (no PII)
- Can be re-run if Finmo updates their API in the future
