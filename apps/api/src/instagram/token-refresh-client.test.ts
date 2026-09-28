import { describe, expect, it, vi } from 'vitest';

import {
  createInstagramTokenRefreshClient,
  InstagramTokenRefreshError,
} from './token-refresh-client.js';

describe('Instagram token-refresh HTTP adapter', () => {
  it('refreshes a token and calculates its provider expiry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'new-token', expires_in: 5_184_000 }), {
        status: 200,
      }),
    );
    const client = createInstagramTokenRefreshClient(fetcher, () => 1_000);

    await expect(client.refresh('old-token')).resolves.toEqual({
      accessToken: 'new-token',
      tokenExpiresAt: new Date(5_184_001_000),
    });

    const [url, request] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).origin).toBe('https://graph.instagram.com');
    expect(new URL(String(url)).pathname).toBe('/refresh_access_token');
    expect(new URL(String(url)).searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(new URL(String(url)).searchParams.get('access_token')).toBe('old-token');
    expect(request?.redirect).toBe('error');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('requires reconnection only when Meta explicitly rejects the credential', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 190, message: 'private provider detail' } }), {
        status: 400,
      }),
    );

    const operation = createInstagramTokenRefreshClient(fetcher).refresh('old-token');
    await expect(operation).rejects.toBeInstanceOf(InstagramTokenRefreshError);
    await operation.catch((error: InstagramTokenRefreshError) => {
      expect(error.reconnectRequired).toBe(true);
      expect(error.toLogContext()).toEqual({
        errorName: 'InstagramTokenRefreshError',
        reason: 'http_error',
        reconnectRequired: 'true',
        httpStatus: '400',
        metaErrorCode: '190',
      });
    });
  });

  it('classifies timeouts as temporary without exposing the original message', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('private timeout detail', 'TimeoutError'));
    const operation = createInstagramTokenRefreshClient(fetcher).refresh('old-token');

    await expect(operation).rejects.toBeInstanceOf(InstagramTokenRefreshError);
    await operation.catch((error: InstagramTokenRefreshError) => {
      expect(error.reconnectRequired).toBe(false);
      expect(JSON.stringify(error.toLogContext())).not.toContain('private timeout detail');
    });
  });
});
