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
const user = { id: 'user-id', createdAt: new Date('2026-09-01T00:00:00.000Z') };
const connection = {
  id: account.id,
  userId: user.id,
  provider: 'instagram' as const,
  externalAccountId: account.instagramUserId,
  displayName: account.username,
  connectionStatus: account.connectionStatus,
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
    userId: user.id,
    accountId: account.id,
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const sessionRepository = {
    createSession: vi.fn(),
    deleteByTokenHash: vi.fn(),
    findActiveByTokenHash: vi.fn(async (tokenHash: string) =>
      tokenHash === sessionToken.tokenHash ? { user, connection, account, session } : null,
    ),
  };
  const logger = { error: vi.fn(), info: vi.fn() };
  const accountRepository = { findByInstagramUserId: vi.fn() };
  const automationRepository = {
    findByAccountId: vi.fn().mockResolvedValue(null),
    findByAccountAndMedia: vi.fn().mockResolvedValue(null),
    listByAccountId: vi.fn().mockResolvedValue([]),
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
  const instagramDirectMessageClient = {
    sendDirectMessage: vi
      .fn()
      .mockResolvedValue({ recipientId: 'person-id', replyId: 'dm-reply-id' }),
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
  const dmConversationRepository = {
    recordInboundAnswer: vi.fn(),
    claimFollowup: vi.fn(),
    claimDueFollowups: vi.fn(),
    resolveStaleFollowups: vi.fn(),
    markFollowupDispatchStarted: vi.fn(),
    markFollowupSucceeded: vi.fn(),
    markFollowupRetryPending: vi.fn(),
    markFollowupFailed: vi.fn(),
    markFollowupUncertain: vi.fn(),
    listRecentAnswersByAccountId: vi.fn().mockResolvedValue([]),
  };
  const app = createApp({
    automationRepository,
    dmConversationRepository,
    executionRepository,
    database: { checkHealth: vi.fn() },
    instagramAuth: {
      appBaseUrl: 'https://app.example',
      redirectUri: 'https://app.example/api/auth/instagram/callback',
      instagramClient: { authorizationUrl: vi.fn(), completeLogin: vi.fn() },
      identityRepository: { completeInstagramLogin: vi.fn() },
      oauthStateRepository: {
        consumeState: vi.fn(),
        createState: vi.fn(),
        consumeStateDetails: vi.fn(),
      },
      tokenProtector,
    },
    instagramMedia: { instagramMediaClient: { listRecentMedia: vi.fn() }, tokenProtector },
    instagramSubscription: {
      instagramWebhookClient,
      tokenRefreshRepository: { markAccountReconnectRequired: vi.fn() },
    },
    instagramWebhook: {
      accountRepository,
      appSecret,
      instagramCommentReplyClient,
      instagramDirectMessageClient,
      instagramPrivateReplyClient,
      tokenProtector,
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
    instagramDirectMessageClient,
    executionRepository,
    dmConversationRepository,
    logger,
  };
};

describe('Instagram webhook routes', () => {
  it.each(['story-message-id', 'm'.repeat(200)])(
    'claims and sends a signed Story reply once for message ID %s',
    async (messageId) => {
      const f = createFixture();
      f.accountRepository.findByInstagramUserId.mockResolvedValue(account);
      f.automationRepository.findEnabledByAccountAndMedia.mockResolvedValue({
        id: 'story-automation-id',
        triggerKind: 'story_reply',
        deliveryMode: 'private',
        privateReplyText: 'Private Story answer',
        triggerMode: 'all',
        triggerText: null,
        quickReplyOptions: [],
      });
      f.executionRepository.claimExecutions.mockImplementationOnce(async ([claim]) => [
        { ...claim, id: 'story-execution-id', leaseId: 'story-lease-id', attemptCount: 1 },
      ]);
      f.executionRepository.markDispatchStarted.mockResolvedValue(true);
      f.executionRepository.markSucceeded.mockResolvedValue({ id: 'story-execution-id' });
      const body = JSON.stringify({
        object: 'instagram',
        entry: [
          {
            id: account.instagramUserId,
            messaging: [
              {
                sender: { id: 'person-id' },
                recipient: { id: account.instagramUserId },
                timestamp: Date.now() - 1000,
                message: {
                  mid: messageId,
                  text: 'Yes',
                  reply_to: { story: { id: 'story-id', url: 'https://example.com/story' } },
                },
              },
            ],
          },
        ],
      });
      const response = await f.app.request('/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': signature(body) },
        body,
      });
      expect(response.status).toBe(200);
      expect(f.automationRepository.findEnabledByAccountAndMedia).toHaveBeenCalledWith(
        account.id,
        'story-id',
      );
      expect(f.dmConversationRepository.recordInboundAnswer).not.toHaveBeenCalled();
      expect(f.executionRepository.claimExecutions).toHaveBeenCalledWith([
        expect.objectContaining({
          instagramCommentId: messageId,
          mediaId: 'story-id',
          triggerKind: 'story_reply',
          deliveryChannel: 'private',
          commenterInstagramId: 'person-id',
        }),
      ]);
      expect(f.instagramDirectMessageClient.sendDirectMessage).toHaveBeenCalledWith({
        accessToken: 'private-access-token',
        instagramUserId: account.instagramUserId,
        recipientId: 'person-id',
        message: 'Private Story answer',
      });
      expect(f.executionRepository.markSucceeded).toHaveBeenCalledWith(
        'story-execution-id',
        'story-lease-id',
        'dm-reply-id',
        'person-id',
      );
      expect(f.logger.info).toHaveBeenLastCalledWith(
        'Instagram webhook processed',
        expect.objectContaining({ messageEventCount: 1, storyReplySucceededCount: 1 }),
      );
      const replay = await f.app.request('/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': signature(body) },
        body,
      });
      expect(replay.status).toBe(200);
      expect(f.executionRepository.claimExecutions).toHaveBeenCalledTimes(2);
      expect(f.instagramDirectMessageClient.sendDirectMessage).toHaveBeenCalledTimes(1);
      expect(f.dmConversationRepository.recordInboundAnswer).not.toHaveBeenCalled();
      expect(f.instagramCommentReplyClient.replyToComment).not.toHaveBeenCalled();
      expect(f.logger.info).toHaveBeenLastCalledWith(
        'Instagram webhook processed',
        expect.objectContaining({ messageDuplicateCount: 1, storyReplySucceededCount: 0 }),
      );
      const logs = JSON.stringify([f.logger.info.mock.calls, f.logger.error.mock.calls]);
      for (const privateValue of [
        messageId,
        'story-id',
        'person-id',
        account.instagramUserId,
        'Yes',
        'Private Story answer',
        body,
      ])
        expect(logs).not.toContain(privateValue);
    },
  );

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
      storyReplySucceededCount: 0,
      storyReplyFailedCount: 0,
      commentEventCount: 1,
      messageEventCount: 0,
      messageDuplicateCount: 0,
      messageFollowupStartedCount: 0,
      messageIgnoredCount: 0,
      messageRecordedCount: 0,
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
      messagingRejectedInvalidMessageIdCount: 0,
      messagingRejectedInvalidPayloadCount: 0,
      messagingRejectedEchoCount: 0,
      messagingRejectedOwnSenderCount: 0,
      messagingRejectedRecipientMismatchCount: 0,
      messagingRejectedUnsupportedContentCount: 0,
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
      triggerMode: 'exact',
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
        mediaId: commentPayload.entry[0].changes[0].value.media.id,
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
      storyReplySucceededCount: 0,
      storyReplyFailedCount: 0,
      commentEventCount: 1,
      messageEventCount: 0,
      messageDuplicateCount: 0,
      messageFollowupStartedCount: 0,
      messageIgnoredCount: 0,
      messageRecordedCount: 0,
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
      messagingRejectedInvalidMessageIdCount: 0,
      messagingRejectedInvalidPayloadCount: 0,
      messagingRejectedEchoCount: 0,
      messagingRejectedOwnSenderCount: 0,
      messagingRejectedRecipientMismatchCount: 0,
      messagingRejectedUnsupportedContentCount: 0,
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
      storyReplySucceededCount: 0,
      storyReplyFailedCount: 0,
      commentEventCount: 0,
      messageEventCount: 0,
      messageDuplicateCount: 0,
      messageFollowupStartedCount: 0,
      messageIgnoredCount: 0,
      messageRecordedCount: 0,
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
      messagingRejectedInvalidMessageIdCount: 1,
      messagingRejectedInvalidPayloadCount: 0,
      messagingRejectedEchoCount: 0,
      messagingRejectedOwnSenderCount: 0,
      messagingRejectedRecipientMismatchCount: 0,
      messagingRejectedUnsupportedContentCount: 0,
      unsupportedOtherChangeEventCount: 0,
      unsupportedOtherEntryEventCount: 0,
    });
    expect(JSON.stringify(f.logger.info.mock.calls)).not.toContain('private message body');
  });

  it('logs only flat safe rejection counts for signed rejected messages', async () => {
    const f = createFixture();
    const event = {
      sender: { id: 'private-sender-id' },
      recipient: { id: account.instagramUserId },
      timestamp: Date.now(),
      message: { mid: 'private-message-id', text: 'private rejected text' },
    };
    const body = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: account.instagramUserId,
          messaging: [
            { ...event, message: { ...event.message, mid: 'x'.repeat(1_025) } },
            { ...event, timestamp: 'private invalid timestamp' },
            { ...event, message: { ...event.message, is_echo: true } },
            { ...event, sender: { id: account.instagramUserId } },
            { ...event, recipient: { id: 'private-other-recipient' } },
            {
              ...event,
              message: {
                mid: event.message.mid,
                attachments: [{ type: 'image', payload: { url: 'https://example.com/private' } }],
              },
            },
          ],
        },
      ],
    });
    const response = await f.app.request('/api/webhooks/instagram', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signature(body) },
      body,
    });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('EVENT_RECEIVED');
    expect(f.logger.info).toHaveBeenCalledExactlyOnceWith(
      'Instagram webhook processed',
      expect.objectContaining({
        messageEventCount: 0,
        unsupportedMessagingEventCount: 6,
        messagingRejectedInvalidMessageIdCount: 1,
        messagingRejectedInvalidPayloadCount: 1,
        messagingRejectedEchoCount: 1,
        messagingRejectedOwnSenderCount: 1,
        messagingRejectedRecipientMismatchCount: 1,
        messagingRejectedUnsupportedContentCount: 1,
      }),
    );
    const context = f.logger.info.mock.calls[0]![1];
    expect(Object.values(context).every((value) => typeof value === 'number')).toBe(true);
    const logs = JSON.stringify([f.logger.info.mock.calls, f.logger.error.mock.calls]);
    for (const privateValue of [
      body,
      event.message.mid,
      event.message.text,
      event.sender.id,
      account.instagramUserId,
      'private-other-recipient',
      'private invalid timestamp',
      'https://example.com/private',
      'x'.repeat(1_025),
    ])
      expect(logs).not.toContain(privateValue);
    expect(f.logger.error).not.toHaveBeenCalled();
    expect(f.accountRepository.findByInstagramUserId).not.toHaveBeenCalled();
    expect(f.executionRepository.claimExecutions).not.toHaveBeenCalled();
    expect(f.instagramDirectMessageClient.sendDirectMessage).not.toHaveBeenCalled();
  });

  it('records a signed incoming quick reply without logging its payload', async () => {
    const f = createFixture();
    f.accountRepository.findByInstagramUserId.mockResolvedValue(account);
    f.dmConversationRepository.recordInboundAnswer.mockResolvedValue({
      answer: { id: 'answer-id' },
      followup: null,
      duplicate: false,
    });
    const body = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: account.instagramUserId,
          messaging: [
            {
              sender: { id: 'customer-igsid' },
              recipient: { id: account.instagramUserId },
              timestamp: 1_767_000_000_000,
              message: {
                mid: 'mid-1',
                text: 'Yes',
                quick_reply: { payload: 'private-choice-payload' },
              },
            },
          ],
        },
      ],
    });
    const response = await f.app.request('/api/webhooks/instagram', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signature(body) },
      body,
    });
    expect(response.status).toBe(200);
    expect(f.dmConversationRepository.recordInboundAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: account.id,
        providerMessageId: 'mid-1',
        quickReplyPayload: 'private-choice-payload',
      }),
    );
    expect(JSON.stringify(f.logger.info.mock.calls)).not.toContain('private-choice-payload');
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
      includeMessages: true,
    });
  });
  it('retains message subscriptions for sent prompts even after all rules are disabled', async () => {
    const f = createFixture();
    f.automationRepository.listByAccountId.mockResolvedValue([
      { enabled: false, quickReplyOptions: [] },
      { enabled: false, quickReplyOptions: [{ id: 'choice-id' }] },
    ]);
    const response = await f.app.request('/api/webhooks/instagram/subscription', {
      method: 'POST',
      headers: f.headers,
    });
    expect(response.status).toBe(204);
    expect(f.instagramWebhookClient.subscribeToComments).toHaveBeenCalledWith(
      expect.objectContaining({ includeMessages: true }),
    );
  });
});
