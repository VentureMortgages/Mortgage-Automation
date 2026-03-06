/**
 * One-off: Create a Gmail draft to Cat about checklist fixes + feedback question.
 * Usage: npx tsx src/e2e/draft-cat-update.ts
 */
import 'dotenv/config';
import { encodeMimeMessage } from '../email/mime.js';
import { createGmailDraft } from '../email/gmail-client.js';

async function main(): Promise<void> {
  const to = 'admin@venturemortgages.com';
  const subject = 'Checklist fixes deployed + feedback question';

  const body = `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6;">
<p>Hi Cat,</p>

<p>Quick update — I've deployed fixes for all the issues you flagged in your draft review:</p>

<ol>
  <li><strong>Commission T4</strong> no longer shows up twice</li>
  <li><strong>Property docs</strong> no longer duplicate across borrowers</li>
  <li><strong>Subject property vs rental</strong> — if the subject property is also a rental, it only shows once (under Property)</li>
  <li><strong>Self-employed docs</strong> — only shows for borrowers with active self-employment income</li>
  <li><strong>Property address</strong> — now pulls the correct address instead of showing "undefined"</li>
  <li><strong>Yellow bar</strong> (high net worth) — cosmetic fix, displays properly now</li>
</ol>

<p>These are live as of today — next time a draft generates, you should see the improvements.</p>

<p>And to answer your question about editing drafts: <strong>yes, when you edit a draft before sending it, the system learns from your changes.</strong> It compares your version to the original and uses that to improve future drafts. So keep editing as needed — it's training the system to get better over time.</p>

<p>Let me know if you spot anything else!</p>

<p>Lucas</p>
</div>`;

  const raw = encodeMimeMessage({
    to,
    from: 'admin@venturemortgages.com',
    subject,
    body,
  });

  const result = await createGmailDraft(raw);
  console.log('Draft created!');
  console.log(`  Draft ID: ${result.draftId}`);
  console.log(`  Subject: ${subject}`);
  console.log(`  To: ${to}`);
  console.log('\nCheck Gmail Drafts to review and send.');
}

main().catch((err: unknown) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
