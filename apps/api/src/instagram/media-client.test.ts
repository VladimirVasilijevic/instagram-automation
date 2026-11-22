import { describe, expect, it, vi } from 'vitest';

import { createInstagramMediaClient, InstagramMediaError } from './media-client.js';

const config = { apiVersion: 'v24.0' };
const input = {
  accessToken: 'private-access-token',
  instagramUserId: '17841400000000001',
  limit: 12,
};
const media = {
  id: '17841400000000002',
  media_type: 'IMAGE',
  media_url: 'https://cdn.example/media.jpg',
  thumbnail_url: 'https://cdn.example/thumbnail.jpg',
  caption: 'Example caption',
  timestamp: '2026-09-22T12:00:00+0000',
  permalink: 'https://www.instagram.com/p/example/',
};
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

const failureContext = async (operation: Promise<unknown>) => {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(InstagramMediaError);
    return (error as InstagramMediaError).toLogContext();
  }
  throw new Error('Expected Instagram media request to fail');
};

describe('Instagram media HTTP adapter', () => {
  it('requests and normalizes recent media without exposing the token in the URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [media] }));
    await expect(
      createInstagramMediaClient(config, fetcher).listRecentMedia(input),
    ).resolves.toEqual([
      {
        id: media.id,
        mediaType: media.media_type,
        mediaUrl: media.media_url,
        thumbnailUrl: media.thumbnail_url,
        caption: media.caption,
        timestamp: media.timestamp,
        permalink: media.permalink,
      },
    ]);
    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://graph.instagram.com/v24.0/17841400000000001/media?fields=id%2Cmedia_type%2Cmedia_url%2Cthumbnail_url%2Ccaption%2Ctimestamp%2Cpermalink&limit=12',
    );
    expect(String(url)).not.toContain(input.accessToken);
    expect(request?.headers).toEqual({ Authorization: `Bearer ${input.accessToken}` });
    expect(request?.redirect).toBe('error');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves numeric media IDs beyond JavaScript safe integers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{"data":[{"id":17841400000000002,"media_type":"IMAGE"}]}', { status: 200 }),
      );
    await expect(
      createInstagramMediaClient(config, fetcher).listRecentMedia(input),
    ).resolves.toEqual([
      {
        id: '17841400000000002',
        mediaType: 'IMAGE',
        mediaUrl: null,
        thumbnailUrl: null,
        caption: null,
        timestamp: null,
        permalink: null,
      },
    ]);
  });

  it('returns only the requested number of provider items', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: [media, { ...media, id: '2' }] }));
    await expect(
      createInstagramMediaClient(config, fetcher).listRecentMedia({ ...input, limit: 1 }),
    ).resolves.toHaveLength(1);
  });

  it.each([0, 13, 1.5])('rejects invalid limits: %s', async (limit) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createInstagramMediaClient(config, fetcher).listRecentMedia({ ...input, limit }),
    ).rejects.toThrow('Media limit must be an integer from 1 through 12');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes optional provider fields to null', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: [{ id: media.id, media_type: media.media_type }] }));
    await expect(
      createInstagramMediaClient(config, fetcher).listRecentMedia(input),
    ).resolves.toEqual([
      {
        id: media.id,
        mediaType: media.media_type,
        mediaUrl: null,
        thumbnailUrl: null,
        caption: null,
        timestamp: null,
        permalink: null,
      },
    ]);
  });

  it('reports safe Meta HTTP diagnostics without response content', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 190, error_subcode: 463, message: 'private provider detail' },
          access_token: 'private provider token',
        }),
        { status: 400 },
      ),
    );
    const operation = createInstagramMediaClient(config, fetcher).listRecentMedia(input);
    await expect(operation).rejects.toThrow('Instagram media request failed');
    expect(await failureContext(operation)).toEqual({
      errorName: 'InstagramMediaError',
      stage: 'media',
      reason: 'http_error',
      httpStatus: '400',
      metaErrorCode: '190',
      metaErrorSubcode: '463',
    });
  });

  it('reports only safe field names and types for malformed provider responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ data: [{ id: 'private-id', media_type: 42, media_url: 'private-not-a-url' }] }),
      );
    const operation = createInstagramMediaClient(config, fetcher).listRecentMedia(input);
    await expect(operation).rejects.toThrow('Instagram media request failed');
    expect(await failureContext(operation)).toEqual({
      errorName: 'InstagramMediaError',
      stage: 'media',
      reason: 'invalid_response',
      httpStatus: '200',
      invalidFields: 'id,media_type,media_url',
      invalidFieldTypes: 'id:string,media_type:number,media_url:string',
    });
  });

  it('classifies fetch timeouts without retrying', async () => {
    const timeout = new DOMException('private timeout detail', 'TimeoutError');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(timeout);
    const operation = createInstagramMediaClient(config, fetcher).listRecentMedia(input);
    await expect(operation).rejects.toThrow('Instagram media request failed');
    expect(await failureContext(operation)).toEqual({
      errorName: 'InstagramMediaError',
      stage: 'media',
      reason: 'timeout',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('Instagram catalog adapter', () => {
  it('classifies REELS explicitly while retaining ordinary videos as posts and omitting stories', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        data: [
          { ...media, id: '11', media_type: 'VIDEO', media_product_type: 'REELS' },
          { ...media, id: '12', media_type: 'VIDEO', media_product_type: 'FEED' },
          { ...media, id: '13', media_product_type: 'STORY' },
        ],
        paging: { cursors: { after: 'next-token' }, next: 'https://graph.instagram.com/next' },
      }),
    );
    const result = await createInstagramMediaClient(config, fetcher).listMediaPage!({
      ...input,
      after: 'prior-token',
    });
    expect(result.media.map(({ id, contentKind }) => ({ id, contentKind }))).toEqual([
      { id: '11', contentKind: 'reel' },
      { id: '12', contentKind: 'post' },
    ]);
    expect(result.after).toBe('next-token');
    const [url, request] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get('after')).toBe('prior-token');
    expect(new URL(String(url)).searchParams.get('fields')).toContain('media_product_type');
    expect(String(url)).not.toContain(input.accessToken);
    expect(request?.headers).toEqual({ Authorization: `Bearer ${input.accessToken}` });
  });

  it.each(['another-owner', undefined])(
    'fails closed on individual media ownership %s',
    async (ownerId) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ ...media, owner: ownerId ? { id: ownerId } : undefined }));
      expect(
        await createInstagramMediaClient(config, fetcher).findOwnedMedia!({
          ...input,
          mediaId: media.id,
        }),
      ).toBeNull();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it('reads an owned historical reel directly with its provider identifier unchanged', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ...media,
        media_type: 'VIDEO',
        media_product_type: 'REELS',
        owner: { id: input.instagramUserId },
      }),
    );
    expect(
      await createInstagramMediaClient(config, fetcher).findOwnedMedia!({
        ...input,
        mediaId: media.id,
      }),
    ).toMatchObject({ id: media.id, contentKind: 'reel' });
    expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe(`/v24.0/${media.id}`);
  });
});

