# Phase 25: Smart Forwarding Notes & Filing Feedback - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Three fixes to the doc intake pipeline, triggered by a real production failure where Cat forwarded docs for Srimal and Carolyn Wong-Ranasinghe and the system created 3 duplicate Drive folders instead of filing to the existing one.

**Root causes identified:**
1. Regex-based forwarding note parser can't handle natural language notes with multiple clients/doc types
2. Auto-create logic creates new Drive folders without checking for existing matching folders
3. No feedback to Cat about what the system did with her forwarded docs

**Scope:** Forwarding note parsing, Drive folder matching before auto-create, filing confirmation email to sender.
</domain>

<decisions>
## Implementation Decisions

### 1. AI Forwarding Note Parser (replace regex)

- **Replace `parseForwardingNote()` in `src/intake/body-extractor.ts`** with a Gemini Flash call
- One API call per forwarded message (not per doc) — ~50 tokens, negligible cost
- Structured output schema returns:
  ```json
  {
    "clients": ["Srimal Wong-Ranasinghe", "Carolyn Wong-Ranasinghe"],
    "docs": [
      { "client": "Srimal", "type": "ID" },
      { "client": "Carolyn", "type": "ID" },
      { "client": "Srimal", "type": "Statement of Account" }
    ],
    "rawNote": "original text"
  }
  ```
- `ForwardingNotes` interface expands to support multiple clients + per-doc assignments
- Downstream: each attachment gets its own client assignment from the parsed note (not one clientName for the whole batch)
- Fallback: if Gemini call fails, fall back to regex parser (non-fatal)
- Model: `gemini-2.0-flash` (same as classification)

### 2. Drive Folder Fuzzy Matching Before Auto-Create

- **Before creating a new folder**, search the prod root for existing folders whose name fuzzy-matches the client
- Match logic: normalize names (case-insensitive, ignore punctuation) and check if either name is a substring of an existing folder name
- Examples:
  - Looking for `RANASINGHE, SRIMAL` → finds `Wong-Ranasinghe, Carolyn/Srimal` ✓
  - Looking for `WONG, CAROLYN` → finds `Wong-Ranasinghe, Carolyn/Srimal` ✓
- If a match is found, use that folder ID and link it to the CRM contact
- If multiple matches found, route to Needs Review (ambiguous)
- Integration point: `autoCreateFromDoc()` in `src/matching/auto-create.ts` — add folder search before `findOrCreateFolder()`

### 3. Filing Confirmation Email to Sender

- After processing all docs from a forwarded email, send a summary reply to the **sender** (whoever forwarded to docs@)
- Reply to the original message thread (same Gmail threadId)
- Content: list of docs processed, where each was filed, any that need review
- Example:
  ```
  Filed 5 documents from your forwarded email:

  ✓ Srimal - ID (Driver's License) → Wong-Ranasinghe, Carolyn/Srimal/Srimal/ID/
  ✓ Srimal - Passport → Wong-Ranasinghe, Carolyn/Srimal/Srimal/ID/
  ✓ Srimal - CRA Statement → Wong-Ranasinghe, Carolyn/Srimal/Srimal/Tax/
  ✓ Carolyn - ID (Driver's License) → Wong-Ranasinghe, Carolyn/Srimal/Carolyn/ID/
  ⚠ Carolyn - Passport → Needs Review (low confidence match)
  ```
- Uses `gmail.compose` scope (already have it) to send from docs@
- Sender detection: read `From` header of the forwarded email
- If sender is dev@ → reply goes to dev@ (for testing)
- If sender is admin@ → reply goes to admin@ (Cat's feedback loop)

### 4. Link Existing Folders to CRM Contacts (Immediate Fix)

- Link `Wong-Ranasinghe, Carolyn/Srimal` folder (id=1IESaMxZKcqe1PN63--PhKc39S9HYqVkf) to:
  - CRM contact `srimal ranasinghe` (T56fC66Fmw2SOWuErm8N)
  - CRM contact `carolyn wong-ranasinghe` (Z1w4Bn0PzA83MEDoBwYa)
- This is a one-time data fix but also validates the folder-linking flow
</decisions>

<verification>
## Acceptance Criteria

1. Cat re-forwards the same email ("Srimal and Carolyn Wong-Ranasignhe ID's and Srimal's Statement of Account") and all 5 docs file to the correct existing folder
2. No duplicate folders created
3. Cat (or dev@ for testing) receives a confirmation email listing where each doc was filed
4. Forwarding notes with multiple clients + doc types are parsed correctly by AI
5. If existing Drive folder found by fuzzy match, no new folder created
6. All existing tests still pass
</verification>

<test_plan>
## Test Plan

1. **AI parser unit tests:** Various note formats (single client, multi-client, with/without doc types, typos, natural language)
2. **Drive folder matching tests:** Fuzzy match finds existing folders, handles no match, handles ambiguous matches
3. **Confirmation email tests:** Correct recipient, correct content, handles errors gracefully
4. **E2E retest:** Cat re-forwards the Wong-Ranasinghe email → verify correct filing + confirmation email
5. **Dev@ test:** Forward from dev@ → verify confirmation goes to dev@
</test_plan>
