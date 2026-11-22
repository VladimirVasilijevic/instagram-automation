import { describe, expect, it, vi } from 'vitest';

import type {
  DmConversationRepository,
  ExecutionRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import type { Logger } from '../logging/logger.js';
import { runMaintenance } from './run-maintenance.js';

const now = new Date('2026-09-29T10:00:00.000Z');

describe('maintenance orchestration', () => {
  it('uses Hobby-safe batch bounds and returns only safe aggregate counts', async () => {
    const executionRepository: ExecutionRepository = {
      claimDueRetries: vi.fn().mockResolvedValue([]),
      claimExecution: vi.fn(),
      claimExecutions: vi.fn(),
      listRecentByAccountId: vi.fn(),
      markDispatchStarted: vi.fn(),
      markFailed: vi.fn(),
      markRetryPending: vi.fn(),
      markSucceeded: vi.fn(),
      markUncertain: vi.fn(),
      resolveStaleExecutions: vi.fn().mockResolvedValue(2),
    };
    const dmConversationRepository: DmConversationRepository = {
      recordInboundAnswer: vi.fn(),
      claimFollowup: vi.fn(),
      claimDueFollowups: vi.fn().mockResolvedValue([]),
      resolveStaleFollowups: vi.fn().mockResolvedValue(3),
      markFollowupDispatchStarted: vi.fn(),
      markFollowupSucceeded: vi.fn(),
      markFollowupRetryPending: vi.fn(),
      markFollowupFailed: vi.fn(),
      markFollowupUncertain: vi.fn(),
      listRecentAnswersByAccountId: vi.fn(),
    };
    const tokenRefreshRepository: TokenRefreshRepository = {
      claimExpiringAccounts: vi.fn().mockResolvedValue([]),
      completeTokenRefresh: vi.fn(),
      failTokenRefresh: vi.fn(),
      markAccountReconnectRequired: vi.fn(),
      markExpiredAccountsReconnectRequired: vi.fn().mockResolvedValue(1),
    };
    const logger: Logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runMaintenance(
        {
          dmConversationRepository,
          executionRepository,
          instagramCommentReplyClient: { replyToComment: vi.fn() },
          instagramDirectMessageClient: { sendDirectMessage: vi.fn() },
          instagramPrivateReplyClient: { sendPrivateReply: vi.fn() },
          instagramTokenRefreshClient: { refresh: vi.fn() },
          logger,
          tokenProtector: { decrypt: vi.fn(), encrypt: vi.fn() },
          tokenRefreshRepository,
        },
        now,
      ),
    ).resolves.toEqual({
      expiredTokenCount: 1,
      followupFailedCount: 0,
      followupRetryPendingCount: 0,
      followupSucceededCount: 0,
      followupUncertainCount: 0,
      reconnectRequiredCount: 0,
      replyFailedCount: 0,
      replyRetryPendingCount: 0,
      replySucceededCount: 0,
      replyUncertainCount: 0,
      staleExecutionCount: 2,
      staleFollowupCount: 3,
      tokenRefreshFailedCount: 0,
      tokenRefreshedCount: 0,
    });

    expect(tokenRefreshRepository.claimExpiringAccounts).toHaveBeenCalledWith(
      now,
      new Date('2026-10-06T10:00:00.000Z'),
      new Date('2026-09-29T10:02:00.000Z'),
      10,
    );
    expect(executionRepository.claimDueRetries).toHaveBeenCalledWith(
      now,
      new Date('2026-09-29T10:02:00.000Z'),
      10,
    );
    expect(dmConversationRepository.claimDueFollowups).toHaveBeenCalledWith(
      now,
      new Date('2026-09-29T10:02:00.000Z'),
      10,
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Instagram maintenance completed',
      expect.objectContaining({ expiredTokenCount: 1, staleExecutionCount: 2 }),
    );
  });
});

