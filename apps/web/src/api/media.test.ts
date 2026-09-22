import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRecentMedia } from './media.js';

afterEach(() => vi.unstubAllGlobals());
const media = {
  id: '17841400000000002',
  mediaType: 'IMAGE',
  mediaUrl: 'https://cdn.example/media.jpg',
  thumbnailUrl: null,
  caption: 'Example caption',
  timestamp: '2026-09-22T12:00:00+0000',
  permalink: 'https://www.instagram.com/p/example/',
};

describe('recent media API client', () => {
  it('loads normalized media with same-origin credentials and no cache', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ media: [media] })));
    vi.stubGlobal('fetch', fetcher);

    await expect(getRecentMedia()).resolves.toEqual([media]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/media?limit=12',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it.each([{}, { media: {} }, { media: Array(13).fill(media) }, { media: [{ ...media, id: '' }] }])(
    'rejects invalid media responses: %j',
    async (payload) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
      await expect(getRecentMedia()).rejects.toThrow('invalid response');
    },
  );

  it('does not expose provider error bodies and wraps network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('private provider response', { status: 502 }))
        .mockRejectedValueOnce(new Error('private network detail')),
    );
    await expect(getRecentMedia()).rejects.toThrow('Media service is unavailable');
    await expect(getRecentMedia()).rejects.toThrow('Media service is unavailable');
  });
});
