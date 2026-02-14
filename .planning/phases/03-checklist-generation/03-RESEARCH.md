# Phase 3 Research: Checklist Generation

**Researched:** 2026-02-13
**Mode:** Feasibility + Ecosystem
**Overall Confidence:** HIGH

---

## Executive Summary

Phase 3 transforms DOC_CHECKLIST_RULES_V2.md (17 sections, Cat-approved) into executable code that reads a Finmo application response and produces a personalized document checklist. This is fundamentally a **data mapping + conditional logic** problem, not an AI/ML problem. The Finmo API returns structured JSON with all the fields needed to drive every rule in the checklist (employment type, property type, deal type, down payment sources, residency, co-borrowers). The main engineering challenge is building a rule engine that faithfully encodes Cat's 17-section document with its nested conditionals, exclusions, and special cases -- and making it testable and maintainable.

After analyzing every field in the sample Finmo API response against every rule in DOC_CHECKLIST_RULES_V2.md, this is entirely feasible. Every decision point in the checklist maps to a concrete Finmo API field. There are no blocking unknowns. The highest-risk areas are: (1) edge cases where Finmo data is ambiguous or missing (e.g., "self-employed" but no sub-type indicating sole prop vs incorporated), (2) co-borrower handling where each person may have different income types, and (3) ensuring excluded items are never generated despite code changes over time.

**Recommendation:** Build a custom declarative rule engine in TypeScript (not a third-party library). The rules are domain-specific enough that a library like json-rules-engine adds indirection without value. A well-typed, data-driven rule definition with exhaustive test coverage is the right approach.

---

## Key Findings

### 1. Finmo API Provides All Required Input Fields

**Confidence: HIGH** (verified against real API response `finmo_app_sample.json`)

Every decision point in DOC_CHECKLIST_RULES_V2.md maps to a Finmo API field:

| Checklist Decision | Finmo Field Path | Values Seen | Notes |
|---|---|---|---|
| Deal type (purchase/refi) | `application.goal` | `"purchase"`, `"refinance"` | Direct mapping |
| Property use | `application.use` | `"owner_occupied"` | Investment = non-owner-occupied |
| First-time buyer | `borrowers[].firstTime` | `true`/`false` | Per-borrower flag |
| Property type | `properties[].type` | `"detached"`, `"condo"`, etc. | Subject property = `application.propertyId` linked |
| Property tenure | `properties[].tenure` | `"freehold"`, `"leasehold"` | |
| Condo fees | `properties[].monthlyFees` | number or null | Non-null = condo |
| Employment type | `incomes[].source` | `"employed"`, `"self_employed"`, `"retired"` | Per-borrower, linked via `borrowerId` |
| Pay type | `incomes[].payType` | `"salaried"`, `"hourly"`, `"commission"` | Determines income section |
| Job type | `incomes[].jobType` | `"full_time"`, `"part_time"`, `"contract"` | Contract triggers Section 2 |
| Bonus flag | `incomes[].bonuses` | `true`/`false` | Triggers Section 10 bonus rules |
| Self-pay type | `incomes[].selfPayType` | array (e.g., `[]`) | Determines sole prop vs incorporated vs stated |
| Business type | `incomes[].businessType` | string or null | Further self-employment classification |
| Down payment source | `assets[].type` | `"rrsp"`, `"tfsa"`, `"cash_savings"`, `"other"` | Maps to Section 14 sub-sections |
| Asset description | `assets[].description` | `"TFSA"`, `"RSP CIBC"`, etc. | Helps disambiguate `"other"` types |
| Asset owner | `assets[].owners` | array of borrower IDs | Routes to correct person |
| Has co-borrower | `borrowers.length > 1` | numeric | Direct check |
| Main borrower | `borrowers[].isMainBorrower` | `true`/`false` | |
| Borrower name | `borrowers[].firstName` + `lastName` | strings | For per-person sections |
| Relationship | `borrowers[].relationshipToMainBorrower` | `"common_law"`, `"spouse"`, etc. | |
| Residency / country | `applicant.country` | `"Canada"` | Combined with other signals for newcomer/work permit |
| Rental income | `properties[].rentalIncome` | number | > 0 triggers Section 10 rental |
| Has mortgage | `properties[].mortgaged` | `true`/`false` | Triggers liability docs |
| Is selling | `properties[].isSelling` | `true`/`false` | Sale of property down payment |
| Marital status | `borrowers[].marital` | `"common_law"`, `"married"`, `"divorced"`, etc. | Divorce triggers Section 12 |
| Application stage | `application.process` | `"searching"`, `"found_property"` | Gift donor proof of funds conditional |
| Employer name | `incomes[].business` | string | For email context ("LOE from Central City Hardware") |

