import type { SocialMediaItem } from '@instagram-automation/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { SocialConnection } from '../database/identity-repositories.js';
import type { InstagramAccount } from '../database/repositories.js';
import type { ProtectedToken } from '../security/token-protector.js';
import { createMediaCatalog, InvalidMediaCursorError } from './catalog.js';

const connection: SocialConnection = {
  id: 'connection-1',
  userId: 'user-1',
  provider: 'instagram',
  externalAccountId: 'instagram-1',
  displayName: 'Owner',
  connectionStatus: 'active',
};
const account: InstagramAccount = {
  id: connection.id,
  instagramUserId: connection.externalAccountId,
  username: 'Owner',
  accessTokenCiphertext: 'encrypted-instagram' as ProtectedToken,
  connectionStatus: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
  tokenExpiresAt: new Date(),
  tokenRefreshFailureCode: null,
  tokenRefreshLastSucceededAt: null,
  tokenRefreshNextAttemptAt: null,
};
const item = (id: string, contentKind: 'post' | 'reel' | 'story' = 'post'): SocialMediaItem => ({
  id,
  contentKind,
  caption: null,
  mediaType: 'VIDEO',
  mediaUrl: null,
  thumbnailUrl: null,
  timestamp: null,
  permalink: null,
});
const fixture = () => {
  const instagramMediaClient = {
    listRecentMedia: vi.fn(),
    listMediaPage: vi.fn(),
    listStoriesPage: vi.fn(),
    findOwnedMedia: vi.fn(),
  };
  const facebookPageClient = {
    listManagedPages: vi.fn(),
    listRecentPosts: vi.fn(),
    subscribeToEvents: vi.fn(),
    listPostPage: vi.fn(),
    listReelPage: vi.fn(),
    findOwnedPost: vi.fn(),
  };
  const page = {
    ...connection,
    provider: 'facebook' as const,
    externalAccountId: 'page-1',
    accessTokenCiphertext: 'encrypted-page' as ProtectedToken,
  };
  const socialConnectionRepository = { findFacebookPageByPageId: vi.fn().mockResolvedValue(page) };
  const tokenProtector = {
    encrypt: vi.fn(),
    decrypt: vi.fn((value: string) =>
      value === 'encrypted-page' ? 'page-secret' : 'instagram-secret',
    ),
  };
  return {
    instagramMediaClient,
    facebookPageClient,
    page,
    socialConnectionRepository,
    tokenProtector,
    catalog: createMediaCatalog({
      instagramMediaClient,
      facebookPageClient,
      socialConnectionRepository,
      tokenProtector,
    }),
  };
};

