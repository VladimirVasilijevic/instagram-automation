import { EXECUTION_STATUS } from '@instagram-automation/contracts';

import { deliverFollowup } from '../automation/deliver-followup.js';
import { deliverReply, type ReplyDeliveryOutcome } from '../automation/deliver-reply.js';
import type {
  DmConversationRepository,
  ExecutionRepository,
  MaintenanceCounts,
  TokenRefreshRepository,
} from '../database/repositories.js';
import type { SocialConnectionRepository } from '../database/identity-repositories.js';
import type { FacebookCommentReplyClient } from '../facebook/comment-reply-client.js';
import type { FacebookDirectMessageClient } from '../facebook/direct-message-client.js';
import type { FacebookPrivateReplyClient } from '../facebook/private-reply-client.js';
import type { InstagramCommentReplyClient } from '../instagram/comment-reply-client.js';
import type { InstagramDirectMessageClient } from '../instagram/direct-message-client.js';
import type { InstagramPrivateReplyClient } from '../instagram/private-reply-client.js';
import type { InstagramTokenRefreshClient } from '../instagram/token-refresh-client.js';
import type { Logger } from '../logging/logger.js';
import type { TokenProtector } from '../security/token-protector.js';
import { refreshInstagramTokens } from './refresh-instagram-tokens.js';
import { MAINTENANCE_BATCH_SIZE } from './limits.js';

/** Safe aggregate maintenance result returned to the authenticated scheduler. */
export interface MaintenanceSummary extends MaintenanceCounts {
  /** Accounts marked reconnect-required because their tokens were already expired. */
  expiredTokenCount: number;
  /** Branch messages that reached a terminal failure. */
  followupFailedCount: number;
  /** Branch messages awaiting a controlled retry. */
  followupRetryPendingCount: number;
  /** Confirmed branch messages. */
  followupSucceededCount: number;
  /** Branch messages stopped after an ambiguous send result. */
  followupUncertainCount: number;
  /** Refresh attempts that require a new owner login. */
  reconnectRequiredCount: number;
  /** Reply attempts that reached a terminal failure. */
  replyFailedCount: number;
  /** Reply attempts scheduled for a controlled retry. */
  replyRetryPendingCount: number;
  /** Reply attempts confirmed successful by Meta. */
  replySucceededCount: number;
  /** Ambiguous reply attempts stopped to prevent duplicate delivery. */
  replyUncertainCount: number;
  /** Expired processing leases resolved during this pass. */
  staleExecutionCount: number;
  /** Expired follow-up leases or messaging windows resolved during this pass. */
  staleFollowupCount: number;
  /** Token refresh attempts deferred after a temporary failure. */
  tokenRefreshFailedCount: number;
  /** Tokens successfully refreshed during this pass. */
  tokenRefreshedCount: number;
}

/** Runs one bounded, concurrency-safe token and reply recovery pass. */
export const runMaintenance = async (
  dependencies: {
    dmConversationRepository: DmConversationRepository;
    executionRepository: ExecutionRepository;
    instagramCommentReplyClient: InstagramCommentReplyClient;
    instagramDirectMessageClient: InstagramDirectMessageClient;
    instagramPrivateReplyClient: InstagramPrivateReplyClient;
    facebookCommentReplyClient?: FacebookCommentReplyClient;
    facebookPrivateReplyClient?: FacebookPrivateReplyClient;
    facebookDirectMessageClient?: FacebookDirectMessageClient;
    socialConnectionRepository?: Pick<SocialConnectionRepository, 'markReconnectRequired'>;
    instagramTokenRefreshClient: InstagramTokenRefreshClient;
    logger: Logger;
    tokenProtector: TokenProtector;
    tokenRefreshRepository: TokenRefreshRepository;
  },
  now: Date = new Date(),
): Promise<MaintenanceSummary> => {
  const tokens = await refreshInstagramTokens(
    {
      logger: dependencies.logger,
      repository: dependencies.tokenRefreshRepository,
      tokenProtector: dependencies.tokenProtector,
      tokenRefreshClient: dependencies.instagramTokenRefreshClient,
    },
    now,
  );
  const staleExecutionCount = await dependencies.executionRepository.resolveStaleExecutions(now);
  const staleFollowupCount = await dependencies.dmConversationRepository.resolveStaleFollowups(now);
  const claims = await dependencies.executionRepository.claimDueRetries(
    now,
    new Date(now.getTime() + 2 * 60 * 1000),
    MAINTENANCE_BATCH_SIZE,
  );
  const replyCounts: Record<ReplyDeliveryOutcome, number> = {
    [EXECUTION_STATUS.FAILED]: 0,
    [EXECUTION_STATUS.RETRY_PENDING]: 0,
    [EXECUTION_STATUS.SUCCEEDED]: 0,
    [EXECUTION_STATUS.UNCERTAIN]: 0,
  };
  for (const claim of claims) {
    const outcome = await deliverReply(
      {
        provider: claim.provider,
        accountId: claim.accountId,
        accessTokenCiphertext: claim.accessTokenCiphertext,
        commentId: claim.execution.instagramCommentId,
        execution: claim.execution,
        instagramUserId: claim.externalAccountId,
        message: claim.execution.messageText,
      },
      dependencies,
      now,
    );
    replyCounts[outcome] += 1;
  }
  const followupClaims = await dependencies.dmConversationRepository.claimDueFollowups(
    now,
    new Date(now.getTime() + 2 * 60 * 1000),
    MAINTENANCE_BATCH_SIZE,
  );
  const followupCounts: Record<ReplyDeliveryOutcome, number> = {
    [EXECUTION_STATUS.FAILED]: 0,
    [EXECUTION_STATUS.RETRY_PENDING]: 0,
    [EXECUTION_STATUS.SUCCEEDED]: 0,
    [EXECUTION_STATUS.UNCERTAIN]: 0,
  };
  for (const claim of followupClaims) {
    const outcome = await deliverFollowup(claim, dependencies, now);
    followupCounts[outcome] += 1;
  }
  const summary: MaintenanceSummary = {
    expiredTokenCount: tokens.expiredCount,
    followupFailedCount: followupCounts[EXECUTION_STATUS.FAILED],
    followupRetryPendingCount: followupCounts[EXECUTION_STATUS.RETRY_PENDING],
    followupSucceededCount: followupCounts[EXECUTION_STATUS.SUCCEEDED],
    followupUncertainCount: followupCounts[EXECUTION_STATUS.UNCERTAIN],
    reconnectRequiredCount: tokens.reconnectRequiredCount,
    replyFailedCount: replyCounts[EXECUTION_STATUS.FAILED],
    replyRetryPendingCount: replyCounts[EXECUTION_STATUS.RETRY_PENDING],
    replySucceededCount: replyCounts[EXECUTION_STATUS.SUCCEEDED],
    replyUncertainCount: replyCounts[EXECUTION_STATUS.UNCERTAIN],
    staleExecutionCount,
    staleFollowupCount,
    tokenRefreshFailedCount: tokens.failedCount,
    tokenRefreshedCount: tokens.refreshedCount,
  };
  dependencies.logger.info('Instagram maintenance completed', { ...summary });
  return summary;
};
