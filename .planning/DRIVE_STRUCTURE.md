# Google Drive Folder Structure Analysis

**Source:** Screenshots from Cat's Google Drive (Feb 2026)
**Status:** Partial — need more examples to confirm patterns

---

## Top Level: `Mortgage Clients/`

### Status Folders (numbered)
- `1 - Funded/Closed` — completed deals
- `3 - Pre approval (long term)` — active pre-approvals
- (Likely `2 - ...` exists but not shown in screenshots)

### Client Folders
Individual client folders also sit directly at `Mortgage Clients/` root level alongside status folders.

---

## Client Folder Naming Convention

| Pattern | Example | Notes |
|---------|---------|-------|
| Single client | `Day, Hannah` | `LastName, FirstName` |
| Single client | `Arrell, Colleen` | |
| Couple (same last name) | `Brown, Trina/Trevor` | `LastName, FirstName1/FirstName2` |
| Couple (same last name) | `Devick, Krystal/Michael` | |
| Couple (same last name) | `Albrecht, Terry/Kathy` | |
| Couple (different last names) | `Comeau/Soto, Leeve/Paula` | `LastName1/LastName2, FirstName1/FirstName2` |
| Couple (different last names) | `Banner, James/ Harris, Ian` | Note: inconsistent space after `/` |
| Multiple people | `Greenwood, James/Caroline` | |

**Key observations:**
- Format is always `LastName, FirstName`
- Couples use `/` separator between names
- Different last names: both last names separated by `/` before the comma
- Spacing is slightly inconsistent (sometimes space after `/`, sometimes not)

---

## Inside a Client Folder

### Subfolder Structure (from Albrecht, Terry/Kathy)

```
Albrecht, Terry/Kathy/
├── Kathy/                          ← Person subfolder (income + personal docs)
│   ├── *Kathy - Income Docs.pdf    ← Bundled income package (* prefix)
│   ├── Kathy - ID.pdf
│   ├── Kathy - T4A CPP 2024 $16k.pdf
│   ├── Kathy - T4A OAS 2024 $8.6k.pdf
│   ├── Kathy - T4A RBC 2024 $22k.pdf
│   ├── Kathy - T4RIF Scotia 2 2024 $12.5k.pdf
│   ├── Kathy - T4RIF Scotia 2024 $15k.pdf
│   ├── Kathy - T5 GSC 2024 $1.8k.pdf
│   └── Kathy - TurboTax "T1" Email.pdf
├── Terry/                          ← Person subfolder
│   ├── *Terry - Income Docs.pdf
│   ├── Terry - ID.pdf
│   ├── Terry - T4A CPP 2024 $16k.pdf
│   ├── Terry - T4A OAS 2024 $8.6k.pdf
│   ├── Terry - T4RIF IG 2024 $15k.pdf
│   ├── Terry - T4RIF Scotia 2 2024 $1,600.pdf
│   ├── Terry - T4RIF Scotia 2024 $34k.pdf
│   ├── Terry - T5 2024 Desjardins $585.pdf
│   ├── Terry - T5 Scotia 2024 $5.2k.pdf
│   └── Terry - TurboTax "T1" Email.pdf
├── Subject Property/               ← Property being purchased/refinanced
│   ├── 4587 Postill Dr - MLS.pdf
│   ├── 4587 Postill Dr - PDS.pdf
│   ├── 4587 Postill Dr - Purchase Agreement.pdf
│   └── 4587 Postill Dr - Title.pdf
├── Non-Subject Property/           ← Other properties they own
│   ├── Bridle Hill - Sale Agreement.pdf
│   ├── Bridlehill - MLS/PDS/Title/Waivers.pdf
│   └── Bridlehill Court - Current Scotia HELOC.pdf
├── Signed Docs/                    ← Lender paperwork, consents, commitment letters
│   ├── Amortization Schedule.pdf
│   ├── Application Summary.pdf
│   ├── BC Disclosure Statement.pdf
│   ├── BC Form 10.pdf
│   ├── Form 10 Confirmation.png    ← NOTE: non-PDF exists
│   ├── Kathy - Credit Consent May 21.pdf
│   ├── Material Risk Form.pdf
│   ├── MPP No Offer .pdf
│   ├── Scotia Commitment Letter.pdf
│   └── Terry - Credit Consent May 21.pdf
├── Albrecht Void Cheque.JPG        ← Root-level: shared docs (both people)
├── Kathy - Scotia Bank Account Summary $630k+.pdf
└── Terry - Scotia Bank Accounts Summary.pdf
```

