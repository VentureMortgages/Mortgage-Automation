/**
 * Matching Agent — Agentic Gemini loop for document-to-contact matching
 *
 * Main entry point: matchDocument(input) -> MatchDecision
 *
 * Algorithm:
 * 1. Pre-collect deterministic signals (thread, sender, metadata)
 * 2. If matching disabled, fall back to legacy resolveContactId
 * 3. Build system prompt with signals, classification, and signal priority tiers
 * 4. Agentic loop: Gemini reasons + calls tools until it reaches a decision
 * 5. Conflict detection: check if agent's choice conflicts with collected signals
 * 6. Log decision to Redis (MATCH-06)
 *
 * Requirements covered:
 * - MATCH-01: Thread-based matching (Tier 1)
 * - MATCH-02: Third-party sender doc content name matching
 * - MATCH-05: Opportunity-level matching for multi-deal clients
 * - FOLD-02: Phone number fallback (via search_contact_by_phone tool)
 * - FOLD-03: Co-borrower routing (via lookup_co_borrowers tool)
 *
 * Consumers: classification worker (Phase 14 Plan 03)
 */

import { GoogleGenerativeAI, type Content, type Part } from '@google/generative-ai';
import { matchingConfig } from './config.js';
import { collectThreadSignal, collectSenderSignal, collectEmailMetadataSignals } from './signal-collectors.js';
import { executeToolCall, MATCHING_TOOLS } from './agent-tools.js';
import { logMatchDecision } from './decision-log.js';
import { resolveContactId } from '../crm/contacts.js';
import type { MatchSignal, MatchDecision, MatchOutcome, MatchCandidate } from './types.js';
import type { ClassificationResult } from '../classification/types.js';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface MatchInput {
  intakeDocumentId: string;
  classificationResult: ClassificationResult;
  senderEmail: string | null;
  threadId?: string;
  ccAddresses?: string[];
  emailSubject?: string;
  applicationId: string | null;
  originalFilename: string;
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  signals: MatchSignal[],
  input: MatchInput,
): string {
  const signalSummary = signals.length > 0
    ? signals.map(s => `- ${s.type} (Tier ${s.tier}, confidence ${s.confidence}): value="${s.value}"${s.contactId ? `, contactId=${s.contactId}` : ''}`).join('\n')
    : '- No pre-collected signals.';

  const { classificationResult: cr } = input;

  return `You are a document matching agent for a mortgage broker's automation system.
Your job is to determine which CRM contact an incoming document belongs to.

## Document Information
- Document type: ${cr.documentType}
- Borrower name from doc: ${cr.borrowerFirstName ?? 'unknown'} ${cr.borrowerLastName ?? 'unknown'}
- Institution: ${cr.institution ?? 'unknown'}
- Original filename: ${input.originalFilename}
- Sender email: ${input.senderEmail ?? 'unknown'}
- Email subject: ${input.emailSubject ?? 'none'}

## Pre-collected Signals
${signalSummary}

## Signal Priority Tiers
- Tier 1 (highest): Thread match (reply to sent doc-request), sender email + single opportunity
- Tier 2: Doc content name matches one contact, sender email + agent picks opportunity
- Tier 3 (weak): Display name fuzzy, CC/To addresses, subject/body name patterns, doc address, employer
- Tier 4 (contextual): Pipeline stage, recency, doc type gaps, professional associations

## Instructions
1. Use the available tools to search the CRM and verify matches.
2. If the sender email doesn't match a CRM contact, try searching by the borrower name from the document.
3. If email lookup fails, try search_contact_by_phone if a phone number is available.
4. If the sender matches a co-borrower on a Finmo application (via lookup_co_borrowers), route to the PRIMARY borrower's folder.
5. If signals conflict (sender matches Contact A, but doc name matches Contact B), set outcome to 'conflict'.
6. Assign a confidence score 0.0-1.0 based on signal strength.

When you have enough information, respond with a JSON object (no markdown, no code fences):
{
  "chosenContactId": "string or null",
  "chosenOpportunityId": "string or null",
  "confidence": number,
  "reasoning": "string explaining your decision"
}`;
}

// ---------------------------------------------------------------------------
// Agent Loop
// ---------------------------------------------------------------------------

/**
 * Match an incoming document to a CRM contact using the Gemini agentic loop.
 *
 * @param input - Document metadata, classification result, and email context
 * @returns Complete matching decision record
 */
