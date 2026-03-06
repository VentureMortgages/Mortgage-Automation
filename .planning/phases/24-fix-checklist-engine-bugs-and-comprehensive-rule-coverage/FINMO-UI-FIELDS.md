# Finmo Application UI Fields Reference

Documented from actual Finmo UI screenshots (2026-03-04).
Purpose: Audit every UI field against our checklist rules to find gaps.

---

## Application Steps (8 total)

1. Goal
2. Borrowers
3. Income
4. Assets
5. Properties
6. Professionals
7. Consent
8. Additional details → Review and submit

---

## Step 1: Goal

### "I want to" (radio select, required)
| UI Label | API Value | Rules Affected |
|----------|-----------|----------------|
| Purchase | `application.goal = 'purchase'` | Enables DP rules (s14_*), purchase property rules (s15_*) |
| Renew | `application.goal = 'renew'` | Skips DP rules entirely |
| Refinance | `application.goal = 'refinance'` | Skips DP rules entirely |

### "Where are you in the process of purchasing?" (conditional on Purchase)
| UI Label | API Value | Rules Affected |
|----------|-----------|----------------|
| I've found the property I want | `application.process = 'found_property'` | Enables gift donor proof (s14_dp_gift_donor_proof), purchase agreement (s15_purchase_offer) |
| Have not started | `application.process = 'not_started'` (or similar) | Skips property-specific purchase docs |

### Province dropdown (conditional on Purchase)
All Canadian provinces & territories:
Alberta, British Columbia, Manitoba, New Brunswick, Newfoundland and Labrador,
Northwest Territories, Nova Scotia, Nunavut, Ontario, PEI, Quebec, Saskatchewan, Yukon

**API field:** `application.province` or subject property address province
**Rules:** Currently no province-specific rules. May need for land transfer tax (ON/BC).

---

## Step 2: Borrowers

Can add multiple borrowers (main + co-borrowers).

### Contact info
| Field | Required | API Field |
|-------|----------|-----------|
| First name | Yes* | `borrower.firstName` |
| Last name | Yes* | `borrower.lastName` |
| Email address | Yes* (locked after invite) | `borrower.email` |
| Phone number | No | `borrower.phone` |
| Work phone number | No (supports ext) | `borrower.workPhone` |

### Personal details
| Field | Type | API Field | Possible Values |
|-------|------|-----------|-----------------|
| First time buyer? | Yes/No radio | `borrower.firstTime` | `true` / `false` |
| Marital status | Dropdown | `borrower.maritalStatus` | `single`, `married`, `widowed`, `separated`, `divorced`, `common_law` (or `common-law`) |
| SIN | Text (optional) | `borrower.sin` | 9-digit number |
| Date of birth | Month/Day/Year | `borrower.dateOfBirth` | Date |
| Number of dependents | Dropdown | `borrower.dependents` | `0` (No Dependents), `1`-`7`+ |

### Living history
| Field | Type | API Field | Possible Values |
|-------|------|-----------|-----------------|
| Country | Dropdown | `borrower.address.country` | Country list |
| Address | Autocomplete or manual | `borrower.address.*` | Street fields |
| Living situation | Radio | `borrower.livingSituation` | `renting`, `owner`, `live_with_parents`, `other` |
| Move in date | Month/Day/Year | `borrower.moveInDate` | Date |

### Rules mapping — Borrower fields
| UI Field | Checklist Impact |
|----------|-----------------|
| First time buyer = Yes | **GAP: No rules use this.** Could trigger FHSA/HBP docs. |
| Marital = Separated | Triggers s12_divorce_agreement (separation agreement) |
| Marital = Divorced | Triggers s12_divorce_agreement (divorce decree) |
| Living situation = Owner | Indicates existing property — may have mortgage stmt needs |
| Living situation = Renting | No checklist impact currently |
| Dependents > 0 | **GAP: No rules use this.** Could help detect CCB eligibility. |

---

## Step 3: Income

Per-borrower. Multiple income sources allowed ("Add a source of income").
Note: "John Smith needs 3 years of income history" shown as guidance.

