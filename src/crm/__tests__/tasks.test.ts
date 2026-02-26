// ============================================================================
// Tests: CRM Tasks — Business day calculation + task search/update/dedup
// ============================================================================
//
// Tests addBusinessDays (pure utility), findReviewTask, completeTask,
// and createOrUpdateReviewTask. Uses vi.stubGlobal('fetch') for HTTP tests.
//
// NOTE: All Date constructors use 'T12:00:00Z' (noon UTC) to prevent
// timezone-related day-of-week shifts when running in non-UTC timezones.
// getDay()/setDate() operate in local time, so midnight UTC can shift
// the local day backward in Western Hemisphere timezones.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock CRM config before imports
vi.mock('../config.js', () => ({
  crmConfig: {
    apiKey: 'test-api-key',
    baseUrl: 'https://test-api.example.com',
    isDev: true,
    userIds: {
      cat: 'cat-user-id-123',
      taylor: 'taylor-user-id-456',
    },
  },
  devPrefix: (text: string) => `[TEST] ${text}`,
}));

import { addBusinessDays, findReviewTask, completeTask, createOrUpdateReviewTask } from '../tasks.js';

// Helper to extract YYYY-MM-DD from a Date using local date parts
// (matches how getDay/setDate operate in addBusinessDays)
function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ============================================================================
// addBusinessDays
// ============================================================================

describe('addBusinessDays', () => {
  test('Monday + 1 = Tuesday', () => {
    const monday = new Date('2026-02-16T12:00:00Z'); // Monday
    expect(toLocalDate(addBusinessDays(monday, 1))).toBe('2026-02-17');
  });

  test('Friday + 1 = Monday', () => {
    const friday = new Date('2026-02-13T12:00:00Z'); // Friday
    expect(toLocalDate(addBusinessDays(friday, 1))).toBe('2026-02-16');
  });

  test('Saturday + 1 = Monday', () => {
    const saturday = new Date('2026-02-14T12:00:00Z'); // Saturday
    expect(toLocalDate(addBusinessDays(saturday, 1))).toBe('2026-02-16');
  });

  test('Sunday + 1 = Monday', () => {
    const sunday = new Date('2026-02-15T12:00:00Z'); // Sunday
    expect(toLocalDate(addBusinessDays(sunday, 1))).toBe('2026-02-16');
  });

  test('Friday + 2 = Tuesday', () => {
    const friday = new Date('2026-02-13T12:00:00Z');
    expect(toLocalDate(addBusinessDays(friday, 2))).toBe('2026-02-17');
  });

  test('Wednesday + 5 = Wednesday next week', () => {
    const wed = new Date('2026-02-11T12:00:00Z'); // Wednesday
    expect(toLocalDate(addBusinessDays(wed, 5))).toBe('2026-02-18');
  });

  test('Monday + 0 = Monday', () => {
    const monday = new Date('2026-02-16T12:00:00Z');
    expect(toLocalDate(addBusinessDays(monday, 0))).toBe('2026-02-16');
  });

  test('Thursday + 1 = Friday', () => {
    const thursday = new Date('2026-02-12T12:00:00Z');
    expect(toLocalDate(addBusinessDays(thursday, 1))).toBe('2026-02-13');
  });
});

// ============================================================================
// findReviewTask
// ============================================================================

describe('findReviewTask', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns matching task when one exists with "Review doc request" in title', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'task-1', title: '[TEST] Review doc request — John Doe', completed: false },
          { id: 'task-2', title: 'Some other task', completed: false },
        ],
      }),
    });

    const result = await findReviewTask('contact-123');

    expect(result).toEqual({
      id: 'task-1',
      title: '[TEST] Review doc request — John Doe',
      completed: false,
    });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/contacts/contact-123/tasks');
  });

  test('returns null when no tasks match the pattern', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'task-1', title: 'Other task', completed: false },
          { id: 'task-2', title: 'PRE docs complete — Jane', completed: true },
        ],
      }),
    });

    const result = await findReviewTask('contact-123');

    expect(result).toBeNull();
  });

  test('returns null when API call fails (non-fatal)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server error',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await findReviewTask('contact-123');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[findReviewTask] Failed to search tasks'),
    );

    warnSpy.mockRestore();
  });

  test('returns first match when multiple tasks match', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [
          { id: 'task-old', title: '[TEST] Review doc request — John Doe', completed: true },
          { id: 'task-new', title: '[TEST] Review doc request — John Doe', completed: false },
        ],
      }),
    });

    const result = await findReviewTask('contact-123');

    expect(result).toEqual({
      id: 'task-old',
      title: '[TEST] Review doc request — John Doe',
      completed: true,
    });
  });

  test('returns null on network failure (non-fatal)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await findReviewTask('contact-123');

    expect(result).toBeNull();
    warnSpy.mockRestore();
  });
});

