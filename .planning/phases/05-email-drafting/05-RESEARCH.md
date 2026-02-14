# Phase 5: Email Drafting - Research

**Researched:** 2026-02-13
**Domain:** Gmail API (drafts, sending, OAuth), email templating, GeneratedChecklist-to-email transformation
**Confidence:** MEDIUM-HIGH

## Summary

Phase 5 transforms the Phase 3 `GeneratedChecklist` output into a professional, personalized doc request email that Cat can review before it sends from `admin@venturemortgages.com`. The phase has three major components: (1) a pure email body generator that converts checklist data into a formatted email matching Cat's existing tone and structure, (2) a Gmail API integration for creating drafts and sending them, and (3) an OAuth2 authentication layer for server-to-server Gmail access.

The existing codebase already has the data structures we need: `GeneratedChecklist` with `BorrowerChecklist[]`, `PropertyChecklist[]`, `sharedItems[]`, and `ChecklistItem[]` with `displayName`, `notes`, and `stage` fields. The email template reference (`.planning/EMAIL_TEMPLATE_REFERENCE.md`) from Cat documents the exact tone and structure: casual greeting, intro paragraph, per-person document lists, per-property lists, shared "Other" section, and friendly closing. The email generator is a pure function that maps these structures to formatted text.

For Gmail API access, there are two viable approaches: (A) Service Account with domain-wide delegation, or (B) OAuth2 with stored refresh token. Service account with domain-wide delegation is the recommended approach for this project because it requires no user interaction after initial setup, handles token refresh automatically via JWT, and is the standard for server-to-server Google Workspace automation. The `googleapis` npm package (v171.x) provides typed Gmail API methods including `users.drafts.create` and `users.drafts.send`.

**Primary recommendation:** Use `googleapis` with a Google Workspace service account (domain-wide delegation) to impersonate `admin@venturemortgages.com`. Build a pure `generateEmailBody()` function that transforms `GeneratedChecklist` into MIME content. Create drafts via Gmail API. Integrate Cat's review task (Phase 4) with a mechanism to trigger sending after approval.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `googleapis` | ^171.x | Official Google APIs Node.js client; Gmail API for drafts/sending | Official Google SDK, typed methods, built-in auth support, actively maintained |
| `google-auth-library` | ^10.x | OAuth2/JWT authentication for Google APIs | Peer dependency of googleapis, handles JWT signing, token refresh, impersonation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.0.18 | Test framework | Already in project; test email body generation and MIME encoding |
| `dotenv` | ^17.x | Environment variable loading | Already in project; load Gmail credentials from .env |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `googleapis` (drafts API) | Nodemailer with Gmail SMTP | SMTP requires "App Passwords" or OAuth2. Gmail API drafts are superior because they create visible drafts in the Gmail UI that Cat could preview if needed. SMTP sends immediately with no draft step. |
| Service account + domain-wide delegation | OAuth2 refresh token (user consent flow) | Refresh tokens expire after 6 months of inactivity, can be revoked by user, require initial browser consent. Service account is zero-interaction after admin setup. Downside: requires Google Workspace admin access to configure delegation. |
| Plain text email | HTML email with MJML/React Email | Cat's current emails are plain text (no HTML formatting). Keep it simple. Plain text matches Cat's style perfectly and avoids email client rendering issues. |
| Custom template engine | Handlebars/EJS/Mustache | The email structure is well-defined and static (greeting, per-person sections, per-property sections, shared section, closing). A pure function with string concatenation is simpler, testable, and adds no dependency. |

**Installation:**
```bash
npm install googleapis google-auth-library
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── checklist/          # Phase 3 (existing) - pure function engine
├── crm/                # Phase 4 (existing) - CRM integration layer
├── email/              # Phase 5 (new) - email generation + Gmail integration
│   ├── config.ts       # Gmail config: credentials, sender address, dev mode
│   ├── gmail-client.ts # Gmail API client: auth, draft creation, send
│   ├── body.ts         # Pure function: GeneratedChecklist -> email body text
│   ├── mime.ts         # MIME message construction + base64url encoding
│   ├── draft.ts        # Orchestrator: generate body, create draft, return draft ID
│   ├── send.ts         # Send a draft by ID (triggered after Cat's review)
│   ├── types.ts        # EmailDraft, EmailConfig, SendResult types
│   ├── index.ts        # Barrel export
│   └── __tests__/
│       ├── body.test.ts       # Email body generation tests
│       ├── mime.test.ts       # MIME encoding tests
│       └── draft.test.ts      # Draft orchestrator tests (mocked Gmail API)
└── ...
```

