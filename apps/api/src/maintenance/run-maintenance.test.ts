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
