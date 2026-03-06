/**
 * Tests: Filing Confirmation Email
 *
 * Tests cover:
 * - buildConfirmationBody generates correct plain-text body for filed, needs-review, and error docs
 * - encodeMimeMessage produces In-Reply-To and References headers for threading
 * - encodeMimeMessage supports text/plain content type
 * - recordFilingResult stores result in Redis and triggers send when all results collected
 * - maybeSendConfirmation skips when not all results are collected
 * - maybeSendConfirmation handles missing gmailMessageRfc822Id (sends without threading)
 * - Confirmation sent from docs@ not admin@
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const mockRedisHset = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockRedisHgetall = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockRedisHlen = vi.hoisted(() => vi.fn().mockResolvedValue(0));
const mockRedisSet = vi.hoisted(() => vi.fn().mockResolvedValue('OK'));
const mockRedisGet = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockRedisDel = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockRedisExpire = vi.hoisted(() => vi.fn().mockResolvedValue(1));

vi.mock('ioredis', () => ({
  Redis: class MockIORedis {
    hset = mockRedisHset;
    hgetall = mockRedisHgetall;
    hlen = mockRedisHlen;
    set = mockRedisSet;
    get = mockRedisGet;
    del = mockRedisDel;
    expire = mockRedisExpire;
    constructor() { /* no-op */ }
  },
}));

vi.mock('../../webhook/queue.js', () => ({
  createRedisConnection: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

// ---------------------------------------------------------------------------
// Mock Gmail Client
// ---------------------------------------------------------------------------

const mockGmailSend = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: 'sent-msg-1' } }));

vi.mock('../gmail-client.js', () => ({
  getGmailComposeClient: vi.fn(() => ({
    users: {
      messages: {
        send: mockGmailSend,
      },
    },
  })),
}));

// ---------------------------------------------------------------------------
// Mock intake config
// ---------------------------------------------------------------------------

