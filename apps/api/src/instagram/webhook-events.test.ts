import { describe, expect, it } from 'vitest';

import { createMessagingRejectionCounts, normalizeCommentEvents } from './webhook-events.js';

describe('normalizeCommentEvents', () => {
  it('retains Story identity without retaining the Story URL', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: 'business-id',
          messaging: [
            {
              sender: { id: 'person-id' },
              recipient: { id: 'business-id' },
              timestamp: 1767000000000,
              message: {
                mid: 'story-message',
                text: 'info',
                reply_to: { story: { id: 'story-id', url: 'https://private.example/story' } },
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.messageEvents[0]).toMatchObject({
        storyId: 'story-id',
        messageId: 'story-message',
      });
    expect(JSON.stringify(result)).not.toContain('private.example');
  });

  it('does not reinterpret a malformed Story reference as an ordinary DM', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: 'business-id',
          messaging: [
            {
              sender: { id: 'person-id' },
              recipient: { id: 'business-id' },
              timestamp: 1767000000000,
              message: {
                mid: 'story-message',
                text: 'Yes',
                reply_to: { story: { url: 'https://example.com/story' } },
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.messageEvents).toEqual([]);
  });

  it('counts non-comment change events without retaining their payload', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: '17841400000000001',
          changes: [{ field: 'mentions', value: { caption: 'private caption' } }],
        },
      ],
    });

    expect(result).toEqual({
      events: [],
      messagingRejectionCounts: createMessagingRejectionCounts(),
      messageEvents: [],
      success: true,
      unsupportedEventCounts: { messaging: 0, other_change: 1, other_entry: 0 },
    });
    expect(JSON.stringify(result)).not.toContain('private caption');
  });

  it('counts messaging entries without requiring their private payload shape', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: '17841400000000001',
          messaging: [{ message: { text: 'private message body' } }],
        },
      ],
    });

    expect(result).toEqual({
      events: [],
      messagingRejectionCounts: { ...createMessagingRejectionCounts(), invalid_message_id: 1 },
      messageEvents: [],
      success: true,
      unsupportedEventCounts: { messaging: 1, other_change: 0, other_entry: 0 },
    });
    expect(JSON.stringify(result)).not.toContain('private message body');
  });

  it('rejects a malformed comments change', () => {
    expect(
      normalizeCommentEvents({
        object: 'instagram',
        entry: [{ id: '17841400000000001', changes: [{ field: 'comments', value: {} }] }],
      }),
    ).toEqual({ success: false });
  });

  it('normalizes a quick-reply tap and typed message without logging content', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: 'business-id',
          messaging: [
            {
              sender: { id: 'person-id' },
              recipient: { id: 'business-id' },
              timestamp: 1_767_000_000_000,
              message: {
                mid: 'quick-message-id',
                text: 'Choice A',
                quick_reply: { payload: 'execution-id:choice-a' },
              },
            },
            {
              sender: { id: 'person-id' },
              recipient: { id: 'business-id' },
              timestamp: 1_767_000_000_001,
              message: { mid: 'typed-message-id', text: 'Custom answer' },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      events: [],
      messagingRejectionCounts: createMessagingRejectionCounts(),
      messageEvents: [
        {
          instagramAccountId: 'business-id',
          messageId: 'quick-message-id',
          quickReplyPayload: 'execution-id:choice-a',
          recipientId: 'business-id',
          senderId: 'person-id',
          timestamp: new Date(1_767_000_000_000),
          text: 'Choice A',
        },
        {
          instagramAccountId: 'business-id',
          messageId: 'typed-message-id',
          quickReplyPayload: null,
          recipientId: 'business-id',
          senderId: 'person-id',
          timestamp: new Date(1_767_000_000_001),
          text: 'Custom answer',
        },
      ],
      success: true,
      unsupportedEventCounts: { messaging: 0, other_change: 0, other_entry: 0 },
    });
  });

  it('also accepts a messages change with the same inbound message shape', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: 'business-id',
          changes: [
            {
              field: 'messages',
              value: {
                sender: { id: 'person-id' },
                recipient: { id: 'business-id' },
                timestamp: 1_767_000_000_000,
                message: { mid: 'message-id', quick_reply: { payload: 'choice-payload' } },
              },
            },
          ],
        },
      ],
    });
    expect(result).toMatchObject({
      success: true,
      messageEvents: [{ messageId: 'message-id', quickReplyPayload: 'choice-payload' }],
      unsupportedEventCounts: { messaging: 0, other_change: 0, other_entry: 0 },
    });
  });

  it('ignores echoes, unrelated messaging events, and incomplete DM events', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: 'business-id',
          messaging: [
            {
              sender: { id: 'business-id' },
              recipient: { id: 'person-id' },
              timestamp: 1_767_000_000_000,
              message: { mid: 'echo-id', text: 'Private outgoing content', is_echo: true },
            },
            { message: { text: 'Private malformed content' } },
            {
              sender: { id: 'person-id' },
              recipient: { id: 'another-business-id' },
              timestamp: 1_767_000_000_000,
              message: { mid: 'wrong-recipient-id', text: 'Private unrelated content' },
            },
            {
              sender: { id: 'person-id' },
              recipient: { id: 'business-id' },
              timestamp: 1_767_000_000_000,
              message: { mid: 'attachment-id', attachments: [{ type: 'image' }] },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      events: [],
      messagingRejectionCounts: {
        ...createMessagingRejectionCounts(),
        echo: 1,
        invalid_message_id: 1,
        recipient_mismatch: 1,
        unsupported_content: 1,
      },
      messageEvents: [],
      success: true,
      unsupportedEventCounts: { messaging: 4, other_change: 0, other_entry: 0 },
    });
    expect(JSON.stringify(result)).not.toContain('Private');
  });

  it('accepts a quick-reply payload when Meta omits visible message text', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: 'business-id',
          messaging: [
            {
              sender: { id: 'person-id' },
              recipient: { id: 'business-id' },
              timestamp: 1_767_000_000_000,
              message: { mid: 'message-id', quick_reply: { payload: 'execution-id:option-id' } },
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      messageEvents: [
        {
          messageId: 'message-id',
          quickReplyPayload: 'execution-id:option-id',
          text: null,
        },
      ],
      unsupportedEventCounts: { messaging: 0, other_change: 0, other_entry: 0 },
    });
  });

  it('normalizes blank quick-reply text and ignores blank text-only messages', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: 'business-id',
          messaging: [
            {
              sender: { id: 'person-id' },
              recipient: { id: 'business-id' },
              timestamp: 1_767_000_000_000,
              message: {
                mid: 'blank-quick-reply',
                text: '   ',
                quick_reply: { payload: 'execution-id:option-id' },
              },
            },
            {
              sender: { id: 'person-id' },
              recipient: { id: 'business-id' },
              timestamp: 1_767_000_000_001,
              message: { mid: 'blank-text-only', text: '' },
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      success: true,
      messageEvents: [
        {
          messageId: 'blank-quick-reply',
          quickReplyPayload: 'execution-id:option-id',
          text: null,
        },
      ],
      unsupportedEventCounts: { messaging: 1, other_change: 0, other_entry: 0 },
    });
  });
});