### Pattern 1: Pure Email Body Generator
**What:** A pure function that takes `GeneratedChecklist` + borrower metadata and returns a formatted email body string. No API calls, no side effects.
**When to use:** Every time an email needs to be generated from a checklist.
**Why:** Testable independently. Can be unit tested against Cat's reference email without any Gmail API setup.
**Example:**
```typescript
// src/email/body.ts
import type { GeneratedChecklist, BorrowerChecklist, PropertyChecklist, ChecklistItem } from '../checklist/types/index.js';

interface EmailContext {
  /** Borrower first names for greeting, e.g., ["Megan", "Cory"] */
  borrowerFirstNames: string[];
  /** The email address clients should send docs to */
  docInboxEmail: string;
}

/**
 * Generates the email body text from a GeneratedChecklist.
 * Matches Cat's tone and structure from EMAIL_TEMPLATE_REFERENCE.md.
 *
 * Structure:
 * 1. Greeting: "Hey [Names]!"
 * 2. Intro paragraph
 * 3. Per-borrower sections (first name as header)
 * 4. Per-property sections (address as header)
 * 5. "Other" section (shared items)
 * 6. Closing
 */
export function generateEmailBody(
  checklist: GeneratedChecklist,
  context: EmailContext,
): string {
  const lines: string[] = [];

  // 1. Greeting
  lines.push(`Hey ${context.borrowerFirstNames.join(' and ')}!`);
  lines.push('');

  // 2. Intro
  lines.push(
    "Thanks for filling out the application. As Taylor mentioned, I'll just collect some " +
    "supporting documents. We like to do the majority of document collection up front to " +
    "ensure the accuracy of your pre-approval budget and it will also make the process " +
    "easier down the line."
  );
  lines.push('');

  // 3. Per-borrower sections
  for (const bc of checklist.borrowerChecklists) {
    const firstName = bc.borrowerName.split(' ')[0];
    lines.push(firstName);
    for (const item of bc.items.filter(i => i.forEmail)) {
      lines.push(item.displayName);
      if (item.notes) {
        lines.push(`  ${item.notes}`);
      }
    }
    lines.push('');
  }

  // 4. Per-property sections
  for (const pc of checklist.propertyChecklists) {
    lines.push(`${pc.propertyDescription}:`);
    for (const item of pc.items.filter(i => i.forEmail)) {
      lines.push(item.displayName);
      if (item.notes) {
        lines.push(`  ${item.notes}`);
      }
    }
    lines.push('');
  }

  // 5. Shared items
  if (checklist.sharedItems.filter(i => i.forEmail).length > 0) {
    lines.push('Other');
    for (const item of checklist.sharedItems.filter(i => i.forEmail)) {
      lines.push(item.displayName);
      if (item.notes) {
        lines.push(`  ${item.notes}`);
      }
    }
    lines.push('');
  }

  // 6. Closing
  lines.push(
    `You can send these documents directly to ${context.docInboxEmail} and if you have ` +
    "any questions let me know!"
  );
  lines.push('');
  lines.push('Thanks!');

  return lines.join('\n');
}
```

### Pattern 2: MIME Message Construction
**What:** Constructs an RFC 2822 compliant MIME message with proper headers and base64url encodes it for the Gmail API `raw` field.
**When to use:** Every Gmail API draft/send call requires this encoding.
**Example:**
```typescript
// src/email/mime.ts

interface MimeMessageInput {
  to: string;       // recipient email
  from: string;     // sender email (admin@venturemortgages.com)
  subject: string;  // email subject line
  body: string;     // plain text body
}

/**
 * Constructs an RFC 2822 MIME message and base64url encodes it.
 * Gmail API requires this format for the message.raw field.
 */
export function encodeMimeMessage(input: MimeMessageInput): string {
  const mimeMessage = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    input.body,
  ].join('\r\n');

  // Gmail API requires base64url encoding (not standard base64)
  return Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

### Pattern 3: Service Account with Domain-Wide Delegation
**What:** Uses a Google Workspace service account to impersonate `admin@venturemortgages.com` for Gmail API access. No user interaction needed.
**When to use:** All Gmail API operations in this project.
**Example:**
```typescript
// src/email/gmail-client.ts
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { emailConfig } from './config.js';

