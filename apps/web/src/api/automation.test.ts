import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutomationSaveError, getAutomation, saveAutomation } from './automation.js';

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
  it('loads null or a valid configurable automation', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ automation: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ automation })));
    vi.stubGlobal('fetch', fetcher);

    await expect(getAutomation()).resolves.toBeNull();
    await expect(getAutomation()).resolves.toEqual(automation);
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
    { automation: { ...automation, triggerMode: 'all', triggerText: '#Hello' } },
    { automation: { ...automation, triggerMode: 'contains', triggerText: 'two words' } },
    { automation: { ...automation, replyText: '' } },
  ])('rejects invalid responses: %j', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(getAutomation()).rejects.toThrow('invalid response');
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

  it.each(['INSTAGRAM_COMMENT_SUBSCRIPTION_UNAVAILABLE', 'INSTAGRAM_RECONNECT_REQUIRED'] as const)(
    'returns the safe %s save failure code',
    async (code) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ error: { code, message: 'application-owned message' } }),
              { status: 502 },
            ),
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
    },
  );
});