// ============================================================================
// completeTask
// ============================================================================

describe('completeTask', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('calls PUT with { completed: true } on the correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'task-abc', completed: true } }),
    });

    await completeTask('contact-123', 'task-abc');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.example.com/contacts/contact-123/tasks/task-abc');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ completed: true });
    expect(init.headers.Authorization).toBe('Bearer test-api-key');
  });

  test('does not throw when API call fails (non-fatal)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server error',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Should NOT throw
    await expect(completeTask('contact-123', 'task-abc')).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[completeTask] Failed to complete task'),
    );

    warnSpy.mockRestore();
  });

  test('does not throw on network failure (non-fatal)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(completeTask('contact-123', 'task-abc')).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });
});

// ============================================================================
// createOrUpdateReviewTask
// ============================================================================

describe('createOrUpdateReviewTask', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('creates new task when no existing task found', async () => {
    // First call: findReviewTask GET — returns no matching tasks
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tasks: [] }),
    });

    // Second call: createReviewTask POST — creates new task
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'new-task-123' } }),
    });

    const result = await createOrUpdateReviewTask('contact-123', 'John Doe', 'Summary text');

    expect(result).toBe('new-task-123');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify second call is a POST (task creation)
    const [, createInit] = mockFetch.mock.calls[1];
    expect(createInit.method).toBe('POST');
  });

  test('updates existing task when findReviewTask returns a match', async () => {
    // First call: findReviewTask GET — returns matching task
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [{ id: 'existing-task-456', title: '[TEST] Review doc request — John Doe', completed: false }],
      }),
    });

    // Second call: update PUT
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'existing-task-456' } }),
    });

    const result = await createOrUpdateReviewTask('contact-123', 'John Doe', 'Updated summary');

    expect(result).toBe('existing-task-456');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify second call is a PUT to update the existing task
    const [url, updateInit] = mockFetch.mock.calls[1];
    expect(url).toBe('https://test-api.example.com/contacts/contact-123/tasks/existing-task-456');
    expect(updateInit.method).toBe('PUT');

    const body = JSON.parse(updateInit.body);
    expect(body.body).toContain('Updated summary');
    expect(body.body).toContain('Checklist Summary');
  });

  test('returns undefined when all operations fail (non-fatal)', async () => {
    // findReviewTask fails
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Even the fallback createReviewTask would fail, but since findReviewTask
    // itself returns null on error, a second fetch for createReviewTask happens
    // and also fails — but the outer catch handles it
    mockFetch.mockRejectedValueOnce(new Error('Also fails'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await createOrUpdateReviewTask('contact-123', 'John Doe', 'Summary');

    // findReviewTask catches its own error and returns null, so createReviewTask is called.
    // createReviewTask throws because the Cat user ID check passes (mocked), but the fetch fails.
    // The outer catch in createOrUpdateReviewTask catches it and returns undefined.
    expect(result).toBeUndefined();

    warnSpy.mockRestore();
  });

  test('updates existing task body without checklist summary when none provided', async () => {
    // findReviewTask GET — returns matching task
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [{ id: 'existing-task', title: '[TEST] Review doc request — Jane', completed: false }],
      }),
    });

    // Update PUT
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'existing-task' } }),
    });

    const result = await createOrUpdateReviewTask('contact-123', 'Jane Doe');

    expect(result).toBe('existing-task');

    const [, updateInit] = mockFetch.mock.calls[1];
    const body = JSON.parse(updateInit.body);
    expect(body.body).toBe('Generated checklist ready for review. Check custom fields for document list. Edit and send email when ready.');
    expect(body.body).not.toContain('Checklist Summary');
  });
});
