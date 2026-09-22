import { afterEach, describe, expect, it, vi } from 'vitest';

import { subscribeToCommentDelivery } from './webhook.js';

afterEach(() => vi.unstubAllGlobals());

describe('comment delivery subscription API', () => {
  it('uses the same-origin authenticated subscription endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(subscribeToCommentDelivery()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith('/api/webhooks/instagram/subscription', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      method: 'POST',
      signal: expect.any(AbortSignal),
    });
  });

  it('returns a safe error for an unavailable subscription', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 })),
    );
    await expect(subscribeToCommentDelivery()).rejects.toThrow('could not be enabled');
  });
});
