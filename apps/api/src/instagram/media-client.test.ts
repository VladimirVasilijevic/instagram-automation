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