let gmailClient: ReturnType<typeof google.gmail> | null = null;

/**
 * Gets an authenticated Gmail API client using service account impersonation.
 * The service account impersonates admin@venturemortgages.com via domain-wide delegation.
 */
export function getGmailClient() {
  if (gmailClient) return gmailClient;

  const auth = new JWT({
    email: emailConfig.serviceAccountEmail,
    key: emailConfig.serviceAccountKey,
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
    subject: emailConfig.senderAddress, // admin@venturemortgages.com
  });

  gmailClient = google.gmail({ version: 'v1', auth });
  return gmailClient;
}

/**
 * Creates a draft in admin@venturemortgages.com's Gmail.
 * Returns the draft ID for later sending.
 */
export async function createDraft(rawMessage: string): Promise<string> {
  const gmail = getGmailClient();
  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw: rawMessage },
    },
  });

  if (!response.data.id) {
    throw new Error('Gmail API returned draft without ID');
  }

  return response.data.id;
}

/**
 * Sends a previously created draft.
 * Returns the sent message ID.
 */
export async function sendDraft(draftId: string): Promise<string> {
  const gmail = getGmailClient();
  const response = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: { id: draftId },
  });

  if (!response.data.id) {
    throw new Error('Gmail API returned sent message without ID');
  }

  return response.data.id;
}
```

### Pattern 4: Dev Mode Safety
**What:** In development mode, emails are NOT sent to real clients. Override the recipient to a safe dev address.
**When to use:** Always in dev mode. Critical safety guard.
**Example:**
```typescript
// In config.ts
export const emailConfig = {
  isDev: crmConfig.isDev,
  // In dev mode, ALL emails go to dev@venturemortgages.com (never to real clients)
  recipientOverride: crmConfig.isDev ? 'dev@venturemortgages.com' : null,
  senderAddress: 'admin@venturemortgages.com', // always send from admin
  // Subject prefix in dev mode
  subjectPrefix: crmConfig.isDev ? '[TEST] ' : '',
};
```

### Pattern 5: Draft-Then-Send Orchestrator
**What:** Orchestrator that creates a draft and links it to the CRM task for Cat's review. Separate send function is called after Cat approves.
**When to use:** The main entry point for Phase 5.
**Example:**
```typescript
// src/email/draft.ts
export interface CreateEmailDraftInput {
  checklist: GeneratedChecklist;
  recipientEmail: string;
  borrowerFirstNames: string[];
  contactId: string;  // CRM contact for task linking
}

export interface CreateEmailDraftResult {
  draftId: string;
  subject: string;
  recipientEmail: string;
  bodyPreview: string;  // first 200 chars for CRM task body
}

