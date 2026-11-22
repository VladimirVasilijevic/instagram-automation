import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { SocialConnection } from '../database/identity-repositories.js';
import type { InstagramAccount, Session } from '../database/repositories.js';
import { InstagramMediaError } from '../instagram/media-client.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 7).toString('base64'));
const account: InstagramAccount = {
  connectionStatus: 'active',
  id: 'e9e90c93-1843-43d1-91d8-9ef894c26f4f',
  instagramUserId: '17841400000000001',
  username: 'example_account',
  accessTokenCiphertext: tokenProtector.encrypt('private-instagram-token'),
  tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  tokenRefreshFailureCode: null,
  tokenRefreshLastSucceededAt: null,
  tokenRefreshNextAttemptAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};
const user = { id: 'user-id', createdAt: new Date('2026-09-01T00:00:00.000Z') };
const connection = {
  id: account.id,
  userId: user.id,
  provider: 'instagram' as const,
  externalAccountId: account.instagramUserId,
  displayName: account.username,
  connectionStatus: account.connectionStatus,
};
const media = [
  {
    id: '17841400000000002',
    mediaType: 'IMAGE',
    mediaUrl: 'https://cdn.example/media.jpg',
    thumbnailUrl: null,
    caption: 'Example caption',
    timestamp: '2026-09-22T12:00:00+0000',
    permalink: 'https://www.instagram.com/p/example/',
  },
];

