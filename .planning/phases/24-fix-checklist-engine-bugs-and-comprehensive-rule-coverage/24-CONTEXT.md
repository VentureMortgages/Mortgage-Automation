# Phase 24: Fix Checklist Engine Bugs and Comprehensive Rule Coverage - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix all 9 known bugs in the checklist engine, harden all fragile detection patterns, activate all auto-detectable dormant rules, and audit every Finmo UI field to ensure it maps to a rule (or is explicitly marked N/A). Also fix CRM bugs 8 (contact type) and 9 (realtor/lawyer sync) discovered during the audit. This is a full audit + fix phase.

</domain>

<decisions>
## Implementation Decisions

### Phase Scope
- Full audit: every Finmo UI field must map to a checklist rule or be documented as N/A
- Fix all 9 known bugs (including CRM bugs 8 and 9)
- Harden ALL fragile detection patterns (gift, inheritance, borrowed DP) — check asset.type first, fallback to description
- Add NEW rules for gaps where Finmo already captures the data (first-time buyer, owner-occupied/rental use type, etc.)
- Code from FINMO-UI-FIELDS.md as source of truth; handle uncertain API values defensively

### Bug Fix Approach
- **BUG 1 (per-property rental):** Per-property rules must evaluate against the specific property, not all properties
- **BUG 2 (empty assets DP):** If goal=purchase and downPayment > 0, always request bank statements regardless of asset array
- **BUG 3 (gift detection):** Check asset.type for gift value first, fallback to description
- **BUG 4 (pension/CPP/OAS):** Check for ['retired', 'pension', 'cpp', 'oas'] in source field
- **BUG 5 (dormant rules):** Activate support, CCB, and pension rules since Finmo auto-detects them
- **BUG 6 (TFSA/FHSA):** Claude's discretion on handling
- **BUG 7 (owner-occupied/rental):** Use explicit property use type matching
- **BUG 8 (contact type):** Set borrowers to "Client", realtors to "Realtor", lawyers to "Lawyer"
- **BUG 9 (professional sync):** Auto-create MBP contacts for realtors and lawyers from Finmo apps

### Dormant Rule Activation
- Activate ALL auto-detectable rules: Child Support, Spousal Support, CCB, Pension/CPP/OAS
- Leave non-auto-detectable rules dormant (maternity, probation, bankruptcy, newcomer, work permit, non-resident) — Cat keeps manual control
- Activated rules go directly into client emails (no staging period as internal-only)

### API Value Handling
- Check all likely variants for uncertain values (belt and suspenders)
- Log unrecognized values for monitoring
- Use explicit matching for property use types (owner_occupied, owner_occupied_rental, rental_investment, second_home) — no negation patterns
- Claude's discretion on where to surface unrecognized value alerts

### CRM Professional Sync (Bug 9)
- Auto-create MBP contacts for realtors and lawyers included in Finmo applications
- Differentiate contact types by role: borrowers = Client, realtors = Realtor, lawyers = Lawyer
- Claude's discretion on whether to link professionals to the opportunity or create as standalone contacts

### Claude's Discretion
- Handling of low-impact gaps (TFSA/FHSA not in Finmo dropdown, dependents count) — document as N/A, add commented-out rules, or skip
- Alerting mechanism for unrecognized Finmo values (Railway logs, CRM task, or other)
- Whether to link realtor/lawyer contacts to the opportunity or just create them
- Per-property rule evaluation architecture (how to pass current property to rule context)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `generateChecklist()` in `src/checklist/engine/generate-checklist.ts` — core function, needs BUG 1 fix for per-property evaluation
- `buildBorrowerContexts()` in `src/checklist/engine/build-context.ts` — creates RuleContext per borrower
- `RuleContext` interface in `src/checklist/types/checklist.ts` — may need `currentProperty` field for BUG 1 fix
- 86 existing rules across 10 rule files in `src/checklist/rules/`
- CRM contact creation in webhook handler — existing pattern for borrower upsert, extend for professionals

### Established Patterns
- Rules use `ChecklistRule` interface with `condition(ctx)` and optional `excludeWhen(ctx)`
- Per-borrower rules evaluate independently per borrower
- Per-property rules currently use main borrower's context (the bug)
- Dormant rules use `return false` — activation means replacing with actual condition logic
- `internalOnly: true` flag separates internal flags from client-facing items
- `displayNameFn()` for dynamic labels based on context

### Integration Points
- `src/checklist/rules/down-payment.ts` — BUG 2, 3 fixes (hasDownPaymentAssets, hasGift)
- `src/checklist/rules/income-other.ts` — BUG 4 fix (isRetired)
- `src/checklist/rules/variable-income.ts` — BUG 5 fix (isReceivingSupport, hasChildBenefit)
- `src/checklist/rules/property.ts` — BUG 7 fix (explicit use type matching)
- `src/checklist/engine/generate-checklist.ts` — BUG 1 fix (per-property evaluation loop)
- Webhook handler — BUG 8 (contact type), BUG 9 (professional sync)

### Test Files
- `src/checklist/__tests__/generate-checklist.test.ts` — core tests
- `src/checklist/__tests__/co-borrower.test.ts` — co-borrower handling
- `src/crm/__tests__/checklist-mapper.test.ts` — CRM field mapping
- Tests need updates for all bug fixes and new rules

</code_context>

<specifics>
## Specific Ideas

- FINMO-UI-FIELDS.md in this phase directory is the comprehensive audit reference — all bugs and gaps documented there
- For BUG 1: per-property rules need the current property injected into context, not just access to all properties
- For hardening: pattern should be type-first, description-fallback (e.g., check asset.type === 'gift' first, then check description.includes('gift'))
- For unknown API values: log as warning-level, include the actual value in the log message for easy diagnosis

</specifics>

<deferred>
## Deferred Ideas

- CRM toggle fields for manual-flag rules (maternity, bankruptcy, newcomer) — future phase if needed
- Province-specific rules (land transfer tax for ON/BC) — noted in FINMO-UI-FIELDS.md
- Employed/Self-Employed sub-field screenshots needed for complete dropdown verification
- Consent (Step 7) and Additional Details (Step 8) screenshot audit — low checklist impact

</deferred>

---

*Phase: 24-fix-checklist-engine-bugs-and-comprehensive-rule-coverage*
*Context gathered: 2026-03-04*
