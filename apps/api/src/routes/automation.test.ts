import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { Automation, InstagramAccount, Session } from '../database/repositories.js';
import { InstagramMediaError } from '../instagram/media-client.js';
import { InstagramWebhookError } from '../instagram/webhook-client.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 8).toString('base64'));
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
const automation: Automation = {
  id: 'automation-id',
  accountId: account.id,
  deliveryMode: 'public',
  mediaId: '17841400000000002',
  privateReplyText: null,
  triggerMode: 'exact',
  triggerText: '#Hello',
  replyText: 'Hello! Thanks for commenting.',
  enabled: true,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};

const responseAutomation = {
  deliveryMode: automation.deliveryMode,
  enabled: automation.enabled,
  mediaId: automation.mediaId,
  privateReplyText: automation.privateReplyText,
  replyText: automation.replyText,
  triggerMode: automation.triggerMode,
  triggerText: automation.triggerText,
};

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
  const automationRepository = {
    findByAccountId: vi.fn().mockResolvedValue(null),
    findEnabledByAccountAndMedia: vi.fn(),
    saveAutomation: vi.fn().mockResolvedValue(automation),
  };
  const instagramMediaClient = {
    listRecentMedia: vi.fn().mockResolvedValue([
      {
        id: automation.mediaId,
        mediaType: 'IMAGE',
        mediaUrl: null,
        thumbnailUrl: null,
        caption: null,
        timestamp: null,
        permalink: null,
      },
    ]),
  };
  const instagramWebhookClient = { subscribeToComments: vi.fn().mockResolvedValue(undefined) };
  const tokenRefreshRepository = { markAccountReconnectRequired: vi.fn().mockResolvedValue(true) };
  const logger = { error: vi.fn(), info: vi.fn() };
  const app = createApp({
    automationRepository,
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
      accountRepository: { upsertConnectedAccount: vi.fn(), findByInstagramUserId: vi.fn() },
      oauthStateRepository: { createState: vi.fn(), consumeState: vi.fn() },
      tokenProtector,
    },
    instagramMedia: { instagramMediaClient, tokenProtector },
    instagramSubscription: { instagramWebhookClient, tokenRefreshRepository },
    logger,
    sessionCookie: { name: 'igauto_session', secure: true, ttlSeconds: 3600 },
    sessionRepository,
  });
  return {
    app,
    automationRepository,
    headers: { Cookie: `igauto_session=${sessionToken.token}` },
    instagramMediaClient,
    instagramWebhookClient,
    logger,
    tokenRefreshRepository,
  };
};

