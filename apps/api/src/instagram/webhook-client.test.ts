import { describe, expect, it, vi } from 'vitest';

import { createInstagramWebhookClient, InstagramWebhookError } from './webhook-client.js';

const input = {
  accessToken: 'private-access-token',
  instagramUserId: '17841400000000001',
};

const failureContext = async (operation: Promise<unknown>) => {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(InstagramWebhookError);
    return (error as InstagramWebhookError).toLogContext();
  }
  throw new Error('Expected subscription to fail');
};

describe('Instagram webhook subscription adapter', () => {
  it('subscribes to comments without placing the token in the URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await expect(
      createInstagramWebhookClient({ apiVersion: 'v24.0' }, fetcher).subscribeToComments(input),
    ).resolves.toBeUndefined();
    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://graph.instagram.com/v24.0/17841400000000001/subscribed_apps?subscribed_fields=comments',
    );
    expect(String(url)).not.toContain(input.accessToken);
    expect(request).toMatchObject({
      headers: { Authorization: `Bearer ${input.accessToken}` },
      method: 'POST',
      redirect: 'error',
    });
  });

  it('returns safe provider diagnostics without response details', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 200, error_subcode: 99, message: 'private provider detail' },
          access_token: 'private token',
        }),
        { status: 400 },
      ),
    );
    const context = await failureContext(
      createInstagramWebhookClient({ apiVersion: 'v24.0' }, fetcher).subscribeToComments(input),
    );
    expect(context).toEqual({
      errorName: 'InstagramWebhookError',
      reason: 'http_error',
      httpStatus: '400',
      metaErrorCode: '200',
      metaErrorSubcode: '99',
    });
    expect(JSON.stringify(context)).not.toContain('private');
  });
});
