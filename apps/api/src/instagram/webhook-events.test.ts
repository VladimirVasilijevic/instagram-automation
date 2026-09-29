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
});
