import type {
  AccountRepository,
  AutomationRepository,
  ExecutionRepository,
} from '../database/repositories.js';
import {
  InstagramCommentReplyError,
  type InstagramCommentReplyClient,
} from '../instagram/comment-reply-client.js';
import type { CommentEvent } from '../instagram/webhook-events.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import type { TokenProtector } from '../security/token-protector.js';

/** A verified comment did not qualify for an automation reply. */
export interface IgnoredCommentProcessResult {
  /** Identifies the comment as deliberately ignored. */
  outcome: 'ignored';

  /** Safe reason why an automation reply was not eligible. */
  reason: 'account_not_connected' | 'no_enabled_automation' | 'trigger_not_matched';
}

/** A delivery repeated a comment that was already claimed. */
export interface DuplicateCommentProcessResult {
  /** Identifies the event as a duplicate that must not send another reply. */
  outcome: 'duplicate';
}

/** A public reply was accepted by Meta and persisted as successful. */
export interface SucceededCommentProcessResult {
  /** Identifies the completed successful reply. */
  outcome: 'succeeded';
}

/** A claimed comment could not be replied to and was persisted as failed. */
export interface FailedCommentProcessResult {
  /** Identifies the safely recorded failed reply. */
  outcome: 'failed';
}

/** Safe result categories for one normalized comment event. */
export type CommentProcessResult =
  | DuplicateCommentProcessResult
  | FailedCommentProcessResult
  | IgnoredCommentProcessResult
  | SucceededCommentProcessResult;

/** Dependencies for processing one verified Instagram comment into an optional public reply. */
export interface ProcessCommentDependencies {
  /** Resolves the connected owner account from a webhook's Instagram account ID. */
  accountRepository: Pick<AccountRepository, 'findByInstagramUserId'>;

  /** Resolves an enabled automation only for the selected owner and media. */
  automationRepository: Pick<AutomationRepository, 'findEnabledByAccountAndMedia'>;

  /** Atomically records processing ownership and its terminal result. */
  executionRepository: Pick<ExecutionRepository, 'claimExecution' | 'markFailed' | 'markSucceeded'>;

  /** Publishes a reply only after an execution has been claimed. */
  instagramCommentReplyClient: InstagramCommentReplyClient;

  /** Receives safe provider failure diagnostics without comment content or credentials. */
  logger: Logger;

  /** Decrypts an account token only immediately before the provider request. */
  tokenProtector: TokenProtector;
}

/**
 * Processes one authenticated comment event using the fixed exact-match automation rule.
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
  if (!account) return { outcome: 'ignored', reason: 'account_not_connected' };

  const automation = await dependencies.automationRepository.findEnabledByAccountAndMedia(
    account.id,
    event.mediaId,
  );
  if (!automation) return { outcome: 'ignored', reason: 'no_enabled_automation' };
  if (event.text.trim() !== automation.triggerText) {
    return { outcome: 'ignored', reason: 'trigger_not_matched' };
  }

  const execution = await dependencies.executionRepository.claimExecution({
    automationId: automation.id,
    commenterUsername: event.username,
    commentText: event.text,
    instagramCommentId: event.commentId,
  });
  if (!execution) return { outcome: 'duplicate' };

  try {
    await dependencies.instagramCommentReplyClient.replyToComment({
      accessToken: dependencies.tokenProtector.decrypt(account.accessTokenCiphertext),
      commentId: event.commentId,
      message: automation.replyText,
    });
  } catch (error) {
    dependencies.logger.error(
      'Instagram comment reply failed',
      error instanceof InstagramCommentReplyError
        ? error.toLogContext()
        : toSafeErrorContext(error),
    );
    const failedExecution = await dependencies.executionRepository.markFailed(execution.id, {
      errorCode: 'INSTAGRAM_REPLY_UNAVAILABLE',
      errorMessage: 'The public reply could not be sent.',
    });
    if (!failedExecution)
      throw new Error('Claimed execution could not be marked failed', { cause: error });
    return { outcome: 'failed' };
  }

  const succeededExecution = await dependencies.executionRepository.markSucceeded(execution.id);
  if (!succeededExecution) throw new Error('Claimed execution could not be marked succeeded');
  return { outcome: 'succeeded' };
};
