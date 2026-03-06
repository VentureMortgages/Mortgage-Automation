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

import {
  buildConfirmationBody,
  recordFilingResult,
  maybeSendConfirmation,
  buildQuestionBody,
  storePendingChoice,
  getPendingChoice,
  deletePendingChoice,
  sendQuestionEmail,
  buildFollowUpBody,
  sendFollowUpConfirmation,
} from '../filing-confirmation.js';
import { encodeMimeMessage } from '../mime.js';
import type { MimeMessageInput } from '../types.js';
import type { FilingResult, MessageContext, PendingChoice } from '../filing-confirmation.js';

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

    expect(body).toContain('John Smith');
    expect(body).toContain('Pay Stub');
    expect(body).toContain('Filed');
    expect(body).toContain('Jane Doe');
    expect(body).toContain('Needs review');
    expect(body).toContain('Low confidence');
    expect(body).toContain('1 item moved to Needs Review');
  });

  test('all filed docs shows success summary', () => {
    const results = [filedResult, { ...filedResult, intakeDocumentId: 'gmail-msg-001-1' }];
    const body = buildConfirmationBody(results);

    expect(body).toContain('Got it');
    expect(body).toContain('filed 2 documents');
    expect(body).not.toContain('Needs review');
    expect(body).not.toContain('Could not process');
  });

  test('all needs-review docs shows warnings for each', () => {
    const results = [reviewResult, { ...reviewResult, intakeDocumentId: 'gmail-msg-001-2' }];
    const body = buildConfirmationBody(results);

    expect(body).toContain('Needs review');
    expect(body).toContain('2 items moved to Needs Review');
    expect(body).not.toContain('Filed:');
  });

  test('error docs show could not process message', () => {
    const results = [errorResult];
    const body = buildConfirmationBody(results);

    expect(body).toContain('Could not process');
    expect(body).toContain('corrupt_file.pdf');
  });

  test('single filed doc uses singular "document"', () => {
    const results = [filedResult];
    const body = buildConfirmationBody(results);

    expect(body).toContain('filed 1 document.');
    expect(body).not.toContain('documents');
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

// ---------------------------------------------------------------------------
// Tests: buildQuestionBody (Phase 26)
// ---------------------------------------------------------------------------

describe('buildQuestionBody', () => {
  test('lists 2 folder options with numbered list', () => {
    const body = buildQuestionBody('T4_2024.pdf', 'T4', [
      { folderName: 'Wong-Ranasinghe, Carolyn/Srimal' },
      { folderName: 'Ranasinghe, Srimal' },
    ]);

    expect(body).toContain('T4_2024.pdf');
    expect(body).toContain('T4');
    expect(body).toContain('not sure where to file it');
    expect(body).toContain('1. Wong-Ranasinghe, Carolyn/Srimal');
    expect(body).toContain('2. Ranasinghe, Srimal');
    expect(body).toContain('reply with the number');
  });

  test('lists 3 folder options', () => {
    const body = buildQuestionBody('pay_stub.pdf', 'Pay Stub', [
      { folderName: 'Smith, John' },
      { folderName: 'Smith, Jonathan' },
      { folderName: 'Smith-Jones, John' },
    ]);

    expect(body).toContain('1. Smith, John');
    expect(body).toContain('2. Smith, Jonathan');
    expect(body).toContain('3. Smith-Jones, John');
  });

  test('includes "skip" and "create new folder" in footer', () => {
    const body = buildQuestionBody('doc.pdf', 'Document', [
      { folderName: 'Folder A' },
      { folderName: 'Folder B' },
    ]);

    expect(body).toContain('create new folder');
    expect(body).toContain('skip');
    expect(body).toContain('Needs Review');
  });
});

// ---------------------------------------------------------------------------
// Tests: storePendingChoice / getPendingChoice / deletePendingChoice (Phase 26)
// ---------------------------------------------------------------------------

describe('storePendingChoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const pendingChoice: PendingChoice = {
    options: [
      { folderId: 'folder-1', folderName: 'Wong-Ranasinghe, Carolyn/Srimal' },
      { folderId: 'folder-2', folderName: 'Ranasinghe, Srimal' },
    ],
    documentInfo: {
      intakeDocumentId: 'gmail-msg-001-0',
      originalFilename: 'T4_2024.pdf',
      docTypeLabel: 'T4',
      driveFileId: 'file-abc',
      needsReviewFolderId: 'nr-folder-123',
    },
    contactId: 'contact-123',
    threadContext: {
      gmailThreadId: 'thread-abc-123',
      gmailMessageRfc822Id: '<CABx+XJ2abc@mail.gmail.com>',
      senderEmail: 'admin@venturemortgages.com',
      emailSubject: 'Fwd: John Smith documents',
    },
    createdAt: '2026-03-06T12:00:00Z',
  };

  test('stores pending choice in Redis with 24h TTL keyed by threadId', async () => {
    await storePendingChoice('thread-abc-123', pendingChoice);

    expect(mockRedisSet).toHaveBeenCalledWith(
      'pending-choice:thread-abc-123',
      JSON.stringify(pendingChoice),
      'EX',
      86400,
    );
  });

  test('getPendingChoice retrieves stored pending choice', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(pendingChoice));

    const result = await getPendingChoice('thread-abc-123');

    expect(result).toEqual(pendingChoice);
    expect(mockRedisGet).toHaveBeenCalledWith('pending-choice:thread-abc-123');
  });

  test('getPendingChoice returns null for unknown threadId', async () => {
    mockRedisGet.mockResolvedValueOnce(null);

    const result = await getPendingChoice('unknown-thread');

    expect(result).toBeNull();
  });

  test('deletePendingChoice removes the Redis key', async () => {
    await deletePendingChoice('thread-abc-123');

    expect(mockRedisDel).toHaveBeenCalledWith('pending-choice:thread-abc-123');
  });
});