### 2. Known Data Gaps in Finmo

**Confidence: MEDIUM** (based on one sample, need more diverse applications)

Several checklist rules require data that may not always be present in Finmo:

| Missing Data | Impact | Mitigation |
|---|---|---|
| Explicit "sole proprietor" vs "incorporated" flag | Self-employed sub-type classification | Check `incomes[].businessType` and `incomes[].selfPayType`. If ambiguous, default to requesting the broader set (all self-employed docs). Flag for Cat review. |
| Maternity/parental leave status | Section 8 triggers | No direct field found. May be detectable from `incomes[].active === false` + recent `endDate`. Safest: Cat manually flags this in review. |
| Probation status | Section 9 triggers | No explicit field. May infer from short tenure (`startDate` within last 3-6 months). Safest: Cat flags in review. |
| Work permit / PR status | Section 16 residency programs | No explicit immigration status field found. `applicant.country` shows "Canada" but doesn't distinguish citizen vs PR vs work permit. Need to verify with more samples. |
| Gift as down payment source | Section 14 gift rules | `assets[].type` may not have "gift" value. May appear as `"other"` with description containing "gift". Need pattern matching or fallback. |
| FHSA as down payment | Section 14 FHSA | May appear as `"other"` type asset. Check `assets[].description` for "FHSA" pattern. |
| Support income (receiving/paying) | Section 10 support rules | No explicit "support income" source type seen. May be in `incomes[].source` for other applications. |
| Bankruptcy/consumer proposal | Section 13 | No explicit field found in sample. May be visible in credit report data or separate field. |

**Strategy for gaps:** Build the rule engine to handle missing data gracefully. When a field is ambiguous, include the broader document set rather than the narrower one. Cat reviews every generated checklist before it becomes an email (human-in-the-loop), so over-requesting is safer than under-requesting.

### 3. Rule Complexity Analysis

After analyzing all 17 sections of DOC_CHECKLIST_RULES_V2.md, the rules decompose into these categories:

**Always-included (Section 0 base pack):** 3 items (2 IDs + void cheque). Simple.

**Income-type-driven (Sections 1-10):** Most complex. Each borrower gets docs based on their income type(s). A single borrower can have MULTIPLE income entries (sample shows Karen with 2 jobs). The engine must process all incomes per borrower and combine the required docs, deduplicating where needed.

**Liability-driven (Section 11):** Triggered by `liabilities[]` and `properties[]` data. Straightforward.

**Situation-driven (Sections 12-13):** Divorce, bankruptcy. These require signals that may not be in Finmo data. Best handled as manual flags.

**Down-payment-driven (Section 14):** Each `assets[]` entry maps to a sub-section. Gift has special conditional logic (donor info upfront, gift letter deferred, proof of funds only if "found property").

**Property-type-driven (Section 15):** Driven by `application.goal` (purchase vs refinance), `properties[].type` (condo, multi-unit), and `application.use` (owner-occupied vs investment).

**Residency-driven (Section 16):** Requires immigration status data not clearly available in Finmo. Needs manual override or additional data source.

**Total unique documents across all sections:** ~85 distinct document types (counting per-section variants).

**Total conditional rules:** ~40 conditions that determine which documents apply.

### 4. Architecture Recommendation: Custom Declarative Rule Engine

**Confidence: HIGH**

