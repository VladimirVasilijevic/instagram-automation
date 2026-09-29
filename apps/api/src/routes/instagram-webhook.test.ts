import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { InstagramAccount, Session } from '../database/repositories.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';

const appSecret = 'test-app-secret';
const verifyToken = 'test-webhook-token';
const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 9).toString('base64'));
const account: InstagramAccount = {
  connectionStatus: 'active',
  id: 'account-id',
  instagramUserId: '17841400000000001',
  username: 'example',
  accessTokenCiphertext: tokenProtector.encrypt('private-access-token'),
  tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  tokenRefreshFailureCode: null,
  tokenRefreshLastSucceededAt: null,
  tokenRefreshNextAttemptAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};
const commentPayload = {
  object: 'instagram',
  entry: [
    {
      id: account.instagramUserId,
      changes: [
        {
          field: 'comments',
          value: {
            id: '17841400000000002',
            media: { id: '17841400000000003' },
            from: { id: '17841400000000004', username: 'commenter' },
            text: '#Hello',
          },
        },
      ],
    },
  ],
};
const messagingPayload = {
  object: 'instagram',
  entry: [
    {
      id: account.instagramUserId,
      messaging: [{ message: { text: 'private message body' } }],
    },
  ],
};

const signature = (body: string): string =>
  `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;

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
  const logger = { error: vi.fn(), info: vi.fn() };
  const accountRepository = { findByInstagramUserId: vi.fn() };
  const automationRepository = {
    findByAccountId: vi.fn(),
    findEnabledByAccountAndMedia: vi.fn(),
    saveAutomation: vi.fn(),
  };
  const instagramWebhookClient = { subscribeToComments: vi.fn().mockResolvedValue(undefined) };
  const instagramCommentReplyClient = {
    replyToComment: vi.fn().mockResolvedValue({ replyId: 'reply-id' }),
  };
  const instagramPrivateReplyClient = {
    sendPrivateReply: vi.fn().mockResolvedValue({ replyId: 'private-reply-id' }),
  };
  const executionRepository = {
    claimExecutions: vi.fn().mockResolvedValue([]),
    listRecentByAccountId: vi.fn(),
    markDispatchStarted: vi.fn(),
    markFailed: vi.fn(),
    markRetryPending: vi.fn(),
    markSucceeded: vi.fn(),
    markUncertain: vi.fn(),
  };
  const app = createApp({
    automationRepository,
    executionRepository,
    database: { checkHealth: vi.fn() },
    instagramAuth: {
      appBaseUrl: 'https://app.example',
      redirectUri: 'https://app.example/api/auth/instagram/callback',
      instagramClient: { authorizationUrl: vi.fn(), completeLogin: vi.fn() },
      accountRepository: { findByInstagramUserId: vi.fn(), upsertConnectedAccount: vi.fn() },
      oauthStateRepository: { consumeState: vi.fn(), createState: vi.fn() },
      tokenProtector,
    },
    instagramMedia: { instagramMediaClient: { listRecentMedia: vi.fn() }, tokenProtector },
    instagramWebhook: {
      accountRepository,
      appSecret,
      instagramCommentReplyClient,
      instagramPrivateReplyClient,
      instagramWebhookClient,
      tokenProtector,
      tokenRefreshRepository: { markAccountReconnectRequired: vi.fn() },
      verifyToken,
    },
    logger,
    sessionCookie: { name: 'igauto_session', secure: true, ttlSeconds: 3600 },
    sessionRepository,
  });
  return {
    app,
    accountRepository,
    automationRepository,
    headers: { Cookie: `igauto_session=${sessionToken.token}` },
    instagramWebhookClient,
    instagramCommentReplyClient,
    executionRepository,
    logger,
  };
};

describe('Instagram webhook routes', () => {
  it("echoes Meta's challenge only for a valid verification request", async () => {
    const f = createFixture();
    const response = await f.app.request(
      '/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-webhook-token&hub.challenge=challenge',
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('challenge');
    expect(
      (
        await f.app.request(
          '/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge',
        )
      ).status,
    ).toBe(403);
  });

  it('accepts a valid signed comment delivery without logging comment content', async () => {
    const f = createFixture();
    const body = JSON.stringify(commentPayload);
    const response = await f.app.request('/api/webhooks/instagram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(body) },
      body,
    });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('EVENT_RECEIVED');
    expect(f.logger.info).toHaveBeenCalledWith('Instagram webhook processed', {
      commentEventCount: 1,
      duplicateCount: 0,
      failedCount: 0,
      ignoredAccountNotConnectedCount: 1,
      ignoredConnectionInactiveCount: 0,
      ignoredCount: 1,
      ignoredNestedCommentCount: 0,
      ignoredNoEnabledAutomationCount: 0,
      ignoredOwnCommentCount: 0,
      ignoredTriggerNotMatchedCount: 0,
      succeededCount: 0,
      unsupportedMessagingEventCount: 0,
      unsupportedOtherChangeEventCount: 0,
      unsupportedOtherEntryEventCount: 0,
    });
    expect(JSON.stringify(f.logger.info.mock.calls)).not.toContain('#Hello');
    expect(JSON.stringify(f.logger.info.mock.calls)).not.toContain('commenter');
  });

  it('processes one matching comment through the public reply boundary', async () => {
    const f = createFixture();
    f.accountRepository.findByInstagramUserId.mockResolvedValue(account);
    f.automationRepository.findEnabledByAccountAndMedia.mockResolvedValue({
      id: 'automation-id',
      accountId: account.id,
      mediaId: commentPayload.entry[0].changes[0].value.media.id,
      triggerText: '#Hello',
      deliveryMode: 'public',
      privateReplyText: null,
      replyText: 'Thanks for commenting!',
      enabled: true,
    });
    f.executionRepository.claimExecutions.mockResolvedValue([
      {
        attemptCount: 1,
        automationId: 'automation-id',
        commenterInstagramId: commentPayload.entry[0].changes[0].value.from.id,
        commenterUsername: 'commenter',
        commentText: '#Hello',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        deliveryChannel: 'public',
        dispatchStartedAt: null,
        errorCode: null,
        errorMessage: null,
        failureKind: null,
        id: 'execution-id',
        instagramCommentId: commentPayload.entry[0].changes[0].value.id,
        leaseExpiresAt: new Date('2026-09-01T00:02:00.000Z'),
        leaseId: 'lease-id',
        messageText: 'Thanks for commenting!',
        nextAttemptAt: null,
        providerReplyId: null,
        status: 'processing',
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);
    f.executionRepository.markDispatchStarted.mockResolvedValue(true);
    f.executionRepository.markSucceeded.mockResolvedValue({ id: 'execution-id' });
    const body = JSON.stringify(commentPayload);

    const response = await f.app.request('/api/webhooks/instagram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(body) },
      body,
    });

    expect(response.status).toBe(200);
    expect(f.instagramCommentReplyClient.replyToComment).toHaveBeenCalledWith({
      accessToken: 'private-access-token',
      commentId: commentPayload.entry[0].changes[0].value.id,
      message: 'Thanks for commenting!',
    });
    expect(f.executionRepository.markSucceeded).toHaveBeenCalledWith(
      'execution-id',
      'lease-id',
      'reply-id',
    );
    expect(f.logger.info).toHaveBeenCalledWith('Instagram webhook processed', {
      commentEventCount: 1,
      duplicateCount: 0,
      failedCount: 0,
      ignoredAccountNotConnectedCount: 0,
      ignoredConnectionInactiveCount: 0,
      ignoredCount: 0,
      ignoredNestedCommentCount: 0,
      ignoredNoEnabledAutomationCount: 0,
      ignoredOwnCommentCount: 0,
      ignoredTriggerNotMatchedCount: 0,
      succeededCount: 1,
      unsupportedMessagingEventCount: 0,
      unsupportedOtherChangeEventCount: 0,
      unsupportedOtherEntryEventCount: 0,
    });
  });

  it('acknowledges signed unsupported messaging events without logging message content', async () => {
    const f = createFixture();
    const body = JSON.stringify(messagingPayload);

    const response = await f.app.request('/api/webhooks/instagram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(body) },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('EVENT_RECEIVED');
    expect(f.accountRepository.findByInstagramUserId).not.toHaveBeenCalled();
    expect(f.logger.info).toHaveBeenCalledWith('Instagram webhook processed', {
      commentEventCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      ignoredAccountNotConnectedCount: 0,
      ignoredConnectionInactiveCount: 0,
      ignoredCount: 0,
      ignoredNestedCommentCount: 0,
      ignoredNoEnabledAutomationCount: 0,
      ignoredOwnCommentCount: 0,
      ignoredTriggerNotMatchedCount: 0,
      succeededCount: 0,
      unsupportedMessagingEventCount: 1,
      unsupportedOtherChangeEventCount: 0,
      unsupportedOtherEntryEventCount: 0,
    });
    expect(JSON.stringify(f.logger.info.mock.calls)).not.toContain('private message body');
  });

  it('rejects unsigned, malformed, and invalid comment deliveries safely', async () => {
    const f = createFixture();
    const body = JSON.stringify({ object: 'instagram', entry: [] });
    expect((await f.app.request('/api/webhooks/instagram', { method: 'POST', body })).status).toBe(
      401,
    );
    expect(
      (
        await f.app.request('/api/webhooks/instagram', {
          method: 'POST',
          headers: { 'x-hub-signature-256': signature('{') },
          body: '{',
        })
      ).status,
    ).toBe(400);
    const invalid = JSON.stringify({
      object: 'instagram',
      entry: [{ id: 'account', changes: [{ field: 'comments', value: {} }] }],
    });
    expect(
      (
        await f.app.request('/api/webhooks/instagram', {
          method: 'POST',
          headers: { 'x-hub-signature-256': signature(invalid) },
          body: invalid,
        })
      ).status,
    ).toBe(400);
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain('account');
  });

  it('requires an application session before subscribing the connected account', async () => {
    const f = createFixture();
    expect(
      (await f.app.request('/api/webhooks/instagram/subscription', { method: 'POST' })).status,
    ).toBe(401);
    const response = await f.app.request('/api/webhooks/instagram/subscription', {
      method: 'POST',
      headers: f.headers,
    });
    expect(response.status).toBe(204);
    expect(f.instagramWebhookClient.subscribeToComments).toHaveBeenCalledWith({
      accessToken: 'private-access-token',
      instagramUserId: account.instagramUserId,
    });
  });
});