### Income type dropdown (required)
| UI Label | Probable API Value (`income.source`) | Our Rule Detection | Status |
|----------|--------------------------------------|-------------------|--------|
| Employed | `employed` | `hasSalaryOrHourly()`, `hasContract()` | WORKING |
| Self Employed | `self_employed` or `self-employed` | `isSelfEmployed()`, `isSoleProprietor()`, `isIncorporated()` | WORKING |
| Pension | `pension` (?) | `isRetired()` checks `source === 'retired'` | **GAP: Likely missed** — may come as `'pension'` not `'retired'` |
| Canada Pension Plan (CPP) | `cpp` or `canada_pension_plan` (?) | `isRetired()` checks `source === 'retired'` | **GAP: Different source value** |
| Old Age Security (OAS) | `oas` or `old_age_security` (?) | `isRetired()` checks `source === 'retired'` | **GAP: Different source value** |
| Child Support | `child_support` (?) | `isReceivingSupport()` — **always returns false (dormant)** | **GAP: Auto-detectable but dormant** |
| Spousal Support | `spousal_support` (?) | `isReceivingSupport()` — **always returns false (dormant)** | **GAP: Auto-detectable but dormant** |
| Canada Child Benefit (CCB) | `ccb` or `canada_child_benefit` (?) | `hasChildBenefit()` — **always returns false (dormant)** | **GAP: Auto-detectable but dormant** |
| *(possibly more below scroll)* | Unknown | Unknown | **NEED: Scroll screenshot** |

**CRITICAL FINDING:** Several income types are visible in the Finmo UI but our rules either:
1. Check for the wrong `source` value (e.g., `'retired'` vs `'pension'`/`'cpp'`/`'oas'`)
2. Have rules but are permanently dormant (support, CCB)

**ACTION NEEDED:** Submit a test app with each income type and check the raw API value.

### Conditional fields — Employed (from John Smith API data)
When "Employed" is selected, additional fields appear:
| Field | Type | API Field | Values |
|-------|------|-----------|--------|
| Employer name | Text | `income.employer` | Free text |
| Employer location | Text/address | `income.employerAddress` | Address |
| Job title/description | Text | `income.description` | Free text |
| Pay type | Dropdown | `income.payType` | `salaried`, `hourly_full_time`, `hourly_part_time`, `commission` (?) |
| Job type | Dropdown | `income.jobType` | `full_time`, `part_time`, `contract`, `seasonal` (?) |
| Bonuses | Yes/No | `income.bonuses` | `true` / `false` |
| Commission | Unknown | `income.payType = 'commission'`? | TBD |

**NEED:** Screenshots of Employed sub-fields to confirm all dropdowns.

### Conditional fields — Self Employed (from API data)
When "Self Employed" is selected, additional fields appear:
| Field | Type | API Field | Values |
|-------|------|-----------|--------|
| Business name | Text | `income.employer` (?) | Free text |
| Business type | Text/Dropdown | `income.businessType` | May contain "corporation", "incorporated", "inc" |
| Self pay type | Multi-select? | `income.selfPayType` | Array, may include `"salary"` |
| Industry | Text | `income.industry` | Free text |

**NEED:** Screenshots of Self Employed sub-fields.

### Generic fields (all income types)
| Field | Required | API Field |
|-------|----------|-----------|
| Income type description | No | `income.description` |
| Income from this source | Yes* | `income.amount` |
| Frequency | Dropdown | `income.frequency` | Values: `annually`, `monthly`, `bi_weekly`, `weekly` (?) |
| Start date | Yes* (Month/Day/Year) | `income.startDate` |
| Is this a current source of income? | Yes/No | `income.isActive` or `income.isCurrent` |
| Hide from other borrowers? | Yes/No | `income.hidden` (internal) |

---

## Step 4: Assets

Per-borrower. Can add multiple assets ("Add an asset"). Can skip entirely ("Finish adding assets").

