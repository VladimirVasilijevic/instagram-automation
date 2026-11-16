import { EXECUTION_STATUS } from '@instagram-automation/contracts';

import type {
  DmConversationRepository,
  DmFollowup,
  DmFollowupClaim,
  TokenRefreshRepository,
} from '../database/repositories.js';
import {
  InstagramDirectMessageError,
  type InstagramDirectMessageClient,
} from '../instagram/direct-message-client.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import type { TokenProtector } from '../security/token-protector.js';
import { RECOVERY_KIND, type RecoveryKind } from './recovery.js';
import type { ReplyDeliveryOutcome } from './deliver-reply.js';

/** Dependencies for one leased, recipient-addressed Instagram follow-up. */
export interface FollowupDeliveryDependencies {
  /** Durable state transitions for this leased follow-up. */
  dmConversationRepository: Pick<
    DmConversationRepository,
    | 'markFollowupDispatchStarted'
    | 'markFollowupFailed'
    | 'markFollowupRetryPending'
    | 'markFollowupSucceeded'
    | 'markFollowupUncertain'
  >;
  /** Provider adapter used to send the message. */
  instagramDirectMessageClient: InstagramDirectMessageClient;
  /** Safe application logger. */
  logger: Logger;
  /** Decrypts the account token immediately before delivery. */
  tokenProtector: TokenProtector;
  /** Marks rejected Instagram connections for reconnection. */
  tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'>;
}

/** Delivers a claimed branch response without sending after the standard messaging window closes. */
export const deliverFollowup = async (
  claim: DmFollowupClaim,
  dependencies: FollowupDeliveryDependencies,
  now: Date = new Date(),
): Promise<ReplyDeliveryOutcome> => {
  const { followup } = claim;
  const leaseId = followup.leaseId;
  if (!leaseId) throw new Error('Follow-up has no active lease');

  const fail = async (
    errorCode: string,
    errorMessage: string,
    failureKind: RecoveryKind = RECOVERY_KIND.PERMANENT,
  ): Promise<ReplyDeliveryOutcome> => {
    const completed = await dependencies.dmConversationRepository.markFollowupFailed(
      followup.id,
      leaseId,
      { errorCode, errorMessage, failureKind },
    );
    if (!completed) throw new Error('Follow-up lease ownership was lost');
    return EXECUTION_STATUS.FAILED;
  };

  if (now >= followup.expiresAt) {
    return fail('FOLLOWUP_WINDOW_EXPIRED', 'The messaging window closed before delivery.');
  }

  let accessToken: string;
  try {
    accessToken = dependencies.tokenProtector.decrypt(claim.accessTokenCiphertext);
  } catch (error) {
    dependencies.logger.error(
      'Instagram follow-up token decryption failed',
      toSafeErrorContext(error),
    );
    return fail('TOKEN_DECRYPTION_FAILED', 'The Instagram connection must be repaired.');
  }

  if (
    !(await dependencies.dmConversationRepository.markFollowupDispatchStarted(
      followup.id,
      leaseId,
      now,
    ))
  )
    throw new Error('Follow-up lease ownership was lost before dispatch');

  try {
    const sent = await dependencies.instagramDirectMessageClient.sendDirectMessage({
      accessToken,
      instagramUserId: claim.instagramUserId,
      recipientId: followup.recipientIgsid,
      message: followup.messageText,
    });
    const completed = await dependencies.dmConversationRepository.markFollowupSucceeded(
      followup.id,
      leaseId,
      sent.replyId,
    );
    if (!completed) throw new Error('Follow-up lease ownership was lost after success');
    return EXECUTION_STATUS.SUCCEEDED;
  } catch (error) {
    const providerError = error instanceof InstagramDirectMessageError ? error : null;
    const recoveryKind = providerError ? providerError.recoveryKind() : RECOVERY_KIND.UNCERTAIN;
    dependencies.logger.error(
      'Instagram follow-up failed',
      providerError ? providerError.toLogContext() : toSafeErrorContext(error),
    );
    if (recoveryKind === RECOVERY_KIND.AUTHENTICATION) {
      await dependencies.tokenRefreshRepository.markAccountReconnectRequired(
        followup.accountId,
        'TOKEN_REJECTED',
      );
    }

    const failure = {
      errorCode:
        recoveryKind === RECOVERY_KIND.UNCERTAIN
          ? 'FOLLOWUP_OUTCOME_UNKNOWN'
          : recoveryKind === RECOVERY_KIND.AUTHENTICATION
            ? 'INSTAGRAM_RECONNECT_REQUIRED'
            : recoveryKind === RECOVERY_KIND.RETRYABLE
              ? 'INSTAGRAM_FOLLOWUP_RETRY_SCHEDULED'
              : 'INSTAGRAM_FOLLOWUP_REJECTED',
      errorMessage:
        recoveryKind === RECOVERY_KIND.UNCERTAIN
          ? 'Delivery requires manual review to prevent a duplicate message.'
          : recoveryKind === RECOVERY_KIND.AUTHENTICATION
            ? 'Reconnect Instagram before this message can be retried.'
            : recoveryKind === RECOVERY_KIND.RETRYABLE
              ? 'Instagram temporarily rejected the message.'
              : 'Instagram rejected the follow-up message.',
      failureKind: recoveryKind,
    } as const;
    let completed: DmFollowup | null;
    if (recoveryKind === RECOVERY_KIND.UNCERTAIN) {
      completed = await dependencies.dmConversationRepository.markFollowupUncertain(
        followup.id,
        leaseId,
        failure,
      );
    } else {
      const retryAt = new Date(now.getTime() + followup.attemptCount * 15 * 60 * 1000);
      if (
        (recoveryKind === RECOVERY_KIND.RETRYABLE ||
          recoveryKind === RECOVERY_KIND.AUTHENTICATION) &&
        followup.attemptCount < 3 &&
        retryAt < followup.expiresAt
      ) {
        completed = await dependencies.dmConversationRepository.markFollowupRetryPending(
          followup.id,
          leaseId,
          failure,
          retryAt,
        );
      } else {
        completed = await dependencies.dmConversationRepository.markFollowupFailed(
          followup.id,
          leaseId,
          {
            ...failure,
            errorCode:
              (recoveryKind === RECOVERY_KIND.RETRYABLE ||
                recoveryKind === RECOVERY_KIND.AUTHENTICATION) &&
              retryAt >= followup.expiresAt
                ? 'FOLLOWUP_WINDOW_EXPIRED'
                : followup.attemptCount >= 3
                  ? 'RETRY_ATTEMPTS_EXHAUSTED'
                  : failure.errorCode,
            errorMessage:
              (recoveryKind === RECOVERY_KIND.RETRYABLE ||
                recoveryKind === RECOVERY_KIND.AUTHENTICATION) &&
              retryAt >= followup.expiresAt
                ? 'The messaging window will close before a controlled retry.'
                : followup.attemptCount >= 3
                  ? 'The message could not be sent after controlled retry attempts.'
                  : failure.errorMessage,
            failureKind:
              recoveryKind === RECOVERY_KIND.RETRYABLE ? RECOVERY_KIND.PERMANENT : recoveryKind,
          },
        );
      }
    }
    if (!completed) throw new Error('Follow-up lease ownership was lost', { cause: error });
    return completed.status as ReplyDeliveryOutcome;
  }
};