// ---------------------------------------------------------------------------
// Tests: sendQuestionEmail (Phase 26)
// ---------------------------------------------------------------------------

describe('sendQuestionEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sends MIME message with In-Reply-To, References, and threadId', async () => {
    const context: MessageContext = {
      gmailMessageId: 'msg-abc-123',
      gmailThreadId: 'thread-abc-123',
      gmailMessageRfc822Id: '<CABx+XJ2abc@mail.gmail.com>',
      senderEmail: 'admin@venturemortgages.com',
      emailSubject: 'Fwd: John Smith documents',
      totalExpected: 1,
    };

    await sendQuestionEmail(context, 'Which folder should I use?');

    expect(mockGmailSend).toHaveBeenCalledTimes(1);

    const sendCall = mockGmailSend.mock.calls[0][0];
    expect(sendCall.requestBody.threadId).toBe('thread-abc-123');

    const decoded = decodeBase64url(sendCall.requestBody.raw);
    expect(decoded).toContain('In-Reply-To: <CABx+XJ2abc@mail.gmail.com>');
    expect(decoded).toContain('References: <CABx+XJ2abc@mail.gmail.com>');
    expect(decoded).toContain('From: docs@venturemortgages.co');
    expect(decoded).toContain('To: admin@venturemortgages.com');
    expect(decoded).toContain('Subject: Re: Fwd: John Smith documents');
    expect(decoded).toContain('Content-Type: text/plain; charset=utf-8');
  });

  test('sends without threading headers when gmailMessageRfc822Id is null', async () => {
    const context: MessageContext = {
      gmailMessageId: 'msg-abc-123',
      gmailThreadId: 'thread-abc-123',
      gmailMessageRfc822Id: null,
      senderEmail: 'admin@venturemortgages.com',
      emailSubject: 'Fwd: documents',
      totalExpected: 1,
    };

    await sendQuestionEmail(context, 'Question body');

    expect(mockGmailSend).toHaveBeenCalledTimes(1);

    const sendCall = mockGmailSend.mock.calls[0][0];
    const decoded = decodeBase64url(sendCall.requestBody.raw);
    expect(decoded).not.toContain('In-Reply-To:');
    expect(decoded).not.toContain('References:');
  });
});

