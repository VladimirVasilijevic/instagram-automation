import { describe, expect, it } from 'vitest';

import { normalizeCommentEvents } from './webhook-events.js';

describe('normalizeCommentEvents', () => {
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