describe('automation configuration routes', () => {
  it('requires an active session for loading and saving', async () => {
    const f = createFixture();

    expect((await f.app.request('/api/automation')).status).toBe(401);
    expect((await f.app.request('/api/automation', { method: 'PUT', body: '{}' })).status).toBe(
      401,
    );
    expect(f.automationRepository.findByAccountId).not.toHaveBeenCalled();
    expect(f.automationRepository.saveAutomation).not.toHaveBeenCalled();
  });

  it('returns null when the signed-in account has no saved automation', async () => {
    const f = createFixture();
    const response = await f.app.request('/api/automation', { headers: f.headers });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ automation: null });
    expect(f.automationRepository.findByAccountId).toHaveBeenCalledWith(account.id);
  });

  it('returns a saved automation without internal account or persistence fields', async () => {
    const f = createFixture();
    f.automationRepository.findByAccountId.mockResolvedValue(automation);
    const response = await f.app.request('/api/automation', { headers: f.headers });

    await expect(response.json()).resolves.toEqual({ automation: responseAutomation });
  });

  it('returns a safe unavailable response when loading fails', async () => {
    const f = createFixture();
    f.automationRepository.findByAccountId.mockRejectedValue(new Error('private database detail'));
    const response = await f.app.request('/api/automation', { headers: f.headers });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'AUTOMATION_STORE_UNAVAILABLE',
        message: 'Automation settings are unavailable. Please try again.',
      },
    });
    expect(body).not.toContain('private database detail');
    expect(f.logger.error).toHaveBeenCalledOnce();
  });

  it('trims and saves owner-controlled trigger and delivery settings', async () => {
    const f = createFixture();
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMode: 'public',
        mediaId: ` ${automation.mediaId} `,
        privateReplyText: null,
        replyText: ` ${automation.replyText} `,
        triggerMode: 'exact',
        triggerText: ' #Hello ',
        enabled: true,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ automation: responseAutomation });
    expect(f.automationRepository.saveAutomation).toHaveBeenCalledWith({
      accountId: account.id,
      deliveryMode: 'public',
      mediaId: automation.mediaId,
      privateReplyText: null,
      replyText: automation.replyText,
      triggerMode: 'exact',
      triggerText: '#Hello',
      enabled: true,
    });
    expect(f.instagramMediaClient.listRecentMedia).toHaveBeenCalledWith({
      accessToken: 'private-instagram-token',
      instagramUserId: account.instagramUserId,
      limit: 12,
    });
    expect(f.instagramWebhookClient.subscribeToComments).toHaveBeenCalledWith({
      accessToken: 'private-instagram-token',
      instagramUserId: account.instagramUserId,
    });
    expect(f.instagramMediaClient.listRecentMedia.mock.invocationCallOrder[0]!).toBeLessThan(
      f.instagramWebhookClient.subscribeToComments.mock.invocationCallOrder[0]!,
    );
    expect(f.instagramWebhookClient.subscribeToComments.mock.invocationCallOrder[0]!).toBeLessThan(
      f.automationRepository.saveAutomation.mock.invocationCallOrder[0]!,
    );
  });

  it('saves distinct public and private text when both channels are selected', async () => {
    const f = createFixture();
    const bothAutomation = {
      ...automation,
      deliveryMode: 'both' as const,
      privateReplyText: 'Private response',
      replyText: 'Public response',
      triggerMode: 'contains' as const,
      triggerText: '#test',
    };
    f.automationRepository.saveAutomation.mockResolvedValue(bothAutomation);

    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMode: 'both',
        enabled: true,
        mediaId: automation.mediaId,
        privateReplyText: ' Private response ',
        replyText: ' Public response ',
        triggerMode: 'contains',
        triggerText: ' #test ',
      }),
    });

    expect(response.status).toBe(200);
    expect(f.automationRepository.saveAutomation).toHaveBeenCalledWith({
      accountId: account.id,
      deliveryMode: 'both',
      enabled: true,
      mediaId: automation.mediaId,
      privateReplyText: 'Private response',
      replyText: 'Public response',
      triggerMode: 'contains',
      triggerText: '#test',
    });
  });

  it('saves every-comment mode without trigger text', async () => {
    const f = createFixture();
    f.automationRepository.saveAutomation.mockResolvedValue({
      ...automation,
      triggerMode: 'all',
      triggerText: null,
    });

    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMode: 'public',
        enabled: false,
        mediaId: automation.mediaId,
        privateReplyText: null,
        replyText: 'Public response',
        triggerMode: 'all',
        triggerText: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(f.automationRepository.saveAutomation).toHaveBeenCalledWith({
      accountId: account.id,
      deliveryMode: 'public',
      enabled: false,
      mediaId: automation.mediaId,
      privateReplyText: null,
      replyText: 'Public response',
      triggerMode: 'all',
      triggerText: null,
    });
  });

  it.each([
    ['exact', null],
    ['all', '#Hello'],
    ['contains', 'two words'],
    ['contains', '#'],
  ])('rejects invalid %s trigger configuration', async (triggerMode, triggerText) => {
    const f = createFixture();
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMode: 'public',
        enabled: false,
        mediaId: automation.mediaId,
        privateReplyText: null,
        replyText: 'Reply',
        triggerMode,
        triggerText,
      }),
    });

    expect(response.status).toBe(400);
    expect(f.automationRepository.saveAutomation).not.toHaveBeenCalled();
    expect(f.instagramMediaClient.listRecentMedia).not.toHaveBeenCalled();
  });

  it('rejects a selected media ID outside the connected account recent-media list', async () => {
    const f = createFixture();
    f.instagramMediaClient.listRecentMedia.mockResolvedValue([]);
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMode: 'public',
        enabled: true,
        mediaId: automation.mediaId,
        privateReplyText: null,
        replyText: 'Reply',
        triggerMode: 'exact',
        triggerText: '#Hello',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SELECTED_MEDIA_UNAVAILABLE',
        message: 'Select one of your current recent posts before saving.',
      },
    });
    expect(f.automationRepository.saveAutomation).not.toHaveBeenCalled();
  });

  it('returns a safe error when media ownership cannot be checked', async () => {
    const f = createFixture();
    f.instagramMediaClient.listRecentMedia.mockRejectedValue(
      new InstagramMediaError({
        diagnostics: { stage: 'media', reason: 'http_error', httpStatus: 400, metaErrorCode: 190 },
      }),
    );
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMode: 'public',
        enabled: true,
        mediaId: automation.mediaId,
        privateReplyText: null,
        replyText: 'Reply',
        triggerMode: 'exact',
        triggerText: '#Hello',
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'INSTAGRAM_MEDIA_UNAVAILABLE',
        message: 'Instagram media is unavailable. Please try again.',
      },
    });
    expect(body).not.toContain('private-instagram-token');
    expect(f.automationRepository.saveAutomation).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledWith(
      'Instagram media validation failed',
      expect.objectContaining({
        stage: 'media',
        reason: 'http_error',
        httpStatus: '400',
        metaErrorCode: '190',
      }),
    );
  });

  it.each([
    {},
    { mediaId: '', replyText: 'Reply', enabled: true },
    { mediaId: 'media', replyText: '   ', enabled: true },
    { mediaId: 'media', replyText: 'Reply', enabled: 'true' },
    { mediaId: 'media', replyText: 'Reply', enabled: true, triggerText: '#Other' },
  ])('rejects invalid input: %j', async (body) => {
    const f = createFixture();
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INVALID_AUTOMATION_INPUT',
        message: 'Automation settings are incomplete or invalid.',
      },
    });
    expect(f.automationRepository.saveAutomation).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without exposing parser details', async () => {
    const f = createFixture();
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: '{',
    });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'INVALID_AUTOMATION_INPUT',
        message: 'Automation settings are incomplete or invalid.',
      },
    });
  });

  it('returns a safe unavailable response for persistence failures', async () => {
    const f = createFixture();
    f.automationRepository.saveAutomation.mockRejectedValue(new Error('private database detail'));
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMode: 'public',
        enabled: false,
        mediaId: automation.mediaId,
        privateReplyText: null,
        replyText: 'Reply',
        triggerMode: 'exact',
        triggerText: '#Hello',
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'AUTOMATION_STORE_UNAVAILABLE',
        message: 'Automation settings are unavailable. Please try again.',
      },
    });
    expect(body).not.toContain('private database detail');
    expect(f.instagramWebhookClient.subscribeToComments).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledOnce();
  });

  it('does not save enabled changes when comment delivery cannot be enabled', async () => {
    const f = createFixture();
    f.instagramWebhookClient.subscribeToComments.mockRejectedValue(
      new InstagramWebhookError({
        reason: 'http_error',
        httpStatus: 500,
        metaErrorCode: 2,
      }),
    );

    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryMode: 'public',
        enabled: true,
        mediaId: automation.mediaId,
        privateReplyText: null,
        replyText: 'Updated reply',
        triggerMode: 'exact',
        triggerText: '#Hello',
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'INSTAGRAM_COMMENT_SUBSCRIPTION_UNAVAILABLE',
        message: 'Comment delivery could not be enabled. Your changes were not saved.',
      },
    });
    expect(f.automationRepository.saveAutomation).not.toHaveBeenCalled();
    expect(f.tokenRefreshRepository.markAccountReconnectRequired).not.toHaveBeenCalled();
    expect(body).not.toContain('private-instagram-token');
    expect(f.logger.error).toHaveBeenCalledWith(
      'Instagram comment subscription failed while saving automation',
      expect.objectContaining({
        reason: 'http_error',
        httpStatus: '500',
        metaErrorCode: '2',
      }),
    );
  });

  it.each([
    { httpStatus: 401, metaErrorCode: 200 },
    { httpStatus: 400, metaErrorCode: 190 },
  ])(
    'requires reconnection after definite subscription credential rejection: %j',
    async (diagnostics) => {
      const f = createFixture();
      f.instagramWebhookClient.subscribeToComments.mockRejectedValue(
        new InstagramWebhookError({ reason: 'http_error', ...diagnostics }),
      );

      const response = await f.app.request('/api/automation', {
        method: 'PUT',
        headers: { ...f.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryMode: 'public',
          enabled: true,
          mediaId: automation.mediaId,
          privateReplyText: null,
          replyText: 'Updated reply',
          triggerMode: 'exact',
          triggerText: '#Hello',
        }),
      });

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'INSTAGRAM_RECONNECT_REQUIRED',
          message: 'Reconnect Instagram before enabling this automation.',
        },
      });
      expect(f.tokenRefreshRepository.markAccountReconnectRequired).toHaveBeenCalledWith(
        account.id,
        'TOKEN_REJECTED',
      );
      expect(f.automationRepository.saveAutomation).not.toHaveBeenCalled();
    },
  );
});
