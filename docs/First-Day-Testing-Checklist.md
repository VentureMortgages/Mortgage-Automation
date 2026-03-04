# First Day Testing Checklist

**For:** Cat
**Time needed:** ~10 minutes
**Prerequisites:** Access to admin@venturemortgages.com Gmail and MyBrokerPro

---

## Test 1: Forward a Document (5 min)

Pick a real client document you haven't filed yet (or use a test PDF).

1. [ ] Open admin@venturemortgages.com Gmail
2. [ ] Find an email with a client document attached (PDF, image, or Word)
3. [ ] **Forward** the email to **docs@venturemortgages.com**
4. [ ] Wait 2-3 minutes

### Verify it worked:

5. [ ] Open **docs@venturemortgages.com** Gmail
6. [ ] Check the **Processed** label — your forwarded email should be there
7. [ ] Open **Google Drive** > **Mortgage Clients** > the client's folder
8. [ ] Check the relevant subfolder (Income/, Property/, etc.) — the document should be there with the correct name
9. [ ] Check the **Originals/** subfolder — the original file should also be there
10. [ ] Open **MyBrokerPro** > the client's contact/opportunity — the doc checklist field should show the document as received

**If something looks wrong:** Don't worry — the original is always preserved in Originals/. Note what happened and tell Luca.

---

## Test 2: Check a Needs Review Scenario (optional)

Forward an email that has a document with no clear client name (e.g., a generic "bank statement.pdf" with no identifying info).

1. [ ] Forward the ambiguous document to docs@venturemortgages.com
2. [ ] Wait 2-3 minutes
3. [ ] Check Google Drive > **Needs Review/** folder — the doc should appear there
4. [ ] Check MyBrokerPro tasks — you should see a **"Match Review"** task with a best guess and confidence score
5. [ ] Move the file to the correct client folder manually
6. [ ] Mark the CRM task as complete

---

## Test 3: Check Multiple Attachments (optional)

Forward an email with 2+ document attachments.

1. [ ] Forward the email to docs@venturemortgages.com
2. [ ] Wait 2-3 minutes
3. [ ] Verify each attachment was classified and filed independently
4. [ ] Each should appear in the correct subfolder with the correct name

---

## Quick Reference

| Action | How |
|---|---|
| Forward docs | Forward email to docs@venturemortgages.com |
| Check processing | Look at docs@ Processed label |
| Find originals | Client folder > Originals/ |
| Handle review items | CRM task + Needs Review/ folder |
| Stop the system | Tell Luca or set AUTOMATION_KILL_SWITCH=true on Railway |