vi.mock('../../intake/config.js', () => ({
  intakeConfig: {
    docsInbox: 'docs@venturemortgages.co',
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { buildConfirmationBody, recordFilingResult, maybeSendConfirmation } from '../filing-confirmation.js';
import { encodeMimeMessage } from '../mime.js';
import type { MimeMessageInput } from '../types.js';
import type { FilingResult, MessageContext } from '../filing-confirmation.js';

// ---------------------------------------------------------------------------
// Helper: decode base64url back to string
// ---------------------------------------------------------------------------

function decodeBase64url(encoded: string): string {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const filedResult: FilingResult = {
  intakeDocumentId: 'gmail-msg-001-0',
  originalFilename: 'pay_stub_jan.pdf',
  borrowerName: 'John Smith',
  docTypeLabel: 'Pay Stub',
  filed: true,
  folderPath: 'Filed (Pay Stub)',
  manualReview: false,
  reason: null,
};

const reviewResult: FilingResult = {
  intakeDocumentId: 'gmail-msg-001-1',
  originalFilename: 'unknown_doc.pdf',
  borrowerName: 'Jane Doe',
  docTypeLabel: 'Document',
  filed: false,
  folderPath: null,
  manualReview: true,
  reason: 'Low confidence',
};

const errorResult: FilingResult = {
  intakeDocumentId: 'gmail-msg-001-2',
  originalFilename: 'corrupt_file.pdf',
  borrowerName: null,
  docTypeLabel: 'Unknown',
  filed: false,
  folderPath: null,
  manualReview: false,
  reason: null,
};

const messageContext: MessageContext = {
  gmailMessageId: 'msg-abc-123',
  gmailThreadId: 'thread-abc-123',
  gmailMessageRfc822Id: '<CABx+XJ2abc@mail.gmail.com>',
  senderEmail: 'admin@venturemortgages.com',
  emailSubject: 'Fwd: John Smith documents',
  totalExpected: 3,
};

// ---------------------------------------------------------------------------
// Tests: buildConfirmationBody
// ---------------------------------------------------------------------------

describe('buildConfirmationBody', () => {
  test('generates correct body with 3 filed + 1 needs-review doc', () => {
    const results = [filedResult, filedResult, filedResult, reviewResult];
    const body = buildConfirmationBody(results);

    expect(body).toContain('OK');
    expect(body).toContain('John Smith');
    expect(body).toContain('Pay Stub');
    expect(body).toContain('!!');
    expect(body).toContain('Jane Doe');
    expect(body).toContain('Needs Review');
    expect(body).toContain('Low confidence');
    expect(body).toContain('Venture Mortgages Doc System');
  });

  test('all filed docs shows success for each', () => {
    const results = [filedResult, { ...filedResult, intakeDocumentId: 'gmail-msg-001-1' }];
    const body = buildConfirmationBody(results);

    // Should have OK indicators
    const okCount = (body.match(/OK/g) ?? []).length;
    expect(okCount).toBeGreaterThanOrEqual(2);
    // Should NOT have !! or XX
    expect(body).not.toContain('!!');
    expect(body).not.toContain('XX');
  });

  test('all needs-review docs shows warnings for each', () => {
    const results = [reviewResult, { ...reviewResult, intakeDocumentId: 'gmail-msg-001-2' }];
    const body = buildConfirmationBody(results);

    const warnCount = (body.match(/!!/g) ?? []).length;
    expect(warnCount).toBeGreaterThanOrEqual(2);
    expect(body).not.toContain('  OK');
  });

  test('error docs show XX indicator', () => {
    const results = [errorResult];
    const body = buildConfirmationBody(results);

    expect(body).toContain('XX');
    expect(body).toContain('corrupt_file.pdf');
  });
});

// ---------------------------------------------------------------------------
// Tests: encodeMimeMessage threading
// ---------------------------------------------------------------------------

describe('encodeMimeMessage threading', () => {
  test('with inReplyTo and references produces correct MIME headers', () => {
    const input: MimeMessageInput = {
      to: 'admin@venturemortgages.com',
      from: 'docs@venturemortgages.co',
      subject: 'Re: John Smith documents',
      body: 'Filing confirmation',
      inReplyTo: '<CABx+XJ2abc@mail.gmail.com>',
      references: '<CABx+XJ2abc@mail.gmail.com>',
    };
    const encoded = encodeMimeMessage(input);
    const decoded = decodeBase64url(encoded);

    expect(decoded).toContain('In-Reply-To: <CABx+XJ2abc@mail.gmail.com>');
    expect(decoded).toContain('References: <CABx+XJ2abc@mail.gmail.com>');
  });

  test('without inReplyTo/references does not include threading headers', () => {
    const input: MimeMessageInput = {
      to: 'admin@venturemortgages.com',
      from: 'docs@venturemortgages.co',
      subject: 'Filing confirmation',
      body: 'Test body',
    };
    const encoded = encodeMimeMessage(input);
    const decoded = decodeBase64url(encoded);

    expect(decoded).not.toContain('In-Reply-To:');
    expect(decoded).not.toContain('References:');
  });

  test('with contentType text/plain sets correct Content-Type header', () => {
    const input: MimeMessageInput = {
      to: 'admin@venturemortgages.com',
      from: 'docs@venturemortgages.co',
      subject: 'Filing confirmation',
      body: 'Plain text body',
      contentType: 'text/plain',
    };
    const encoded = encodeMimeMessage(input);
    const decoded = decodeBase64url(encoded);

    expect(decoded).toContain('Content-Type: text/plain; charset=utf-8');
    expect(decoded).not.toContain('Content-Type: text/html');
  });
});

// ---------------------------------------------------------------------------
// Tests: recordFilingResult + maybeSendConfirmation
// ---------------------------------------------------------------------------

describe('recordFilingResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('stores result in Redis hash and triggers send when all results collected', async () => {
    // Simulate that after storing, there are 3 results (matching totalExpected=3)
    mockRedisHlen.mockResolvedValueOnce(3);
    // For maybeSendConfirmation: return stored results and context
    mockRedisHgetall.mockResolvedValueOnce({
      'gmail-msg-001-0': JSON.stringify(filedResult),
      'gmail-msg-001-1': JSON.stringify(reviewResult),
      'gmail-msg-001-2': JSON.stringify(errorResult),
    });
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(messageContext));

    await recordFilingResult(filedResult, messageContext);

    // Should store result in Redis hash
    expect(mockRedisHset).toHaveBeenCalledWith(
      'filing-results:msg-abc-123',
      'gmail-msg-001-0',
      JSON.stringify(filedResult),
    );

    // Should store context with NX
    expect(mockRedisSet).toHaveBeenCalledWith(
      'filing-context:msg-abc-123',
      JSON.stringify(messageContext),
      'EX', 3600, 'NX',
    );

    // Should send confirmation email (since hlen returned 3 == totalExpected)
    expect(mockGmailSend).toHaveBeenCalled();
  });
});

describe('maybeSendConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('does nothing when not all results are collected yet', async () => {
    // Only 1 of 3 expected results stored
    mockRedisHgetall.mockResolvedValueOnce({
      'gmail-msg-001-0': JSON.stringify(filedResult),
    });
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(messageContext));

    await maybeSendConfirmation('msg-abc-123');

    // Should NOT send email
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  test('handles missing gmailMessageRfc822Id gracefully (sends without threading)', async () => {
    const contextNoRfc = { ...messageContext, gmailMessageRfc822Id: null };
    mockRedisHgetall.mockResolvedValueOnce({
      'gmail-msg-001-0': JSON.stringify(filedResult),
      'gmail-msg-001-1': JSON.stringify(reviewResult),
      'gmail-msg-001-2': JSON.stringify(errorResult),
    });
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(contextNoRfc));

    await maybeSendConfirmation('msg-abc-123');

    // Should still send email
    expect(mockGmailSend).toHaveBeenCalled();

    // Verify the raw message does NOT have In-Reply-To
    const sendCall = mockGmailSend.mock.calls[0][0];
    const rawMessage = sendCall.requestBody.raw;
    const decoded = decodeBase64url(rawMessage);
    expect(decoded).not.toContain('In-Reply-To:');
  });

  test('sends confirmation from docs@ not admin@', async () => {
    mockRedisHgetall.mockResolvedValueOnce({
      'gmail-msg-001-0': JSON.stringify(filedResult),
      'gmail-msg-001-1': JSON.stringify(reviewResult),
      'gmail-msg-001-2': JSON.stringify(errorResult),
    });
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(messageContext));

    await maybeSendConfirmation('msg-abc-123');

    expect(mockGmailSend).toHaveBeenCalled();

    // Verify the MIME message has From: docs@
    const sendCall = mockGmailSend.mock.calls[0][0];
    const rawMessage = sendCall.requestBody.raw;
    const decoded = decodeBase64url(rawMessage);
    expect(decoded).toContain('From: docs@venturemortgages.co');
    expect(decoded).not.toContain('From: admin@');
  });

  test('cleans up Redis keys after successful send', async () => {
    mockRedisHgetall.mockResolvedValueOnce({
      'gmail-msg-001-0': JSON.stringify(filedResult),
      'gmail-msg-001-1': JSON.stringify(reviewResult),
      'gmail-msg-001-2': JSON.stringify(errorResult),
    });
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(messageContext));

    await maybeSendConfirmation('msg-abc-123');

    // Should clean up both Redis keys
    expect(mockRedisDel).toHaveBeenCalledWith('filing-results:msg-abc-123');
    expect(mockRedisDel).toHaveBeenCalledWith('filing-context:msg-abc-123');
  });
});
