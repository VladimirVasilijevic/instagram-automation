import type { OpenAPIHono } from '@hono/zod-openapi';

import {
  COMMENT_PROCESS_OUTCOME,
  processComment,
  type IgnoredCommentProcessResult,
} from '../automation/process-comment.js';
import { processIncomingMessage } from '../automation/process-incoming-message.js';
import { processStoryReply } from '../automation/process-story-reply.js';
import type {
  AccountRepository,
  AutomationRepository,
  DmConversationRepository,
  ExecutionRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import type { InstagramCommentReplyClient } from '../instagram/comment-reply-client.js';
import type { InstagramDirectMessageClient } from '../instagram/direct-message-client.js';
import type { InstagramPrivateReplyClient } from '../instagram/private-reply-client.js';
import type { InstagramWebhookClient } from '../instagram/webhook-client.js';
import { InstagramWebhookError } from '../instagram/webhook-client.js';
import { normalizeCommentEvents } from '../instagram/webhook-events.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  createRequireSessionMiddleware,
  type SessionMiddlewareDependencies,
} from '../middleware/session.js';
import type { TokenProtector } from '../security/token-protector.js';
import {
  equalWebhookSecrets,
  verifyMetaWebhookSignature,
} from '../security/meta-webhook-signature.js';

/** Dependencies for public signed delivery and authenticated account subscription routes. */
export interface InstagramWebhookRouteDependencies extends SessionMiddlewareDependencies {
  /** Resolves connected Instagram accounts during later event processing. */
  accountRepository: Pick<AccountRepository, 'findByInstagramUserId'>;
  /** Resolves enabled automations for an owner and commented media item. */
  automationRepository: Pick<
    AutomationRepository,
    'listByAccountId' | 'findEnabledByAccountAndMedia'
  >;
  /** App Secret used solely to authenticate signed webhook delivery bodies. */
  appSecret: string;
  /** Provider client that enables comments delivery for the signed-in account. */
  instagramCommentReplyClient: InstagramCommentReplyClient;
  /** Sends one recipient-addressed follow-up after an incoming quick-reply tap. */
  instagramDirectMessageClient?: InstagramDirectMessageClient;
  /** Provider client that sends comment-addressed private replies. */
  instagramPrivateReplyClient: InstagramPrivateReplyClient;
  /** Provider client that enables comments delivery for the signed-in account. */
  instagramWebhookClient: InstagramWebhookClient;
  /** Persists account-owned DM answers and follow-up jobs. */
  dmConversationRepository?: DmConversationRepository;
  /** Claims and completes idempotent comment processing records. */
  executionRepository: Pick<
    ExecutionRepository,
    | 'claimExecutions'
    | 'markDispatchStarted'
    | 'markFailed'
    | 'markRetryPending'
    | 'markSucceeded'
    | 'markUncertain'
  >;
  /** Receives safe lifecycle and rejection metadata. */
  logger: Logger;
  /** Decrypts the connected account token immediately before subscription. */
  tokenProtector: TokenProtector;
  /** Records account reconnection state after an authentication rejection. */
  tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'>;
  /** Shared value Meta presents during the one-time callback handshake. */
  verifyToken: string;
}

const createIgnoredReasonCounts = (): Record<IgnoredCommentProcessResult['reason'], number> => ({
  account_not_connected: 0,
  connection_inactive: 0,
  nested_comment: 0,
  no_enabled_automation: 0,
  own_comment: 0,
  trigger_not_matched: 0,
});

/** Verifies Meta's SHA-256 signature over the exact delivery bytes. */
export const verifyWebhookSignature = verifyMetaWebhookSignature;