const createFixture = (provider: 'instagram' | 'facebook' = 'instagram', withCatalog = false) => {
  const selectedConnection: SocialConnection =
    provider === 'facebook'
      ? { ...connection, provider, externalAccountId: 'page-id', displayName: 'Example Page' }
      : connection;
  const page = {
    ...selectedConnection,
    accessTokenCiphertext: tokenProtector.encrypt('private-facebook-token'),
  };
  const sessionToken = createSessionToken();
  const session: Session = {
    id: 'session-id',
    userId: user.id,
    accountId: provider === 'instagram' ? account.id : null,
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const sessionRepository = {
    createSession: vi.fn(),
    deleteByTokenHash: vi.fn(),
    findActiveByTokenHash: vi.fn(async (tokenHash: string) =>
      tokenHash === sessionToken.tokenHash
        ? {
            user,
            connection: selectedConnection,
            account: provider === 'instagram' ? account : null,
            session,
          }
        : null,
    ),
  };
  const instagramMediaClient = {
    listRecentMedia: vi.fn().mockResolvedValue(media),
    ...(withCatalog
      ? {
          listStoriesPage: vi.fn().mockResolvedValue({
            media: media.map((item) => ({ ...item, contentKind: 'story' as const })),
            after: null,
          }),
          listMediaPage: vi.fn().mockResolvedValue({
            media: media.map((item) => ({ ...item, contentKind: 'reel' as const })),
            after: null,
          }),
        }
      : {}),
  };
  const facebookPageClient = {
    listManagedPages: vi.fn(),
    listRecentPosts: vi.fn(),
    subscribeToEvents: vi.fn(),
  };
  const socialConnectionRepository = {
    connectFacebookPage: vi.fn(),
    createPendingPageSelection: vi.fn(),
    getPendingPageSelection: vi.fn(),
    consumeSelectedPage: vi.fn(),
    findFirstByUserId: vi.fn(),
    findFacebookPageByPageId: vi.fn().mockResolvedValue(page),
    markReconnectRequired: vi.fn(),
  };
  const logger = { error: vi.fn(), info: vi.fn() };
  const app = createApp({
    automationRepository: {
      findByAccountId: vi.fn(),
      listByAccountId: vi.fn().mockResolvedValue([]),
      findByAccountAndMedia: vi.fn().mockResolvedValue(null),
      findEnabledByAccountAndMedia: vi.fn(),
      saveAutomation: vi.fn(),
    },
    executionRepository: {
      claimExecutions: vi.fn(),
      listRecentByAccountId: vi.fn(),
      markDispatchStarted: vi.fn(),
      markFailed: vi.fn(),
      markRetryPending: vi.fn(),
      markSucceeded: vi.fn(),
      markUncertain: vi.fn(),
    },
    database: { checkHealth: vi.fn() },
    instagramAuth: {
      appBaseUrl: 'https://app.example',
      redirectUri: 'https://app.example/api/auth/instagram/callback',
      instagramClient: { authorizationUrl: vi.fn(), completeLogin: vi.fn() },
      identityRepository: { completeInstagramLogin: vi.fn() },
      oauthStateRepository: {
        createState: vi.fn(),
        consumeState: vi.fn(),
        consumeStateDetails: vi.fn(),
      },
      tokenProtector,
    },
    instagramMedia: { instagramMediaClient, tokenProtector },
    facebookPage: { facebookPageClient, socialConnectionRepository },
    instagramSubscription: {
      instagramWebhookClient: { subscribeToComments: vi.fn() },
      tokenRefreshRepository: { markAccountReconnectRequired: vi.fn() },
    },
    logger,
    sessionCookie: { name: 'igauto_session', secure: true, ttlSeconds: 3600 },
    sessionRepository,
  });
  return {
    app,
    instagramMediaClient,
    facebookPageClient,
    socialConnectionRepository,
    page,
    logger,
    headers: { Cookie: `igauto_session=${sessionToken.token}` },
    sessionRepository,
  };
};

describe('recent Instagram media route', () => {
  it('requires an active session before contacting Instagram', async () => {
    const f = createFixture();
    const response = await f.app.request('/api/media');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication is required' },
    });
    expect(f.instagramMediaClient.listRecentMedia).not.toHaveBeenCalled();
  });

  it('decrypts the token server-side and returns normalized media with the default limit', async () => {
    const f = createFixture();
    const response = await f.app.request('/api/media', { headers: f.headers });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ media });
    expect(f.instagramMediaClient.listRecentMedia).toHaveBeenCalledWith({
      accessToken: 'private-instagram-token',
      instagramUserId: account.instagramUserId,
      limit: 12,
    });
    expect(body).not.toContain('private-instagram-token');
  });

  it('accepts an explicit media limit from one through twelve', async () => {
    const f = createFixture();
    const response = await f.app.request('/api/media?limit=3', { headers: f.headers });

    expect(response.status).toBe(200);
    expect(f.instagramMediaClient.listRecentMedia).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 }),
    );
  });

  it.each(['0', '13', '1.5', 'private', '3&limit=4'])(
    'rejects invalid media limits: %s',
    async (limit) => {
      const f = createFixture();
      const response = await f.app.request(`/api/media?limit=${limit}`, { headers: f.headers });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'INVALID_MEDIA_LIMIT',
          message: 'Media limit must be an integer from 1 through 12',
        },
      });
      expect(f.instagramMediaClient.listRecentMedia).not.toHaveBeenCalled();
    },
  );

  it('returns a safe error when Instagram is unavailable', async () => {
    const f = createFixture();
    f.instagramMediaClient.listRecentMedia.mockRejectedValue(
      new InstagramMediaError({
        diagnostics: { stage: 'media', reason: 'http_error', httpStatus: 400, metaErrorCode: 190 },
      }),
    );
    const response = await f.app.request('/api/media', { headers: f.headers });
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'INSTAGRAM_MEDIA_UNAVAILABLE',
        message: 'Instagram media is unavailable. Please try again.',
      },
    });
    expect(body).not.toContain('private-instagram-token');
    expect(f.logger.error).toHaveBeenCalledWith(
      'Social media request failed',
      expect.objectContaining({
        stage: 'media',
        reason: 'http_error',
        httpStatus: '400',
        metaErrorCode: '190',
      }),
    );
  });
});