---

## File Naming Conventions

### Personal Documents (income, ID)
Format: `FirstName - DocType [Year] [Amount].pdf`

| Example | Pattern |
|---------|---------|
| `Kathy - ID.pdf` | `Name - DocType` |
| `Kathy - T4A CPP 2024 $16k.pdf` | `Name - DocType Source Year Amount` |
| `Terry - T4RIF Scotia 2024 $34k.pdf` | `Name - DocType Institution Year Amount` |
| `Terry - T5 2024 Desjardins $585.pdf` | `Name - DocType Year Institution Amount` (inconsistent order) |
| `*Kathy - Income Docs.pdf` | `*` prefix = bundled/combined package |
| `Kathy - TurboTax "T1" Email.pdf` | Informal naming for email screenshots of tax docs |

### Property Documents
Format: `Address - DocType.pdf`

| Example | Pattern |
|---------|---------|
| `4587 Postill Dr - MLS.pdf` | `Address - DocType` |
| `4587 Postill Dr - Purchase Agreement.pdf` | `Address - DocType` |
| `Bridlehill Court - Current Scotia HELOC.pdf` | `PropertyName - Description` |

### Shared/Root Documents
Format: `LastName DocType.ext` (less consistent)

| Example | Pattern |
|---------|---------|
| `Albrecht Void Cheque.JPG` | `LastName DocType` (no dash separator) |
| `Kathy - Scotia Bank Account Summary $630k+.pdf` | Same as personal docs pattern |

---

## Observations & Design Implications

### Naming inconsistencies we must handle
1. Amount format varies: `$16k`, `$5.2k`, `$1,600`, `$585`, `$630k+`
2. Order of fields varies: sometimes `DocType Year Institution`, sometimes `DocType Institution Year`
3. `*` prefix for bundled packages
4. Some files are JPG/PNG not PDF (void cheque, form confirmation)
5. Quotes in filenames: `TurboTax "T1" Email.pdf`
6. Space inconsistencies in folder names: `James/ Harris` vs `Trina/Trevor`

### How to match client to folder
- Primary: match Finmo applicant `LastName, FirstName` to folder name
- Challenge: couples — Finmo has primary applicant + co-borrower, folder combines both
- Need: mapping table or fuzzy match logic
- Safest: when system creates a new client, also create/find the Drive folder and store the folder ID in CRM

### How to file documents to correct subfolder
- Income/ID docs → person subfolder (`Kathy/`, `Terry/`)
- Property docs → `Subject Property/` subfolder
- Other property docs → `Non-Subject Property/`
- Lender/legal docs → `Signed Docs/`
- Shared docs (void cheque, bank summaries) → client folder root

### Multiple deals per client
- **UNKNOWN** — Need to confirm with Cat: do they create a new folder for a repeat client, or reuse the same one?
- Current structure suggests per-client, not per-deal (no deal-level subfolders visible)

### Document reuse potential
- Year-specific docs (T4, T4A, NOA, T1): valid for tax year only. New year = need new doc.
- ID: valid until expiry date on the ID
- Articles of Incorporation: doesn't change
- Employment letter: needs to be recent (within 30 days typically)
- Property docs: deal-specific, not reusable

### Multiple family members
- Handled via person subfolders within the client folder
- System needs to identify WHICH person a doc belongs to and file accordingly
- Co-borrower detection needed: if couple, create both person subfolders

---

## Single Applicant Example (Hunter, Susan)

Located at: `Mortgage Clients/Hunter, Susan/` (root level, not inside a status folder)

```
Hunter, Susan/
├── Susan/                          ← Person subfolder (even for single applicant)
│   ├── RBC #4796 3 months CPP $567.12:mo.pdf
│   ├── Susan - CPP Entitlement Dec 2025.pdf
│   ├── Susan - CRA payment.pdf
│   ├── Susan - ID.pdf
│   ├── Susan - Job Offer Letter Nov 26 $33k.pdf
│   ├── Susan - LOE Dec 22 $37k.pdf
│   ├── Susan - NOA 2024.pdf
│   ├── Susan - Pay Stub Dec 5.pdf
│   ├── Susan - T1 2024.pdf
│   └── Susan - Year End Pay Stub.pdf
├── Down Payment/                   ← Situational subfolder (not always present)
├── Life Insurance Payout/          ← Situational subfolder (deal-specific)
├── Non-Subject Property/
├── Signed Docs/
├── Subject Property/
├── Manulife Rental Worksheet (1).xls
├── Susan budget (Google Sheet)
├── Susan.png                       ← Photo/screenshot
└── Void Cheque.pdf
```

