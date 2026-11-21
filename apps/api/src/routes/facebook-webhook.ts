import type { OpenAPIHono } from '@hono/zod-openapi';

import type {
  FacebookCommentEvent,
  FacebookIncomingMessageEvent,
} from '../facebook/webhook-events.js';
import { normalizeFacebookWebhookEvents } from '../facebook/webhook-events.js';
import type { Logger } from '../logging/logger.js';
import {
  equalWebhookSecrets,
  verifyMetaWebhookSignature,
} from '../security/meta-webhook-signature.js';

/** Dependencies for signed Facebook Page feed and Messenger delivery. */
export interface FacebookWebhookRouteDependencies {
  /** Meta App Secret used to verify the exact delivery bytes. */
  appSecret: string;
  /** One-time webhook subscription challenge secret. */
  verifyToken: string;
  /** Records counts and safe rejection reasons only. */
  logger: Logger;
  /** Idempotently handles one authenticated Page comment. */
  processFacebookComment(event: FacebookCommentEvent): Promise<void>;
  /** Idempotently handles one authenticated Page Messenger message. */
  processFacebookMessage(event: FacebookIncomingMessageEvent): Promise<void>;
}

/** Registers Meta's Page webhook challenge and signed delivery endpoints. */
export const registerFacebookWebhookRoutes = (
  app: OpenAPIHono,
  dependencies: FacebookWebhookRouteDependencies,
): void => {
  app.get('/api/webhooks/facebook', (context) => {
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

  app.post('/api/webhooks/facebook', async (context) => {
    const rawBody = Buffer.from(await context.req.raw.arrayBuffer());
    if (
      !verifyMetaWebhookSignature(
        rawBody,
        context.req.header('x-hub-signature-256'),
        dependencies.appSecret,
      )
    ) {
      dependencies.logger.error('Facebook webhook signature rejected', {
        reason: 'invalid_signature',
      });
      return context.text('Unauthorized', 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      dependencies.logger.error('Facebook webhook payload rejected', { reason: 'invalid_json' });
      return context.text('Bad Request', 400);
    }
    const normalized = normalizeFacebookWebhookEvents(payload);
    if (!normalized.success) {
      dependencies.logger.error('Facebook webhook payload rejected', {
        reason: 'invalid_page_event',
      });
      return context.text('Bad Request', 400);
    }

    const commentKeys = new Set<string>();
    const messageKeys = new Set<string>();
    let commentDuplicateCount = 0;
    let messageDuplicateCount = 0;
    for (const event of normalized.comments) {
      const key = `${event.pageId}\0${event.commentId}`;
      if (commentKeys.has(key)) {
        commentDuplicateCount += 1;
        continue;
      }
      commentKeys.add(key);
      await dependencies.processFacebookComment(event);
    }
    for (const event of normalized.messages) {
      const key = `${event.pageId}\0${event.messageId}`;
      if (messageKeys.has(key)) {
        messageDuplicateCount += 1;
        continue;
      }
      messageKeys.add(key);
      await dependencies.processFacebookMessage(event);
    }
    dependencies.logger.info('Facebook webhook processed', {
      commentEventCount: normalized.comments.length,
      messageEventCount: normalized.messages.length,
      commentDuplicateCount,
      messageDuplicateCount,
      unsupportedFeedEventCount: normalized.unsupported.feed,
      unsupportedOtherChangeEventCount: normalized.unsupported.otherChange,
      unsupportedMessagingEventCount: normalized.unsupported.messaging,
    });
    return context.text('EVENT_RECEIVED', 200);
  });
};
