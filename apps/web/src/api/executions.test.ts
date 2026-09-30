import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRecentExecutions } from './executions.js';

afterEach(() => vi.unstubAllGlobals());
const execution = {
  commenterUsername: 'commenter',
  commentText: '#Hello',
  createdAt: '2026-09-24T12:00:00.000Z',
  deliveries: [{ channel: 'public', errorCode: null, errorMessage: null, status: 'succeeded' }],
  mediaId: null,
};

describe('execution activity API client', () => {
  it('loads safe activity with same-origin credentials and no cache', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ executions: [execution] })));
    vi.stubGlobal('fetch', fetcher);
    await expect(getRecentExecutions()).resolves.toEqual([execution]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/executions?limit=50',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('requests activity for one selected post when an identifier is supplied', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ executions: [{ ...execution, mediaId: 'post / one' }] })),
      );
    vi.stubGlobal('fetch', fetcher);

    await expect(getRecentExecutions(undefined, 'post / one')).resolves.toMatchObject([
      { mediaId: 'post / one' },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/executions?limit=50&mediaId=post+%2F+one',
      expect.any(Object),
    );
  });

  it.each([
    {},
    { executions: {} },
    { executions: [{ ...execution, deliveries: [{ channel: 'other', status: 'succeeded' }] }] },
  ])('rejects invalid activity responses: %j', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(getRecentExecutions()).rejects.toThrow('invalid response');
  });
});
