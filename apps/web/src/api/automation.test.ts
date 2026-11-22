import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutomationSaveError, getAutomations, saveAutomation } from './automation.js';

afterEach(() => vi.unstubAllGlobals());
const automation = {
  deliveryMode: 'public',
  enabled: true,
  mediaId: '17841400000000002',
  privateReplyText: null,
  replyText: 'Hello! Thanks for commenting.',
  triggerMode: 'exact',
  triggerText: '#Hello',
} as const;

describe('automation API client', () => {
  it('loads an empty or populated rule list with same-origin credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ automations: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ automations: [automation] })));
    vi.stubGlobal('fetch', fetcher);

    await expect(getAutomations()).resolves.toEqual([]);
    await expect(getAutomations()).resolves.toEqual([automation]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/automation',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('saves only owner-controlled fields through a same-origin JSON request', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ automation })));
    vi.stubGlobal('fetch', fetcher);

    await expect(
      saveAutomation({
        deliveryMode: 'public',
        enabled: true,
        mediaId: automation.mediaId,
        privateReplyText: null,
        replyText: automation.replyText,
        triggerMode: automation.triggerMode,
        triggerText: automation.triggerText,
      }),
    ).resolves.toEqual(automation);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/automation',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'same-origin',
        body: JSON.stringify({
          deliveryMode: 'public',
          enabled: true,
          mediaId: automation.mediaId,
          privateReplyText: null,
          replyText: automation.replyText,
          triggerMode: automation.triggerMode,
          triggerText: automation.triggerText,
        }),
      }),
    );
  });

  it.each([
    {},
    { automations: [{ ...automation, triggerMode: 'all', triggerText: '#Hello' }] },
    { automations: [{ ...automation, triggerMode: 'contains', triggerText: 'two words' }] },
    { automations: [{ ...automation, replyText: '' }] },
  ])('rejects invalid responses: %j', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(getAutomations()).rejects.toThrow('invalid response');
  });

  it('does not expose API failure bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private error', { status: 503 })),
    );
    await expect(
      saveAutomation({
        deliveryMode: 'public',
        enabled: false,
        mediaId: 'media',
        privateReplyText: null,
        replyText: 'Reply',
        triggerMode: 'exact',
        triggerText: '#Hello',
      }),
    ).rejects.toThrow('could not be saved');
  });

  it.each([
    'INSTAGRAM_COMMENT_SUBSCRIPTION_UNAVAILABLE',
    'INSTAGRAM_RECONNECT_REQUIRED',
    'FACEBOOK_COMMENT_SUBSCRIPTION_UNAVAILABLE',
    'FACEBOOK_MEDIA_UNAVAILABLE',
    'FACEBOOK_RECONNECT_REQUIRED',
  ] as const)('returns the safe %s save failure code', async (code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code, message: 'application-owned message' } }), {
          status: 502,
        }),
      ),
    );

    await expect(
      saveAutomation({
        deliveryMode: 'public',
        enabled: true,
        mediaId: 'media',
        privateReplyText: null,
        replyText: 'Reply',
        triggerMode: 'exact',
        triggerText: '#Hello',
      }),
    ).rejects.toEqual(new AutomationSaveError(code));
  });
  it('loads multiple independent post rules and rejects malformed list entries', async () => {
    const other = {
      ...automation,
      mediaId: 'other-post',
      enabled: false,
      replyText: 'Other reply',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ automations: [automation, other] })))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ automations: [{ ...automation, mediaId: '' }] })),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ automation }))),
    );
    await expect(getAutomations()).resolves.toEqual([automation, other]);
    await expect(getAutomations()).rejects.toThrow('invalid response');
    await expect(getAutomations()).rejects.toThrow('invalid response');
  });
  it('preserves a Story rule event kind and rejects public Story replies', async () => {
    const story = {
      ...automation,
      triggerKind: 'story_reply',
      deliveryMode: 'private',
      replyText: '',
      privateReplyText: 'Story answer',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ automations: [story] })))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              automations: [{ ...story, deliveryMode: 'both', replyText: 'Public' }],
            }),
          ),
        ),
    );
    await expect(getAutomations()).resolves.toEqual([story]);
    await expect(getAutomations()).rejects.toThrow('invalid response');
  });
});

it.each(['http', 'network', 'json'] as const)(
  'rejects %s list failures without displaying provider details',
  async (failure) => {
    const fetcher = vi.fn();
    if (failure === 'network') fetcher.mockRejectedValue(new Error('private-network-detail'));
    else
      fetcher.mockResolvedValue(
        new Response('private-provider-detail', { status: failure === 'http' ? 503 : 200 }),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(getAutomations()).rejects.toThrow(
      failure === 'json' ? 'invalid response' : 'Automation service is unavailable',
    );
  },
);
