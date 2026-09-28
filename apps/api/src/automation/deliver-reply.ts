import type {
  Execution,
  ExecutionRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import {
  InstagramCommentReplyError,
  type InstagramCommentReplyClient,
} from '../instagram/comment-reply-client.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import type { ProtectedToken, TokenProtector } from '../security/token-protector.js';

/** Safe terminal or scheduled result of one leased reply attempt. */
export type ReplyDeliveryOutcome = 'failed' | 'retry_pending' | 'succeeded' | 'uncertain';

/** Executes one leased provider attempt with conservative duplicate prevention. */
export const deliverReply = async (
  input: {
    accountId: string;
    accessTokenCiphertext: ProtectedToken;
    commentId: string;
    execution: Execution;
    message: string;
  },
  dependencies: {
    executionRepository: Pick<
      ExecutionRepository,
      'markDispatchStarted' | 'markFailed' | 'markRetryPending' | 'markSucceeded' | 'markUncertain'
    >;
    instagramCommentReplyClient: InstagramCommentReplyClient;
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
      failureKind: 'permanent',
    });
    if (!failed) throw new Error('Reply execution lease ownership was lost', { cause: error });
    return 'failed';
  }

  if (
    !(await dependencies.executionRepository.markDispatchStarted(input.execution.id, leaseId, now))
  )
    throw new Error('Reply execution lease ownership was lost before dispatch');

  try {
    const result = await dependencies.instagramCommentReplyClient.replyToComment({
      accessToken,
      commentId: input.commentId,
      message: input.message,
    });
    const completed = await dependencies.executionRepository.markSucceeded(
      input.execution.id,
      leaseId,
      result.replyId,
    );
    if (!completed) throw new Error('Reply execution lease ownership was lost after success');
    return 'succeeded';
  } catch (error) {
    const recoveryKind =
      error instanceof InstagramCommentReplyError ? error.recoveryKind() : 'uncertain';
    dependencies.logger.error(
      'Instagram comment reply failed',
      error instanceof InstagramCommentReplyError
        ? error.toLogContext()
        : toSafeErrorContext(error),
    );
    if (recoveryKind === 'authentication') {
      await dependencies.tokenRefreshRepository.markAccountReconnectRequired(
        input.accountId,
        'TOKEN_REJECTED',
      );
    }
    const failure = {
      errorCode:
        recoveryKind === 'uncertain'
          ? 'DELIVERY_OUTCOME_UNKNOWN'
          : recoveryKind === 'authentication'
            ? 'INSTAGRAM_RECONNECT_REQUIRED'
            : recoveryKind === 'retryable'
              ? 'INSTAGRAM_REPLY_RETRY_SCHEDULED'
              : 'INSTAGRAM_REPLY_REJECTED',
      errorMessage:
        recoveryKind === 'uncertain'
          ? 'Delivery requires manual review to prevent a duplicate reply.'
          : recoveryKind === 'authentication'
            ? 'Reconnect Instagram before this reply can be retried.'
            : recoveryKind === 'retryable'
              ? 'Instagram temporarily rejected the reply. A controlled retry is scheduled.'
              : 'Instagram rejected the public reply.',
      failureKind: recoveryKind,
    } as const;
    let completed: Execution | null;
    if (recoveryKind === 'uncertain') {
      completed = await dependencies.executionRepository.markUncertain(
        input.execution.id,
        leaseId,
        failure,
      );
    } else if (
      (recoveryKind === 'retryable' || recoveryKind === 'authentication') &&
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
            ? 'The public reply could not be sent after controlled retry attempts.'
            : failure.errorMessage,
        failureKind: recoveryKind === 'retryable' ? 'permanent' : recoveryKind,
      });
    }
    if (!completed) throw new Error('Reply execution lease ownership was lost', { cause: error });
    return completed.status as ReplyDeliveryOutcome;
  }
};