describe('owned social media catalog', () => {
  it('isolates Story browsing from feed discovery and direct ownership', async () => {
    const f = fixture();
    f.instagramMediaClient.listStoriesPage.mockResolvedValue({
      media: [item('active-story', 'story')],
      after: null,
    });
    expect(await f.catalog.list({ connection, account, kind: 'story', limit: 12 })).toEqual({
      media: [item('active-story', 'story')],
      nextCursor: null,
    });
    expect(f.instagramMediaClient.listMediaPage).not.toHaveBeenCalled();
    f.instagramMediaClient.findOwnedMedia.mockResolvedValue(item('active-story', 'story'));
    expect(
      await f.catalog.findOwned({ connection, account, mediaId: 'active-story' }),
    ).toMatchObject({ contentKind: 'story' });
  });

  it('does not query Facebook providers for unsupported Story browsing', async () => {
    const f = fixture();
    await expect(
      f.catalog.list({ connection: f.page, account: null, kind: 'story', limit: 12 }),
    ).rejects.toThrow('Facebook Stories are not supported');
    expect(f.facebookPageClient.listPostPage).not.toHaveBeenCalled();
    expect(f.tokenProtector.decrypt).not.toHaveBeenCalled();
  });

  it('continues through sparse provider pages and filters content without duplicates', async () => {
    const f = fixture();
    f.instagramMediaClient.listMediaPage
      .mockResolvedValueOnce({ media: [item('post-1')], after: 'cursor-1' })
      .mockResolvedValueOnce({ media: [item('reel-1', 'reel')], after: 'cursor-2' })
      .mockResolvedValueOnce({
        media: [item('reel-1', 'reel'), item('reel-2', 'reel')],
        after: null,
      });
    const result = await f.catalog.list({ connection, account, kind: 'reel', limit: 2 });
    expect(result).toEqual({
      media: [item('reel-1', 'reel'), item('reel-2', 'reel')],
      nextCursor: null,
    });
    expect(f.instagramMediaClient.listMediaPage).toHaveBeenNthCalledWith(2, {
      accessToken: 'instagram-secret',
      instagramUserId: 'instagram-1',
      limit: 2,
      after: 'cursor-1',
    });
    expect(f.facebookPageClient.listReelPage).not.toHaveBeenCalled();
  });

  it('bounds sparse scans and returns a resumable connection/category cursor', async () => {
    const f = fixture();
    for (let n = 1; n <= 6; n += 1)
      f.instagramMediaClient.listMediaPage.mockResolvedValueOnce({
        media: [item(`post-${n}`)],
        after: n === 6 ? null : `after-${n}`,
      });
    const result = await f.catalog.list({ connection, account, kind: 'reel', limit: 2 });
    expect(result.media).toEqual([]);
    expect(f.instagramMediaClient.listMediaPage).toHaveBeenCalledTimes(5);
    expect(result.nextCursor).toEqual(expect.any(String));
    await f.catalog.list({
      connection,
      account,
      kind: 'reel',
      limit: 2,
      cursor: result.nextCursor!,
    });
    expect(f.instagramMediaClient.listMediaPage).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({ after: 'after-5' }),
    );
  });

  it('rejects cursors from a different connection or category before provider calls', async () => {
    const f = fixture();
    f.instagramMediaClient.listMediaPage.mockResolvedValueOnce({
      media: [item('one')],
      after: 'next',
    });
    const { nextCursor } = await f.catalog.list({ connection, account, kind: 'post', limit: 1 });
    f.instagramMediaClient.listMediaPage.mockClear();
    await expect(
      f.catalog.list({
        connection: { ...connection, id: 'other' },
        account,
        kind: 'post',
        limit: 1,
        cursor: nextCursor!,
      }),
    ).rejects.toBeInstanceOf(InvalidMediaCursorError);
    await expect(
      f.catalog.list({ connection, account, kind: 'reel', limit: 1, cursor: nextCursor! }),
    ).rejects.toBeInstanceOf(InvalidMediaCursorError);
    expect(f.instagramMediaClient.listMediaPage).not.toHaveBeenCalled();
  });

  it('uses the Page credential only for the selected Page reel catalog', async () => {
    const f = fixture();
    f.facebookPageClient.listReelPage.mockResolvedValue({
      media: [item('video-id', 'reel')],
      after: null,
    });
    const result = await f.catalog.list({
      connection: f.page,
      account: null,
      kind: 'reel',
      limit: 1,
    });
    expect(result.media[0]?.id).toBe('video-id');
    expect(f.facebookPageClient.listReelPage).toHaveBeenCalledWith({
      pageId: 'page-1',
      pageAccessToken: 'page-secret',
      limit: 1,
    });
    expect(f.instagramMediaClient.listMediaPage).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('page-secret');
  });

  it.each(['id', 'userId'] as const)(
    'rejects a Page credential with mismatched %s',
    async (key) => {
      const f = fixture();
      f.socialConnectionRepository.findFacebookPageByPageId.mockResolvedValue({
        ...f.page,
        [key]: 'another-owner',
      });
      await expect(
        f.catalog.findOwned({ connection: f.page, account: null, mediaId: 'video-id' }),
      ).rejects.toThrow('credential unavailable');
      expect(f.tokenProtector.decrypt).not.toHaveBeenCalled();
      expect(f.facebookPageClient.findOwnedPost).not.toHaveBeenCalled();
    },
  );

  it('rejects another Instagram account before decrypting its credential', async () => {
    const f = fixture();
    await expect(
      f.catalog.findOwned({
        connection,
        account: { ...account, instagramUserId: 'another-instagram' },
        mediaId: 'old-media',
      }),
    ).rejects.toThrow('credential unavailable');
    expect(f.tokenProtector.decrypt).not.toHaveBeenCalled();
  });

  it('validates historical ownership directly without scanning recent posts', async () => {
    const f = fixture();
    f.facebookPageClient.findOwnedPost.mockResolvedValue(item('old-post'));
    expect(
      await f.catalog.findOwned({ connection: f.page, account: null, mediaId: 'old-post' }),
    ).toEqual(item('old-post'));
    expect(f.facebookPageClient.findOwnedPost).toHaveBeenCalledWith({
      pageId: 'page-1',
      pageAccessToken: 'page-secret',
      mediaId: 'old-post',
    });
    expect(f.facebookPageClient.listPostPage).not.toHaveBeenCalled();
  });
  it.each(['not+base64', 'a'.repeat(4097), Buffer.from('{bad-json').toString('base64url')])(
    'rejects malformed cursor before decrypting credentials',
    async (cursor) => {
      const f = fixture();
      await expect(
        f.catalog.list({ connection, account, limit: 1, cursor }),
      ).rejects.toBeInstanceOf(InvalidMediaCursorError);
      expect(f.tokenProtector.decrypt).not.toHaveBeenCalled();
      expect(f.instagramMediaClient.listMediaPage).not.toHaveBeenCalled();
    },
  );

  it('terminates repeated cursors without returning an endless continuation', async () => {
    const f = fixture();
    f.instagramMediaClient.listMediaPage.mockResolvedValue({
      media: [item('post')],
      after: 'same-cursor',
    });
    expect(await f.catalog.list({ connection, account, kind: 'reel', limit: 2 })).toEqual({
      media: [],
      nextCursor: null,
    });
    expect(f.instagramMediaClient.listMediaPage).toHaveBeenCalledTimes(2);
  });

  it('rejects a failed continuation rather than returning a misleading partial success', async () => {
    const f = fixture();
    f.instagramMediaClient.listMediaPage
      .mockResolvedValueOnce({ media: [item('one', 'reel')], after: 'next' })
      .mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(f.catalog.list({ connection, account, kind: 'reel', limit: 2 })).rejects.toThrow(
      'provider unavailable',
    );
  });
});
