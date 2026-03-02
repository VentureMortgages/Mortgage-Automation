# Phase 14: Smart Document Matching - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Match every incoming document to the correct client folder using a signal-based AI agent. Handles third-party senders (lawyers, accountants, employers), name ambiguity, joint/solo application overlap, and co-borrower routing. Human-in-the-loop for low confidence. Includes interactive backfill for historical contacts without Drive folder IDs.

</domain>

<decisions>
## Implementation Decisions

### Agent architecture
- **Agentic with tools** — Gemini gets CRM and Drive API tools and reasons in a loop (not one-shot)
- Tools available: CRM contact search (name/email/phone), CRM opportunity lookup (active deals, pipeline stage), Drive folder search (by name)
- Thread match is the strongest signal but still passes through the agent (not a hard override) — keeps flow consistent
- Name extraction from document content happens in the **same Gemini classification call** (not a separate API call)
- Agent **self-assigns confidence score** (0.0-1.0) — not derived from signal patterns

### Decision boundary
- **Auto-file threshold: 0.8** — agent confidence >= 0.8 means auto-file, below 0.8 means Cat reviews
- **Conflicting signals always escalate** — if sender matches Client A but doc name matches Client B, it goes to Cat regardless of individual confidence scores
- Agent returns **single best match** (not ranked candidates) with confidence and reasoning
- **Zero matches: auto-create** — agent extracts name/email from doc, creates new CRM contact + client folder, files the doc, notifies Cat via CRM task ("New contact created from incoming doc — please verify")

### Cat's review experience
- CRM task includes: **agent's best guess + all signals + Drive link**
  - Example: "Incoming doc may belong to [John Smith] (65%). Signals: sender=lawyer@firm.ca, doc name='John D Smith', CC'd john@gmail.com. File: [Drive link]."
- Unmatched/low-confidence docs go to a **global Needs Review/ folder** at the Drive root level (not per-client)
- **No learning from corrections** — stateless. Each match is independent. Same third-party sender will re-trigger matching every time.
- **Auto-filed docs include brief reasoning in CRM note** — "T4 filed to Income/ — matched via sender email (john@gmail.com), confidence 0.95"

### Matching scope & identity
- Match to **opportunity first, contact as fallback** — deal-specific docs (property) need the right deal, reusable docs (T4, ID) can match at contact level
- **Co-borrower routing via Finmo app data** — agent checks if sender email matches any co-borrower on an active application, routes to primary borrower's folder
- **Returning clients reuse existing folder** — new deal gets a new deal subfolder inside same client folder
- **Interactive backfill script** — lists unlinked CRM contacts alongside best-guess Drive folders, Cat confirms each match, runs once to clean up historical data

### Claude's Discretion
- Gemini function-calling schema design (tool definitions, response format)
- System prompt for the matching agent (signal priority guidance, reasoning format)
- How to handle the agentic loop timeout (max iterations before escalating)
- Backfill script UX (CLI vs web interface vs CRM task-based)

</decisions>

<specifics>
## Specific Ideas

- The matching agent's system prompt should reference the signal priority tiers from our earlier discussion (thread > sender email > doc content name > filename > CC > subject/body > context clues)
- Global Needs Review/ folder should be at the Drive root level alongside client folders — easy for Cat to find
- CRM task for zero-match auto-creation should say "New contact created — please verify" not "Unknown document"
- The 0.8 threshold should be consistent with Phase 13's low-confidence threshold for Needs Review routing

</specifics>

<deferred>
## Deferred Ideas

- Learning from Cat's corrections (store sender→client associations in Redis) — revisit if third-party volume is high
- Ranked candidate list in CRM task (top 3) — start with single best match, add if Cat requests
- Per-client Needs Review/ for low-confidence matches (currently using global) — revisit based on Cat's feedback
- Automatic re-matching when Cat moves a file from global Needs Review/ to a client folder — would need Drive webhook

</deferred>

---

*Phase: 14-smart-document-matching*
*Context gathered: 2026-03-02*
