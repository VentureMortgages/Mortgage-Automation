# Phase 26: Conversational Filing Assistant - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the doc filing system feel like a real assistant that Cat can talk to. When there are ambiguous matches (multiple possible folders or contacts), the system asks Cat naturally and understands her natural language reply to complete filing.

**Trigger:** Phase 25 added confirmation emails but they're one-way. When ambiguous matches arise, docs go to Needs Review silently. Cat has to manually file them with no guidance.

**Scope:** Conversational reply handling for ambiguous filing decisions. NOT a general-purpose chatbot — scoped to filing disambiguation only.
</domain>

<decisions>
## Implementation Decisions

### 1. Multiple Match Options in Confirmation Email (CONV-01)

- When `searchExistingFolders()` finds 2+ fuzzy matches, pass all matches through to the confirmation email
- Change `folder-search.ts` to return the full match list (not just null for ambiguous)
- Change `auto-create.ts` to pass match options into the filing result
- Confirmation email presents options naturally:
  > "I found a couple of folders that might match — 'Wong-Ranasinghe, Carolyn/Srimal' or 'Ranasinghe, Srimal'. Which one should I use?"
- Same pattern for ambiguous contact matches (multiple CRM contacts with similar names)
- Tone: professional but conversational, like a real assistant would ask

### 2. Detect Replies to Confirmation Threads (CONV-02)

- The docs@ inbox is already polled every 120s by the intake worker
- Detect replies to confirmation threads by matching threadId or subject pattern
- Store pending choices in Redis with the gmailMessageId as key:
  ```json
  {
    "pendingChoices": [
      { "folderId": "abc", "folderName": "Wong-Ranasinghe, Carolyn/Srimal" },
      { "folderId": "def", "folderName": "Ranasinghe, Srimal" }
    ],
    "documentInfo": { "intakeDocumentId": "...", "originalFilename": "...", "docTypeLabel": "..." },
    "senderEmail": "admin@venturemortgages.com"
  }
  ```
- TTL: 24 hours (Cat might not reply same day)
- In intake worker: before normal processing, check if incoming message is a reply to a pending choice thread

### 3. AI-Parse Cat's Natural Language Reply (CONV-03)

- Use Gemini Flash structured output (same pattern as classifier and forwarding note parser)
- Input: Cat's reply text + the list of options
- Output: `{ "selectedIndex": 0, "confidence": 0.95 }` or `{ "selectedIndex": null, "needsClarification": true }`
- Examples Cat might say:
  - "the first one" → index 0
  - "wong ranasinghe" → fuzzy match to option
  - "file it under srimal's folder" → match to option containing "srimal"
  - "neither, create a new folder" → create new
  - "skip it" → leave in Needs Review
- If confidence < 0.7 or can't determine, ask again: "Sorry, I wasn't sure which one you meant. Could you clarify?"
- Model: gemini-2.0-flash (same as classification)

### 4. Execute Deferred Filing + Follow-up Confirmation (CONV-04)

- After parsing Cat's choice, execute the filing (move doc from Needs Review to chosen folder)
- Link the folder to the CRM contact if not already linked
- Send a follow-up confirmation in the same thread: "Done — filed to Wong-Ranasinghe, Carolyn/Srimal."
- If Cat said "create new folder" — create it, file, link, confirm
- If Cat said "skip" — acknowledge: "Got it, leaving in Needs Review."

### Claude's Discretion

- Redis key structure and TTL for pending choices
- Exact Gemini prompt wording for reply parsing
- How to handle replies that arrive after TTL expiry
- Rate limiting / dedup for reply processing
</decisions>

<verification>
## Acceptance Criteria

1. When multiple folder matches found, confirmation email lists options naturally (not as IDs or codes)
2. Cat replies in natural language and the system correctly identifies her choice
3. Doc is filed to the chosen folder and a follow-up confirmation is sent
4. System handles edge cases: "neither", "skip", "create new folder", "not sure"
5. If reply is ambiguous, system asks for clarification (doesn't guess)
6. Pending choices expire after 24h and don't leak memory
7. All existing tests still pass
</verification>

<test_plan>
## Test Plan

1. **Reply parser unit tests:** Various natural language replies mapped to correct option selection
2. **Pending choice Redis tests:** Store, retrieve, expire, cleanup
3. **Reply detection tests:** Intake worker correctly routes reply messages vs new forwards
4. **Filing execution tests:** Doc moved from Needs Review to chosen folder, CRM contact linked
5. **Confirmation email tests:** Follow-up message in same thread with correct content
6. **Edge case tests:** Expired choices, invalid replies, "skip", "create new"
</test_plan>
