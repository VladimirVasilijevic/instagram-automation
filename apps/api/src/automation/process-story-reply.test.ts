import { describe, expect, it, vi } from 'vitest';

import type { Automation, Execution, InstagramAccount } from '../database/repositories.js';
import { InstagramDirectMessageError } from '../instagram/direct-message-client.js';
import type { IncomingMessageEvent } from '../instagram/webhook-events.js';
import type { ProtectedToken } from '../security/token-protector.js';
import { deliverReply } from './deliver-reply.js';
import { processStoryReply } from './process-story-reply.js';

const now = new Date('2026-11-22T10:00:00Z');
const event: IncomingMessageEvent = {
  instagramAccountId: 'owner',
  recipientId: 'owner',
  senderId: 'person',
  messageId: 'message-1',
  storyId: 'story-1',
  text: 'info',
  quickReplyPayload: null,
  timestamp: new Date(now.getTime() - 1000),
};
const fixture = () => {
  const rule = {
    id: 'rule-1',
    triggerKind: 'story_reply',
    deliveryMode: 'private',
    privateReplyText: 'Details',
    triggerMode: 'all',
    triggerText: null,
    quickReplyOptions: [{ id: 'yes', title: 'Yes', followUpText: 'Next' }],
  } as Automation;
  const account = {
    id: 'account-1',
    instagramUserId: 'owner',
    username: 'owner',
    connectionStatus: 'active',
    accessTokenCiphertext: 'encrypted' as ProtectedToken,
  } as InstagramAccount;
  const executionRepository = {
    claimExecutions: vi.fn().mockImplementation(async (claims) =>
      claims.map((claim: Execution) => ({
        ...claim,
        id: 'execution-1',
        leaseId: 'lease-1',
        attemptCount: 1,
      })),
    ),
    markDispatchStarted: vi.fn().mockResolvedValue(true),
    markSucceeded: vi.fn().mockResolvedValue({}),
    markFailed: vi.fn().mockResolvedValue({}),
    markRetryPending: vi.fn().mockResolvedValue({}),
    markUncertain: vi.fn().mockResolvedValue({}),
  };
  const dependencies = {
    accountRepository: { findByInstagramUserId: vi.fn().mockResolvedValue(account) },
    automationRepository: { findEnabledByAccountAndMedia: vi.fn().mockResolvedValue(rule) },
    executionRepository,
    instagramDirectMessageClient: {
      sendDirectMessage: vi.fn().mockResolvedValue({ recipientId: 'person', replyId: 'reply-1' }),
    },
    instagramCommentReplyClient: { replyToComment: vi.fn() },
    instagramPrivateReplyClient: { sendPrivateReply: vi.fn() },
    tokenProtector: { decrypt: vi.fn().mockReturnValue('token'), encrypt: vi.fn() },
    tokenRefreshRepository: { markAccountReconnectRequired: vi.fn() },
    logger: { info: vi.fn(), error: vi.fn() },
  };
  return { dependencies, rule };
};