After evaluating options:

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **json-rules-engine** (npm) | Declarative JSON, well-tested | Over-engineered for this use case. Rules are not dynamically user-editable. Adds dependency + abstraction layer. | REJECT |
| **Hard-coded if/else** | Simple, fast to build | Untestable spaghetti. Changes require touching code logic. Easy to introduce bugs. | REJECT |
| **Custom declarative rules (recommended)** | Type-safe, testable, domain-specific. Rules defined as data structures, engine evaluates them. | Slightly more upfront work than if/else. | ACCEPT |

**Why custom over json-rules-engine:** The checklist rules are not generic boolean conditions. They involve per-borrower iteration, document deduplication, internal-only flags, conditional notes, and exclusion lists. json-rules-engine's condition/action model would require extensive custom operators that negate the benefit of using a library. A custom engine purpose-built for this domain will be simpler, more readable, and easier to maintain.

**Proposed rule structure:**

```typescript
interface ChecklistRule {
  id: string;                          // e.g., "income_employed_paystub"
  section: string;                     // e.g., "1_income_employed"
  document: string;                    // e.g., "Recent paystub (within 30 days)"
  displayName: string;                 // Plain language for email: "2 recent pay stubs"
  stage: 'PRE' | 'FULL' | 'LATER' | 'CONDITIONAL' | 'INTERNAL_CHECK';
  scope: 'per_borrower' | 'per_property' | 'shared';
  condition: (ctx: ApplicationContext) => boolean;  // When this doc is needed
  excludeWhen?: (ctx: ApplicationContext) => boolean; // CHKL-05 exclusions
  notes?: string;                      // Inline note for email (e.g., "if NOA shows amount owing...")
  internalOnly?: boolean;              // CHKL-06: gift letter, T2125 check, etc.
}

interface ApplicationContext {
  application: FinmoApplication;
  borrower: FinmoBorrower;            // Current borrower being evaluated
  allBorrowers: FinmoBorrower[];
  incomes: FinmoIncome[];             // Current borrower's incomes
  assets: FinmoAsset[];               // All assets
  properties: FinmoProperty[];
  liabilities: FinmoLiability[];
  subjectProperty: FinmoProperty | null;
}
```

Each rule is a self-contained data object. The engine iterates borrowers, evaluates conditions, collects matching rules, applies exclusions, and produces a structured checklist grouped by person/property/shared.

### 5. Output Structure

The checklist generator must produce output that serves two consumers:

**Consumer 1 — Email draft (Phase 5):** Grouped by person, then property, then "Other". Uses `displayName` and `notes`. Excludes `internalOnly` items. Matches Cat's email format.

**Consumer 2 — CRM tracking (Phase 4):** Flat list with `stage` tags (PRE/FULL). Includes `internalOnly` items for internal tracking. Used for received/missing status.

```typescript
interface GeneratedChecklist {
  applicationId: string;
  generatedAt: string;
  borrowers: BorrowerChecklist[];     // Per-person documents
  properties: PropertyChecklist[];     // Per-property documents
  shared: ChecklistItem[];            // Shared docs (void cheque, down payment)
  internalFlags: InternalFlag[];      // Gift letter, T2125 checks, etc.
}

interface ChecklistItem {
  ruleId: string;
  document: string;                   // Internal name
  displayName: string;                // Email-friendly name
  stage: 'PRE' | 'FULL';
  notes?: string;                     // Conditional note for email
  forEmail: boolean;                  // false = internal tracking only
}
```

### 6. Testing Strategy

**Confidence: HIGH**

This is the most testable phase in the entire project. Every rule is deterministic: given input X, output should contain document Y. No AI, no external APIs at test time.

**Test approach:**

1. **Fixture-based testing:** Create JSON fixtures representing different application profiles (employed purchase, self-employed refi, retired condo, co-borrower mixed income, etc.). Assert exact checklist output.

2. **Snapshot testing:** Generate checklist for each fixture, save as snapshot. Any rule change that alters output will fail the snapshot, forcing explicit review.

3. **Negative testing (CHKL-05):** For each excluded item (signed credit consent, T2125, bonus payment history, etc.), create a fixture that WOULD trigger it and assert it is NOT in the output.

