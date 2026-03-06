# Checklist Rules Changelog

Tracks every change to doc checklist rules with rationale. Reference for Cat when rules are questioned later.

## Format
Each entry: date, what changed, why, source (Cat feedback / bug fix / Finmo data)

---

## 2026-03-05 — Cat's Draft Review (5 checklists)

### FIXED: Commission T4 Duplication (Steffie)
**Issue:** When borrower has both employment income AND commission income (from same employer), the system requests T4s twice — once for employment (Section 1) and once showing commission (Section 10).
**Cat says:** "Duplicate T4 requests (a separate one for commission income again)"
**Fix:** Added `excludeWhen: hasEmploymentT4s` to `s10_commission_t4s` rule. When borrower has salary/hourly T4s from Section 1, the separate commission T4 request is suppressed. Commission statements and employer letter still appear.
**Rationale:** Employers issue ONE T4 covering all employment income including commission.

### FIXED: Property Section Duplication (Steffie, Andrea & Robert, Erin)
**Issue:** Per-property rental sections correctly list docs under each address. But a generic "Property" section ALSO appears requesting overlapping items ("Lease agreements for all units", "Current mortgage statement", "Property tax bill").
**Cat says:** "'Property' section just asks for lease agreements, I think that's duplicated?"
**Fix:** Added `excludeWhen: subjectPropertyIsRental` to `s15_multiunit_leases`, `s15_refi_mortgage`, and `s15_refi_tax`. When the subject property has rental income, per-property rules already cover these docs under the address header.
**Rationale:** Per-property sections with addresses are more useful to clients than generic "Property" headings.

### FIXED: Subject Property with Rental Income (Erin)
**Issue:** 680 Old Meadows is BOTH the subject property AND has rental income. System duplicates docs across per-property section and shared Property section.
**Cat says:** "Property requests seems duplicated, if we can have the correct property addresses listed. 680 Meadows is also the subject."
**Fix:** Same as above — `s15_refi_mortgage` and `s15_refi_tax` now suppressed when subject property has rental income. Per-property rental section under the address covers mortgage statement + property tax.
**Rationale:** One clear section per property is cleaner than split across per-property and shared.

### FIXED: Self-Employed Gets Employed Docs (Paul)
**Issue:** Paul is self-employed but the system requested LOE, paystub, and T4s (employed docs).
**Cat says:** "He's self-employed so these aren't applicable."
**Fix:** `hasSalaryOrHourly()` and `hasContract()` now filter by `active !== false`. Inactive/stale Finmo income entries no longer trigger employed doc requests. Active part-time jobs alongside self-employment still trigger correctly.
**Cat's question answered:** YES — if Cat edits out wrong docs and sends the email, the feedback loop (Phase 8.1) captures the diff and auto-applies to similar future applications.

### FIXED: Property Addresses Not Populated (Paul & Shawna & Steve)
**Issue:** Property section shows "Additional Property 1" instead of actual address.
**Cat says:** "Property address names aren't being populated, just 'Additional Property 1' and property."
**Fix:** `buildPropertyDescription()` now has a 3-step fallback chain: (1) addressId lookup, (2) find address by propertyId match, (3) try `line1` field before falling back to generic name.
**Rationale:** Finmo sometimes stores property addresses differently — the fallback handles all known patterns.

### FIXED: High Net Worth Yellow Bar (Erin)
**Issue:** When Cat deletes the HNW text in Gmail, a yellow bar remains.
**Cat says:** "Just don't know how to get rid of the yellow bar when I remove it"
**Fix:** Changed from `<div>` container to `<span>` inside `<p>`. Deleting the text in Gmail now removes the span and its yellow background styling. Updated instruction: "select this entire line and delete before sending."
**Rationale:** Gmail's editor keeps empty `<div>` containers with background styles; `<span>` elements are removed when their content is deleted.

---

## 2026-03-04 — Phase 24 Bug Fixes (9 bugs)

### FIXED: Per-Property Rule Evaluation (BUG 1)
**Issue:** Rental docs appeared on ALL properties, not just rentals.
**Fix:** Inject `currentProperty` into context per iteration in generate-checklist.ts
**Rationale:** Each property needs independent rule evaluation.

### FIXED: Empty Assets with Down Payment (BUG 2)
**Issue:** Purchase with downPayment > 0 but empty assets[] skipped bank statement request.
**Fix:** Check downPayment > 0 as fallback trigger for bank statements.
**Rationale:** Applicant declared DP amount but hasn't specified source yet.

### FIXED: Gift/Inheritance/Borrowed Detection (BUG 3)
**Issue:** Gift detection relied only on text matching in description.
**Fix:** Type-first pattern — check asset.type before description text.
**Rationale:** Explicit field values are more reliable than text matching.

### FIXED: Pension/CPP/OAS Detection (BUG 4)
**Issue:** Only 'retired' was detected, not 'pension', 'cpp', 'oas'.
**Fix:** Expanded RETIRED_SOURCES array to include all pension variants.
**Rationale:** Finmo sends different values depending on how applicant fills it.

### FIXED: Support & CCB Rules Activated (BUG 5)
**Issue:** Child support, spousal support, CCB rules were dormant.
**Fix:** Activated isReceivingSupport() and hasChildBenefit() checks.
**Rationale:** Auto-detectable from Finmo source field.

### FIXED: TFSA/FHSA Documented as N/A (BUG 6)
**Issue:** No TFSA/FHSA detection.
**Fix:** None needed — Finmo doesn't offer these in asset dropdown, and existing bank statement rule covers them.
**Rationale:** No data to detect from.

### FIXED: Rental Use Type Matching (BUG 7)
**Issue:** Only checked rentalIncome > 0, missed rental use types with $0 income.
**Fix:** Explicit RENTAL_USE_TYPES array matching property.use field.
**Rationale:** Property can be rental by type even if income not yet entered.

### FIXED: Borrower Contact Type (BUG 8)
**Issue:** Borrower contacts in MBP had no 'Client' tag.
**Fix:** All borrower upserts include tags: ['Client'].
**Rationale:** Cat needs to filter clients in CRM.

### FIXED: Professional Contact Sync (BUG 9)
**Issue:** Realtor/lawyer contacts missing phone, company, and proper role tags.
**Fix:** Capitalized role tags + phone/company passthrough.
**Rationale:** Cat needs professional metadata visible in CRM.

---

*Created: 2026-03-05*
*Source: Cat's review of 5 draft checklists + Phase 24 bug fixes*
