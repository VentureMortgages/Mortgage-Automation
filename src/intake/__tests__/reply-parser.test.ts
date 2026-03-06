/**
 * Tests for Reply Parser — AI-powered filing reply interpreter (Phase 26)
 *
 * extractReplyText tests (pure unit, no mocking):
 * - Strips Gmail "On ... wrote:" quote markers
 * - Strips ">" quoted lines
 * - Strips "--" signature delimiter
 * - Returns full text when no markers present
 * - Handles empty string
 * - Handles multiple newlines before marker
 *
 * parseFilingReply tests (mocked Gemini):
 * - "the first one" -> select index 0
 * - "2" -> select index 1
 * - "wong ranasinghe" -> select matching option
 * - "file it under srimal's folder" -> select matching option
 * - "skip" -> action skip
 * - "leave it in needs review" -> action skip
 * - "create new folder" -> action create_new
 * - "neither, make a new one" -> action create_new
 * - gibberish -> action unclear, confidence < 0.7
 * - Gemini error -> action unclear, confidence 0, error message
 * - selectedIndex out of bounds -> override to unclear
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Gemini SDK (same pattern as body-extractor.test.ts)
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}));

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: class MockGoogleGenerativeAI {
      getGenerativeModel = mockGetGenerativeModel;
    },
    SchemaType: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
    },
  };
});

// Mock classification config so Gemini API key doesn't throw
vi.mock('../../classification/config.js', () => ({
  classificationConfig: {
    geminiApiKey: 'test-api-key',
    model: 'gemini-2.0-flash',
  },
}));

import { extractReplyText, parseFilingReply } from '../reply-parser.js';
import type { ReplyParseResult } from '../reply-parser.js';

// ---------------------------------------------------------------------------
// extractReplyText — pure unit tests
// ---------------------------------------------------------------------------

describe('extractReplyText', () => {
  it('strips Gmail "On ... wrote:" quote marker and everything after', () => {
    const body = [
      'The first one please',
      '',
      'On Mon, Mar 3, 2026 at 10:15 AM Filing Assistant <docs@venturemortgages.com> wrote:',
      'I received "paystub.pdf" but I am not sure where to file it.',
      '',
      '1. Wong-Ranasinghe, Carolyn/Srimal',
      '2. Ranasinghe, Srimal',
    ].join('\n');

    expect(extractReplyText(body)).toBe('The first one please');
  });

  it('strips ">" quoted lines', () => {
    const body = [
      'Use the second option',
      '',
      '> I received "paystub.pdf" but I am not sure where to file it.',
      '> 1. Wong-Ranasinghe',
      '> 2. Ranasinghe',
    ].join('\n');

    expect(extractReplyText(body)).toBe('Use the second option');
  });

  it('strips "--" signature delimiter and everything after', () => {
    const body = [
      'Skip it',
      '',
      '--',
      'Cat Johnson',
      'Venture Mortgages',
      'admin@venturemortgages.com',
    ].join('\n');

    expect(extractReplyText(body)).toBe('Skip it');
  });

  it('returns full text trimmed when no markers present', () => {
    const body = '  The first one please  ';
    expect(extractReplyText(body)).toBe('The first one please');
  });

  it('returns empty string for empty input', () => {
    expect(extractReplyText('')).toBe('');
  });

  it('handles reply with all three markers (stops at first one)', () => {
    const body = [
      'Wong ranasinghe',
      '',
      '-- ',
      'Cat Johnson',
      '',
      'On Mon, Mar 3, 2026 at 10:15 AM wrote:',
      '> quoted line',
    ].join('\n');

    // Should stop at "--" (signature), not go further
    expect(extractReplyText(body)).toBe('Wong ranasinghe');
  });

  it('handles multi-line reply before marker', () => {
    const body = [
      'Hey,',
      'Use the first one.',
      'Thanks!',
      '',
      'On Mon, Mar 3 wrote:',
      'original content',
    ].join('\n');

    expect(extractReplyText(body)).toBe('Hey,\nUse the first one.\nThanks!');
  });
});

// ---------------------------------------------------------------------------
// parseFilingReply — mocked Gemini tests
// ---------------------------------------------------------------------------

describe('parseFilingReply', () => {
  const twoOptions = [
    { folderName: 'Wong-Ranasinghe, Carolyn/Srimal' },
    { folderName: 'Ranasinghe, Srimal' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('"the first one" returns select index 0', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'select',
          selectedIndex: 0,
          selectedOption: 'Wong-Ranasinghe, Carolyn/Srimal',
          confidence: 0.95,
        }),
      },
    });

    const result = await parseFilingReply('the first one', twoOptions);
    expect(result.action).toBe('select');
    expect(result.selectedIndex).toBe(0);
    expect(result.selectedOption).toBe('Wong-Ranasinghe, Carolyn/Srimal');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('"2" returns select index 1', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'select',
          selectedIndex: 1,
          selectedOption: 'Ranasinghe, Srimal',
          confidence: 0.9,
        }),
      },
    });

    const result = await parseFilingReply('2', twoOptions);
    expect(result.action).toBe('select');
    expect(result.selectedIndex).toBe(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('"wong ranasinghe" matches first option', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'select',
          selectedIndex: 0,
          selectedOption: 'Wong-Ranasinghe, Carolyn/Srimal',
          confidence: 0.9,
        }),
      },
    });

    const result = await parseFilingReply('wong ranasinghe', twoOptions);
    expect(result.action).toBe('select');
    expect(result.selectedIndex).toBe(0);
    expect(result.selectedOption).toBe('Wong-Ranasinghe, Carolyn/Srimal');
  });

  it('"file it under srimal\'s folder" matches the Ranasinghe option', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'select',
          selectedIndex: 1,
          selectedOption: 'Ranasinghe, Srimal',
          confidence: 0.85,
        }),
      },
    });

    const result = await parseFilingReply("file it under srimal's folder", twoOptions);
    expect(result.action).toBe('select');
    expect(result.selectedIndex).toBe(1);
    expect(result.selectedOption).toBe('Ranasinghe, Srimal');
  });

  it('"skip" returns action skip', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'skip',
          selectedIndex: null,
          selectedOption: null,
          confidence: 0.95,
        }),
      },
    });

    const result = await parseFilingReply('skip', twoOptions);
    expect(result.action).toBe('skip');
    expect(result.selectedIndex).toBeNull();
    expect(result.selectedOption).toBeNull();
  });

  it('"leave it in needs review" returns action skip', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'skip',
          selectedIndex: null,
          selectedOption: null,
          confidence: 0.9,
        }),
      },
    });

    const result = await parseFilingReply('leave it in needs review', twoOptions);
    expect(result.action).toBe('skip');
    expect(result.selectedIndex).toBeNull();
  });

  it('"create new folder" returns action create_new', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'create_new',
          selectedIndex: null,
          selectedOption: null,
          confidence: 0.95,
        }),
      },
    });

    const result = await parseFilingReply('create new folder', twoOptions);
    expect(result.action).toBe('create_new');
    expect(result.selectedIndex).toBeNull();
  });

  it('"neither, make a new one" returns action create_new', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'create_new',
          selectedIndex: null,
          selectedOption: null,
          confidence: 0.9,
        }),
      },
    });

    const result = await parseFilingReply('neither, make a new one', twoOptions);
    expect(result.action).toBe('create_new');
  });

  it('gibberish returns action unclear with confidence < 0.7', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'unclear',
          selectedIndex: null,
          selectedOption: null,
          confidence: 0.3,
        }),
      },
    });

    const result = await parseFilingReply('asdf jkl qwerty', twoOptions);
    expect(result.action).toBe('unclear');
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('Gemini error returns action unclear with confidence 0 and error message', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Gemini API timeout'));

    const result = await parseFilingReply('the first one', twoOptions);
    expect(result.action).toBe('unclear');
    expect(result.confidence).toBe(0);
    expect(result.selectedIndex).toBeNull();
    expect(result.selectedOption).toBeNull();
    expect(result.error).toBe('Gemini API timeout');
  });

  it('selectedIndex out of bounds overrides to unclear', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'select',
          selectedIndex: 5,  // out of bounds for 2 options
          selectedOption: 'Some nonexistent folder',
          confidence: 0.8,
        }),
      },
    });

    const result = await parseFilingReply('option 6', twoOptions);
    expect(result.action).toBe('unclear');
    expect(result.selectedIndex).toBeNull();
    expect(result.selectedOption).toBeNull();
  });

  it('negative selectedIndex overrides to unclear', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'select',
          selectedIndex: -1,
          selectedOption: null,
          confidence: 0.8,
        }),
      },
    });

    const result = await parseFilingReply('hmm', twoOptions);
    expect(result.action).toBe('unclear');
    expect(result.selectedIndex).toBeNull();
  });

  it('passes options and reply text to Gemini prompt', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          action: 'select',
          selectedIndex: 0,
          selectedOption: 'Wong-Ranasinghe, Carolyn/Srimal',
          confidence: 0.95,
        }),
      },
    });

    await parseFilingReply('the first one', twoOptions);

    // Verify the prompt includes the options and reply text
    expect(mockGenerateContent).toHaveBeenCalledOnce();
    const promptArg = mockGenerateContent.mock.calls[0][0];
    const promptText = promptArg[0].text;
    expect(promptText).toContain('Wong-Ranasinghe, Carolyn/Srimal');
    expect(promptText).toContain('Ranasinghe, Srimal');
    expect(promptText).toContain('the first one');
  });

  it('invalid JSON from Gemini returns action unclear with error', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'not valid json at all',
      },
    });

    const result = await parseFilingReply('the first one', twoOptions);
    expect(result.action).toBe('unclear');
    expect(result.confidence).toBe(0);
    expect(result.error).toBeDefined();
  });
});