4. **Co-borrower testing (CHKL-04):** Verify that a 2-borrower application produces duplicate per-person items with correct names.

5. **Gift letter testing (CHKL-06):** Verify gift letter appears in `internalFlags` but NOT in email-facing items. Verify donor info + amount DO appear in email items.

6. **Success criteria as tests:** Each of the 6 success criteria becomes a test case:
   - SC1: Employed borrower fixture -> assert pay stubs, T4s, bank statements, LOE
   - SC2: Self-employed fixture -> assert NOAs, T1s, corporate docs, bank statements
   - SC3: Co-borrower fixture -> assert duplicate items with names
   - SC4: Exclusion fixtures -> assert removed items absent
   - SC5: Gift fixture -> assert gift letter is internal-only
   - SC6: Mixed PRE/FULL fixture -> assert all in single list

**Estimated test count:** ~25-35 test cases to cover all scenarios.

---

## Finmo-to-Checklist Field Mapping (Complete)

This is the core data transformation. Each checklist section maps to Finmo fields as follows:

### Section 0: Base Pack (Always)
- **Trigger:** Always
- **Fields needed:** None (unconditional)
- **Exclusion:** Signed credit consent (REMOVED -- auto-sent by Finmo)

### Section 1: Income -- Employed (Salary/Hourly)
- **Trigger:** `incomes[].source === "employed"` AND `incomes[].payType in ["salaried", "hourly"]`
- **Fields needed:** `borrower.firstName` (for naming), `incomes[].business` (employer name for LOE context)
- **Special:** If current year T4 not available, request year-end pay stub. This is a timing issue -- may need to check if we're in Jan-Mar (T4 season).

### Section 2: Income -- Employed (Contract/Seasonal)
- **Trigger:** `incomes[].source === "employed"` AND `incomes[].jobType === "contract"`
- **Fields needed:** Same as Section 1

### Section 3: Income -- Self-Employed (General)
- **Trigger:** `incomes[].source === "self_employed"`
- **Fields needed:** `incomes[].selfPayType`, `incomes[].businessType`

### Section 4: Self-Employed -- Sole Proprietor
- **Trigger:** Section 3 + detected as sole prop (not incorporated)
- **Internal check:** T2125 in T1 package. NOT requested separately.

### Section 5: Self-Employed -- Incorporated
- **Trigger:** Section 3 + detected as incorporated
- **Fields needed:** `incomes[].businessType` or similar
- **Internal check:** Schedule 50 in T2. NOT requested separately.
- **Exclusion:** Business bank statements (lender condition only)

### Section 6: Self-Employed -- Stated Income (B Lender)
- **Trigger:** Unclear from Finmo data alone. May need manual flag.
- **Note:** This is a B-lender program -- Taylor would know at intake. Safe to exclude from auto-generation and let Cat add manually.

### Section 7: Income -- Retired
- **Trigger:** `incomes[].source === "retired"`
- **Exclusions:** NOA (REMOVED), RRIF/Annuity (REMOVED)
- **Additions:** 3 months bank statements showing pension deposits, 2 years CPP/OAS T4As, 2 years T5s

### Section 8: Income -- Maternity/Parental Leave
- **Trigger:** `incomes[].active === false` with recent `endDate`? Unclear signal.
- **Recommendation:** Manual flag by Cat. Not auto-detectable from Finmo data.

### Section 9: Income -- Probation
- **Trigger:** Short tenure. `incomes[].startDate` within last 3-6 months could hint.
- **Recommendation:** Manual flag. Tenure alone is not sufficient (new job != probation).

### Section 10: Variable Income
- **Commission trigger:** `incomes[].payType === "commission"` or commission percentage
- **Bonus trigger:** `incomes[].bonuses === true`
- **Rental trigger:** `properties[].rentalIncome > 0`
- **Support trigger:** No clear Finmo field. Manual flag.
- **Other income trigger:** No clear Finmo field. Manual flag.
- **Exclusions:** Bonus payment history (REMOVED), T776 (REMOVED -- in T1)

