import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMediaPage } from './media.js';

afterEach(() => vi.unstubAllGlobals());
const media = {
  id: '17841400000000002',
  mediaType: 'IMAGE',
  contentKind: 'post',
  mediaUrl: 'https://cdn.example/media.jpg',
  thumbnailUrl: null,
  caption: 'Example caption',
  timestamp: '2026-09-22T12:00:00+0000',
  permalink: 'https://www.instagram.com/p/example/',
};

describe('recent media API client', () => {
  it('loads normalized media with same-origin credentials and no cache', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ media: [media], nextCursor: null })));
    vi.stubGlobal('fetch', fetcher);

    await expect(getMediaPage({ kind: 'post' })).resolves.toEqual({
      media: [media],
      nextCursor: null,
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/media?limit=12&kind=post',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it.each([{}, { media: {} }, { media: Array(13).fill(media) }, { media: [{ ...media, id: '' }] }])(
    'rejects invalid media responses: %j',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ nextCursor: null, ...payload }))),
      );
      await expect(getMediaPage({ kind: 'post' })).rejects.toThrow('invalid response');
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
    await expect(getMediaPage({ kind: 'post' })).rejects.toThrow('Media service is unavailable');
    await expect(getMediaPage({ kind: 'post' })).rejects.toThrow('Media service is unavailable');
  });
  it('requests a typed section and safely encodes its continuation cursor', async () => {
    const reel = { ...media, contentKind: 'reel' };
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ media: [reel], nextCursor: 'next-token' })));
    vi.stubGlobal('fetch', fetcher);
    await expect(getMediaPage({ kind: 'reel', cursor: 'opaque&value=1' })).resolves.toEqual({
      media: [reel],
      nextCursor: 'next-token',
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/media?limit=12&kind=reel&cursor=opaque%26value%3D1',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it.each([
    { media: [], nextCursor: 42 },
    { media: [{ ...media, contentKind: 'video' }], nextCursor: null },
  ])('rejects an invalid catalog page: %j', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(getMediaPage({ kind: 'post' })).rejects.toThrow('invalid response');
  });
  it('loads normalized Stories through the same paginated catalog API', async () => {
    const story = { ...media, contentKind: 'story' };
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ media: [story], nextCursor: null })));
    vi.stubGlobal('fetch', fetcher);
    await expect(getMediaPage({ kind: 'story' })).resolves.toEqual({
      media: [story],
      nextCursor: null,
    });
    expect(fetcher).toHaveBeenCalledWith('/api/media?limit=12&kind=story', expect.anything());
  });
});

it('rejects malformed catalog JSON without exposing the response body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-provider-json')));
  await expect(getMediaPage({ kind: 'post' })).rejects.toThrow('invalid response');
});

it('passes caller cancellation to the active catalog request', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    requestSignal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener(
        'abort',
        () => reject(new DOMException('private-abort-detail', 'AbortError')),
        { once: true },
      );
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const result = getMediaPage({ kind: 'story' }, controller.signal);
  const rejected = expect(result).rejects.toThrow('Media service is unavailable');
  controller.abort();
  await rejected;
  expect(requestSignal?.aborted).toBe(true);
});