export async function createEmailDraft(
  input: CreateEmailDraftInput,
): Promise<CreateEmailDraftResult> {
  // 1. Generate email body (pure function)
  const body = generateEmailBody(input.checklist, {
    borrowerFirstNames: input.borrowerFirstNames,
    docInboxEmail: emailConfig.docInbox,
  });

  // 2. Determine recipient (dev override in dev mode)
  const recipient = emailConfig.recipientOverride ?? input.recipientEmail;

  // 3. Build subject line
  const borrowerName = input.borrowerFirstNames.join(' & ');
  const subject = `${emailConfig.subjectPrefix}Documents Needed — ${borrowerName}`;

  // 4. Encode MIME message
  const raw = encodeMimeMessage({
    to: recipient,
    from: emailConfig.senderAddress,
    subject,
    body,
  });

  // 5. Create Gmail draft
  const draftId = await createDraft(raw);

  return {
    draftId,
    subject,
    recipientEmail: recipient,
    bodyPreview: body.substring(0, 200),
  };
}
```

### Anti-Patterns to Avoid
- **Auto-sending without Cat's review:** The CLAUDE.md mandates human-in-the-loop. Always create draft first, send only after explicit approval.
- **Storing email body in logs with client names/details:** Log only metadata (draft ID, item count, recipient domain) not email content or borrower names.
- **HTML email when plain text suffices:** Cat's current emails are plain text. HTML adds complexity with no value. Keep it plain text.
- **Hard-coding the intro paragraph:** Make the intro paragraph configurable (template string) so Cat can adjust wording without code changes.
- **Sending from dev@ in production or to real clients in dev:** Always enforce dev mode recipient override. Production sender is always admin@.
- **Building custom OAuth token management:** Use `google-auth-library`'s JWT class which handles token refresh automatically via JWT assertion flow.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gmail API authentication | Custom JWT signing + token exchange | `google-auth-library` JWT class | Handles key signing, token caching, auto-refresh, impersonation subject |
| Gmail draft creation | Raw HTTP calls to Gmail REST API | `googleapis` gmail.users.drafts.create | Typed params/response, auth injection, retry handling |
| Base64url encoding | Custom encoding function | `Buffer.from().toString('base64')` + replace | Node.js built-in, well-tested, simple replacements for URL-safe variant |
| MIME message construction | Complex multipart MIME builder | Simple string concatenation for plain text | Our emails are plain text only. No attachments, no HTML. Simple string headers suffice. |
| Token refresh monitoring | Polling or timer-based refresh check | JWT auto-refresh + error handling in catch block | google-auth-library handles JWT assertion refresh transparently. Catch auth errors and alert. |

**Key insight:** The email is plain text (matching Cat's style), so MIME construction is trivial. The complexity is in the Gmail API auth setup, not the message format.

## Common Pitfalls

### Pitfall 1: Service Account Cannot Send Gmail Without Domain-Wide Delegation
**What goes wrong:** Service account is created but Gmail API calls fail with 403 "Delegation denied for user".
**Why it happens:** Service accounts cannot access Gmail by default. Domain-wide delegation must be explicitly enabled in Google Workspace Admin Console and the specific scopes must be authorized for the service account's client ID.
**How to avoid:**
1. Create service account in Google Cloud Console with domain-wide delegation enabled
2. In Google Workspace Admin Console (admin.google.com), go to Security > API controls > Domain-wide Delegation
3. Add the service account's Client ID with scope: `https://www.googleapis.com/auth/gmail.compose`
4. Set `subject` to `admin@venturemortgages.com` in JWT constructor
**Warning signs:** 403 errors, "Delegation denied", "unauthorized_client" in token exchange.

### Pitfall 2: Base64 vs Base64url Encoding
**What goes wrong:** Gmail API rejects the draft with "Invalid message" or creates a garbled message.
**Why it happens:** Gmail API requires base64url encoding (RFC 4648), not standard base64. The difference is: `+` -> `-`, `/` -> `_`, and trailing `=` padding must be stripped.
**How to avoid:** Always use the three-step replacement after `Buffer.from().toString('base64')`. Test with messages containing special characters.
**Warning signs:** "400 Bad Request", garbled subjects/bodies, encoding errors.

### Pitfall 3: MIME Line Endings Must Be CRLF
**What goes wrong:** Email headers are malformed. Subject or To/From are missing in the delivered message.
**Why it happens:** RFC 2822 requires `\r\n` (CRLF) line endings, not `\n` (LF). Node.js template literals produce `\n` by default.
**How to avoid:** Use explicit `\r\n` in MIME header construction. Test that headers parse correctly by inspecting the raw encoded message.
**Warning signs:** Missing headers, double-spaced body, headers appearing in body.

### Pitfall 4: Dev Mode Emails Going to Real Clients
**What goes wrong:** Test email with `[TEST]` prefix but real client's email address gets sent during development.
**Why it happens:** Dev mode only prefixes the subject but doesn't override the recipient.
**How to avoid:** In dev mode, ALWAYS override the `To:` address to `dev@venturemortgages.com` regardless of input. This is a safety guard, not optional. The config should make this automatic and impossible to bypass accidentally.
**Warning signs:** Real client receives `[TEST]` prefixed email during development.

### Pitfall 5: Gmail Draft Visible in Wrong Inbox
**What goes wrong:** Draft appears in a shared inbox or the wrong account's drafts.
**Why it happens:** The `userId` parameter in `drafts.create` determines which account's drafts folder to use. With impersonation, `'me'` refers to the impersonated user (admin@venturemortgages.com).
**How to avoid:** Always use `userId: 'me'` with proper impersonation. Verify during testing that the draft appears in admin@venturemortgages.com's drafts, not the service account's.
**Warning signs:** Draft not visible in admin@venturemortgages.com Gmail. Service account email showing in sent-as.

