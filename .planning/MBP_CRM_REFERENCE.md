# MyBrokerPro (GoHighLevel) CRM Reference

**Last Updated:** 2026-02-13
**Location ID:** bzzWH2mLpCr7HHulO3bW
**Total Contacts:** 551
**Total Custom Fields:** 209

---

## Executive Summary

MyBrokerPro is a white-labeled GoHighLevel CRM instance with extensive mortgage-specific customizations. The system has:

- **10 pipelines** (4 core mortgage workflows, 6 marketing/operational)
- **209 custom fields** organized into 6 logical groups
- **Existing Finmo integration** (contacts synced with source: "finmo")
- **Complex multi-property tracking** (up to 6 properties per contact)
- **Multi-mortgage tracking** (up to 6 mortgages per property, 3 mortgages per mortgage entity)

**Key Finding:** The CRM is heavily configured for post-deal tracking (renewal dates, commission tracking) but has minimal fields for **document collection workflow**. This is a gap we can fill.

---

## Pipeline Overview

### Core Mortgage Pipelines (Priority for Automation)

#### 1. **Finmo - Leads** (id: FK2LWevdQrcfHLHfjpDa)
**Purpose:** Lead management from initial contact through application
**13 Stages:**
- New
- Attempting To Contact
- Pending Meeting
- Meeting Complete
- On Hold
- **Application Link Sent** ⭐ (automation trigger point)
- Application In Progress
- **Application Received** ⭐ (our Phase 1 automation starts here)
- Unqualified
- Unresponsive
- No Longer Needs Services
- Junk
- Archived

**Relevance:** HIGH - This is where our doc collection automation will integrate.

---