describe('Story message envelope variants', () => {
  const message = {
    sender: { id: 'person' },
    recipient: { id: 'owner' },
    timestamp: 1767000000000,
    message: {
      mid: 'story-message',
      text: 'info',
      reply_to: { story: { id: 'story-id', url: 'https://private.example/story' } },
    },
  };
  it('normalizes a Story reply delivered through messages changes', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [{ id: 'owner', changes: [{ field: 'messages', value: message }] }],
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.messageEvents).toMatchObject([
        { messageId: 'story-message', storyId: 'story-id' },
      ]);
    expect(JSON.stringify(result)).not.toContain('private.example');
  });

  it.each([null, {}, { id: '' }, { id: 123 }])(
    'does not turn malformed Story references into ordinary answers',
    (story) => {
      const result = normalizeCommentEvents({
        object: 'instagram',
        entry: [
          {
            id: 'owner',
            messaging: [{ ...message, message: { ...message.message, reply_to: { story } } }],
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.messageEvents).toEqual([]);
    },
  );

  it('ignores echoed Story replies before automation routing', () => {
    const result = normalizeCommentEvents({
      object: 'instagram',
      entry: [
        {
          id: 'owner',
          messaging: [{ ...message, message: { ...message.message, is_echo: true } }],
        },
      ],
    });
    if (result.success) expect(result.messageEvents).toEqual([]);
    else throw new Error('Echo should be ignored safely');
  });
});

describe.each(['messaging', 'messages change'])(
  'messaging rejection diagnostics: %s',
  (envelope) => {
    const message = {
      sender: { id: 'person' },
      recipient: { id: 'owner' },
      timestamp: 1_767_000_000_000,
      message: {
        mid: 'opaque-id',
        text: 'Private message text',
        reply_to: { story: { id: 'story-id', url: 'https://private.example/story' } },
      },
    };
    const normalize = (item: unknown, owner = 'owner') =>
      normalizeCommentEvents({
        object: 'instagram',
        entry: [
          {
            id: owner,
            ...(envelope === 'messaging'
              ? { messaging: [item] }
              : { changes: [{ field: 'messages', value: item }] }),
          },
        ],
      });

    it.each([128, 129, 200, 1024])(
      'accepts and trims an opaque message ID of length %i',
      (length) => {
        const mid = 'm'.repeat(length);
        const result = normalize({ ...message, message: { ...message.message, mid: ` ${mid} ` } });
        expect(result).toMatchObject({
          success: true,
          messageEvents: [{ messageId: mid, storyId: 'story-id' }],
          messagingRejectionCounts: createMessagingRejectionCounts(),
          unsupportedEventCounts: { messaging: 0, other_change: 0, other_entry: 0 },
        });
      },
    );

    it.each(['', '   ', 'm'.repeat(1025)])('rejects blank or oversized message IDs %#', (mid) => {
      expect(normalize({ ...message, message: { ...message.message, mid } })).toEqual({
        success: true,
        events: [],
        messageEvents: [],
        messagingRejectionCounts: { ...createMessagingRejectionCounts(), invalid_message_id: 1 },
        unsupportedEventCounts: { messaging: 1, other_change: 0, other_entry: 0 },
      });
    });

    it.each(['sender', 'recipient'])('preserves the 128-character %s account ID bound', (field) => {
      const result = normalize({ ...message, [field]: { id: 'a'.repeat(129) } });
      expect(result).toMatchObject({
        success: true,
        messageEvents: [],
        messagingRejectionCounts: { ...createMessagingRejectionCounts(), invalid_payload: 1 },
        unsupportedEventCounts: { messaging: 1 },
      });
    });

    it('preserves the entry account ID limit', () => {
      expect(normalize(message, 'a'.repeat(129))).toEqual({ success: false });
    });

    it.each([
      {
        reason: 'invalid_message_id',
        item: {
          ...message,
          timestamp: 'invalid private timestamp',
          message: { ...message.message, mid: ' ', is_echo: true },
        },
      },
      {
        reason: 'invalid_payload',
        item: {
          ...message,
          timestamp: 'invalid private timestamp',
          message: { ...message.message, is_echo: true },
        },
      },
      {
        reason: 'echo',
        item: {
          ...message,
          sender: { id: 'owner' },
          recipient: { id: 'other' },
          message: { mid: 'private-id', is_echo: true },
        },
      },
      {
        reason: 'own_sender',
        item: {
          ...message,
          sender: { id: 'owner' },
          recipient: { id: 'other' },
          message: { mid: 'private-id' },
        },
      },
      {
        reason: 'recipient_mismatch',
        item: { ...message, recipient: { id: 'other' }, message: { mid: 'private-id' } },
      },
      {
        reason: 'unsupported_content',
        item: {
          ...message,
          message: {
            mid: 'private-id',
            attachments: [{ type: 'image', url: 'https://private.example/image' }],
          },
        },
      },
    ])('records only $reason with no private values or validation details', ({ reason, item }) => {
      const result = normalize(item);
      expect(result).toEqual({
        success: true,
        events: [],
        messageEvents: [],
        messagingRejectionCounts: { ...createMessagingRejectionCounts(), [reason]: 1 },
        unsupportedEventCounts: { messaging: 1, other_change: 0, other_entry: 0 },
      });
    });
  },
);
