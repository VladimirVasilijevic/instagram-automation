import { DELIVERY_CHANNEL, DELIVERY_MODE, EXECUTION_STATUS } from '@instagram-automation/contracts';

import type {
  AccountRepository,
  AutomationRepository,
  ExecutionRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import type { InstagramCommentReplyClient } from '../instagram/comment-reply-client.js';
import type { InstagramPrivateReplyClient } from '../instagram/private-reply-client.js';
import type { CommentEvent } from '../instagram/webhook-events.js';
import type { Logger } from '../logging/logger.js';
import type { TokenProtector } from '../security/token-protector.js';
import { deliverReply } from './deliver-reply.js';

/** Safe webhook-processing result categories. */
export const COMMENT_PROCESS_OUTCOME = {
  /** Every selected delivery channel was already claimed. */
  DUPLICATE: 'duplicate',
  /** At least one newly claimed delivery did not succeed. */
  FAILED: EXECUTION_STATUS.FAILED,
  /** Comment was intentionally excluded from automation processing. */
  IGNORED: 'ignored',
  /** Every newly claimed delivery succeeded. */
  SUCCEEDED: EXECUTION_STATUS.SUCCEEDED,
} as const;

/** A verified comment did not qualify for an automation reply. */
export interface IgnoredCommentProcessResult {
  /** Identifies the comment as deliberately ignored. */
  outcome: typeof COMMENT_PROCESS_OUTCOME.IGNORED;

  /** Safe reason why an automation reply was not eligible. */
  reason:
    | 'account_not_connected'
    | 'connection_inactive'
    | 'nested_comment'
    | 'no_enabled_automation'
    | 'own_comment'
    | 'trigger_not_matched';
}

/** A delivery repeated a comment that was already claimed. */
export interface DuplicateCommentProcessResult {
  /** Identifies the event as a duplicate that must not send another reply. */
  outcome: typeof COMMENT_PROCESS_OUTCOME.DUPLICATE;
}

/** Every claimed delivery was accepted by Meta and persisted as successful. */
export interface SucceededCommentProcessResult {
  /** Identifies the completed successful reply. */
  outcome: typeof COMMENT_PROCESS_OUTCOME.SUCCEEDED;
}

/** A claimed comment could not be replied to and was persisted as failed. */
export interface FailedCommentProcessResult {
  /** Identifies the safely recorded failed reply. */
  outcome: typeof COMMENT_PROCESS_OUTCOME.FAILED;
}

/** Safe result categories for one normalized comment event. */
export type CommentProcessResult =
  | DuplicateCommentProcessResult
  | FailedCommentProcessResult
  | IgnoredCommentProcessResult
  | SucceededCommentProcessResult;

/** Dependencies for processing one verified Instagram comment into configured reply channels. */
export interface ProcessCommentDependencies {
  /** Resolves the connected owner account from a webhook's Instagram account ID. */
  accountRepository: Pick<AccountRepository, 'findByInstagramUserId'>;

  /** Resolves an enabled automation only for the selected owner and media. */
  automationRepository: Pick<AutomationRepository, 'findEnabledByAccountAndMedia'>;

  /** Atomically records processing ownership and its terminal result. */
  executionRepository: Pick<
    ExecutionRepository,
    | 'claimExecutions'
    | 'markDispatchStarted'
    | 'markFailed'
    | 'markRetryPending'
    | 'markSucceeded'
    | 'markUncertain'
  >;

  /** Publishes a reply only after an execution has been claimed. */
  instagramCommentReplyClient: InstagramCommentReplyClient;

  /** Sends private replies addressed to matching comments. */
  instagramPrivateReplyClient: InstagramPrivateReplyClient;

  /** Receives safe provider failure diagnostics without comment content or credentials. */
  logger: Logger;

  /** Decrypts an account token only immediately before the provider request. */
  tokenProtector: TokenProtector;

  /** Records provider authentication rejection for account reconnect warnings. */
  tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'>;
}

/**
 * Processes one authenticated comment event using the configured exact-match automation rule.
 *
 * @param event - Normalized signed Instagram comment delivery.
 * @param dependencies - Persistence, provider, logging, and token-protection dependencies.
 * @returns A safe outcome suitable for aggregate webhook lifecycle logging.
 */
export const processComment = async (
  event: CommentEvent,
  dependencies: ProcessCommentDependencies,
): Promise<CommentProcessResult> => {
  const account = await dependencies.accountRepository.findByInstagramUserId(
    event.instagramAccountId,
  );
  if (!account) {
    return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'account_not_connected' };
  }
  if (account.connectionStatus !== 'active') {
    return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'connection_inactive' };
  }
  if (event.parentCommentId) {
    return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'nested_comment' };
  }
  if (
    event.commenterId === account.instagramUserId ||
    event.username?.toLowerCase() === account.username.toLowerCase()
  ) {
    return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'own_comment' };
  }

  const automation = await dependencies.automationRepository.findEnabledByAccountAndMedia(
    account.id,
    event.mediaId,
  );
  if (!automation) {
    return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'no_enabled_automation' };
  }
  if (event.text.trim().toLowerCase() !== automation.triggerText.trim().toLowerCase()) {
    return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'trigger_not_matched' };
  }

  const deliveryRequests = [
    ...(automation.deliveryMode === DELIVERY_MODE.PUBLIC ||
    automation.deliveryMode === DELIVERY_MODE.BOTH
      ? [{ deliveryChannel: DELIVERY_CHANNEL.PUBLIC, messageText: automation.replyText }]
      : []),
    ...(automation.deliveryMode === DELIVERY_MODE.PRIVATE ||
    automation.deliveryMode === DELIVERY_MODE.BOTH
      ? [{ deliveryChannel: DELIVERY_CHANNEL.PRIVATE, messageText: automation.privateReplyText! }]
      : []),
  ];
  const executions = await dependencies.executionRepository.claimExecutions(
    deliveryRequests.map((delivery) => ({
      automationId: automation.id,
      commenterInstagramId: event.commenterId,
      commenterUsername: event.username,
      commentText: event.text,
      deliveryChannel: delivery.deliveryChannel,
      instagramCommentId: event.commentId,
      leaseExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
      messageText: delivery.messageText,
    })),
  );
  if (executions.length === 0) return { outcome: COMMENT_PROCESS_OUTCOME.DUPLICATE };

  const outcomes = await Promise.all(
    executions.map((execution) =>
      deliverReply(
        {
          accountId: account.id,
          accessTokenCiphertext: account.accessTokenCiphertext,
          commentId: event.commentId,
          execution,
          instagramUserId: account.instagramUserId,
          message: execution.messageText,
        },
        dependencies,
      ),
    ),
  );
  return {
    outcome: outcomes.every((outcome) => outcome === EXECUTION_STATUS.SUCCEEDED)
      ? COMMENT_PROCESS_OUTCOME.SUCCEEDED
      : COMMENT_PROCESS_OUTCOME.FAILED,
  };
};