**Key finding:** Single applicants still get a person subfolder. Cat also creates deal-specific subfolders as needed (Down Payment, Life Insurance Payout).

---

## Where Client Folders Live

Client folders can exist in multiple locations:
- `Mortgage Clients/1 - Funded/Closed/` — completed deals
- `Mortgage Clients/3 - Pre approval (long term)/` — active pre-approvals
- `Mortgage Clients/` (root) — also has client folders directly (Hunter, Susan; Arrell, Colleen; etc.)

**Implication:** System cannot assume a client folder is always inside a status subfolder. Need to search across all locations, or store the folder ID when we first link a client.

---

## Pre-Approval vs Funded — Structural Differences

| Feature | Funded/Closed (Albrecht) | Pre-Approval (Bell, Bennett) |
|---------|--------------------------|------------------------------|
| Person subfolders | Yes (`Terry/`, `Kathy/`) | Yes (`Davin/`, `Monika/`, `Andrew/`, `Tabitha/`) |
| Subject Property | Yes | Sometimes (Bennett has it, Bell doesn't) |
| Non-Subject Property | Yes | Sometimes (Bell has it, Bennett doesn't) |
| Signed Docs | Yes | No (not yet at that stage) |
| Budget spreadsheet | Not visible | Yes (Google Sheets by Taylor) |
| Loose root files | Some (void cheque, bank summaries) | More common (banking/down payment docs) |

**Key insight:** Subfolder structure evolves as the deal progresses. Pre-approvals may not have Subject Property or Signed Docs yet. Our system should create subfolders as needed, not all upfront.

---

## Naming Convention Consistency

### Consistent (inside person subfolders — income docs)
- `Name - DocType Year Amount.pdf` pattern followed ~80% of the time
- Examples: `Kathy - T4A CPP 2024 $16k.pdf`, `Terry - T5 Scotia 2024 $5.2k.pdf`

### Inconsistent (root-level files — banking/down payment docs)
- `CIBC #6937 May $31k.pdf` — no person name, account number used
- `CIBC FHSA Andrew Jan-March $16k.pdf` — person name in middle
- `RRSP 90 day Andrew $31k.pdf` — different order
- `Tabitha - April Statement Savings:RSP $140k.pdf` — uses `Name -` prefix but different structure

**Design implication:** Our classifier should follow the `Name - DocType` convention for output, but must handle messy input naming. Don't rely on filename for classification — use content analysis.

---

## Folder Name vs Actual Occupants

`Bell, Davin` folder contains subfolders for both `Davin/` and `Monika/`, but folder name only shows Davin. This means:
- Folder name may reflect primary applicant only
- Co-borrowers may be added later without renaming folder
- Cannot rely on folder name alone to determine all people in a deal
- System should track occupants separately from folder name

---

## Full Folder Inventory (via API, Feb 11 2026)

### Folder Counts by Location

| Location | Client Folders | Other Items |
|----------|---------------|-------------|
| Root (Mortgage Clients/) | 24 | 1 spreadsheet + 2 status folders |
| 1 - Funded/Closed | ~105 | 1 PDF (consent form) |
| 3 - Pre approval (long term) | 39 | — |
| **Total unique client folders** | **~168** | |

**No `2 - ...` status folder exists.** Only `1 - Funded/Closed` and `3 - Pre approval (long term)`.

---

## Repeat Client Analysis (ANSWERED)

**Question:** Does Cat create new folders for repeat clients or reuse existing ones?
**Answer:** **New folder each time.** Multiple clients have 2-3 separate folders for different deals.

### Confirmed Repeat Clients (multiple folders)

| Client | Folders Found | Notes |
|--------|--------------|-------|
| **Power, Callan** | 3 folders: `Power, Callan (Refi)` + `Power, Callan/Sondrea` ×2 | Explicit refinance deal + 2 purchase deals |
| **Brown, Spencer** | 3 folders: `Brown, Spencer` + `Brown, Spencer/Lindsay` + `Brown, Spencer/Lindsey` | Solo + couple (spelling variation) |
| **Pellerin, Steffie** | 2+ folders: standalone ×2 + combined `Pellerin, Jessika/Pellerin, Steffie/Plamondon Chantal` | Multiple deals |
| **Pellerin, Jessika** | 2 folders: standalone + combined (above) | |
| **Olsen, Gary** | 2 folders (both in Funded) | Same name, different folder IDs |
| **Pitre, Andrew** | 2 folders (both in Funded) | Same name, different folder IDs |
| **Atkinson, Jesse** | 2 folders: `Atkinson, Jesse/Nancy` + `Atkinson, Jesse` | Likely broker's family |
| **Festerling, Amber/Garrett** | 2 folders (spacing variation) | |
| **Zurstrom** | 2 folders: `Josh/Annie` + `Annie/Joshua` | Name order reversed |

### Cross-Location Duplicates (client appears in multiple stages)

| Client | Root | Funded | Pre-Approval | Notes |
|--------|------|--------|-------------|-------|
| Newby, Sean/Kelly | ✓ | ✓ | | Active + funded deal |
| Comeau, Leeve/Paula | ✓ | ✓ (×2 variants) | | Multiple deals |
| Ungaro, Kayla/Warren | ✓ | ✓ (as Ungaro/Bongers) | | Name format changed |
| Fedak, Megan | | ✓ | ✓ | Funded + new pre-approval |

### Related Family Members (same surname, different people)

| Surname | Entries |
|---------|---------|
| Brown | Spencer/Lindsay, Spencer, Spencer/Lindsey, Don, Trina/Trevor (root), Katlin/Jeff (pre-approval) |
| Ungaro | Kayla/Warren (root+funded), Tim/Michelle (funded) |
| Pannu | Stefano/Danielle + Stefano/Elsa/Sasha (funded) — same person, different co-applicants |
| Krahn | Denise/Chris ×2 + Kanaan/Denise (pre-approval) |
| Landry | Ryan/Cara (funded) + Ryan/Caralynn (old format, funded) |

### Old Naming Convention (non-standard entries in Funded)

These don't follow `LastName, FirstName` pattern:
- `Neuman` (no first name)
- `Malito Family`
- `James Ken and Caylee and Jayce Campbell`
- `Patel Khushbu`
- `Hartsook Kowen and Lindsay`
- `Tobin Austin and Ellen and Ryan Landry`
- `Landry Ryan and Caralynn`
- `McKay Dawson and Leona`
- `Masum` (pre-approval, no first name)

These appear to be older entries predating the current naming convention.

---

## Design Implications (Updated)

### Repeat clients = NEW folder per deal
- System must NOT deduplicate folders — Cat intentionally creates separate folders per deal
- When automation creates a folder, always create new (never merge into existing)
- Store folder ID per deal in CRM, not per client

### Naming inconsistency is real
- Same couple can appear as `Brown, Spencer/Lindsay` or `Brown, Spencer/Lindsey` (typo)
- Name order can flip: `Zurstrom, Josh/Annie` vs `Zurstrom, Annie/Joshua`
- Some include maiden/extra names: `Ungaro/Bongers, Kayla/Warren`
- Old entries use `FirstName LastName` instead of `LastName, FirstName`
- **Automation should enforce consistent naming going forward**

### Folder location varies
- Active deals: Root level
- Funded: `1 - Funded/Closed/`
- Long-term pre-approvals: `3 - Pre approval (long term)/`
- Some funded deals also at root (haven't been moved yet)
- **System should always store folder ID, never rely on path**

### ~168 client folders total
- Manageable size for search/matching
- But fuzzy matching needed given naming inconsistencies

---

## Open Questions for Cat

1. ~~When a repeat client comes back, do you create a new folder or add to the existing one?~~ **ANSWERED: New folder each time.**
2. ~~Is there a `2 - ...` status folder?~~ **ANSWERED: No. Only 1 and 3 exist.**
3. What does the `*` prefix mean on bundled files (e.g., `*Kathy - Income Docs.pdf`)?
4. ~~For single applicants with no co-borrower, do you still create a person subfolder?~~ **ANSWERED: Yes (Hunter, Susan example).**
5. Do clients ever move between status folders (e.g., from root to `1 - Funded/Closed`) or do folders stay where they were created?

---
*Analysis date: 2026-02-11*
*Sources: Screenshots (Albrecht, Bell, Bennett, Hunter) + Google Drive API via n8n*
