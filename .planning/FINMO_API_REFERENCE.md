# Finmo API Reference

**Base URL:** `https://app.finmo.ca/api/v1`
**Auth:** `Authorization: Bearer <FINMO_API_KEY>`
**Swagger:** `https://app.finmo.ca/api/documentation/` (requires login)
**Status:** Working as of 2026-02-13

---

## Team IDs

| Role | ID |
|------|-----|
| Team | `4a9c7b8d-d026-4a0e-b444-968708e62159` |
| Taylor (broker) | `19150e1b-baa5-4f09-8c00-72c16b2d41c1` |
| Cat (assistant) | `0b51e636-586a-40a1-85e7-a9a1aa25f4e0` |

---

## Endpoints Discovered

### List Applications
```
GET /applications?teamId={teamId}&page=1&pageSize=50
```
Returns array of application summaries. Key fields: id, goal, borrowerNames, purchasePrice, downPayment, use, applicationStatus, subjectPropertyAddress, applicant, teamMembers.

**Note:** pageSize doesn't seem to be respected — returns all applications (~979KB). May need to paginate differently.

### Get Application Detail
```
GET /applications/{applicationId}
```
Returns full application with all nested data. This is the primary endpoint for checklist generation.

**Response structure:**
```
{
  application: {}        // deal metadata (goal, amounts, status, mortgage info)
  applicant: {}          // primary applicant contact info
  borrowers: []          // ALL borrowers with full PII (SIN, DOB, KYC, etc.)
  incomes: []            // employment details per borrower
  properties: []         // subject + other properties
  assets: []             // RRSP, TFSA, savings, vehicles (with owner IDs)
  liabilities: []        // debts per borrower
  addresses: []          // current/previous addresses
  addressSituations: []  // renting/owning history per borrower
  creditReports: []      // credit pull data
  activities: []         // audit trail (status changes, notes, consent)
  agents: []             // lawyers, realtors
  fees: []               // broker fees
  teamMembers: []        // Taylor, Cat
  users: []              // linked user accounts
  idVerificationRequests: []
  referralLink: null
}
```

### Confirmed Non-Existent Endpoints
- `/api/v1/deals` — 404
- `/api/v1/borrowers` — 404
- `/api/v1/contacts` — 404
- `/api/v1/documents` — 404
- `/api/v1/deal` — 404

### Endpoints That Exist But Need Permissions
- `/api/v1/teams` — 403 "user_is_not_admin"
- `/api/v1/applications` — 403 "no_access" (use with ?teamId= param instead)

---

## Key Fields for Checklist Generation

### Determine Deal Type
| Decision | Field | Values |
|----------|-------|--------|
| Purchase vs Refinance | `application.goal` | "purchase", "refinance", null |
| Owner-occupied vs Investment | `application.use` | "owner_occupied", etc. |
| First-time buyer | `borrowers[].firstTime` | true/false |
| Property type | `properties[].type` | "detached", "condo", etc. |
| Property tenure | `properties[].tenure` | "freehold", "leasehold", etc. |
| Condo fees | `properties[].monthlyFees` | number or null |

### Determine Income Type (per borrower)
| Decision | Field | Values |
|----------|-------|--------|
| Employment type | `incomes[].source` | "employed", "self_employed", "retired", etc. |
| Pay type | `incomes[].payType` | "salaried", "hourly", "commission", etc. |
| Job type | `incomes[].jobType` | "full_time", "part_time", "contract", etc. |
| Employer name | `incomes[].business` | string (e.g., "CIBC", "Central City Hardware") |
| Job title | `incomes[].title` | string |
| Start date | `incomes[].startDate` | ISO date |

### Determine Down Payment Source
| Decision | Field | Values |
|----------|-------|--------|
| Asset type | `assets[].type` | "rrsp", "tfsa", "cash_savings", "vehicle", "other" |
| Asset owner | `assets[].owners` | array of borrower IDs |
| Asset description | `assets[].description` | string (e.g., "TFSA", "RSP CIBC") |

### Identify Co-Borrowers
| Decision | Field |
|----------|-------|
| Has co-borrower | `borrowers.length > 1` |
| Main borrower | `borrowers[].isMainBorrower === true` |
| Relationship | `borrowers[].relationshipToMainBorrower` |
| Borrower name | `borrowers[].firstName`, `borrowers[].lastName` |

### Property Info
| Decision | Field |
|----------|-------|
| Subject property address | `addresses[]` linked via `properties[].addressId` |
| Other properties owned | `properties[]` where not subject |
| Has rental income | `properties[].rentalIncome > 0` |
| Annual taxes | `properties[].annualTaxes` |
| Is selling | `properties[].isSelling` |

### Borrower Details
| Decision | Field |
|----------|-------|
| Marital status | `borrowers[].marital` |
| Dependents | `borrowers[].dependents` |
| KYC completed | `borrowers[].kycCompleted` |
| ID type used | `borrowers[].kycForm.typeOfDocumentUsed` |
| Residency | `applicant.country`, `applicant.state` |

---

## Webhook (Resthook) Events Available

| Event | Trigger |
|-------|---------|
| **Application submitted by borrower** | PRIMARY — triggers our checklist pipeline |
| Application started | Client began filling out app |
| Deal submitted | Taylor submits to lender |
| Deal status changed | Status changes (pre-qual → live → funded) |
| Application update event | Client updates application data |
| Deal note created | Note added to deal |
| Response received by lender | Lender responds |
| Credit pulled | Credit report pulled |

Resthook setup: Pick event → enter webhook URL → save.
Public key provided for webhook signature verification.

---

## PII Warning

Application detail responses contain real client PII:
- SIN numbers (`borrowers[].sinNumber`)
- Email, phone, DOB
- Income amounts, employer details
- Property addresses, mortgage amounts

**NEVER log these fields. Strip PII before storing metadata.**

---

## Sample Applications for Testing

| App ID | Client | Type | Scenario |
|--------|--------|------|----------|
| `7a1f3d8e-26ed-43cb-8445-e820c97d9a86` | Cameron/Taras | Refinance | Couple, both employed, existing property |
| `a2dad781-3067-4fbc-8233-741d04401fee` | Worthing, Tracy | Purchase | Single, funded |
| (need to find) | — | Self-employed | Sole prop or incorporated |
| (need to find) | — | Purchase | First-time buyer |
| (need to find) | — | — | Retired income |

*Need to pull a diverse set from the application list for testing.*

---
*Created: 2026-02-13*
*Source: Direct API testing*
