# Codebase Structure

**Analysis Date:** 2026-01-22

## Directory Layout

```
C:\Users\lucac\projects\Taylor_Atkinson\
├── .claude/                          # Claude IDE configuration
│   └── settings.local.json           # Local environment settings
├── .planning/                        # Analysis and planning documents
│   └── codebase/                     # Codebase mapping outputs
│       ├── ARCHITECTURE.md           # Workflow and integration architecture
│       └── STRUCTURE.md              # This file
├── Recordings/                       # Meeting recordings and video files
├── CLAUDE.md                         # Project guide and operating principles
├── PROJECT_DOC.md                    # Detailed project brief and backlog
├── FLOW_EMAIL_TO_DRIVE.md            # Technical flow diagrams for automation
├── NEEDS_FROM_CLIENT.md              # Outstanding action items and blockers
├── TIMESHEET.md                      # Time tracking and billing log
├── WEDNESDAY_MEETING_QUESTIONS.md    # Questions for MyBrokerPro setup meeting
├── Questions (1).pdf                 # Client intake questions/responses
└── [PDF documents]                   # Workflow summaries and other PDFs
```

## Directory Purposes

**`.claude/`:**
- Purpose: IDE and project settings specific to Claude development environment
- Contains: JSON configuration files
- Key files: `settings.local.json`

**`.planning/`:**
- Purpose: Generated analysis documents used by other GSD commands
- Contains: Codebase mapping outputs (ARCHITECTURE.md, STRUCTURE.md, etc.)
- Generated: Yes
- Committed: Yes (templates stored)

**`Recordings/`:**
- Purpose: Video recordings from client meetings and onboarding
- Contains: .mp4, .webm, or similar video files
- Key files: Meeting recordings referenced in status updates

## Key File Locations

**Entry Points / Project Briefs:**
- `PROJECT_DOC.md`: Main project document — workflow summary, systems inventory, automation backlog, open questions, action items, risks & compliance
- `CLAUDE.md`: Operating principles, communication style, safety guardrails, time tracking requirements

**Workflow Documentation:**
- `FLOW_EMAIL_TO_DRIVE.md`: Detailed technical flow diagrams showing:
  - Trigger 1: Finmo application submission → CRM creation + Drive folder setup
  - Trigger 2: Email attachment → client matching → document filing
  - Unmatched email manual review flow
  - Data model for CRM client records
  - Technical components required
  - Open design questions
  - Phased implementation roadmap

**Status & Tracking:**
- `TIMESHEET.md`: Billable hours log with categories (Meeting, Strategy, Writing, Build, Admin, Support)
- `NEEDS_FROM_CLIENT.md`: Action items pending from Taylor/Cat with status
- `WEDNESDAY_MEETING_QUESTIONS.md`: Questions for MyBrokerPro onboarding session

**Supporting Materials:**
- `Questions (1).pdf`: Client intake document with responses about current workflow
- `Taylor Atkinson Automation Project — Confirmed Workflow Summary + Open Items.pdf`: Detailed workflow PDF from client

## Naming Conventions

**Files:**
- Markdown docs: `UPPERCASE_WITH_UNDERSCORES.md` (e.g., `PROJECT_DOC.md`, `FLOW_EMAIL_TO_DRIVE.md`)
- For dates in content: `[YYYY-MM-DD]` format
- Section headers in markdown: H1 (`#`), H2 (`##`), H3 (`###`)

**Directories:**
- Hidden/system: `.prefixed` (e.g., `.planning`, `.claude`)
- Tracking docs: `TIMESHEET.md`, `NEEDS_FROM_CLIENT.md`
- Meeting notes: `[DAY]_MEETING_QUESTIONS.md` (e.g., `WEDNESDAY_MEETING_QUESTIONS.md`)

## Where to Add New Code

**This is not a software codebase.** This is a project planning and documentation repository. Future code will be stored separately once implementation begins:

**For future code repositories:**
- Node.js orchestration (n8n, Make, or custom): Will use `src/`, `package.json`, `.env`
- Python automation scripts: Will use `src/`, `requirements.txt`, `.env`
- Google Apps Script: Will use `appsscript.json`, `.clasp.json` (if stored locally)

**For project documentation:**
- New workflow docs: Add to project root as `[DESCRIPTION].md`
- Meeting notes: Add as `[DATE]_MEETING_NOTES.md`
- Status updates: Append to `TIMESHEET.md` with template from `PROJECT_DOC.md`
- Action item tracking: Update `NEEDS_FROM_CLIENT.md`

## Special Directories

**`.planning/codebase/`:**
- Purpose: Auto-generated codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md
- Generated: Yes (by `/gsd:map-codebase` commands)
- Committed: Yes (used by planner/executor as reference)

**`Recordings/`:**
- Purpose: Archive of video meetings with clients/team
- Generated: Yes (from Zoom, Google Meet, etc.)
- Committed: No (typically .gitignored due to size)

## Project Navigation

**To understand the project:**
1. Start: `CLAUDE.md` (operating principles)
2. Read: `PROJECT_DOC.md` (workflow, systems, backlog)
3. Detail: `FLOW_EMAIL_TO_DRIVE.md` (technical architecture)
4. Track: `NEEDS_FROM_CLIENT.md` (blockers), `TIMESHEET.md` (progress)

**To track progress:**
- Review weekly section in `TIMESHEET.md`
- Check blockers in `NEEDS_FROM_CLIENT.md`
- Compare completed tasks to `PROJECT_DOC.md` backlog

**To find decisions:**
- Open questions: See `PROJECT_DOC.md` section E
- Design decisions: See `FLOW_EMAIL_TO_DRIVE.md` section "Open Design Questions"

---

*Structure analysis: 2026-01-22*