### Pitfall 6: OAuth Scope Too Broad or Too Narrow
**What goes wrong:** Either the service account has more access than needed (security risk) or draft creation fails due to insufficient scope.
**Why it happens:** Gmail has many scopes: `gmail.readonly`, `gmail.send`, `gmail.compose`, `gmail.modify`, `mail.google.com` (full access).
**How to avoid:** Use `gmail.compose` scope. This allows creating drafts and sending messages but NOT reading existing mail. Minimum privilege for our use case.
**Warning signs:** 403 "Insufficient Permission" (scope too narrow) or security audit concerns (scope too broad).

### Pitfall 7: Token Refresh Failure Goes Undetected
**What goes wrong:** Service account key expires or is revoked; emails silently stop being created.
**Why it happens:** Service account keys have a maximum lifetime (they can be revoked or the service account disabled). With JWT flow, there's no refresh token to "expire" but the key itself can become invalid.
**How to avoid:** Wrap all Gmail API calls in try/catch. Detect auth errors specifically. Implement an alerting mechanism (log error with specific tag, or create a CRM task for Taylor/Cat if auth fails). INFRA-05 requires this alerting.
**Warning signs:** 401 errors, "invalid_grant", emails stop being created with no visible error.

## Code Examples

### Creating a Gmail Draft (Full Working Example)
```typescript
// Source: Gmail API official docs + googleapis npm documentation
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const auth = new JWT({
  email: 'service-account@project.iam.gserviceaccount.com',
  key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
  scopes: ['https://www.googleapis.com/auth/gmail.compose'],
  subject: 'admin@venturemortgages.com',
});

const gmail = google.gmail({ version: 'v1', auth });

// Build MIME message
const mimeMessage = [
  'From: admin@venturemortgages.com',
  'To: client@example.com',
  'Subject: Documents Needed',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hey John!\n\nThanks for filling out the application...',
].join('\r\n');

// Base64url encode
const raw = Buffer.from(mimeMessage)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

// Create draft
const response = await gmail.users.drafts.create({
  userId: 'me',
  requestBody: {
    message: { raw },
  },
});

console.log('Draft created:', response.data.id);
```

### Service Account Key as Environment Variable
```typescript
// Store the service account JSON key as a single env var (base64 encoded)
// This avoids committing a JSON key file to git

function loadServiceAccountKey(): { client_email: string; private_key: string } {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable not set');
  }
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  return JSON.parse(decoded);
}
```

### Email Subject Line with Dev Prefix
```typescript
// Matches existing crmConfig.isDev / devPrefix() pattern from Phase 4
function buildSubject(borrowerFirstNames: string[], isDev: boolean): string {
  const names = borrowerFirstNames.join(' & ');
  const prefix = isDev ? '[TEST] ' : '';
  return `${prefix}Documents Needed — ${names}`;
}
```

## Auth Decision: Service Account vs OAuth2 Refresh Token

### Recommendation: Service Account with Domain-Wide Delegation

| Factor | Service Account + DWD | OAuth2 Refresh Token |
|--------|----------------------|---------------------|
| **User interaction** | None after admin setup | Requires initial browser consent |
| **Token lifecycle** | JWT auto-refreshes (no expiry) | Refresh token can expire after 6 months of inactivity |
| **Revocation risk** | Only if SA key is revoked by admin | User password change revokes token for Gmail scopes |
| **Setup complexity** | Moderate (GCP + Workspace Admin) | Low (consent flow + token storage) |
| **Security** | Key stored as env var, rotatable | Refresh token stored as env var, harder to rotate |
| **Best for** | Server-to-server automation (our case) | User-interactive applications |

**Decision:** Service account with domain-wide delegation. Reasons:
1. Zero user interaction after setup (critical for automated server)
2. No refresh token expiration concerns
3. Standard pattern for Google Workspace automation
4. Matches project constraint of running on Railway VPS

**Setup steps required (one-time admin tasks):**
1. Create GCP project (or use existing) with Gmail API enabled
2. Create service account with domain-wide delegation enabled
3. Download service account key JSON
4. In Google Workspace Admin Console: add SA client ID + `gmail.compose` scope
5. Store SA key as base64-encoded env var in .env and Railway

