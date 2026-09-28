import {
  DELIVERY_CHANNEL,
  EXECUTION_STATUS,
  type ExecutionStatus,
} from '@instagram-automation/contracts';

import type {
  Execution,
  ExecutionRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import {
  InstagramCommentReplyError,
  type InstagramCommentReplyClient,
} from '../instagram/comment-reply-client.js';
import {
  InstagramPrivateReplyError,
  type InstagramPrivateReplyClient,
} from '../instagram/private-reply-client.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import type { ProtectedToken, TokenProtector } from '../security/token-protector.js';
import { RECOVERY_KIND, type RecoveryKind } from './recovery.js';

/** Safe terminal or scheduled result of one leased reply attempt. */
export type ReplyDeliveryOutcome = Exclude<ExecutionStatus, typeof EXECUTION_STATUS.PROCESSING>;

/** Executes one leased provider attempt with conservative duplicate prevention. */
export const deliverReply = async (
  input: {
    accountId: string;
    accessTokenCiphertext: ProtectedToken;
    commentId: string;
    execution: Execution;
    instagramUserId: string;
    message: string;
  },
  dependencies: {
    executionRepository: Pick<
      ExecutionRepository,
      'markDispatchStarted' | 'markFailed' | 'markRetryPending' | 'markSucceeded' | 'markUncertain'
    >;
    instagramCommentReplyClient: InstagramCommentReplyClient;
    instagramPrivateReplyClient: InstagramPrivateReplyClient;
    logger: Logger;
    tokenProtector: TokenProtector;
    tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'>;
  },
  now: Date = new Date(),
): Promise<ReplyDeliveryOutcome> => {
  const leaseId = input.execution.leaseId;
  if (!leaseId) throw new Error('Reply execution has no active lease');

  let accessToken: string;
  try {
    accessToken = dependencies.tokenProtector.decrypt(input.accessTokenCiphertext);
  } catch (error) {
    dependencies.logger.error('Instagram token decryption failed', toSafeErrorContext(error));
    const failed = await dependencies.executionRepository.markFailed(input.execution.id, leaseId, {
      errorCode: 'TOKEN_DECRYPTION_FAILED',
      errorMessage: 'The Instagram connection must be repaired before replies can continue.',
      failureKind: RECOVERY_KIND.PERMANENT,
    });
    if (!failed) throw new Error('Reply execution lease ownership was lost', { cause: error });
    return EXECUTION_STATUS.FAILED;
  }

  if (
    !(await dependencies.executionRepository.markDispatchStarted(input.execution.id, leaseId, now))
  )
    throw new Error('Reply execution lease ownership was lost before dispatch');

  try {
    const result =
      input.execution.deliveryChannel === DELIVERY_CHANNEL.PUBLIC
        ? await dependencies.instagramCommentReplyClient.replyToComment({
            accessToken,
            commentId: input.commentId,
            message: input.message,
          })
        : await dependencies.instagramPrivateReplyClient.sendPrivateReply({
            accessToken,
            commentId: input.commentId,
            instagramUserId: input.instagramUserId,
            message: input.message,
          });
    const completed = await dependencies.executionRepository.markSucceeded(
      input.execution.id,
      leaseId,
      result.replyId,
    );
    if (!completed) throw new Error('Reply execution lease ownership was lost after success');
    return EXECUTION_STATUS.SUCCEEDED;
  } catch (error) {
    const providerError =
      error instanceof InstagramCommentReplyError || error instanceof InstagramPrivateReplyError
        ? error
        : null;
    const recoveryKind: RecoveryKind = providerError
      ? providerError.recoveryKind()
      : RECOVERY_KIND.UNCERTAIN;
    dependencies.logger.error(
      'Instagram reply failed',
      providerError
        ? { deliveryChannel: input.execution.deliveryChannel, ...providerError.toLogContext() }
        : { deliveryChannel: input.execution.deliveryChannel, ...toSafeErrorContext(error) },
    );
    if (recoveryKind === RECOVERY_KIND.AUTHENTICATION) {
      await dependencies.tokenRefreshRepository.markAccountReconnectRequired(
        input.accountId,
        'TOKEN_REJECTED',
      );
    }
    const failure = {
      errorCode:
        recoveryKind === RECOVERY_KIND.UNCERTAIN
          ? 'DELIVERY_OUTCOME_UNKNOWN'
          : recoveryKind === RECOVERY_KIND.AUTHENTICATION
            ? 'INSTAGRAM_RECONNECT_REQUIRED'
            : recoveryKind === RECOVERY_KIND.RETRYABLE
              ? 'INSTAGRAM_REPLY_RETRY_SCHEDULED'
              : 'INSTAGRAM_REPLY_REJECTED',
      errorMessage:
        recoveryKind === RECOVERY_KIND.UNCERTAIN
          ? 'Delivery requires manual review to prevent a duplicate reply.'
          : recoveryKind === RECOVERY_KIND.AUTHENTICATION
            ? 'Reconnect Instagram before this reply can be retried.'
            : recoveryKind === RECOVERY_KIND.RETRYABLE
              ? 'Instagram temporarily rejected the reply. A controlled retry is scheduled.'
              : `Instagram rejected the ${input.execution.deliveryChannel} reply.`,
      failureKind: recoveryKind,
    } as const;
    let completed: Execution | null;
    if (recoveryKind === RECOVERY_KIND.UNCERTAIN) {
      completed = await dependencies.executionRepository.markUncertain(
        input.execution.id,
        leaseId,
        failure,
      );
    } else if (
      (recoveryKind === RECOVERY_KIND.RETRYABLE || recoveryKind === RECOVERY_KIND.AUTHENTICATION) &&
      input.execution.attemptCount < 3
    ) {
      completed = await dependencies.executionRepository.markRetryPending(
        input.execution.id,
        leaseId,
        failure,
        new Date(now.getTime() + input.execution.attemptCount * 15 * 60 * 1000),
      );
    } else {
      completed = await dependencies.executionRepository.markFailed(input.execution.id, leaseId, {
        ...failure,
        errorCode:
          input.execution.attemptCount >= 3 ? 'RETRY_ATTEMPTS_EXHAUSTED' : failure.errorCode,
        errorMessage:
          input.execution.attemptCount >= 3
            ? 'The reply could not be sent after controlled retry attempts.'
            : failure.errorMessage,
        failureKind:
          recoveryKind === RECOVERY_KIND.RETRYABLE ? RECOVERY_KIND.PERMANENT : recoveryKind,
      });
    }
    if (!completed) throw new Error('Reply execution lease ownership was lost', { cause: error });
    return completed.status as ReplyDeliveryOutcome;
  }
};
