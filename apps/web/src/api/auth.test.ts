import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCurrentViewer, logout } from './auth.js';

afterEach(() => vi.unstubAllGlobals());

const viewer = {
  user: { id: 'user-id', displayName: 'Ava' },
  connection: {
    id: 'connection-id',
    provider: 'instagram',
    externalAccountId: '17841400000000001',
    displayName: 'example',
    connectionStatus: 'active',
  },
};

describe('viewer API client', () => {
  it('reads only safe user and connection fields with the session cookie', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...viewer,
          user: { ...viewer.user, secret: 'discarded' },
          connection: { ...viewer.connection, token: 'discarded' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(await getCurrentViewer()).toEqual(viewer);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('distinguishes signed out from signed in without a connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ user: viewer.user, connection: null })),
        ),
    );
    expect(await getCurrentViewer()).toBeNull();
    expect(await getCurrentViewer()).toEqual({ user: viewer.user, connection: null });
  });

  it.each([
    {},
    { user: null, connection: null },
    { user: { id: '' }, connection: null },
    { user: viewer.user, connection: { ...viewer.connection, provider: 'unknown' } },
    { user: viewer.user, connection: { ...viewer.connection, displayName: '' } },
  ])('rejects invalid viewer data', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(getCurrentViewer()).rejects.toThrow('invalid response');
  });

  it('keeps server and provider errors out of displayed messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret', { status: 500 })));
    await expect(getCurrentViewer()).rejects.toThrow('Account service is unavailable');
  });

  it('requires successful logout', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await logout();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    await expect(logout()).rejects.toThrow('Logout could not be completed');
  });
});