### Asset type dropdown (required)
| UI Label | Probable API Value (`asset.type`) | Our Rule Detection | Status |
|----------|-----------------------------------|-------------------|--------|
| Vehicle | `vehicle` | No rules check vehicles | OK (not relevant for DP) |
| Cash - Chequing Account | `cash_chequing` (?) | `hasDownPaymentAssets()` — checks various types | **VERIFY: Exact API value** |
| Cash - Savings Account | `cash_savings` | `hasDownPaymentAssets()` | WORKING (confirmed in API) |
| Investment (Stocks, Bonds, Mutual Funds, GIC / Term Deposit) | `investment` (?) | Possibly `hasDownPaymentAssets()` | **VERIFY** |
| RRSP / RRIF | `rrsp` or `rrsp_rrif` (?) | `hasDownPaymentAssets()` — checks for `rrsp` | **VERIFY** |
| Gift from immediate family member | `gift` or `gift_family` (?) | `hasGift()` — checks `description.includes('gift')` | **GAP: Should check asset.type instead of description** |
| Other | `other` | Catches inheritance, borrowed, etc. via description | FRAGILE |

**CRITICAL FINDINGS:**
1. **No TFSA option** — Our rules check for TFSA but it's not in the dropdown. Client would use "Cash - Savings Account" or "Other".
2. **No FHSA option** — Same issue. First Home Savings Account not in dropdown.
3. **Gift is a proper type** — Our `hasGift()` searches `description.includes('gift')` but "Gift from immediate family member" is an explicit dropdown option. Should check `asset.type` instead.
4. **No "Down Payment" amount field on assets** — The DP amount is set at the application level, not per-asset. Possible to have a DP declared but 0 assets (like John Smith's app).

### Asset fields (all types)
| Field | Required | API Field |
|-------|----------|-----------|
| Choose an asset | Yes* | `asset.type` |
| Who owns this asset? | Yes* (borrower select) | `asset.borrowerId` or `asset.owners` |
| Asset description | No | `asset.description` |
| Approximate value or balance | No | `asset.value` |

### Rules mapping — Asset fields
| Scenario | Expected Checklist | Current Behavior | Status |
|----------|-------------------|------------------|--------|
| Cash - Savings + Purchase goal | 90-day bank statements | `hasDownPaymentAssets()` checks `asset.type` | **VERIFY value** |
| Gift from immediate family member | Gift letter (internal), donor proof | `hasGift()` checks description text | **FRAGILE — should check type** |
| RRSP/RRIF + Purchase goal | RRSP statement | `hasDownPaymentAssets()` | **VERIFY value** |
| No assets but DP amount > 0 | Should still request bank statements | **BUG: No bank statement requested** | **BUG** |
| Vehicle only | Nothing DP-related | Correctly skipped | OK |

---

## Known Bugs Found

### BUG 1: Rental docs fire for subject property
Per-property rules evaluate using main borrower context, which sees rental income exists on ANY property.
The subject property (owner-occupied) gets rental docs requested even though it has no rental income.
**Fix:** Per-property rules need to check whether *this specific property* has rental income.

### BUG 2: No DP bank statement when assets array empty
John Smith: $10k down payment declared, 0 assets in array.
`hasDownPaymentAssets()` returns false → no bank statement requested.
**Fix:** If `goal === 'purchase'` and `downPayment > 0`, always request bank statements regardless of asset array.

### BUG 3: Gift detection uses description text, not asset type
Finmo has an explicit "Gift from immediate family member" asset type.
Our `hasGift()` checks `asset.description.includes('gift')` which is fragile.
**Fix:** Check `asset.type` for the gift value.

### BUG 4: Pension/CPP/OAS income types likely not detected
Our `isRetired()` checks `source === 'retired'` but the UI has separate Pension, CPP, OAS options.
If these come through as different source values, retired income rules won't fire.
**Fix:** Confirm API values, then add all pension-related source values to the retired detection.

### BUG 5: Support & CCB income types are dormant but auto-detectable
Child Support, Spousal Support, and CCB are explicit income type options in Finmo.
Our rules for these always return false (manual flag required).
**Fix:** Since Finmo explicitly captures these, enable the rules to fire when the source matches.

### BUG 6: TFSA and FHSA not in asset dropdown
Our rules check for these but they can't be selected in Finmo. Not technically a bug in our code,
but means these rules will never fire. Clients would use "Cash - Savings Account" or "Other" instead.
**Impact:** Low — the bank statement rule covers the same docs.

---

## Step 5: Properties (existing properties borrower owns)

"Properties you own" — Step 5 of 8. Can add multiple properties.
Note: This is for EXISTING properties the borrower already owns, NOT the subject property being purchased.

### Property address
| Field | Required | API Field |
|-------|----------|-----------|
| Country | Dropdown (Canada, United States) | `property.address.country` |
| Address | Autocomplete or manual entry | `property.address.*` |

### Property details
| Field | Type | API Field | Possible Values |
|-------|------|-----------|-----------------|
| Borrower(s) who own this property | Multi-select (from borrower list) | `property.owners` / `property.borrowerIds` | Borrower names |
| How much is the property worth? | Currency | `property.currentValue` | e.g. $200,000 |
| Will this property be sold before or during purchase? | Yes/No radio | `property.isSelling` | `true` / `false` |
| Annual property taxes | Currency | `property.annualTaxes` | e.g. $35,000 |
| Monthly condo fees (if applicable) | Currency | `property.monthlyFees` | e.g. $5,000 |

### "How is this property being used?" (radio select)
| UI Label | Probable API Value (`property.use`) | Rules Affected |
|----------|-------------------------------------|----------------|
| Owner Occupied | `owner_occupied` | No rental docs needed |
| Owner Occupied / Rental | `owner_occupied_rental` (?) | Rental income likely, should trigger rental docs |
| Rental / Investment | `investment` or `rental_investment` | `hasRentalIncome()` — triggers lease, tax bills, T1/T776, mortgage stmt |
| Second Home / Vacation Property | `second_home` or `vacation` (?) | No rental docs unless rental income declared |

**KEY FINDING:** "Owner Occupied / Rental" is a specific use type — means borrower lives there AND rents part of it. Our rules should detect this as having rental income too, not just `investment`.

### "Is your property still mortgaged?" (Yes/No)
Conditional fields when Yes:

**Mortgage information (per mortgage — can add multiple "Add another mortgage")**
| Field | Type | API Field | Possible Values |
|-------|------|-----------|-----------------|
| Current rate | Percentage | `mortgage.rate` | e.g. 5% |
| Term length | Dropdown | `mortgage.term` | 6 months, 1 year, 2 years, 3 years, 4 years, 5 years, 10 years, other |
| Rate type | Radio | `mortgage.rateType` | Fixed, Variable |
| Payment frequency | Dropdown | `mortgage.paymentFrequency` | Weekly, Every two weeks (regular bi-weekly), Twice a month (semi-monthly), Monthly, Accelerated bi-weekly, Accelerated weekly |
| Payment amount | Currency | `mortgage.payment` | e.g. $2,500 |
| Lender | Text | `mortgage.lender` | e.g. "lender a" |
| Remaining balance | Currency | `mortgage.balance` | e.g. $85,000 |
| Renewal date | Month/Day/Year | `mortgage.renewalDate` | Date |

### Rules mapping — Property fields
| UI Field | Checklist Impact | Status |
|----------|------------------|--------|
| Use = Owner Occupied | No rental docs | OK |
| Use = Owner Occupied / Rental | Should trigger rental docs (lease, tax, T776) | **GAP: Need to verify API value and rule detection** |
| Use = Rental / Investment | Triggers rental income rules | WORKING (but BUG 1 applies — fires for wrong properties) |
| Use = Second Home / Vacation | No rental docs unless rentalIncome > 0 | OK |
| isSelling = Yes | Triggers property sale docs (s14_dp_property_sale) | WORKING |
| Has mortgage = Yes | Mortgage statement needed for rental properties | WORKING |
| Condo fees > 0 | May indicate condo — could trigger condo docs | **No rule currently** |

### BUG 7: "Owner Occupied / Rental" use type detection
The property `use` field can be "Owner Occupied / Rental" — a mixed-use scenario. Need to verify:
1. What API value this sends
2. Whether our rental income rules detect it (they check `property.rentalIncome > 0`, not `property.use`)
3. If a property has this use type but no `rentalIncome` amount, rental docs should still be triggered

### NOTE: No rental income field visible in UI
The Property form does NOT show a "Monthly rental income" field in these screenshots.
However, John Smith's API data shows `rentalIncome: 1200` on his investment property.
**Question:** Does this field appear conditionally when use = Rental/Investment? Or is it set elsewhere?

---

## Known Bugs Found (updated)

### BUG 1: Rental docs fire for subject property
Per-property rules evaluate using main borrower context, which sees rental income exists on ANY property.
The subject property (owner-occupied) gets rental docs requested even though it has no rental income.
**Fix:** Per-property rules need to check whether *this specific property* has rental income.

### BUG 2: No DP bank statement when assets array empty
John Smith: $10k down payment declared, 0 assets in array.
`hasDownPaymentAssets()` returns false → no bank statement requested.
**Fix:** If `goal === 'purchase'` and `downPayment > 0`, always request bank statements regardless of asset array.

### BUG 3: Gift detection uses description text, not asset type
Finmo has an explicit "Gift from immediate family member" asset type.
Our `hasGift()` checks `asset.description.includes('gift')` which is fragile.
**Fix:** Check `asset.type` for the gift value.

### BUG 4: Pension/CPP/OAS income types likely not detected
Our `isRetired()` checks `source === 'retired'` but the UI has separate Pension, CPP, OAS options.
If these come through as different source values, retired income rules won't fire.
**Fix:** Confirm API values, then add all pension-related source values to the retired detection.

### BUG 5: Support & CCB income types are dormant but auto-detectable
Child Support, Spousal Support, and CCB are explicit income type options in Finmo.
Our rules for these always return false (manual flag required).
**Fix:** Since Finmo explicitly captures these, enable the rules to fire when the source matches.

### BUG 6: TFSA and FHSA not in asset dropdown
Our rules check for these but they can't be selected in Finmo. Not technically a bug in our code,
but means these rules will never fire. Clients would use "Cash - Savings Account" or "Other" instead.
**Impact:** Low — the bank statement rule covers the same docs.

### BUG 7: "Owner Occupied / Rental" property use type
Mixed-use property type exists in Finmo UI. Need to verify API value and ensure rental rules fire for it.

### BUG 8: Borrower contact type set to N/A instead of "Client"
MBP contacts created from Finmo apps have `Contact type: N/A`. Should be `Client`.
MBP Contact type options: N/A, Lead, Client, Realtor, Lawyer, Financial Advisor / Planner, Other Referral Source, Associate(?).

### BUG 9: Realtors and lawyers from Finmo not synced to MBP
When a Finmo application includes a realtor or real estate lawyer (Step 6: Professionals),
those professionals should be upserted as MBP contacts with the correct contact type:
- Realtor → `Contact type: Realtor`
- Real estate lawyer → `Contact type: Lawyer`
Fields available from Finmo: full name, email, phone, brokerage (realtor) or law firm + fax (lawyer).

---

## Screenshot Coverage Status

- [x] Goal (Step 1) — Purchase/Renew/Refinance, process, province
- [x] Borrowers (Step 2) — contact info, personal details, living history, marital status, dependents
- [x] Income (Step 3) — income type dropdown (8 visible options), generic fields, current toggle
- [x] Assets (Step 4) — asset type dropdown (7 options), owner select, description, value
- [x] Properties (Step 5) — address, owner, value, selling, taxes, condo fees, use type (4 options), rental income (conditional), mortgage info
- [x] Professionals (Step 6) — realtor (name/email/phone/brokerage), lawyer (name/email/phone/fax/firm)
- [ ] Consent (Step 7) — not provided (likely just consent checkboxes, low checklist impact)
- [ ] Additional details (Step 8) — not provided
- [ ] Employed sub-fields — pay type dropdown, job type dropdown, bonuses toggle (inferred from API data)
- [ ] Self Employed sub-fields — business type, incorporated detection (inferred from API data)
- [ ] Renew/Refinance conditional fields

## Additional Notes

### Co-borrowers
Multiple borrowers can be added. Each fills out Income, Assets, Properties independently.
Asset/Property owner dropdowns list all borrowers. Income has "hide from other borrowers" toggle.

### Rental income conditional field
"What is the rental income for this property each year?" appears ONLY when property use is:
- Owner Occupied / Rental → shown
- Rental / Investment → shown
- Owner Occupied → hidden
- Second Home / Vacation Property → hidden

### MBP Contact Types (from GoHighLevel)
N/A, Lead, Client, Realtor, Lawyer, Financial Advisor / Planner, Other Referral Source, Associate(?)