// ---------------------------------------------------------------------------
// Tests: buildFollowUpBody (Phase 26 Plan 03)
// ---------------------------------------------------------------------------

describe('buildFollowUpBody', () => {
  test('select action returns "Done -- filed to {folderName}."', () => {
    const body = buildFollowUpBody('select', 'Wong-Ranasinghe, Carolyn/Srimal');
    expect(body).toBe('Done -- filed to Wong-Ranasinghe, Carolyn/Srimal.');
  });

  test('skip action returns "Got it, leaving in Needs Review."', () => {
    const body = buildFollowUpBody('skip');
    expect(body).toBe('Got it, leaving in Needs Review.');
  });

  test('create_new action returns "Done -- created new folder \'{folderName}\' and filed there."', () => {
    const body = buildFollowUpBody('create_new', 'Smith, John');
    expect(body).toBe("Done -- created new folder 'Smith, John' and filed there.");
  });

  test('unclear action returns clarification message', () => {
    const body = buildFollowUpBody('unclear');
    expect(body).toBe("Sorry, I wasn't sure which one you meant. Could you clarify?");
  });
});

// ---------------------------------------------------------------------------
// Tests: sendFollowUpConfirmation (Phase 26 Plan 03)
// ---------------------------------------------------------------------------

describe('sendFollowUpConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sends MIME message in same thread with correct body', async () => {
    const threadContext = {
      gmailThreadId: 'thread-reply-1',
      gmailMessageRfc822Id: '<CABx+reply1@mail.gmail.com>',
      senderEmail: 'admin@venturemortgages.com',
      emailSubject: 'Re: Fwd: John Smith documents',
    };

    await sendFollowUpConfirmation(threadContext, 'Done -- filed to Smith, John.');

    expect(mockGmailSend).toHaveBeenCalledTimes(1);

    const sendCall = mockGmailSend.mock.calls[0][0];
    expect(sendCall.requestBody.threadId).toBe('thread-reply-1');

    const decoded = decodeBase64url(sendCall.requestBody.raw);
    expect(decoded).toContain('In-Reply-To: <CABx+reply1@mail.gmail.com>');
    expect(decoded).toContain('References: <CABx+reply1@mail.gmail.com>');
    expect(decoded).toContain('From: docs@venturemortgages.co');
    expect(decoded).toContain('To: admin@venturemortgages.com');
    expect(decoded).toContain('Content-Type: text/plain; charset=utf-8');
    // Body is base64-encoded in MIME; decode the body part
    const bodyBase64 = decoded.split('\r\n\r\n')[1]?.trim();
    const bodyDecoded = Buffer.from(bodyBase64, 'base64').toString('utf-8');
    expect(bodyDecoded).toBe('Done -- filed to Smith, John.');
  });

  test('sends without threading headers when gmailMessageRfc822Id is null', async () => {
    const threadContext = {
      gmailThreadId: 'thread-reply-2',
      gmailMessageRfc822Id: null,
      senderEmail: 'admin@venturemortgages.com',
      emailSubject: 'Re: Fwd: documents',
    };

    await sendFollowUpConfirmation(threadContext, 'Got it, leaving in Needs Review.');

    expect(mockGmailSend).toHaveBeenCalledTimes(1);

    const sendCall = mockGmailSend.mock.calls[0][0];
    const decoded = decodeBase64url(sendCall.requestBody.raw);
    expect(decoded).not.toContain('In-Reply-To:');
    expect(decoded).not.toContain('References:');
    // Body is base64-encoded in MIME; decode the body part
    const bodyBase64 = decoded.split('\r\n\r\n')[1]?.trim();
    const bodyDecoded = Buffer.from(bodyBase64, 'base64').toString('utf-8');
    expect(bodyDecoded).toBe('Got it, leaving in Needs Review.');
  });
});