## Integration with Existing CRM (Phase 4) Flow

The Phase 4 `syncChecklistToCrm` orchestrator already creates a review task for Cat. Phase 5 extends this flow:

**Current flow (Phase 4):**
1. Finmo app submitted -> Generate checklist (Phase 3)
2. syncChecklistToCrm: upsert contact, update fields, create review task for Cat, move pipeline

**Extended flow (Phase 5):**
1. Same as above
2. **NEW:** After CRM sync, also create Gmail draft
3. **NEW:** Update Cat's review task body to include draft reference
4. Cat reviews checklist in CRM + email draft in Gmail (or task body preview)
5. Cat approves -> triggers email send (mechanism TBD: could be CRM task completion webhook, manual script, or a simple CLI command)

**The "send trigger" question:** How does Cat's approval trigger sending? Options:
- **Option A (simplest):** Cat completes the review task, then manually opens admin@'s Gmail and sends the draft herself. Zero automation needed for sending. Draft creation is the automation.
- **Option B (moderate):** Build a simple CLI script: `npx tsx src/email/send.ts <draftId>`. Cat tells the system to send by running a command or by marking a task.
- **Option C (advanced):** CRM task completion webhook triggers auto-send. Requires Phase 1 webhook infrastructure.

**Recommendation for Phase 5:** Implement Option A + Option B. Create the draft automatically (the main value). Provide a CLI send tool as well. Defer Option C to Phase 1 or later when webhook infrastructure exists. This matches "stepwise delivery" and "simplicity first" principles from CLAUDE.md.

## Dev Mode Behavior Summary

| Aspect | Dev Mode | Production |
|--------|----------|------------|
| Email recipient | `dev@venturemortgages.com` (override) | Actual client email |
| Email sender | `admin@venturemortgages.com` | `admin@venturemortgages.com` |
| Subject prefix | `[TEST] Documents Needed - Name` | `Documents Needed - Name` |
| Gmail draft location | admin@venturemortgages.com drafts | admin@venturemortgages.com drafts |
| CRM task prefix | `[TEST] Review doc request - Name` | `Review doc request - Name` |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Gmail SMTP with app passwords | Gmail API with OAuth2/SA | 2022 (Google deprecated "less secure apps") | Must use API, not SMTP with plain passwords |
| Manual OAuth2 consent flow | Service account + DWD for server apps | Always been available, but became standard practice ~2023 | Zero-interaction auth for server automation |
| `nodemailer` with Gmail SMTP | `googleapis` with Gmail API drafts | 2023+ best practice for draft-first workflows | API drafts are visible in Gmail UI, SMTP sends immediately |
| `googleapis` v39 (quickstart examples) | `googleapis` v171.x | 2025-2026 | Types improved significantly, ESM support better |

**Deprecated/outdated:**
- Gmail "Less Secure Apps" setting: Removed by Google. Cannot use plain password SMTP anymore.
- `googleapis` v39 or earlier: Very old, missing types, use v171.x.
- `@google-cloud/local-auth` for server apps: This is for interactive desktop apps, not servers. Use `google-auth-library` JWT directly.

## Open Questions

1. **Google Workspace admin access for domain-wide delegation setup**
   - What we know: venturemortgages.com is a Google Workspace domain (they have Gmail, Drive). Taylor is the account owner.
   - What's unclear: Whether Taylor (or we) can access admin.google.com to configure domain-wide delegation. Whether a GCP project already exists or needs to be created.
   - Recommendation: First plan task should be a setup guide/script. If admin access is blocked, fall back to OAuth2 refresh token approach (works but requires one-time browser consent and has the 6-month inactivity expiry risk).

2. **Cat's send trigger workflow**
   - What we know: Cat reviews checklist in CRM. Draft email is created in admin@venturemortgages.com Gmail.
   - What's unclear: How does Cat trigger sending? Does she open admin@'s Gmail? Does she have access to admin@ inbox? Is she comfortable with a CLI command?
   - Recommendation: Build draft creation (automated) + CLI send tool (manual). Ask Cat about her preferred workflow. The draft itself is the main value -- even if she just copies the text into a new email, that saves significant time.