#### 2. **Finmo - Live Deals** (id: tkBeD1nIfgNphnh1oyDW)
**Purpose:** Active deal management from docs to funding
**23 Stages:**
- In Progress
- **Collecting Documents** ⭐ (Cat's primary pain point)
- **All Docs Received** ⭐ (automation goal)
- In Underwriting
- Application Reviewed
- On Hold
- Verbal Pre-Approval
- Submitted To Lender
- Pre-Approved / Rate Hold
- Approved
- Declined
- Signing Package Sent
- Client Accepted
- Broker Complete
- Closing Soon
- Funded
- Compliance Sent
- File Compliant
- Paid
- Bonus
- Trailers
- Cancelled
- Archived

**Key IDs for Phase 4 Automation:**
- Stage: "Collecting Documents" (we need to fetch this ID via API)
- Stage: "All Docs Received" (we need to fetch this ID via API)

**Relevance:** CRITICAL - This pipeline needs doc status tracking fields added.

---

#### 3. **Finmo - Post Closing** (id: CocvSTjIHu0Wil36sbR3)
**Purpose:** Renewal tracking and client retention
**10 Stages:** Closed, 1-5+ Years Post Closing, Maturing Within 1 Year/6 Months/120 Days, Archived

**Relevance:** LOW (for Phase 1-4) - Renewal automation is Phase 7+

---

#### 4. **Imported - Post Closing** (id: 6O5V50y5CioiDvoCNeZt)
**Purpose:** Legacy data import (duplicate structure)
**Relevance:** IGNORE - Duplicate of Finmo Post Closing

---

### Marketing/Operational Pipelines (Low Priority)

#### 5. **Appointments** (id: mwncuCpRBimw5jI2PWhk)
8 stages: Confirmed, Cancelled, Replied, No Reply, No Show, Showed, Inactive, Email Drip
**Relevance:** LOW - Marketing/scheduling only

#### 6. **Leads Source Origin** (id: vIoYb9ZUqxdKIvZufTZg)
17 stages tracking lead sources (Builders, Facebook, Finmo, Realtors, etc.)
**Relevance:** LOW - Attribution tracking only

#### 7. **Lenders** (id: nJECjuWeMdiFQLJ3fwOx)
27 stages (one per lender): Alterna, B2B, BMO, CMLS, etc.
**Relevance:** MEDIUM (Phase 6+) - For lender-specific condition tracking

#### 8. **Open House - Contacts** (id: 8DGl2FBd4bsCQ2xgavkE)
11 stages: Intro, Attempt stages, Engaged, Appointment, etc.
**Relevance:** LOW - Marketing funnel

#### 9. **SMS Campaign** (id: cP3BlyFKNS2u0nQ8lp8b)
5 stages: SMS Sent, Engaged, Opted In, Stop, Unresponsive
**Relevance:** LOW - Marketing only

#### 10. **Webinars - Pipeline Status** (id: x0X2U5Qd8FvRyrBlRT39)
5 stages: Registered, Cancelled, Attended, No Show, Replay
**Relevance:** LOW - Marketing only

#### 11. **Webinars - Registrations** (id: YqrZhsrcOhyLSkJmh6k0)
6 stages: First-Time Home Buyers, Self-Employed, etc.
**Relevance:** LOW - Marketing segmentation

---

## Custom Fields Inventory (209 fields)

### Group 1: Finmo Integration (parentId: jlGAdTgblv5q2cWiw2Qc)
**Purpose:** Finmo sync and deal tracking

| Field ID | Field Name | Data Type | Notes |
|----------|------------|-----------|-------|
| YoBlMiUV8N3MrvUYoxH0 | Finmo Deal ID | TEXT | Primary Finmo identifier |
| FmesbQomeEwegqIyAst4 | Finmo Application ID | TEXT | Application-level ID |
| NhJ3BGgSZcEtyccuYkOB | Finmo Deal Link | TEXT | URL to Finmo deal |
| aN2c8puC6rOQrz83t1h3 | Finmo Application Link Sent | TEXT | Timestamp/boolean |
| MA0sOGAUq6kJLvkfhgmJ | Active Deal | TEXT | Live deal flag |
| no18IIHr4smgHvfpkMHm | Transaction Type | TEXT | Purchase/Refinance/etc |
| eaUvUOarxTpd6KRBrOsN | Lender | TEXT | Selected lender |
| JZdgo6e5kYorFubnSMzI | Closing Date | DATE | Expected close |
| weCZiasWmjtZUuVpjmyp | Maturity Date | DATE | Mortgage maturity |
| UJn1n5anNA8huojuGPqK | Credit Bureau Pull Date | DATE | Credit check date |
| lvaeVxpFKRKNjs0xpv7g | Credit Score | NUMERICAL | Primary borrower score |
| 8Y8EQ8SrylFPzNxy0I35 | Booking Status | SINGLE_OPTIONS | Showed/No-Show |
| jv8n4RGZpbPKsGkMiwsx | Google Review Survey Form | CHECKBOX | 1-5 star rating |

**Automation Relevance:** HIGH
- `Finmo Deal ID` is the primary key for linking Finmo → MyBrokerPro
- We can use `Closing Date` to prioritize urgent deals
- **GAP:** No "Document Status" or "Missing Docs List" field exists

---

### Group 2: Borrower Contact Info (parentId: IyE6GOpbhXXr62PUuaWG)
**Purpose:** Primary borrower personal details

| Field ID | Field Name | Data Type | Notes |
|----------|------------|-----------|-------|
| idaQAndMhoBJdn8cwgNR | Primary Borrower Phone | PHONE | Primary contact |
| QTYMla6yuW6gt6LLq6cS | Mailing Address | TEXT | Physical address |
| kSiszl49np7VX55XG1Vk | Marital Status | TEXT | Single/Married/etc |
| yOqSzyMsJbMIJ6v9yXC4 | Referral Source | MULTIPLE_OPTIONS | 18 options incl. Finmo |
| bie1qSbJqaLVlmuz5RqL | Contact Follower | MULTIPLE_OPTIONS | Team member assignment |

**Automation Relevance:** MEDIUM
- Phone number may be useful for SMS reminders (Phase 5+)
- Referral source confirms Finmo integration works

---

### Group 3: Deal/Transaction Details (parentId: lX3gh9E3KsmW6TVDByFR)
**Purpose:** High-level deal info (overlaps with Finmo group)

| Field ID | Field Name | Data Type | Notes |
|----------|------------|-----------|-------|
| J5WVfpGQh4NkOtaVaonK | Purchase Price | NUMERICAL | Property value |
| 3ZkJrJPRauhhmlBMNE1Q | Mortgage Amount | MONETORY | Loan amount |
| WJMuSFXYEE6FMv0Pcaap | Select your renewal date | DATE | Client-entered renewal |
| SsnFnFZp1RDAv5J4Lpii | Province 2 | SINGLE_OPTIONS | BC/etc (unclear why "2") |
| TyYAVeA1gGNwf3AhzdbK | Consent signature | SIGNATURE | Digital signature field |
| 2TO98WWhLBFHwZarsTqg | Feedback | TEXT | Client feedback |

**Automation Relevance:** LOW
- These are mostly captured by Finmo already

---

### Group 4: Commission Tracking (parentId: XJIbQbYjZVRMSLY5BdIw)
**Purpose:** Broker compensation calculations

| Field ID | Field Name | Data Type | Notes |
|----------|------------|-----------|-------|
| ZTklL574dd0g15eNAJJD | BPS | NUMERICAL | Basis points |
| 4s9njb5ID0hro4EpOkr7 | VB BPS | NUMERICAL | Volume bonus BPS |
| Gvacn0C0M5L9mGMZ0aah | BuyDown in BPS | NUMERICAL | Rate buydown |
| iuY3i06Xq7uTgj9wAx4r | Total BPS | NUMERICAL | Calculated total |
| hf9vcZyPPL6M4SPPty2U | Broker Fee | NUMERICAL | Flat fee amount |
| oAU7jU1HvKYqeoUqiAQf | Total Commission | MONETORY | Final payout |

**Automation Relevance:** NONE
- This is Taylor's post-deal financial tracking, not relevant to doc collection

---

### Group 5: Property Details (parentId: sDh36HFRzi4Hs5I06LXZ)
**Purpose:** Multi-property tracking (up to 6 properties)

**Pattern:** Each property has 4 fields:
- Property [1-6] Address (TEXT)
- Property [1-6] Occupancy (TEXT)
- Property [1-6] Estimated Value (MONETORY)
- Property [1-6] Owner(s) (TEXT)

**Sample IDs (Property 1):**
- Rq2T0f7hHwA7B6aODPlu | Property Address
- m0Ux7bChTnweHIeTGX6w | Occupancy
- M4WbAs9wL73PWvfTRTgQ | Estimated Value
- jMo5INWgvzOSipeE7VON | Property Owner(s)

**Total Fields:** 24 (6 properties × 4 fields)

**Automation Relevance:** MEDIUM
- Property address may help organize Drive folders (Phase 3)
- Occupancy (owner-occupied vs rental) affects doc requirements

---

### Group 6: Mortgage Details (parentId: 1QBFs9DqRD4Dkq312Jsn)
**Purpose:** Hyper-detailed mortgage tracking (renewal dates, rates, etc.)

**Pattern:** Complex nested structure:
- 6 "Mortgage" entities (labeled 1-6)
- Each mortgage has 3 sub-mortgages (1st/2nd/3rd)
- Each sub-mortgage tracks 9 attributes

**Attributes per sub-mortgage:**
1. Lender (TEXT)
2. Rate (TEXT)
3. Rate Type (TEXT) - Fixed/Variable
4. Term (TEXT) - e.g., "5 year"
5. Payment (MONETORY)
6. Payment Frequency (TEXT)
7. Renewal Date (DATE)
8. [Property Address appears within mortgage fields too]

**Example IDs (Mortgage 1, 1st Mortgage):**
- TfcoeLz1xGSb8VRXhYw1 | Property Address (mortgage_1_address)
- niu43uHBKDUQ5Ht9c08n | 1st Mortgage Lender (mortgage_11_lender)
- rHPSpwYydgwdI0qpZ14R | 1st Mortgage Rate (mortgage_11_rate)
- jaBjcwXjjCZyaJmpUjJT | 1st Mortgage Rate Type (mortgage_11_rate_type)
- JZRZ2KkiyHKFOIl4zlrB | 1st Mortgage Term (mortgage_11_term)
- fMzBmm6CfFAv29Gn0eLe | 1st Mortgage Payment (mortgage_11_payment)
- Tyx64RfSOvJ1KBVowtzS | 1st Mortgage Payment Frequency (mortgage_11_payment_frequency)
- HL0qS5is8K2WBLhyndkQ | 1st Mortgage Renewal Date (mortgage_11_renewal_date)

**Total Fields:** 162+ (vast majority of custom fields)

**Automation Relevance:** LOW (for Phase 1-4)
- These fields are for **post-funding renewal tracking**, not doc collection
- Useful in Phase 7+ for renewal reminders
- **Key Insight:** Taylor is clearly focused on long-term client retention via renewal tracking

---

### Group 7: Ungrouped / Test Fields (parentId: OqBVHwQGXkEKe65WdLng)
**Purpose:** Sample/test fields (likely unused)

| Field ID | Field Name | Data Type | Notes |
|----------|------------|-----------|-------|
| R5gzTuNY2CVnPNVpfTMC | Single Dropdown 540f | SINGLE_OPTIONS | Test field (Option 1/2/3) |

**Automation Relevance:** NONE

---

## Existing Finmo Integration Analysis

### Evidence of Active Sync

From sample contact data:
```json
{
  "source": "finmo",
  "customFields": {
    "contact.dealid": "[populated]",
    "contact.finmo_application_id": "[populated]",
    "contact.finmo_deal_link": "[populated]"
  }
}
```

### Integration Architecture (Hypothesis)

**Current State:**
1. Finmo application submitted → webhook fires
2. GoHighLevel creates/updates contact with:
   - `source: "finmo"`
   - Custom field: `Finmo Deal ID` (fieldKey: contact.dealid)
   - Custom field: `Finmo Application ID`
   - Custom field: `Finmo Deal Link`
3. Contact moves through "Finmo - Leads" pipeline
4. Stage moves to "Application Received"

**What's NOT synced (as far as we can tell):**
- Document submission status from Finmo
- Application field values (income, property details, etc.)

**Implication for Our Automation:**
- We need to query Finmo API separately to get application data
- MyBrokerPro contact record has Finmo IDs as foreign keys
- Can't rely on MyBrokerPro alone for doc checklist generation

---

## Critical Gaps for Document Collection Automation

### Missing Custom Fields (Recommended to Add)

| Proposed Field Name | Data Type | Parent Group | Purpose |
|---------------------|-----------|--------------|---------|
| **Doc Collection Status** | SINGLE_OPTIONS | Finmo Integration | "Not Started", "In Progress", "Partial", "Complete" |
| **Missing Docs (JSON)** | LONG_TEXT | Finmo Integration | JSON array of missing doc types |
| **Doc Request Email Sent** | DATE | Finmo Integration | Timestamp of initial email |
| **Last Doc Received Date** | DATE | Finmo Integration | Most recent upload |
| **Doc Collection Notes** | LONG_TEXT | Finmo Integration | Cat's internal notes |
| **Application Type** | SINGLE_OPTIONS | Finmo Integration | "Purchase", "Refinance", "Pre-Approval" |
| **Income Type** | SINGLE_OPTIONS | Finmo Integration | "Employed", "Self-Employed", "Rental", etc. |
| **Down Payment Source** | MULTIPLE_OPTIONS | Finmo Integration | "Savings", "Gift", "Sale of Property", etc. |

**Phase 2 Action Item:** Create API calls to add these custom fields to MyBrokerPro

---

## Key IDs for Automation

### Must-Have IDs (Already Captured)

| Entity | Name | ID |
|--------|------|-----|
| Location | Venture Mortgages | bzzWH2mLpCr7HHulO3bW |
| Pipeline | Finmo - Leads | FK2LWevdQrcfHLHfjpDa |
| Pipeline | Finmo - Live Deals | tkBeD1nIfgNphnh1oyDW |
| Custom Field | Finmo Deal ID | YoBlMiUV8N3MrvUYoxH0 |
| Custom Field | Finmo Application ID | FmesbQomeEwegqIyAst4 |
| Custom Field | Finmo Deal Link | NhJ3BGgSZcEtyccuYkOB |
| Custom Field | Closing Date | JZdgo6e5kYorFubnSMzI |
| Custom Field | Transaction Type | no18IIHr4smgHvfpkMHm |
| Custom Field Group | Finmo Integration | jlGAdTgblv5q2cWiw2Qc |

### Need to Fetch (Phase 2 Task)

| Entity | Name | How to Fetch |
|--------|------|--------------|
| Stage ID | "Application Received" (Finmo - Leads) | GET /locations/{locationId}/pipelines/{pipelineId}/stages |
| Stage ID | "Collecting Documents" (Live Deals) | GET /locations/{locationId}/pipelines/{pipelineId}/stages |
| Stage ID | "All Docs Received" (Live Deals) | GET /locations/{locationId}/pipelines/{pipelineId}/stages |
| User ID | Cat (assigned user) | GET /users or /locations/{locationId}/users |
| User ID | Taylor (assigned user) | GET /users or /locations/{locationId}/users |

---

## Recommendations by Phase

### Phase 1: Email Automation (Current - No CRM)
**Status:** In progress, using Finmo API only
**CRM Interaction:** NONE
**Rationale:** Keep it simple, validate doc checklist logic first

---

### Phase 2: CRM Exploration (Next)
**Goal:** Understand full CRM schema and add missing fields

**Tasks:**
1. **Fetch stage IDs** for "Application Received", "Collecting Documents", "All Docs Received"
2. **Fetch user IDs** for Taylor and Cat (for assignment automation)
3. **Create 8 new custom fields** (see "Missing Custom Fields" table above)
4. **Test custom field updates** via API (create a test contact, update fields)
5. **Document webhook structure** (if GoHighLevel → external webhook is needed)

**Deliverables:**
- Updated MBP_CRM_REFERENCE.md with stage/user IDs
- API test script (Node.js or Python) showing CRUD operations on custom fields
- Decision: Do we add fields via API or via MyBrokerPro UI?

---

### Phase 3: Drive Integration
**CRM Interaction:** Read-only
**Use Case:** When creating Drive folder, pull `Property 1 Address` from MyBrokerPro to name folder

**Example API Call:**
```javascript
GET /contacts/{contactId}
// Extract: customFields["contact.property_1_address"]
// Use to create folder: "123 Main St - [Client Name]"
```

**Risk:** LOW (read-only, optional enhancement)

---

### Phase 4: CRM Integration (Major Phase)
**Goal:** Make MyBrokerPro the "source of truth" for doc collection status

**Architecture:**
1. **Trigger:** Finmo webhook → our service
2. **Lookup:** Find/create MyBrokerPro contact by `Finmo Deal ID`
3. **Update:** Set custom fields:
   - `Doc Collection Status` = "In Progress"
   - `Missing Docs (JSON)` = JSON.stringify(missingDocsList)
   - `Doc Request Email Sent` = new Date()
4. **Move stage:** "Finmo - Leads" → "Application Received"
5. **Email:** Send doc request to client (same as Phase 1)
6. **Cat's workflow:** Cat logs into MyBrokerPro, sees "Missing Docs (JSON)" field, knows what to chase

**Future enhancements:**
- When doc uploaded to Drive → update `Missing Docs (JSON)`, remove from list
- When all docs received → update `Doc Collection Status` = "Complete", move to "All Docs Received" stage
- Trigger automation: "All Docs Received" stage → notify Taylor, create budget call task

**Risks:**
- Webhook reliability (Finmo → our service → MyBrokerPro is 2-hop)
- Data sync lag (if Finmo updates, how long until MyBrokerPro reflects?)
- Field length limits (JSON in LONG_TEXT field - check GoHighLevel limits)

---

### Phase 5: Task/SMS Automation
**CRM Interaction:** Read `Primary Borrower Phone`, create tasks

**Use Cases:**
1. Create MyBrokerPro task: "Follow up on missing [doc type]" assigned to Cat, due in 3 days
2. Send SMS reminder via GoHighLevel: "Hi [name], we're still waiting on your T4. Reply STOP to opt out."

**API Endpoints:**
- POST /contacts/{contactId}/tasks (create task)
- POST /contacts/{contactId}/conversations/messages (send SMS)

---

### Phase 6: Lender-Specific Conditions
**CRM Interaction:** Use "Lenders" pipeline to track lender-specific conditions

**Use Case:**
- Taylor picks lender (e.g., "First National") → move contact to "First National" stage in Lenders pipeline
- Automation pulls lender-specific condition checklist (stored in... TBD, maybe Airtable or Google Sheet?)
- Update `Missing Docs (JSON)` to include lender conditions

**Status:** Phase 6+ (future)

---

### Phase 7: Renewal Automation
**CRM Interaction:** Monitor `mortgage_11_renewal_date` and other renewal date fields

**Use Case:**
- Daily cron job queries MyBrokerPro: "All contacts with renewal date in next 120 days"
- Move contacts to "Finmo - Post Closing" pipeline → "Maturing Within 120 Days"
- Send renewal offer email + create Taylor task: "Call [client] re: renewal"

**Status:** Phase 7+ (future)

---

## API Implementation Notes

### Authentication
**Method:** OAuth 2.0 (GoHighLevel V2 API)
**Credentials:** Stored in SESSION_CONTEXT_2026-02-09.md (change password ASAP per client request)

### Base URL
```
https://services.leadconnectorhq.com
```

### Common Headers
```http
Authorization: Bearer {access_token}
Version: 2021-07-28
```

### Rate Limits
**Unknown** - Need to test and document (GoHighLevel docs should specify)

### Key Endpoints for Phase 2

```http
# Get all pipelines (already done)
GET /locations/{locationId}/pipelines

# Get stages for a pipeline
GET /locations/{locationId}/pipelines/{pipelineId}/stages

# Get custom fields (already done)
GET /locations/{locationId}/customFields

# Create custom field
POST /locations/{locationId}/customFields
{
  "name": "Doc Collection Status",
  "dataType": "SINGLE_OPTIONS",
  "model": "contact",
  "parentId": "jlGAdTgblv5q2cWiw2Qc",
  "picklistOptions": ["Not Started", "In Progress", "Partial", "Complete"]
}

# Get contact by ID
GET /contacts/{contactId}

# Update contact custom fields
PUT /contacts/{contactId}
{
  "customFields": {
    "contact.doc_collection_status": "In Progress",
    "contact.missing_docs_json": "[\"T4\", \"Pay Stub\"]"
  }
}

# Search contacts by Finmo Deal ID
GET /contacts/search?locationId={locationId}&query=contact.dealid:{finmoDealId}

# Update contact pipeline stage
PUT /contacts/{contactId}/workflow/{pipelineId}/stage/{stageId}
```

---

## Security & Compliance Notes

### PII Handling
**Rule (from CLAUDE.md):** Never store client PII in automation logs

**Implication:**
- Custom field `Missing Docs (JSON)` should store doc TYPES only, not doc VALUES
  - ✅ Good: `["T4", "Pay Stub", "Void Cheque"]`
  - ❌ Bad: `["T4 - $85000 income", "Pay Stub - ABC Company"]`
- When logging API calls, redact:
  - Contact names
  - Email addresses
  - Phone numbers
  - Addresses
  - Financial amounts

### Access Control
**MyBrokerPro User Roles:**
- Taylor: Admin (full access)
- Cat: User (need to confirm permissions - can she see all contacts? all pipelines?)
- dev@venturemortgages.com: API-only service account (confirm role/permissions)

**Action Item:** Verify dev@ account has minimal permissions (read contacts, update custom fields, update stages only)

---

## Open Questions for Client

1. **Custom field creation:** Should we add 8 new custom fields via API, or would you prefer to add them manually in the MyBrokerPro UI? (API is faster but less visible)

2. **Stage movement:** When we move a contact from "Application Received" (Leads pipeline) to "Collecting Documents" (Live Deals pipeline), do we also need to create a separate opportunity record? Or is the contact the primary entity?

3. **Cat's workflow:** Does Cat primarily work in MyBrokerPro or Google Docs for tracking missing docs today? (This affects Phase 4 prioritization)

4. **Webhook availability:** Can MyBrokerPro send outbound webhooks when a contact moves to a specific stage? (For Phase 4+ automation triggers)

5. **User assignment:** Should doc collection tasks auto-assign to Cat, or should it depend on deal size / deal type?

6. **Field visibility:** Should the new "Missing Docs (JSON)" field be visible to clients in any client portal, or internal-only?

---

## Next Steps (Immediate)

### For Phase 2 (CRM Exploration):

1. **Script:** Write `fetch_stage_ids.js` to get stage IDs for key stages
2. **Script:** Write `create_custom_fields.js` to add 8 missing fields
3. **Test:** Create a test contact via API, update custom fields, verify in MyBrokerPro UI
4. **Document:** Add stage IDs to this file once fetched
5. **Decision:** Confirm with Taylor/Cat which fields to add (all 8 or subset?)

### For Phase 4 (CRM Integration):

1. **Architecture diagram:** Draw flow: Finmo webhook → our service → MyBrokerPro update → email send
2. **Error handling:** Design retry logic (what if MyBrokerPro API is down?)
3. **Testing strategy:** Use Finmo test applications, verify end-to-end
4. **Rollback plan:** If CRM integration breaks, can we fall back to Phase 1 (Finmo-only) mode?

---

## Appendix: Field Key Naming Convention

**Pattern:** `contact.[field_name]`

**Examples:**
- contact.dealid
- contact.finmo_application_id
- contact.property_1_address
- contact.mortgage_11_rate

**For new fields, follow this pattern:**
- contact.doc_collection_status
- contact.missing_docs_json
- contact.doc_request_sent_date

**Caution:** Field keys must be unique across the location. Use `GET /locations/{locationId}/customFields` to check for conflicts before creating.

---

## Appendix: Sample Contact Record (Sanitized)

```json
{
  "id": "r9ibWWqLz11Rntx2YaCs",
  "locationId": "bzzWH2mLpCr7HHulO3bW",
  "contactName": "[REDACTED]",
  "email": "[REDACTED]",
  "phone": "[REDACTED]",
  "source": "finmo",
  "assignedTo": "kfvuds7wRjIAvb3uWueF",
  "city": "[REDACTED]",
  "state": "BC",
  "dateAdded": "2026-02-12",
  "customFields": {
    "contact.dealid": "[POPULATED]",
    "contact.finmo_application_id": "[POPULATED]",
    "contact.finmo_deal_link": "[POPULATED]"
  }
}
```

**Key Observations:**
- `source: "finmo"` confirms active integration
- `assignedTo` field contains user ID (need to map to Cat/Taylor)
- Custom fields use dot notation matching fieldKey

---

**End of Reference Document**
