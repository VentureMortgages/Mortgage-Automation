# Email Template Reference — Cat's Current Format

**Source:** Cat's example email shared Feb 11 2026
**Status:** Reference for Phase 5 (Email Drafting)

---

## Example Email (Real)

```
Hey [Names]!

Thanks for filling out the application. As Taylor mentioned, I'll just collect some
supporting documents. We like to do the majority of document collection up front to
ensure the accuracy of your pre-approval budget and it will also make the process
easier down the line.

Megan
Letter of Employment confirming back to work date
Last pay stub prior to your mat leave
2024 T4
2 pieces of ID

Cory
2023/2024 T1s
2023/2024 Notice of Assessments: if your 2024 NOA shows an amount owing, please
also provide your CRA Statement of account showing all income tax has been paid.
2 years business financials for RunGuide Media
Partnership Agreement (or similar, if applicable)
2 pieces of ID

Smoke Bluff Rd:
Current Mortgage Statement
Lease Agreement for $1900
2025 Property Tax Bill

Keefer Place:
Current Mortgage Statement
2025 Property Tax Bill
Confirmation of Condo Fees: via Annual Strata Statement outlining the fees for your
unit or 3 months bank statements showing the withdrawals.

Other
Void Cheque: for the account you anticipate your payments to be made from
3 months bank statements for the account(s) holding your down payment funds

You can send these documents directly to my email and if you have any questions let
me know!

Thanks!
```

---

## Template Structure

1. **Greeting**: `Hey [FirstName(s)]!` — casual, warm
2. **Intro paragraph**: Brief explanation of why docs upfront (1-2 sentences)
3. **Per-person sections**: First name as header, their docs listed below
4. **Per-property sections**: Street name/address as header, property-specific docs below
5. **"Other" section**: Shared docs (void cheque, down payment statements, etc.)
6. **Closing**: "Send docs to my email, questions let me know. Thanks!"

---

## Style Notes

- **Tone**: Professional-casual. "Hey!", "let me know!", not corporate.
- **Doc names**: Plain language ("2 pieces of ID" not "Government-issued photo identification")
- **Conditional notes inline**: "if your NOA shows amount owing, please also provide..."
- **Tax years explicit**: "2023/2024 T1s" not "most recent 2 years of T1s"
- **Brief context where helpful**: "for the account you anticipate your payments to be made from"
- **Employment-specific**: Tailored per person's situation (mat leave, self-employed, etc.)
- **No numbering**: Plain list, not numbered checkboxes
- **Company names included**: "2 years business financials for RunGuide Media"
- **Property details included**: Lease amounts ("$1900"), specific property names

---

## Design Implications for Phase 5

- Email generator must group by: person → property → other
- Must resolve first names from Finmo application data
- Must include conditional notes (NOA → CRA Statement, condo fees options, etc.)
- Must tailor doc list per person's employment/income type
- Must include property addresses from application
- Must use plain language, not formal doc type names
- Template should match Cat's tone — draft should feel like Cat wrote it
- Cat reviews and can edit before sending (human-in-the-loop)