### Section 11: Liabilities
- **Trigger:** `liabilities[]` with type `"mortgage"` on other properties, or `"unsecured_line_credit"`
- **Also:** Properties with `mortgaged === true` that are not subject property
- **Support liabilities:** `borrowers[].marital === "divorced"` or "separated" could hint

### Section 12: Divorce/Separation
- **Trigger:** `borrowers[].marital` in `["divorced", "separated"]`
- **Fields needed:** Marital status per borrower

### Section 13: Bankruptcy/Consumer Proposal
- **Trigger:** Not detectable from sample Finmo data. May be in credit report data.
- **Recommendation:** Manual flag by Cat after credit pull.

### Section 14: Down Payment (Source of Funds)
- **Savings trigger:** `assets[].type === "cash_savings"`
- **RRSP trigger:** `assets[].type === "rrsp"`
- **TFSA trigger:** `assets[].type === "tfsa"` OR `assets[].description` contains "TFSA"
- **FHSA trigger:** `assets[].description` contains "FHSA"
- **Gift trigger:** `assets[].description` contains "gift" (needs pattern matching)
- **Sale of property trigger:** `properties[].isSelling === true`
- **Inheritance trigger:** Not detectable. Manual flag.
- **Borrowed trigger:** Not clearly detectable. Manual flag.
- **Gift special rules:**
  - `application.process === "found_property"` -> request donor proof of funds
  - Otherwise -> only donor info + amount (no proof of funds)
  - Gift letter: ALWAYS internal flag only, never in email

### Section 15: Property (Deal Type)
- **Purchase trigger:** `application.goal === "purchase"`
- **Refinance trigger:** `application.goal === "refinance"`
- **Condo trigger:** `properties[].type === "condo"` or `properties[].monthlyFees > 0`
- **Condo fee confirmation:** Only for refinance condos (not purchase)
- **Multi-unit trigger:** `properties[].numberOfUnits > 1`
- **Investment trigger:** `application.use !== "owner_occupied"`

### Section 16: Residency Programs
- **Newcomer/Work Permit/Non-Resident:** Not clearly detectable from Finmo sample data.
- **Recommendation:** Manual flag by Cat. Immigration status is sensitive and not reliably in Finmo.

### Section 17: First-Time Buyer
- **Trigger:** `borrowers[].firstTime === true`
- **Note:** All items REMOVED by Cat. No documents to request. Only used for internal tracking.

---

## Technology Decisions

### Rule Engine: Custom TypeScript (not a library)

Use pure TypeScript functions and data structures. Each rule is a typed object with a condition function. The engine is ~200 lines of code.

**Rationale:**
- Rules are domain-specific (per-borrower iteration, exclusion lists, internal flags)
- Total rule count is ~40-50, not thousands
- Cat-approved rules change infrequently (when mortgage industry changes)
- json-rules-engine (7.3.1) would require custom operators for per-borrower logic, negating its benefits
- Type safety catches rule definition errors at compile time
- Test coverage is the real safety net, not a framework

### Data Layer: Pure functions, no database

The checklist generator is a **pure function**: Finmo API response in, structured checklist out. No state. No database. No side effects.

```
FinmoApplicationResponse -> generateChecklist() -> GeneratedChecklist
```

State management (storing the checklist, tracking received/missing) is Phase 4's concern (CRM). Phase 3 is purely computational.

### Testing: Vitest with fixture files

Use Vitest (fast, TypeScript-native). Test fixtures are JSON files representing different Finmo application profiles. Snapshot tests for regression detection.

### Integration with Phase 1 (Webhook Foundation)

Phase 3's checklist generator is called by the BullMQ job processor from Phase 1:

```
Webhook received -> BullMQ job queued -> Worker calls Finmo API ->
Worker calls generateChecklist() -> Result stored/passed to Phase 4+5
```

The generator itself has no infrastructure dependencies. It receives parsed JSON and returns a data structure.

---

## Pitfalls

### Critical: Finmo Field Values Not Exhaustively Known

**What goes wrong:** We build rules assuming `incomes[].source` has values like "employed", "self_employed", "retired". But Finmo might use values we haven't seen in our one sample (e.g., "pension", "disability", "other"). Unknown values would produce an incomplete checklist.