export async function matchDocument(input: MatchInput): Promise<MatchDecision> {
  const startTime = Date.now();

  // -------------------------------------------------------------------------
  // Disabled mode: fall back to legacy resolveContactId
  // -------------------------------------------------------------------------
  if (!matchingConfig.enabled) {
    const legacy = await resolveContactId({
      senderEmail: input.senderEmail,
      borrowerFirstName: input.classificationResult.borrowerFirstName,
      borrowerLastName: input.classificationResult.borrowerLastName,
    });

    const outcome: MatchOutcome = legacy.contactId ? 'auto_filed' : 'auto_created';
    const decision: MatchDecision = {
      intakeDocumentId: input.intakeDocumentId,
      signals: [],
      candidates: [],
      chosenContactId: legacy.contactId,
      chosenOpportunityId: null,
      chosenDriveFolderId: null,
      confidence: legacy.contactId ? 0.8 : 0,
      reasoning: legacy.contactId
        ? `Legacy fallback: resolved via ${legacy.resolvedVia}`
        : 'Legacy fallback: no contact found',
      outcome,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    await logMatchDecision(decision);
    return decision;
  }

  // -------------------------------------------------------------------------
  // Step 1: Pre-collect deterministic signals
  // -------------------------------------------------------------------------
  const signals: MatchSignal[] = [];

  const threadSignal = await collectThreadSignal(input.threadId);
  if (threadSignal) signals.push(threadSignal);

  const senderSignal = await collectSenderSignal(input.senderEmail);
  if (senderSignal) signals.push(senderSignal);

  const metadataSignals = await collectEmailMetadataSignals(
    input.ccAddresses,
    input.emailSubject,
  );
  signals.push(...metadataSignals);

  // -------------------------------------------------------------------------
  // Step 2: Build system prompt and start agentic loop
  // -------------------------------------------------------------------------
  const systemPrompt = buildSystemPrompt(signals, input);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
  const model = genAI.getGenerativeModel({ model: matchingConfig.model });

  // Build Gemini tool declarations (cast needed — our simplified tool schema
  // matches the runtime format but not the strict TypeScript types)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [{
    functionDeclarations: MATCHING_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  }];

  // Conversation history for multi-turn
  const contents: Content[] = [
    { role: 'user', parts: [{ text: systemPrompt }] },
  ];

  let agentAnswer: {
    chosenContactId: string | null;
    chosenOpportunityId: string | null;
    confidence: number;
    reasoning: string;
  } | null = null;

  let exhaustedIterations = false;

  // -------------------------------------------------------------------------
  // Step 3: Agentic loop
  // -------------------------------------------------------------------------
  for (let iteration = 0; iteration < matchingConfig.maxAgentIterations; iteration++) {
    const result = await model.generateContent({
      contents,
      tools,
    });

    const response = result.response;
    const functionCalls = response.functionCalls?.();

    if (functionCalls && functionCalls.length > 0) {
      // Execute tool calls and feed results back
      const modelParts: Part[] = functionCalls.map(fc => ({
        functionCall: { name: fc.name, args: fc.args ?? {} },
      }));
      contents.push({ role: 'model', parts: modelParts });

      const responseParts: Part[] = [];
      for (const fc of functionCalls) {
        const toolResult = await executeToolCall(
          fc.name,
          (fc.args ?? {}) as Record<string, unknown>,
        );
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: { content: toolResult },
          },
        } as Part);
      }

      contents.push({ role: 'user', parts: responseParts });
    } else {
      // No function calls — parse the text response as the final answer
      const candidate = response.candidates?.[0];
      const textPart = candidate?.content?.parts?.find(
        (p: Part) => 'text' in p && typeof p.text === 'string',
      );

      if (textPart && 'text' in textPart && typeof textPart.text === 'string') {
        try {
          // Strip markdown code fences if present
          const cleaned = textPart.text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
          agentAnswer = JSON.parse(cleaned);
        } catch {
          // If parsing fails, treat as needs_review
          agentAnswer = {
            chosenContactId: null,
            chosenOpportunityId: null,
            confidence: 0,
            reasoning: 'Agent response could not be parsed as JSON.',
          };
        }
      }
      break;
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Handle max iterations (no answer)
  // -------------------------------------------------------------------------
  if (!agentAnswer) {
    exhaustedIterations = true;
    agentAnswer = {
      chosenContactId: null,
      chosenOpportunityId: null,
      confidence: 0,
      reasoning: 'Agent reached max iterations without a final decision.',
    };
  }

  // -------------------------------------------------------------------------
  // Step 5: Conflict detection
  // -------------------------------------------------------------------------
  let outcome: MatchOutcome;

  // Check if any Tier 1 signal points to a different contact than agent's choice
  const tier1Signals = signals.filter(s => s.tier === 1 && s.contactId);
  const hasConflict = agentAnswer.chosenContactId !== null && tier1Signals.some(
    s => s.contactId !== agentAnswer!.chosenContactId,
  );

  if (hasConflict) {
    outcome = 'conflict';
    agentAnswer.reasoning = `CONFLICT: ${agentAnswer.reasoning} | Pre-collected signals point to different contact(s): ${tier1Signals.map(s => `${s.type}=${s.contactId}`).join(', ')}`;
  } else if (exhaustedIterations) {
    outcome = 'needs_review';
  } else if (agentAnswer.chosenContactId === null) {
    outcome = 'auto_created';
  } else if (agentAnswer.confidence >= matchingConfig.autoFileThreshold) {
    outcome = 'auto_filed';
  } else {
    outcome = 'needs_review';
  }

  // -------------------------------------------------------------------------
  // Step 6: Build candidates list and log decision
  // -------------------------------------------------------------------------
  const candidates: MatchCandidate[] = [];
  if (agentAnswer.chosenContactId) {
    candidates.push({
      contactId: agentAnswer.chosenContactId,
      opportunityId: agentAnswer.chosenOpportunityId ?? undefined,
      contactName: '', // Agent doesn't always return name
      signals: signals.filter(s => s.contactId === agentAnswer!.chosenContactId),
      confidence: agentAnswer.confidence,
    });
  }

  const decision: MatchDecision = {
    intakeDocumentId: input.intakeDocumentId,
    signals,
    candidates,
    chosenContactId: agentAnswer.chosenContactId,
    chosenOpportunityId: agentAnswer.chosenOpportunityId,
    chosenDriveFolderId: null, // Resolved later by filing step
    confidence: agentAnswer.confidence,
    reasoning: agentAnswer.reasoning,
    outcome,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };

  await logMatchDecision(decision);
  return decision;
}