it.each([false, true])(
  'recovers mixed comment and Story retries with expired Story window %s',
  async (expired) => {
    const execution = {
      id: 'story-execution',
      automationId: 'story-rule',
      mediaId: 'story-id',
      instagramCommentId: 'inbound-story-message',
      commenterInstagramId: 'story-sender',
      deliveryChannel: 'private',
      triggerKind: 'story_reply',
      leaseId: 'retry-lease',
      messageText: 'Persisted Story response',
      attemptCount: 2,
      quickReplyOptions: [{ id: 'option-id', title: 'Yes', followUpText: 'Next' }],
      replyWindowExpiresAt: new Date(now.getTime() + (expired ? -1 : 60_000)),
    } as import('../database/repositories.js').Execution;
    const executionRepository: ExecutionRepository = {
      claimDueRetries: vi.fn().mockResolvedValue([
        {
          provider: 'instagram',
          connectionId: 'connection-id',
          accountId: 'connection-id',
          externalAccountId: 'owner-id',
          instagramUserId: 'owner-id',
          accessTokenCiphertext: 'encrypted',
          execution,
        },
        {
          provider: 'instagram',
          connectionId: 'other-connection',
          accountId: 'other-connection',
          externalAccountId: 'comment-owner',
          instagramUserId: 'comment-owner',
          accessTokenCiphertext: 'other-encrypted',
          execution: {
            ...execution,
            id: 'comment-execution',
            triggerKind: 'comment',
            deliveryChannel: 'public',
            messageText: 'Persisted public reply',
            quickReplyOptions: [],
            replyWindowExpiresAt: null,
          },
        },
      ]),
      claimExecution: vi.fn(),
      claimExecutions: vi.fn(),
      listRecentByAccountId: vi.fn(),
      markDispatchStarted: vi.fn().mockResolvedValue(true),
      markFailed: vi.fn().mockResolvedValue(execution),
      markRetryPending: vi.fn(),
      markSucceeded: vi.fn().mockResolvedValue(execution),
      markUncertain: vi.fn(),
      resolveStaleExecutions: vi.fn().mockResolvedValue(0),
    };
    const dmConversationRepository: DmConversationRepository = {
      recordInboundAnswer: vi.fn(),
      claimFollowup: vi.fn(),
      claimDueFollowups: vi.fn().mockResolvedValue([]),
      resolveStaleFollowups: vi.fn().mockResolvedValue(0),
      markFollowupDispatchStarted: vi.fn(),
      markFollowupSucceeded: vi.fn(),
      markFollowupRetryPending: vi.fn(),
      markFollowupFailed: vi.fn(),
      markFollowupUncertain: vi.fn(),
      listRecentAnswersByAccountId: vi.fn(),
    };
    const tokenRefreshRepository: TokenRefreshRepository = {
      claimExpiringAccounts: vi.fn().mockResolvedValue([]),
      completeTokenRefresh: vi.fn(),
      failTokenRefresh: vi.fn(),
      markAccountReconnectRequired: vi.fn(),
      markExpiredAccountsReconnectRequired: vi.fn().mockResolvedValue(0),
    };
    const instagramDirectMessageClient = {
      sendDirectMessage: vi
        .fn()
        .mockResolvedValue({ recipientId: 'story-sender', replyId: 'sent-story-reply' }),
    };
    const instagramCommentReplyClient = {
      replyToComment: vi.fn().mockResolvedValue({ replyId: 'comment-reply' }),
    };
    const instagramPrivateReplyClient = { sendPrivateReply: vi.fn() };
    const tokenProtector = {
      decrypt: vi.fn().mockReturnValue('server-only-token'),
      encrypt: vi.fn(),
    };
    const summary = await runMaintenance(
      {
        executionRepository,
        dmConversationRepository,
        tokenRefreshRepository,
        instagramDirectMessageClient,
        instagramCommentReplyClient,
        instagramPrivateReplyClient,
        instagramTokenRefreshClient: { refresh: vi.fn() },
        tokenProtector,
        logger: { error: vi.fn(), info: vi.fn() },
      },
      now,
    );
    expect(instagramCommentReplyClient.replyToComment).toHaveBeenCalledOnce();
    expect(instagramCommentReplyClient.replyToComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: 'inbound-story-message',
        message: 'Persisted public reply',
      }),
    );
    expect(instagramPrivateReplyClient.sendPrivateReply).not.toHaveBeenCalled();
    if (expired) {
      expect(summary.replyFailedCount).toBe(1);
      expect(instagramDirectMessageClient.sendDirectMessage).not.toHaveBeenCalled();
      expect(executionRepository.markDispatchStarted).not.toHaveBeenCalledWith(
        'story-execution',
        'retry-lease',
        expect.anything(),
      );
      expect(tokenProtector.decrypt).toHaveBeenCalledOnce();
      expect(executionRepository.markFailed).toHaveBeenCalledWith(
        'story-execution',
        'retry-lease',
        expect.objectContaining({ errorCode: 'STORY_REPLY_UNAVAILABLE' }),
      );
    } else {
      expect(summary.replySucceededCount).toBe(2);
      expect(instagramDirectMessageClient.sendDirectMessage).toHaveBeenCalledWith({
        accessToken: 'server-only-token',
        instagramUserId: 'owner-id',
        recipientId: 'story-sender',
        message: 'Persisted Story response',
        quickReplies: [{ title: 'Yes', payload: 'qr:story-execution:option-id' }],
      });
      expect(executionRepository.markSucceeded).toHaveBeenCalledWith(
        'story-execution',
        'retry-lease',
        'sent-story-reply',
        'story-sender',
      );
    }
  },
);
