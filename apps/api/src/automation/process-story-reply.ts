import { evaluateComment } from '@instagram-automation/domain';

import type {
  AccountRepository,
  AutomationRepository,
  ExecutionRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import type { InstagramCommentReplyClient } from '../instagram/comment-reply-client.js';
import type { InstagramPrivateReplyClient } from '../instagram/private-reply-client.js';
import type { InstagramDirectMessageClient } from '../instagram/direct-message-client.js';
import type { IncomingMessageEvent } from '../instagram/webhook-events.js';
import type { Logger } from '../logging/logger.js';
import type { TokenProtector } from '../security/token-protector.js';
import { deliverReply } from './deliver-reply.js';

/** Shared durable reply services used for a recipient-addressed Story response. */
export interface StoryReplyDependencies {
  /** Resolves the authenticated recipient account. */
  accountRepository: Pick<AccountRepository, 'findByInstagramUserId'>;
  /** Reads the exact Story's enabled rule. */
  automationRepository: Pick<AutomationRepository, 'findEnabledByAccountAndMedia'>;
  /** Shared claim, lease and outcome persistence. */
  executionRepository: Pick<
    ExecutionRepository,
    | 'claimExecutions'
    | 'markDispatchStarted'
    | 'markFailed'
    | 'markRetryPending'
    | 'markSucceeded'
    | 'markUncertain'
  >;
  /** Recipient-addressed messaging adapter. */
  instagramDirectMessageClient: InstagramDirectMessageClient;
  /** Existing comment delivery ports, unused for Story sends. */
  instagramCommentReplyClient: InstagramCommentReplyClient;
  /** Existing comment-addressed private port, unused for Story sends. */
  instagramPrivateReplyClient: InstagramPrivateReplyClient;
  /** Shared reconnect persistence. */
  tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'>;
  /** Server-side credential protection. */
  tokenProtector: TokenProtector;
  /** Safe application logger. */
  logger: Logger;
}

/** Claims a Story reply by message ID and sends privately within its inbound messaging window. */
export const processStoryReply = async (
  event: IncomingMessageEvent,
  dependencies: StoryReplyDependencies,
  now: Date = new Date(),
): Promise<'ignored' | 'duplicate' | 'succeeded' | 'failed'> => {
  const expiresAt = new Date(event.timestamp.getTime() + 24 * 60 * 60 * 1000);
  if (
    !event.storyId ||
    !event.text ||
    event.quickReplyPayload ||
    event.recipientId !== event.instagramAccountId ||
    event.senderId === event.recipientId ||
    !Number.isFinite(event.timestamp.getTime()) ||
    event.timestamp > now ||
    now >= expiresAt
  )
    return 'ignored';
  const account = await dependencies.accountRepository.findByInstagramUserId(
    event.instagramAccountId,
  );
  if (!account || account.connectionStatus !== 'active') return 'ignored';
  const rule = await dependencies.automationRepository.findEnabledByAccountAndMedia(
    account.id,
    event.storyId,
  );
  if (
    !rule ||
    rule.triggerKind !== 'story_reply' ||
    rule.deliveryMode !== 'private' ||
    !rule.privateReplyText
  )
    return 'ignored';
  if (
    evaluateComment(
      {
        text: event.text,
        authorExternalId: event.senderId,
        authorName: null,
        connectionExternalId: account.instagramUserId,
        parentCommentId: null,
      },
      { externalId: account.instagramUserId, name: account.username },
      { mode: rule.triggerMode, text: rule.triggerText },
    )
  )
    return 'ignored';
  const executions = await dependencies.executionRepository.claimExecutions([
    {
      automationId: rule.id,
      mediaId: event.storyId,
      instagramCommentId: event.messageId,
      commenterInstagramId: event.senderId,
      commenterUsername: null,
      commentText: event.text,
      deliveryChannel: 'private',
      messageText: rule.privateReplyText,
      quickReplyOptions: rule.quickReplyOptions ?? [],
      triggerKind: 'story_reply',
      replyWindowExpiresAt: expiresAt,
      leaseExpiresAt: new Date(now.getTime() + 120_000),
    },
  ]);
  if (!executions.length) return 'duplicate';
  const results = await Promise.all(
    executions.map((execution) =>
      deliverReply(
        {
          accountId: account.id,
          instagramUserId: account.instagramUserId,
          accessTokenCiphertext: account.accessTokenCiphertext,
          execution,
          commentId: event.messageId,
          message: execution.messageText,
        },
        dependencies,
        now,
      ),
    ),
  );
  return results.every((result) => result === 'succeeded') ? 'succeeded' : 'failed';
};
