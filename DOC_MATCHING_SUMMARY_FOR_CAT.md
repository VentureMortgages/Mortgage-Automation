# How the System Matches Documents to Client Folders

## The Problem

Right now, when a document comes in by email, the system looks at who sent it and tries to match that email address to a client in the CRM. This works when the client sends their own docs — but it doesn't work when:

- A **lawyer** forwards closing documents
- An **accountant** sends T4s or tax returns on behalf of a client
- An **employer** sends an employment letter directly
- A **realtor** sends purchase agreements
- A **family member** sends gift letter proof of funds
- A **spouse** sends from their own email for a joint application
- The client sends from a **different email** than what's in Finmo (e.g., work email vs personal)

In all these cases, the sender has nothing to do with the client — so the system can't match it.

## How We're Fixing It

Instead of only checking "who sent this email?", the system will look at **multiple signals** to figure out which client the document belongs to. Think of it like how you (Cat) already do this — you don't just look at the sender, you look at the document itself, the email subject, who's CC'd, etc.

## The Signals (in order of strength)

### 1. Email thread match (strongest)
If someone **replies to the doc request email we sent**, we know exactly which client and deal it's for — regardless of who's replying. This covers the most common case (client replies with attachments).

### 2. Sender email
If the sender's email matches a client in the CRM who has an active deal, we match directly. This is what we do today.

### 3. Name on the actual document
The system already reads documents with AI to classify them (T4, pay stub, etc.). We'll also have it **extract the person's name** from the document. A T4 has the employee's legal name. A pay stub has the employee name. A bank statement has the account holder's name. That name gets matched to active clients.

### 4. Attachment filename
Many docs arrive with the client's name in the filename — like "Smith_T4_2025.pdf" or "John Smith - Employment Letter.pdf". The system will parse these for names.

### 5. CC'd email addresses
If a lawyer sends docs and the **client is CC'd**, we can use that as a hint. But CC alone isn't enough — the CC'd person might just be "in the loop" (like a spouse on a solo application). So CC is used as a **supporting signal**, not a definitive match.

### 6. Email subject and body
Sometimes the email says "Please find John Smith's documents attached" or the subject line includes the client name or deal reference. The system will check for this.

### 7. Context clues
- Which clients are currently in the **"Collecting Documents"** stage? (More likely to receive docs)
- How recently did we **send a doc request** to each client? (If we asked 2 days ago, incoming docs are likely theirs)
- What **doc types** is each client still missing? (If client A is missing a T4 and a T4 comes in with a matching name, that's a strong signal)

## Confidence Levels

The system will score its confidence in each match:

### High confidence (auto-files, no action needed from you)
- Thread reply to our email — we know exactly who it's for
- Sender email matches + only one active deal
- Name on the document clearly matches one active client

**You'll see:** A note on the deal in the CRM saying something like:
> "T4 filed — matched via legal name on document to John Smith (confidence: 95%)"

### Low confidence (creates a task for you)
- Multiple clients could match
- Conflicting signals (sender matches one client, document name matches another)
- No matching signals found at all

**You'll see:** A CRM task like:
> "Document needs routing — T4 received from accounting@lawfirm.ca. Best guesses:
> 1. John Smith (75%) — name on document matches, deal in Collecting Documents
> 2. Jane Doe (40%) — CC'd on email, but document name doesn't match
>
> Please confirm which client this belongs to."

## Safety Net: Original Files

Before any of this matching happens, the system will save a copy of every document **exactly as it arrived** (original filename, original format) in the client's `Originals/` folder. So even if the system gets the match wrong:

- The original file is always findable
- You can move it to the right folder
- Nothing gets lost or overwritten

## What This Means for Your Workflow

**For most documents (client sends their own docs):** Nothing changes. Auto-filed like today.

**For third-party documents (lawyer, accountant, employer):** Instead of you manually figuring out which client folder to put it in, the system will either:
- Auto-file it correctly (and tell you why in the CRM notes), or
- Ask you to confirm with its best guess already filled in (one click to confirm)

**Bottom line:** Less manual sorting, and when the system isn't sure, it asks instead of guessing wrong.

---

*Questions or concerns? Let us know before we build this — your input on how you currently handle these edge cases will help us get the matching logic right.*
