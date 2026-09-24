import { createHmac, timingSafeEqual } from 'node:crypto';

import type { OpenAPIHono } from '@hono/zod-openapi';

import { processComment } from '../automation/process-comment.js';
import type {
  AccountRepository,
  AutomationRepository,
  ExecutionRepository,
} from '../database/repositories.js';
import type { InstagramCommentReplyClient } from '../instagram/comment-reply-client.js';
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

/** Dependencies for public signed delivery and authenticated account subscription routes. */
export interface InstagramWebhookRouteDependencies extends SessionMiddlewareDependencies {
  /** Resolves connected Instagram accounts during later event processing. */
  accountRepository: Pick<AccountRepository, 'findByInstagramUserId'>;
  /** Resolves enabled automations for an owner and commented media item. */
  automationRepository: Pick<AutomationRepository, 'findEnabledByAccountAndMedia'>;
  /** App Secret used solely to authenticate signed webhook delivery bodies. */
  appSecret: string;
  /** Provider client that enables comments delivery for the signed-in account. */
  instagramCommentReplyClient: InstagramCommentReplyClient;
  /** Provider client that enables comments delivery for the signed-in account. */
  instagramWebhookClient: InstagramWebhookClient;
  /** Claims and completes idempotent comment processing records. */
  executionRepository: Pick<ExecutionRepository, 'claimExecution' | 'markFailed' | 'markSucceeded'>;
  /** Receives safe lifecycle and rejection metadata. */
  logger: Logger;
  /** Decrypts the connected account token immediately before subscription. */
  tokenProtector: TokenProtector;
  /** Shared value Meta presents during the one-time callback handshake. */
  verifyToken: string;
}

const equalBuffers = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

/** Verifies Meta's SHA-256 signature over the exact delivery bytes. */
export const verifyWebhookSignature = (
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string,
): boolean => {
  const match = signature?.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return equalBuffers(expected, Buffer.from(match[1]!, 'hex'));
};

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
      !equalBuffers(Buffer.from(token), Buffer.from(dependencies.verifyToken))
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
    for (const event of normalized.events) {
      const result = await processComment(event, dependencies);
      if (result.outcome === 'duplicate') outcomeCounts.duplicateCount += 1;
      if (result.outcome === 'failed') outcomeCounts.failedCount += 1;
      if (result.outcome === 'ignored') outcomeCounts.ignoredCount += 1;
      if (result.outcome === 'succeeded') outcomeCounts.succeededCount += 1;
    }
    dependencies.logger.info('Instagram webhook processed', {
      commentEventCount: normalized.events.length,
      ...outcomeCounts,
    });
    return context.text('EVENT_RECEIVED', 200);
  });

  app.use('/api/webhooks/instagram/subscription', createRequireSessionMiddleware(dependencies));
  app.post('/api/webhooks/instagram/subscription', async (context) => {
    const { account } = context.get('authenticatedSession');
    try {
      await dependencies.instagramWebhookClient.subscribeToComments({
        accessToken: dependencies.tokenProtector.decrypt(account.accessTokenCiphertext),
        instagramUserId: account.instagramUserId,
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
