/**
 * Reply Parser — AI-powered filing reply interpreter (Phase 26)
 *
 * When the system sends a question email asking Cat which folder to file a
 * document in, Cat replies naturally. This module:
 *
 * 1. extractReplyText(fullBody) — strips Gmail quote markers, ">" quoted
 *    lines, and "--" signature delimiters so only Cat's reply remains.
 *
 * 2. parseFilingReply(replyText, options) — uses Gemini 2.0 Flash with
 *    structured output to interpret Cat's natural language choice.
 *
 * Follows the same Gemini lazy singleton pattern as body-extractor.ts.
 *
 * Consumers: intake-worker.ts (Phase 26)
 */

import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { classificationConfig } from '../classification/config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplyAction = 'select' | 'create_new' | 'skip' | 'unclear';

export interface ReplyParseResult {
  action: ReplyAction;
  /** 0-based index into the options array (null if not selecting) */
  selectedIndex: number | null;
  /** The folder name selected, for logging (null if not selecting) */
  selectedOption: string | null;
  /** Confidence in interpretation (0.0 to 1.0) */
  confidence: number;
  /** Error message if parsing failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Reply Text Extraction
// ---------------------------------------------------------------------------

/**
 * Strip Gmail quoted content, signature, and ">" quoted lines from a reply.
 *
 * Walks lines top-down and stops at the first occurrence of:
 * - Gmail quote marker: /^On .+ wrote:$/
 * - Quoted line: starts with ">"
 * - Signature delimiter: line that is exactly "--" (with optional trailing space)
 *
 * Returns the text above all markers, trimmed.
 */
export function extractReplyText(fullBody: string): string {
  if (!fullBody) return '';

  const lines = fullBody.split('\n');
  const replyLines: string[] = [];

  for (const line of lines) {
    // Stop at Gmail quote marker: "On {date}, {sender} wrote:"
    if (/^On .+ wrote:$/.test(line)) break;

    // Stop at ">" quoted lines
    if (line.startsWith('>')) break;

    // Stop at "--" signature delimiter (with optional trailing whitespace)
    if (line.trim() === '--') break;

    replyLines.push(line);
  }

  return replyLines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Gemini Structured Output for Reply Parsing
// ---------------------------------------------------------------------------

/** Response schema for the Gemini reply parser */
const replyParseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    selectedOption: {
      type: SchemaType.STRING,
      description: 'The folder name selected, or null',
      nullable: true,
    },
    selectedIndex: {
      type: SchemaType.NUMBER,
      description: 'Zero-based index of selected option from the list',
      nullable: true,
    },
    action: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['select', 'create_new', 'skip', 'unclear'],
      description: 'What the user wants to do',
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: 'Confidence in interpretation (0.0 to 1.0)',
    },
  },
  required: ['action', 'confidence'],
};

/** Lazy singleton for Gemini client (same pattern as body-extractor.ts) */
let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;
  _genAI = new GoogleGenerativeAI(classificationConfig.geminiApiKey);
  return _genAI;
}

/**
 * Parse Cat's natural language reply to a filing question email.
 *
 * Uses Gemini 2.0 Flash structured output to interpret replies like:
 * - "the first one" -> select index 0
 * - "2" -> select index 1
 * - "wong ranasinghe" -> select matching option
 * - "skip" / "leave it" -> skip
 * - "create new folder" -> create_new
 * - gibberish -> unclear
 *
 * @param replyText - Cat's reply text (already extracted via extractReplyText)
 * @param options - The folder options that were presented in the question email
 * @returns Parsed result with action, selected index/option, and confidence
 */
export async function parseFilingReply(
  replyText: string,
  options: Array<{ folderName: string }>,
): Promise<ReplyParseResult> {
  try {
    const model = getGenAI().getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: replyParseSchema,
      },
    });

    const prompt = `You are parsing a reply from a mortgage broker's assistant who was asked to choose a filing folder for a document.

The options presented were:
${options.map((o, i) => `${i + 1}. ${o.folderName}`).join('\n')}

The assistant replied: "${replyText}"

Determine what the assistant wants:
- If they chose one of the listed options (by number, name, or description), set action to "select" and selectedIndex to the 0-based index
- If they want a new folder created, set action to "create_new"
- If they want to skip/leave in Needs Review, set action to "skip"
- If the reply is unclear or ambiguous, set action to "unclear"

Set confidence between 0.0 and 1.0. If you are uncertain, set it below 0.7.`;

    const result = await model.generateContent([{ text: prompt }]);
    const responseText = result.response.text();
    const parsed = JSON.parse(responseText) as {
      action: ReplyAction;
      selectedIndex?: number | null;
      selectedOption?: string | null;
      confidence: number;
    };

    // Validate: if action is 'select', selectedIndex must be within bounds
    if (parsed.action === 'select') {
      const idx = parsed.selectedIndex;
      if (idx === null || idx === undefined || idx < 0 || idx >= options.length) {
        return {
          action: 'unclear',
          selectedIndex: null,
          selectedOption: null,
          confidence: parsed.confidence,
          error: `selectedIndex ${idx} out of bounds (0-${options.length - 1})`,
        };
      }

      return {
        action: 'select',
        selectedIndex: idx,
        selectedOption: parsed.selectedOption ?? options[idx].folderName,
        confidence: parsed.confidence,
      };
    }

    // Non-select actions: no index or option needed
    return {
      action: parsed.action,
      selectedIndex: parsed.selectedIndex ?? null,
      selectedOption: parsed.selectedOption ?? null,
      confidence: parsed.confidence,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[reply-parser] Gemini parse failed:', message);
    return {
      action: 'unclear',
      selectedIndex: null,
      selectedOption: null,
      confidence: 0,
      error: message,
    };
  }
}