describe('recent Facebook Page media route', () => {
  it('keeps Facebook Reels unavailable until provider ID matching is verified', async () => {
    const f = createFixture('facebook', true);
    const response = await f.app.request('/api/media?kind=reel', { headers: f.headers });
    expect(response.status).toBe(409);
    expect(f.facebookPageClient.listRecentPosts).not.toHaveBeenCalled();
  });
  it.each(['https://cdn.example/facebook-post.jpg', null])(
    'returns the Page post preview %s without exposing its credentials',
    async (pictureUrl) => {
      const f = createFixture('facebook');
      f.facebookPageClient.listRecentPosts.mockResolvedValue([
        {
          id: 'page-id_post-id',
          message: 'Facebook post',
          permalinkUrl: 'https://www.facebook.com/page/posts/post-id',
          pictureUrl,
        },
      ]);

      const response = await f.app.request('/api/media?limit=3', { headers: f.headers });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(JSON.parse(body)).toEqual({
        media: [
          {
            id: 'page-id_post-id',
            caption: 'Facebook post',
            mediaType: 'POST',
            mediaUrl: null,
            permalink: 'https://www.facebook.com/page/posts/post-id',
            thumbnailUrl: pictureUrl,
            timestamp: null,
          },
        ],
      });
      expect(f.socialConnectionRepository.findFacebookPageByPageId).toHaveBeenCalledWith('page-id');
      expect(f.facebookPageClient.listRecentPosts).toHaveBeenCalledWith({
        pageId: 'page-id',
        pageAccessToken: 'private-facebook-token',
        limit: 3,
      });
      expect(f.instagramMediaClient.listRecentMedia).not.toHaveBeenCalled();
      expect(body).not.toContain('private-facebook-token');
      expect(body).not.toContain(f.page.accessTokenCiphertext);
    },
  );
});

describe('shared media catalog route', () => {
  it('returns a classified Instagram Reel page through runtime composition', async () => {
    const f = createFixture('instagram', true);
    const response = await f.app.request('/api/media?kind=reel', { headers: f.headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      media: media.map((item) => ({ ...item, contentKind: 'reel' })),
      nextCursor: null,
    });
    expect(f.instagramMediaClient.listRecentMedia).not.toHaveBeenCalled();
  });

  it.each([
    'kind=unknown',
    'kind=reel&kind=post',
    'kind=reel&limit=13',
    'kind=reel&limit=2&limit=3',
  ])('rejects invalid catalog query %s before provider requests', async (query) => {
    const f = createFixture('instagram', true);
    const response = await f.app.request(`/api/media?${query}`, { headers: f.headers });
    expect(response.status).toBe(400);
    expect(f.instagramMediaClient.listMediaPage).not.toHaveBeenCalled();
  });

  it('maps catalog failures to sanitized provider errors', async () => {
    const f = createFixture('instagram', true);
    f.instagramMediaClient.listMediaPage!.mockRejectedValue(new Error('private token detail'));
    const response = await f.app.request('/api/media?kind=reel', { headers: f.headers });
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'INSTAGRAM_MEDIA_UNAVAILABLE' } });
    expect(body).not.toContain('private token detail');
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain('private token detail');
  });

  it('rejects malformed cursors before requesting provider data', async () => {
    const f = createFixture('instagram', true);
    const response = await f.app.request('/api/media?kind=reel&cursor=invalid', {
      headers: f.headers,
    });
    expect(response.status).toBe(400);
  });
});

describe('Story media route', () => {
  it('returns Instagram Stories through the shared catalog', async () => {
    const f = createFixture('instagram', true);
    const response = await f.app.request('/api/media?kind=story', { headers: f.headers });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.media[0].contentKind).toBe('story');
    expect(payload.nextCursor).toBeNull();
    expect(f.instagramMediaClient.listMediaPage).not.toHaveBeenCalled();
  });
  it('returns an explicit unavailable response for Facebook Stories', async () => {
    const f = createFixture('facebook', true);
    const response = await f.app.request('/api/media?kind=story', { headers: f.headers });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'FACEBOOK_STORIES_UNAVAILABLE' },
    });
    expect(f.facebookPageClient.listRecentPosts).not.toHaveBeenCalled();
  });
});