describe('Instagram Stories catalog', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  const active = {
    ...media,
    id: '1001',
    media_product_type: 'STORY',
    timestamp: '2026-11-22T11:00:00Z',
    owner: { id: input.instagramUserId },
  };

  it('lists only active Stories from the Stories edge and preserves pagination', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        data: [
          active,
          { ...active, id: '1002', timestamp: '2026-11-21T12:00:00Z' },
          { ...active, id: '1003', timestamp: null },
          { ...active, id: '1004', timestamp: '2026-11-23T12:00:00Z' },
        ],
        paging: { cursors: { after: 'next-story' }, next: 'https://graph.instagram.com/next' },
      }),
    );
    const result = await createInstagramMediaClient(config, fetcher, () => now).listStoriesPage!({
      ...input,
      after: 'prior-story',
    });
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject({ id: '1001', contentKind: 'story' });
    expect(result.after).toBe('next-story');
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.pathname).toBe(`/v24.0/${input.instagramUserId}/stories`);
    expect(url.searchParams.get('after')).toBe('prior-story');
    expect(String(url)).not.toContain(input.accessToken);
  });

  it.each([
    ['active', '2026-11-22T11:00:00Z', input.instagramUserId, true],
    ['expired', '2026-11-21T12:00:00Z', input.instagramUserId, false],
    ['missing timestamp', undefined, input.instagramUserId, false],
    ['foreign owner', '2026-11-22T11:00:00Z', 'another-owner', false],
  ] as const)(
    'verifies %s Story ownership and expiry',
    async (_name, timestamp, ownerId, accepted) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ ...active, timestamp, owner: { id: ownerId } }));
      const result = await createInstagramMediaClient(config, fetcher, () => now).findOwnedMedia!({
        ...input,
        mediaId: '1001',
      });
      if (accepted) expect(result).toMatchObject({ id: '1001', contentKind: 'story' });
      else expect(result).toBeNull();
    },
  );
});

describe('Instagram Story provider failures', () => {
  it.each(['http', 'malformed', 'timeout'] as const)(
    'fails safely on a Story listing %s failure',
    async (failure) => {
      const fetcher = vi.fn<typeof fetch>();
      if (failure === 'timeout')
        fetcher.mockRejectedValue(new DOMException('private diagnostic', 'TimeoutError'));
      else if (failure === 'http')
        fetcher.mockResolvedValue(
          new Response(JSON.stringify({ error: { code: 190, message: 'private diagnostic' } }), {
            status: 400,
          }),
        );
      else
        fetcher.mockResolvedValue(
          json({ data: [{ id: '123', media_type: 42, caption: 'private diagnostic' }] }),
        );
      const operation = createInstagramMediaClient(config, fetcher).listStoriesPage!(input);
      await expect(operation).rejects.toThrow();
      try {
        await operation;
      } catch (error) {
        if (failure !== 'timeout') expect(String(error)).not.toContain('private diagnostic');
        else expect(error).toBeInstanceOf(DOMException);
      }
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
});