**Prevention:** Before building rules, pull 10+ diverse applications from Finmo API to catalog all field values actually in use. The API reference lists `GET /applications?teamId=` which returns all applications. Extract unique values for every decision field.

**Detection:** Log a warning when the engine encounters an unknown field value. Route to Cat for manual review.

### Critical: Multiple Income Types Per Borrower

**What goes wrong:** A borrower can have 2+ income entries (Karen in sample has CIBC job + Noble Pannu job, both salaried). If one is commission and one is salaried, the engine must generate docs for BOTH income types without duplicating shared items (like T4s).

**Prevention:** Design the engine to process ALL incomes per borrower and merge/deduplicate the resulting document list. Use a Set of rule IDs to prevent duplicates.

### Moderate: Self-Employment Sub-Type Detection

**What goes wrong:** Finmo has `incomes[].source === "self_employed"` but distinguishing sole proprietor vs incorporated vs stated income is unclear from one sample. The `selfPayType` and `businessType` fields might help but we haven't seen real values.

**Prevention:** Need self-employed sample applications from Finmo. If sub-type cannot be determined, default to the broadest self-employed set (request all corporate + personal docs). Cat can remove unnecessary items in review.

### Moderate: Non-Standard Down Payment Sources

**What goes wrong:** Gift, FHSA, inheritance, and borrowed funds may all appear as `assets[].type === "other"` with varying descriptions. Pattern matching on description text is fragile.

**Prevention:** Define a known-descriptions mapping (e.g., description containing "gift", "FHSA", "inheritance"). When description doesn't match any known pattern, include the asset as "Other down payment source" and flag for Cat.

### Minor: Date-Sensitive Tax Document Names

**What goes wrong:** Cat's email says "2023/2024 T4s" with specific years. The engine needs to know what tax years to reference. If it's January 2026, the "current year T4" is 2025 but may not be available yet.

**Prevention:** Calculate tax years dynamically based on current date. If month <= 4 (T4 filing season), request both current-1 and current-2 year. After April, request current-1 and current year. Include "if not yet available" note per Cat's rules.

### Minor: Webhook Payload vs Full API Response

**What goes wrong:** The Finmo webhook for "application submitted" may send a minimal payload (just application ID), not the full response. The worker must call `GET /applications/{id}` for the full data.

**Prevention:** Already accounted for in Phase 1 architecture. Webhook triggers job, job fetches full application via API. Not a Phase 3 concern, but worth noting.

---

## Implementation Plan Recommendations

### Suggested Sub-Plans for Phase 3

**Plan 03-01: Define rule data structures + extract Finmo field catalog**
- Define TypeScript interfaces for rules, context, and output
- Pull 10+ diverse Finmo applications, catalog all unique field values
- Map every field value to a checklist section
- Identify gaps (fields that need manual flags)
- **Estimated effort:** 2-3 hours

**Plan 03-02: Implement rule definitions (all 17 sections)**
- Encode DOC_CHECKLIST_RULES_V2.md as typed rule objects
- Implement condition functions for each rule
- Implement exclusion functions (CHKL-05)
- Handle per-borrower iteration logic
- Handle gift letter internal-only flag (CHKL-06)
- **Estimated effort:** 4-6 hours

**Plan 03-03: Implement checklist engine + output formatter**
- Build the engine that evaluates rules against application context
- Implement deduplication logic for multiple incomes
- Build output formatter (group by person/property/shared)
- Separate email-facing items from internal tracking items
- **Estimated effort:** 2-3 hours

**Plan 03-04: Test suite (fixtures + snapshots + negative tests)**
- Create JSON fixtures for all major scenarios
- Write tests for all 6 success criteria
- Write negative tests for all CHKL-05 exclusions
- Write co-borrower tests (CHKL-04)
- Write gift letter tests (CHKL-06)
- Snapshot tests for regression
- **Estimated effort:** 3-4 hours

**Total estimated effort:** 11-16 hours

### Phase Ordering Rationale

