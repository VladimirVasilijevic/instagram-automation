import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { Automation, InstagramAccount, Session } from '../database/repositories.js';
import { InstagramMediaError } from '../instagram/media-client.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 8).toString('base64'));
const account: InstagramAccount = {
  id: 'e9e90c93-1843-43d1-91d8-9ef894c26f4f',
  instagramUserId: '17841400000000001',
  username: 'example_account',
  accessTokenCiphertext: tokenProtector.encrypt('private-instagram-token'),
  tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};
const automation: Automation = {
  id: 'automation-id',
  accountId: account.id,
  mediaId: '17841400000000002',
  triggerText: '#Hello',
  replyText: 'Hello! Thanks for commenting.',
  enabled: true,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};

const responseAutomation = {
  enabled: automation.enabled,
  mediaId: automation.mediaId,
  replyText: automation.replyText,
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
  const logger = { error: vi.fn(), info: vi.fn() };
  const app = createApp({
    automationRepository,
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
    automationRepository,
    headers: { Cookie: `igauto_session=${sessionToken.token}` },
    instagramMediaClient,
    logger,
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

  it('trims and saves owner-controlled input with the fixed trigger', async () => {
    const f = createFixture();
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaId: ` ${automation.mediaId} `,
        replyText: ` ${automation.replyText} `,
        enabled: true,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ automation: responseAutomation });
    expect(f.automationRepository.saveAutomation).toHaveBeenCalledWith({
      accountId: account.id,
      mediaId: automation.mediaId,
      replyText: automation.replyText,
      enabled: true,
    });
    expect(f.instagramMediaClient.listRecentMedia).toHaveBeenCalledWith({
      accessToken: 'private-instagram-token',
      instagramUserId: account.instagramUserId,
      limit: 12,
    });
  });

  it('rejects a selected media ID outside the connected account recent-media list', async () => {
    const f = createFixture();
    f.instagramMediaClient.listRecentMedia.mockResolvedValue([]);
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: automation.mediaId, replyText: 'Reply', enabled: true }),
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
      body: JSON.stringify({ mediaId: automation.mediaId, replyText: 'Reply', enabled: true }),
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
  ])('rejects invalid or trigger-changing input: %j', async (body) => {
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
        message: 'Automation settings must include a media ID, reply text, and enabled state.',
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
        message: 'Automation settings must include a media ID, reply text, and enabled state.',
      },
    });
  });

  it('returns a safe unavailable response for persistence failures', async () => {
    const f = createFixture();
    f.automationRepository.saveAutomation.mockRejectedValue(new Error('private database detail'));
    const response = await f.app.request('/api/automation', {
      method: 'PUT',
      headers: { ...f.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: automation.mediaId, replyText: 'Reply', enabled: false }),
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
    expect(f.logger.error).toHaveBeenCalledOnce();
  });
});
