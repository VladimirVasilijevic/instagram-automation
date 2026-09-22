import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCurrentAccount, logout } from './auth.js';

afterEach(() => vi.unstubAllGlobals());
const account = { id: 'account-id', instagramUserId: '17841400000000001', username: 'example' };

describe('account API client', () => {
  it('returns only safe identity fields using same-origin credentials and no cache', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ account: { ...account, unwanted: 'not-returned' } })),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await getCurrentAccount()).toEqual(account);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });
  it('represents a missing or expired session as signed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    expect(await getCurrentAccount()).toBeNull();
  });
  it.each([
    {},
    { account: null },
    { account: { ...account, username: '' } },
    { account: { ...account, instagramUserId: 123 } },
  ])('rejects invalid account data', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(getCurrentAccount()).rejects.toThrow('invalid response');
  });
  it('does not present provider or server error bodies to the user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret', { status: 500 })));
    await expect(getCurrentAccount()).rejects.toThrow('Account service is unavailable');
  });
  it('rejects invalid JSON and wraps network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('bad json'))
        .mockRejectedValueOnce(new Error('private-detail')),
    );
    await expect(getCurrentAccount()).rejects.toThrow('invalid response');
    await expect(getCurrentAccount()).rejects.toThrow('Account service is unavailable');
  });
  it('passes cancellation and accepts only successful logout responses', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    controller.abort();
    await getCurrentAccount(controller.signal);
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
    await logout();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    await expect(logout()).rejects.toThrow('Logout could not be completed');
  });
});
