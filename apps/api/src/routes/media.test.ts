import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { InstagramAccount, Session } from '../database/repositories.js';
import { InstagramMediaError } from '../instagram/media-client.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 7).toString('base64'));
const account: InstagramAccount = {
  id: 'e9e90c93-1843-43d1-91d8-9ef894c26f4f',
  instagramUserId: '17841400000000001',
  username: 'example_account',
  accessTokenCiphertext: tokenProtector.encrypt('private-instagram-token'),
  tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
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

const createFixture = () => {
  const sessionToken = createSessionToken();
  const session: Session = {
    id: 'session-id',
    accountId: account.id,
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const sessionRepository = {
    createSession: vi.fn(),
    deleteByTokenHash: vi.fn(),
    findActiveByTokenHash: vi.fn(async (tokenHash: string) =>
      tokenHash === sessionToken.tokenHash ? { account, session } : null,
    ),
  };
  const instagramMediaClient = { listRecentMedia: vi.fn().mockResolvedValue(media) };
  const logger = { error: vi.fn(), info: vi.fn() };
  const app = createApp({
    automationRepository: {
      findByAccountId: vi.fn(),
      findEnabledByAccountAndMedia: vi.fn(),
      saveAutomation: vi.fn(),
    },
    executionRepository: {
      claimExecution: vi.fn(),
      listRecentByAccountId: vi.fn(),
      markFailed: vi.fn(),
      markSucceeded: vi.fn(),
    },
    database: { checkHealth: vi.fn() },
    instagramAuth: {
      appBaseUrl: 'https://app.example',
      redirectUri: 'https://app.example/api/auth/instagram/callback',
      instagramClient: { authorizationUrl: vi.fn(), completeLogin: vi.fn() },
      accountRepository: { upsertConnectedAccount: vi.fn(), findByInstagramUserId: vi.fn() },
      oauthStateRepository: { createState: vi.fn(), consumeState: vi.fn() },
      tokenProtector,
    },
    instagramMedia: { instagramMediaClient, tokenProtector },
    logger,
    sessionCookie: { name: 'igauto_session', secure: true, ttlSeconds: 3600 },
    sessionRepository,
  });
  return {
    app,
    instagramMediaClient,
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
      'Instagram media request failed',
      expect.objectContaining({
        stage: 'media',
        reason: 'http_error',
        httpStatus: '400',
        metaErrorCode: '190',
      }),
    );
  });
});
