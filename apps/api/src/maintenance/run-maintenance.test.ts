import { describe, expect, it, vi } from 'vitest';

import type { ExecutionRepository, TokenRefreshRepository } from '../database/repositories.js';
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
          executionRepository,
          instagramCommentReplyClient: { replyToComment: vi.fn() },
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
      reconnectRequiredCount: 0,
      replyFailedCount: 0,
      replyRetryPendingCount: 0,
      replySucceededCount: 0,
      replyUncertainCount: 0,
      staleExecutionCount: 2,
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
    expect(logger.info).toHaveBeenCalledWith(
      'Instagram maintenance completed',
      expect.objectContaining({ expiredTokenCount: 1, staleExecutionCount: 2 }),
    );
  });
});
