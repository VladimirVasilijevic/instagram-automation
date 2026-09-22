import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAutomation, saveAutomation } from './automation.js';

afterEach(() => vi.unstubAllGlobals());
const automation = {
  enabled: true,
  mediaId: '17841400000000002',
  replyText: 'Hello! Thanks for commenting.',
  triggerText: '#Hello',
} as const;

describe('automation API client', () => {
  it('loads null or a valid fixed-trigger automation', async () => {
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
        enabled: true,
        mediaId: automation.mediaId,
        replyText: automation.replyText,
      }),
    ).resolves.toEqual(automation);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/automation',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'same-origin',
        body: JSON.stringify({
          enabled: true,
          mediaId: automation.mediaId,
          replyText: automation.replyText,
        }),
      }),
    );
  });

  it.each([
    {},
    { automation: { ...automation, triggerText: '#Other' } },
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
      saveAutomation({ enabled: false, mediaId: 'media', replyText: 'Reply' }),
    ).rejects.toThrow('could not be saved');
  });
});
