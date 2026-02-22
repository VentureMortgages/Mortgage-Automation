---
status: complete
phase: 11-drive-folder-linking-deal-subfolders
source: [11-01-SUMMARY.md, 11-02-SUMMARY.md, 11-03-SUMMARY.md]
started: 2026-02-22T01:10:00Z
updated: 2026-02-22T01:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Setup script creates Drive folder CRM fields
expected: Run `npx tsx src/crm/setup/create-custom-fields.ts --drive-fields` and it creates "Drive Folder ID" on contacts and "Deal Subfolder ID" on opportunities. Prints both field IDs in .env format.
result: pass

### 2. CRM fields visible in MyBrokerPro UI
expected: In MyBrokerPro, open a contact record. Under "Finmo Integration" field group, "Drive Folder ID" appears as a TEXT field. On an opportunity, "Deal Subfolder ID" appears.
result: pass

### 3. All unit tests pass
expected: Run `npx vitest run` and all 705 tests pass with zero failures.
result: pass

### 4. Webhook creates client folder and stores ID on contact
expected: When a Finmo application webhook fires, the webhook worker creates a client folder in Google Drive and stores the folder ID in the "Drive Folder ID" custom field on the CRM contact. Verify by checking the contact record in MyBrokerPro after a webhook fires.
result: pass

### 5. Deal subfolder created in Google Drive
expected: After the webhook fires, a deal-specific subfolder appears inside the client folder. Named by the deal reference from the opportunity name (e.g., "BRXM-F050382"). Visible in Google Drive under the client's folder.
result: pass

### 6. Deal subfolder ID stored on opportunity
expected: The deal subfolder's Drive folder ID is stored on the CRM opportunity's "Deal Subfolder ID" custom field. Verify by checking the opportunity record in MyBrokerPro.
result: pass

### 7. Reusable doc files to client folder
expected: When a reusable document (e.g., T4, pay stub, bank statement) is received and classified, it gets filed to the client folder level in Google Drive — not inside the deal subfolder. Shared across all deals for that client.
result: skipped
reason: Requires classification pipeline with Redis running (not available locally). Unit tests cover routing logic (7 test cases in classification-worker.test.ts).

### 8. Property-specific doc files to deal subfolder
expected: When a property-specific document (e.g., purchase agreement, MLS listing) is received and classified, it gets filed inside the deal subfolder. Separate from other deals for the same client.
result: skipped
reason: Requires classification pipeline with Redis running (not available locally). Unit tests cover routing logic (PROPERTY_SPECIFIC_TYPES routing verified in tests).

### 9. Fallback to root folder when no CRM folder ID
expected: For a client whose contact record does NOT have a Drive Folder ID set, documents still get filed — using the DRIVE_ROOT_FOLDER_ID fallback. No errors or manual review tasks created unnecessarily.
result: skipped
reason: Requires classification pipeline with Redis running. Unit test "CRM contact has no Drive folder ID — fallback to root" covers this path.

## Summary

total: 9
passed: 6
issues: 0
pending: 0
skipped: 3

## Gaps

[none yet]
