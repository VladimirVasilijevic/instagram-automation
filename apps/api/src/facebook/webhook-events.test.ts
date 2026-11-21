import { describe, expect, it } from 'vitest';

import { normalizeFacebookWebhookEvents } from './webhook-events.js';

describe('normalizeFacebookWebhookEvents', () => {
  it('extracts new Page comments and inbound Messenger answers', () => {
    const receivedAt = new Date('2026-11-21T12:00:00.000Z');
    const result = normalizeFacebookWebhookEvents(
      {
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
                  message: 'price?',
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
      },
      receivedAt,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.comments).toEqual([
      {
        pageId: 'page-1',
        postId: 'post-1',
        commentId: 'comment-1',
        parentCommentId: null,
        commenterId: 'author-1',
        commenterName: 'Buyer',
        text: 'price?',
        receivedAt,
      },
    ]);
    expect(result.messages).toEqual([
      {
        pageId: 'page-1',
        messageId: 'message-1',
        senderId: 'psid-1',
        recipientId: 'page-1',
        quickReplyPayload: 'choice-1',
        text: 'Pricing',
        timestamp: new Date(1_700_000_000_000),
      },
    ]);
  });

  it('ignores edited posts and echoed messages but rejects malformed new comments', () => {
    const envelope = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [{ field: 'feed', value: { item: 'post', verb: 'add' } }],
          messaging: [
            {
              sender: { id: 'page-1' },
              recipient: { id: 'psid-1' },
              timestamp: 1_700_000_000_000,
              message: { mid: 'echo-1', is_echo: true, text: 'Sent' },
            },
          ],
        },
      ],
    };
    expect(normalizeFacebookWebhookEvents(envelope)).toMatchObject({
      success: true,
      comments: [],
      messages: [],
      unsupported: { feed: 1, messaging: 1 },
    });
    expect(
      normalizeFacebookWebhookEvents({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            changes: [{ field: 'feed', value: { item: 'comment', verb: 'add' } }],
          },
        ],
      }),
    ).toEqual({ success: false });
  });

  it('keeps nested comment ownership and accepts a payload-only quick reply', () => {
    const receivedAt = new Date('2026-11-21T12:00:00.000Z');
    const result = normalizeFacebookWebhookEvents(
      {
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
                  comment_id: 'reply-1',
                  post_id: 'post-1',
                  parent_id: 'parent-comment-1',
                },
              },
            ],
            messaging: [
              {
                sender: { id: 'psid-1' },
                recipient: { id: 'page-1' },
                timestamp: 1_700_000_000_000,
                message: { mid: 'message-1', quick_reply: { payload: 'choice-1' } },
              },
            ],
          },
        ],
      },
      receivedAt,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.comments[0]).toMatchObject({
      parentCommentId: 'parent-comment-1',
      postId: 'post-1',
      text: '',
    });
    expect(result.messages[0]).toMatchObject({
      quickReplyPayload: 'choice-1',
      text: null,
    });
  });
});
