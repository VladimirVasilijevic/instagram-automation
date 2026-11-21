import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPendingFacebookPages, selectFacebookPage } from './facebook-pages.js';

afterEach(() => vi.unstubAllGlobals());

describe('Facebook Page selection client', () => {
  it('loads only safe Page choices for a session-bound selection', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ pages: [{ id: 'page-id', name: 'My Bakery', token: 'secret' }] }),
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await getPendingFacebookPages('selection-id')).toEqual([
      { id: 'page-id', name: 'My Bakery' },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/connections/facebook/pending?selectionId=selection-id',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('sends only the Page explicitly chosen by the user', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await selectFacebookPage('selection-id', 'page-b');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/connections/facebook/select',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ selectionId: 'selection-id', pageId: 'page-b' }),
      }),
    );
  });

  it('rejects invalid lists and failed selections without exposing server details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ pages: [{ id: 'page-id', name: '' }] })),
        )
        .mockResolvedValueOnce(new Response('secret', { status: 403 })),
    );
    await expect(getPendingFacebookPages('selection-id')).rejects.toThrow('invalid response');
    await expect(selectFacebookPage('selection-id', 'page-id')).rejects.toThrow(
      'could not be connected',
    );
  });
});
