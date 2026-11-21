import { createHmac } from 'node:crypto';

import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';

import { registerFacebookWebhookRoutes } from './facebook-webhook.js';

const appSecret = 'test-app-secret';
const pageDelivery = {
  object: 'page',
  entry: [
    {
      id: 'page-1',
      changes: [
        {
          field: 'feed',
          value: {
            item: 'comment',
            verb: 'add',
            comment_id: 'comment-1',
            post_id: 'post-1',
            parent_id: 'post-1',
            message: 'Pricing?',
            from: { id: 'author-1', name: 'Buyer' },
          },
        },
      ],
      messaging: [
        {
          sender: { id: 'psid-1' },
          recipient: { id: 'page-1' },
          timestamp: 1_700_000_000_000,
          message: {
            mid: 'message-1',
            text: 'Pricing',
            quick_reply: { payload: 'choice-1' },
          },
        },
      ],
    },
  ],
};

const createFixture = () => {
  const app = new OpenAPIHono();
  const processFacebookComment = vi.fn(async () => {});
  const processFacebookMessage = vi.fn(async () => {});
  const logger = { info: vi.fn(), error: vi.fn() };
  registerFacebookWebhookRoutes(app, {
    appSecret,
    verifyToken: 'verify-token',
    logger,
    processFacebookComment,
    processFacebookMessage,
  });
  const post = (payload: unknown, signed = true) => {
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', appSecret).update(body).digest('hex');
    return app.request('/api/webhooks/facebook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signed ? `sha256=${signature}` : 'sha256=invalid' },
      body,
    });
  };
  return { app, post, processFacebookComment, processFacebookMessage, logger };
};

describe('Facebook Page webhook routes', () => {
  it('answers only an authenticated Meta subscription challenge', async () => {
    const { app } = createFixture();
    expect(
      await (
        await app.request(
          '/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123',
        )
      ).text(),
    ).toBe('abc123');
    expect(
      (
        await app.request(
          '/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123',
        )
      ).status,
    ).toBe(403);
  });

  it('rejects an unsigned delivery before parsing or invoking processors', async () => {
    const fixture = createFixture();
    expect((await fixture.post(pageDelivery, false)).status).toBe(401);
    expect(fixture.processFacebookComment).not.toHaveBeenCalled();
    expect(fixture.processFacebookMessage).not.toHaveBeenCalled();
    expect(fixture.logger.error).toHaveBeenCalledWith('Facebook webhook signature rejected', {
      reason: 'invalid_signature',
    });
  });

  it('passes normalized events to processors and acknowledges completed delivery', async () => {
    const fixture = createFixture();
    const response = await fixture.post(pageDelivery);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('EVENT_RECEIVED');
    expect(fixture.processFacebookComment).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
        postId: 'post-1',
        commentId: 'comment-1',
        commenterId: 'author-1',
        text: 'Pricing?',
      }),
    );
    expect(fixture.processFacebookMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
        senderId: 'psid-1',
        quickReplyPayload: 'choice-1',
      }),
    );
    expect(JSON.stringify(fixture.logger.info.mock.calls)).not.toContain('Pricing?');
  });

  it('deduplicates repeated events inside one delivery envelope', async () => {
    const fixture = createFixture();
    const entry = pageDelivery.entry[0]!;
    expect(
      (
        await fixture.post({
          object: 'page',
          entry: [
            {
              ...entry,
              changes: [entry.changes[0], entry.changes[0]],
              messaging: [entry.messaging[0], entry.messaging[0]],
            },
          ],
        })
      ).status,
    ).toBe(200);
    expect(fixture.processFacebookComment).toHaveBeenCalledOnce();
    expect(fixture.processFacebookMessage).toHaveBeenCalledOnce();
    expect(fixture.logger.info).toHaveBeenCalledWith(
      'Facebook webhook processed',
      expect.objectContaining({ commentDuplicateCount: 1, messageDuplicateCount: 1 }),
    );
  });

  it('rejects a signed malformed target comment before any dispatch', async () => {
    const fixture = createFixture();
    expect(
      (
        await fixture.post({
          object: 'page',
          entry: [
            {
              id: 'page-1',
              changes: [{ field: 'feed', value: { item: 'comment', verb: 'add' } }],
            },
          ],
        })
      ).status,
    ).toBe(400);
    expect(fixture.processFacebookComment).not.toHaveBeenCalled();
  });
});
