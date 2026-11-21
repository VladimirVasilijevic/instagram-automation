import { selectCommentDeliveries } from '@instagram-automation/application';
import { evaluateComment, getCommentSafetyExclusion } from '@instagram-automation/domain';

import type { SocialConnectionRepository } from '../database/identity-repositories.js';
import type {
  AutomationRepository,
  ExecutionRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import type { FacebookCommentReplyClient } from '../facebook/comment-reply-client.js';
import type { FacebookPrivateReplyClient } from '../facebook/private-reply-client.js';
import type { FacebookCommentEvent } from '../facebook/webhook-events.js';
import type { InstagramCommentReplyClient } from '../instagram/comment-reply-client.js';
import type { InstagramPrivateReplyClient } from '../instagram/private-reply-client.js';
import type { Logger } from '../logging/logger.js';
import type { TokenProtector } from '../security/token-protector.js';
import { COMMENT_PROCESS_OUTCOME, type CommentProcessResult } from './process-comment.js';
import { deliverReply } from './deliver-reply.js';

/** Ports used to process one signed Facebook Page comment. */
export interface ProcessFacebookCommentDependencies {
  /** Resolves Page ownership and reconnect state. */
  socialConnectionRepository: Pick<
    SocialConnectionRepository,
    'findFacebookPageByPageId' | 'markReconnectRequired'
  >;
  /** Finds the enabled Page rule for a post. */
  automationRepository: Pick<AutomationRepository, 'findEnabledByAccountAndMedia'>;
  /** Claims each reply channel and persists delivery outcomes. */
  executionRepository: Pick<
    ExecutionRepository,
    | 'claimExecutions'
    | 'markDispatchStarted'
    | 'markFailed'
    | 'markRetryPending'
    | 'markSucceeded'
    | 'markUncertain'
  >;
  /** Sends a public Page comment reply. */
  facebookCommentReplyClient: FacebookCommentReplyClient;
  /** Sends a comment-addressed private Page reply. */
  facebookPrivateReplyClient: FacebookPrivateReplyClient;
  /** Existing Instagram adapter required by the shared delivery port. */
  instagramCommentReplyClient: InstagramCommentReplyClient;
  /** Existing Instagram private adapter required by the shared delivery port. */
  instagramPrivateReplyClient: InstagramPrivateReplyClient;
  /** Existing Instagram reconnect capability required by shared delivery. */
  tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'>;
  /** Decrypts the protected Page token at delivery. */
  tokenProtector: TokenProtector;
  /** Records safe processing diagnostics. */
  logger: Logger;
}

/** Claims each selected channel before publishing a Facebook Page reply. */
export const processFacebookComment = async (
  event: FacebookCommentEvent,
  dependencies: ProcessFacebookCommentDependencies,
): Promise<CommentProcessResult> => {
  const page = await dependencies.socialConnectionRepository.findFacebookPageByPageId(event.pageId);
  if (!page) return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'account_not_connected' };
  if (page.connectionStatus !== 'active')
    return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'connection_inactive' };

  const comment = {
    authorExternalId: event.commenterId,
    authorName: event.commenterName,
    connectionExternalId: page.externalAccountId,
    parentCommentId: event.parentCommentId,
    text: event.text,
  };
  const owner = { externalId: page.externalAccountId, name: page.displayName };
  const exclusion = getCommentSafetyExclusion(comment, owner);
  if (exclusion) return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: exclusion };
  const automation = await dependencies.automationRepository.findEnabledByAccountAndMedia(
    page.id,
    event.postId,
  );
  if (!automation)
    return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: 'no_enabled_automation' };
  const mismatch = evaluateComment(comment, owner, {
    mode: automation.triggerMode,
    text: automation.triggerText,
  });
  if (mismatch) return { outcome: COMMENT_PROCESS_OUTCOME.IGNORED, reason: mismatch };

  const executions = await dependencies.executionRepository.claimExecutions(
    selectCommentDeliveries(automation).map((delivery) => ({
      automationId: automation.id,
      mediaId: event.postId,
      commenterInstagramId: event.commenterId,
      commenterUsername: event.commenterName,
      commentText: event.text,
      deliveryChannel: delivery.deliveryChannel,
      instagramCommentId: event.commentId,
      leaseExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
      messageText: delivery.messageText,
      quickReplyOptions: delivery.quickReplyOptions,
    })),
  );
  if (executions.length === 0) return { outcome: COMMENT_PROCESS_OUTCOME.DUPLICATE };
  const outcomes = await Promise.all(
    executions.map((execution) =>
      deliverReply(
        {
          provider: 'facebook',
          accountId: page.id,
          accessTokenCiphertext: page.accessTokenCiphertext,
          commentId: event.commentId,
          execution,
          instagramUserId: page.externalAccountId,
          message: execution.messageText,
        },
        dependencies,
      ),
    ),
  );
  return {
    outcome: outcomes.every((outcome) => outcome === 'succeeded')
      ? COMMENT_PROCESS_OUTCOME.SUCCEEDED
      : COMMENT_PROCESS_OUTCOME.FAILED,
  };
};