Phase 3 depends on Phase 2 (CRM Exploration) because understanding MyBrokerPro's custom field structure informs what the checklist output needs to look like for CRM storage. However, the **core rule engine** is independent -- it can be built and tested in isolation. The only Phase 2 dependency is the output format for CRM tracking fields.

**Recommendation:** Start rule engine implementation (Plans 03-01 through 03-03) in parallel with Phase 2 if desired. Plan 03-04 (testing) can proceed immediately. Only the CRM output format needs Phase 2 input.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Finmo API field availability | HIGH | Verified against real API response. All major decision fields present. |
| Rule encoding feasibility | HIGH | Every rule in V2 is deterministic and encodable. No ambiguous rules. |
| Self-employment sub-types | MEDIUM | Only one sample application seen. Need more diverse examples. |
| Immigration/residency detection | LOW | No clear Finmo fields for PR/work permit/non-resident status. Likely manual flag. |
| Down payment source detection | MEDIUM | Standard types (RRSP, TFSA, savings) are clear. Gift/FHSA/inheritance may need pattern matching on descriptions. |
| Testing approach | HIGH | Pure function = trivially testable. Fixture-based approach is well-established. |
| Effort estimate | MEDIUM | Depends on how many edge cases surface when examining more Finmo applications. |

---

## Open Questions (Need Resolution Before/During Implementation)

1. **What values does `incomes[].source` take?** Need to catalog from real applications. "employed" and "self_employed" confirmed. What about retired, pension, disability, other?

2. **How does Finmo represent sole proprietor vs incorporated?** `incomes[].selfPayType` and `incomes[].businessType` are the candidates but we have no self-employed sample.

3. **How does Finmo represent gift down payment?** Does `assets[].type` ever equal "gift" or is it always "other" with a description?

4. **Does Finmo capture immigration status anywhere?** PR card, work permit, citizenship -- is this in borrower data we haven't seen?

5. **What does `application.process` return?** We've seen `"searching"`. What value means "found the property" (accepted offer)? This controls gift donor proof of funds.

6. **Are there applications with maternity/parental leave income?** Need a sample to understand how Finmo represents this.

**Resolution strategy:** Pull the full application list via `GET /applications?teamId=...`, examine 10-20 diverse applications, and catalog all field values. This is Plan 03-01 and should be done first.

---

## Sources

- Finmo API Reference: `C:/Users/lucac/projects/taylor_atkinson/.planning/FINMO_API_REFERENCE.md` (direct API testing, 2026-02-13)
- Finmo sample application: `C:/Users/lucac/projects/taylor_atkinson/.planning/finmo_app_sample.json` (real API response)
- DOC_CHECKLIST_RULES_V2.md: `C:/Users/lucac/projects/taylor_atkinson/DOC_CHECKLIST_RULES_V2.md` (Cat-approved, 2026-02-09)
- Email template reference: `C:/Users/lucac/projects/taylor_atkinson/.planning/EMAIL_TEMPLATE_REFERENCE.md` (Cat's format)
- Drive structure: `C:/Users/lucac/projects/taylor_atkinson/.planning/DRIVE_STRUCTURE.md` (folder patterns)
- [json-rules-engine npm](https://www.npmjs.com/package/json-rules-engine) -- Evaluated and rejected (v7.3.1)
- [ts-rule-engine](https://github.com/ilovepixelart/ts-rule-engine) -- Evaluated, too lightweight for our needs
- [rules-engine-ts](https://github.com/andrewvo89/rules-engine-ts) -- Evaluated, decent but unnecessary abstraction
- [Building a simple rules engine in TypeScript](https://wtjungle.com/blog/simple-rules-engine-ts/) -- Pattern reference
- [BullMQ TypeScript best practices](https://docs.bullmq.io/readme-1) -- Integration context for Phase 1
- [Finmo REST API Help](https://help.finmo.ca/en/articles/6381437-finmo-rest-api) -- Official docs
- [GoHighLevel Custom Fields V2 API](https://marketplace.gohighlevel.com/docs/ghl/custom-fields/custom-fields-v-2-api/index.html) -- CRM output format context

---
*Research completed: 2026-02-13*