/** Registers Meta's public handshake/delivery endpoint and owner comment-subscription action. */
export const registerInstagramWebhookRoutes = (
  app: OpenAPIHono,
  dependencies: InstagramWebhookRouteDependencies,
): void => {
  app.get('/api/webhooks/instagram', (context) => {
    const mode = context.req.query('hub.mode');
    const token = context.req.query('hub.verify_token');
    const challenge = context.req.query('hub.challenge');
    if (
      mode !== 'subscribe' ||
      !challenge ||
      !token ||
      !equalWebhookSecrets(token, dependencies.verifyToken)
    ) {
      return context.text('Forbidden', 403);
    }
    return context.text(challenge, 200);
  });

  app.post('/api/webhooks/instagram', async (context) => {
    const rawBody = Buffer.from(await context.req.raw.arrayBuffer());
    if (
      !verifyWebhookSignature(
        rawBody,
        context.req.header('x-hub-signature-256'),
        dependencies.appSecret,
      )
    ) {
      dependencies.logger.error('Instagram webhook signature rejected', {
        reason: 'invalid_signature',
      });
      return context.text('Unauthorized', 401);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      dependencies.logger.error('Instagram webhook payload rejected', { reason: 'invalid_json' });
      return context.text('Bad Request', 400);
    }
    const normalized = normalizeCommentEvents(payload);
    if (!normalized.success) {
      dependencies.logger.error('Instagram webhook payload rejected', {
        reason: 'invalid_comment_event',
      });
      return context.text('Bad Request', 400);
    }
    const outcomeCounts = { duplicateCount: 0, failedCount: 0, ignoredCount: 0, succeededCount: 0 };
    const ignoredReasonCounts = createIgnoredReasonCounts();
    for (const event of normalized.events) {
      const result = await processComment(event, dependencies);
      if (result.outcome === COMMENT_PROCESS_OUTCOME.DUPLICATE) outcomeCounts.duplicateCount += 1;
      if (result.outcome === COMMENT_PROCESS_OUTCOME.FAILED) outcomeCounts.failedCount += 1;
      if (result.outcome === COMMENT_PROCESS_OUTCOME.IGNORED) {
        outcomeCounts.ignoredCount += 1;
        ignoredReasonCounts[result.reason] += 1;
      }
      if (result.outcome === COMMENT_PROCESS_OUTCOME.SUCCEEDED) outcomeCounts.succeededCount += 1;
    }
    const unsupportedEventCounts = normalized.unsupportedEventCounts;
    const messageOutcomeCounts = {
      messageDuplicateCount: 0,
      messageFollowupStartedCount: 0,
      messageIgnoredCount: 0,
      messageRecordedCount: 0,
      storyReplySucceededCount: 0,
      storyReplyFailedCount: 0,
    };
    for (const event of normalized.messageEvents) {
      if (event.storyId) {
        if (!dependencies.instagramDirectMessageClient) {
          messageOutcomeCounts.messageIgnoredCount += 1;
          continue;
        }
        const outcome = await processStoryReply(event, {
          ...dependencies,
          instagramDirectMessageClient: dependencies.instagramDirectMessageClient,
        });
        if (outcome === 'succeeded') messageOutcomeCounts.storyReplySucceededCount += 1;
        if (outcome === 'failed') messageOutcomeCounts.storyReplyFailedCount += 1;
        if (outcome === 'ignored') messageOutcomeCounts.messageIgnoredCount += 1;
        if (outcome === 'duplicate') messageOutcomeCounts.messageDuplicateCount += 1;
        continue;
      }
      if (!dependencies.dmConversationRepository || !dependencies.instagramDirectMessageClient) {
        messageOutcomeCounts.messageIgnoredCount += 1;
        continue;
      }
      const outcome = await processIncomingMessage(event, {
        accountRepository: dependencies.accountRepository,
        dmConversationRepository: dependencies.dmConversationRepository,
        instagramDirectMessageClient: dependencies.instagramDirectMessageClient,
        logger: dependencies.logger,
        tokenProtector: dependencies.tokenProtector,
        tokenRefreshRepository: dependencies.tokenRefreshRepository,
      });
      if (outcome === 'duplicate') messageOutcomeCounts.messageDuplicateCount += 1;
      if (outcome === 'followup_started') messageOutcomeCounts.messageFollowupStartedCount += 1;
      if (outcome === 'ignored') messageOutcomeCounts.messageIgnoredCount += 1;
      if (outcome === 'recorded') messageOutcomeCounts.messageRecordedCount += 1;
    }
    dependencies.logger.info('Instagram webhook processed', {
      commentEventCount: normalized.events.length,
      messageEventCount: normalized.messageEvents.length,
      ...messageOutcomeCounts,
      ...outcomeCounts,
      ignoredAccountNotConnectedCount: ignoredReasonCounts.account_not_connected,
      ignoredConnectionInactiveCount: ignoredReasonCounts.connection_inactive,
      ignoredNestedCommentCount: ignoredReasonCounts.nested_comment,
      ignoredNoEnabledAutomationCount: ignoredReasonCounts.no_enabled_automation,
      ignoredOwnCommentCount: ignoredReasonCounts.own_comment,
      ignoredTriggerNotMatchedCount: ignoredReasonCounts.trigger_not_matched,
      unsupportedMessagingEventCount: unsupportedEventCounts.messaging,
      unsupportedOtherChangeEventCount: unsupportedEventCounts.other_change,
      unsupportedOtherEntryEventCount: unsupportedEventCounts.other_entry,
    });
    return context.text('EVENT_RECEIVED', 200);
  });

  app.use('/api/webhooks/instagram/subscription', createRequireSessionMiddleware(dependencies));
  app.post('/api/webhooks/instagram/subscription', async (context) => {
    const { account } = context.get('authenticatedSession');
    if (!account) return context.json({ error: { code: 'INSTAGRAM_CONNECTION_REQUIRED' } }, 409);
    try {
      await dependencies.instagramWebhookClient.subscribeToComments({
        accessToken: dependencies.tokenProtector.decrypt(account.accessTokenCiphertext),
        instagramUserId: account.instagramUserId,
        // Preserve answers to sent prompts even if their rules were subsequently edited.
        includeMessages: true,
      });
      return context.body(null, 204);
    } catch (error) {
      dependencies.logger.error(
        'Instagram comment subscription failed',
        error instanceof InstagramWebhookError ? error.toLogContext() : toSafeErrorContext(error),
      );
      return context.json(
        {
          error: {
            code: 'INSTAGRAM_COMMENT_SUBSCRIPTION_UNAVAILABLE',
            message: 'Comment delivery could not be enabled. Please try again.',
          },
        },
        502,
      );
    }
  });
};