describe('Story reply automation', () => {
  it('selects the exact Story and snapshots the recipient, message and reply deadline', async () => {
    const { dependencies } = fixture();
    expect(await processStoryReply(event, dependencies, now)).toBe('succeeded');
    expect(dependencies.automationRepository.findEnabledByAccountAndMedia).toHaveBeenCalledWith(
      'account-1',
      'story-1',
    );
    expect(dependencies.executionRepository.claimExecutions).toHaveBeenCalledWith([
      expect.objectContaining({
        triggerKind: 'story_reply',
        mediaId: 'story-1',
        instagramCommentId: 'message-1',
        commenterInstagramId: 'person',
        deliveryChannel: 'private',
        messageText: 'Details',
        replyWindowExpiresAt: new Date(event.timestamp.getTime() + 86_400_000),
      }),
    ]);
    expect(dependencies.instagramDirectMessageClient.sendDirectMessage).toHaveBeenCalledWith({
      accessToken: 'token',
      instagramUserId: 'owner',
      recipientId: 'person',
      message: 'Details',
      quickReplies: [{ title: 'Yes', payload: 'qr:execution-1:yes' }],
    });
    expect(dependencies.instagramPrivateReplyClient.sendPrivateReply).not.toHaveBeenCalled();
    expect(dependencies.instagramCommentReplyClient.replyToComment).not.toHaveBeenCalled();
  });

  it('does not dispatch a repeated webhook after its execution has been claimed', async () => {
    const { dependencies } = fixture();
    dependencies.executionRepository.claimExecutions.mockResolvedValueOnce([]);
    expect(await processStoryReply(event, dependencies, now)).toBe('duplicate');
    expect(dependencies.instagramDirectMessageClient.sendDirectMessage).not.toHaveBeenCalled();
  });

  it.each([
    { storyId: undefined },
    { senderId: 'owner' },
    { recipientId: 'other' },
    { text: null },
    { quickReplyPayload: 'qr:old:yes' },
    { timestamp: new Date(now.getTime() - 86_400_000) },
    { timestamp: new Date('invalid') },
    { timestamp: new Date(now.getTime() + 1000) },
  ])('ignores unsafe or unrelated message context %j', async (override) => {
    const { dependencies } = fixture();
    expect(await processStoryReply({ ...event, ...override }, dependencies, now)).toBe('ignored');
    expect(dependencies.executionRepository.claimExecutions).not.toHaveBeenCalled();
  });

  it.each(['comment', 'missing', 'inactive', 'unmatched'])(
    'rejects a %s rule or account',
    async (condition) => {
      const { dependencies, rule } = fixture();
      if (condition === 'comment') rule.triggerKind = 'comment';
      if (condition === 'missing')
        dependencies.automationRepository.findEnabledByAccountAndMedia.mockResolvedValue(null);
      if (condition === 'inactive')
        dependencies.accountRepository.findByInstagramUserId.mockResolvedValue({
          connectionStatus: 'reconnect_required',
        });
      if (condition === 'unmatched') {
        rule.triggerMode = 'exact';
        rule.triggerText = 'different';
      }
      expect(await processStoryReply(event, dependencies, now)).toBe('ignored');
      expect(dependencies.executionRepository.claimExecutions).not.toHaveBeenCalled();
    },
  );

  it('keeps an explicit rate limit failure on the shared retry path', async () => {
    const { dependencies } = fixture();
    dependencies.instagramDirectMessageClient.sendDirectMessage.mockRejectedValue(
      new InstagramDirectMessageError({ reason: 'http_error', httpStatus: 429 }),
    );
    expect(await processStoryReply(event, dependencies, now)).toBe('failed');
    expect(dependencies.executionRepository.markRetryPending).toHaveBeenCalled();
  });

  it.each([undefined, new Date(now.getTime() - 1), now])(
    'blocks delayed retries without an open inbound window %s',
    async (replyWindowExpiresAt) => {
      const { dependencies } = fixture();
      const execution = {
        id: 'execution-1',
        leaseId: 'lease-1',
        triggerKind: 'story_reply',
        deliveryChannel: 'private',
        commenterInstagramId: 'person',
        replyWindowExpiresAt,
      } as Execution;
      expect(
        await deliverReply(
          {
            execution,
            accountId: 'account-1',
            accessTokenCiphertext: 'encrypted' as ProtectedToken,
            instagramUserId: 'owner',
            commentId: 'message-1',
            message: 'Details',
          },
          dependencies,
          now,
        ),
      ).toBe('failed');
      expect(dependencies.executionRepository.markFailed).toHaveBeenCalled();
      expect(dependencies.executionRepository.markDispatchStarted).not.toHaveBeenCalled();
      expect(dependencies.instagramDirectMessageClient.sendDirectMessage).not.toHaveBeenCalled();
    },
  );
  it.each(['missing account', 'public rule', 'empty response'])(
    'ignores Story context with %s',
    async (condition) => {
      const { dependencies, rule } = fixture();
      if (condition === 'missing account')
        dependencies.accountRepository.findByInstagramUserId.mockResolvedValue(null);
      if (condition === 'public rule') rule.deliveryMode = 'public';
      if (condition === 'empty response') rule.privateReplyText = '';
      expect(await processStoryReply(event, dependencies, now)).toBe('ignored');
      expect(dependencies.executionRepository.claimExecutions).not.toHaveBeenCalled();
      expect(dependencies.instagramDirectMessageClient.sendDirectMessage).not.toHaveBeenCalled();
    },
  );
  it('fails a persisted Story execution safely when its messaging adapter is unavailable', async () => {
    const { dependencies } = fixture();
    const execution = {
      id: 'execution-1',
      leaseId: 'lease-1',
      triggerKind: 'story_reply',
      deliveryChannel: 'private',
      commenterInstagramId: 'person',
      replyWindowExpiresAt: new Date(now.getTime() + 1000),
    } as Execution;
    expect(
      await deliverReply(
        {
          execution,
          accountId: 'account-1',
          accessTokenCiphertext: 'encrypted' as ProtectedToken,
          instagramUserId: 'owner',
          commentId: 'message-1',
          message: 'Details',
        },
        { ...dependencies, instagramDirectMessageClient: undefined },
        now,
      ),
    ).toBe('failed');
    expect(dependencies.tokenProtector.decrypt).not.toHaveBeenCalled();
    expect(dependencies.executionRepository.markDispatchStarted).not.toHaveBeenCalled();
    expect(dependencies.executionRepository.markFailed).toHaveBeenCalledWith(
      'execution-1',
      'lease-1',
      expect.objectContaining({ errorCode: 'STORY_REPLY_UNAVAILABLE' }),
    );
  });
});