3. **admin@venturemortgages.com inbox access**
   - What we know: Emails should send from admin@venturemortgages.com.
   - What's unclear: Does Cat have delegated access to this inbox? Can she view drafts there? Or is it a send-only alias?
   - Recommendation: Verify during setup. If admin@ is a send-only alias, the draft approach needs adjustment (could draft in Cat's inbox with "send-as" admin@ alias, or store draft content in CRM task body for copy-paste).

4. **Email send confirmation back to CRM**
   - What we know: Phase 4 sets `docRequestSent` date field on the CRM contact when checklist is synced.
   - What's unclear: Should this field be set when draft is created or when email is actually sent?
   - Recommendation: Set it when the email is actually sent (not at draft creation). Currently Phase 4 sets it during sync -- this may need to be moved to Phase 5's send step.

5. **`GOOGLE_SERVICE_ACCOUNT_KEY` storage format**
   - What we know: Service account keys are JSON files. Railway supports env vars.
   - What's unclear: Best format for storing multi-line JSON key in env var.
   - Recommendation: Base64-encode the entire JSON key file and store as a single env var. Decode at runtime. This is a standard pattern for service account keys in CI/CD and PaaS environments.

## Sources

### Primary (HIGH confidence)
- [Gmail API: Sending Email](https://developers.google.com/workspace/gmail/api/guides/sending) - RFC 2822, base64url encoding, required scopes
- [Gmail API: Working with Drafts](https://developers.google.com/workspace/gmail/api/guides/drafts) - Draft creation, update, send workflows
- [googleapis npm](https://www.npmjs.com/package/googleapis) - Official Node.js client library, v171.x
- [google-auth-library npm](https://www.npmjs.com/package/google-auth-library) - JWT class, service account auth, v10.x
- [Gmail API Node.js Class Reference](https://googleapis.dev/nodejs/googleapis/latest/gmail/classes/Gmail.html) - users.drafts.create, users.drafts.send typed methods
- [Domain-Wide Delegation Setup](https://support.google.com/a/answer/162106?hl=en) - Google Workspace admin setup steps
- [OAuth2 for Server-to-Server](https://developers.google.com/identity/protocols/oauth2/service-account) - Service account JWT flow with subject claim

### Secondary (MEDIUM confidence)
- [Gmail API Node.js Quickstart](https://developers.google.com/gmail/api/quickstart/nodejs) - Setup patterns (interactive, not server-to-server)
- [google-api-nodejs-client Issue #1938](https://github.com/googleapis/google-api-nodejs-client/issues/1938) - Working Node.js draft creation code example
- [Service Account Impersonation Blog](https://blog.salrashid.dev/articles/2021/impersonation_and_domain_delegation/) - JWT subject parameter for domain-wide delegation in Node.js
- [Domain-Wide Delegation Best Practices](https://support.google.com/a/answer/14437356?hl=en) - Security guidance for scope restriction

### Tertiary (LOW confidence)
- Email template structure: Based on Cat's single example email in EMAIL_TEMPLATE_REFERENCE.md. Needs validation that all edge cases match (single borrower, no property docs, etc.)
- Admin@ inbox access model: Assumption that Cat can view admin@venturemortgages.com drafts. Needs verification.

### Project Sources (HIGH confidence)
- `.planning/EMAIL_TEMPLATE_REFERENCE.md` - Cat's exact email format and tone
- `src/checklist/types/checklist.ts` - GeneratedChecklist, BorrowerChecklist, ChecklistItem types
- `src/crm/config.ts` - crmConfig, devPrefix(), AppEnv, DOC_INBOX
- `src/crm/checklist-sync.ts` - SyncChecklistInput/Result, existing orchestrator pattern
- `src/crm/tasks.ts` - createReviewTask (to be extended with draft reference)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - googleapis and google-auth-library are the official Google libraries, well-documented, actively maintained
- Architecture: HIGH - Pure function email body generator + Gmail API draft/send is a straightforward pattern matching existing codebase style
- Auth approach: MEDIUM-HIGH - Service account with DWD is the standard pattern but requires Google Workspace admin setup which has not been verified yet
- Email template: MEDIUM - Based on single example from Cat; edge cases (single borrower, no properties, many borrowers) need testing
- Pitfalls: HIGH - Well-documented in official docs and community issues

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable APIs, unlikely to change)
