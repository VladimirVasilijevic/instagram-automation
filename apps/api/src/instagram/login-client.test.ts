import { describe, expect, it, vi } from 'vitest';

import { createInstagramLoginClient, instagramLoginScopes } from './login-client.js';

const config = {
  appId: '12345',
  appSecret: 'client-secret',
  apiVersion: 'v24.0',
  redirectUri: 'https://app.example/api/auth/instagram/callback',
};
const shortToken = {
  access_token: 'short-token',
  user_id: 'app-scoped-id',
  permissions: instagramLoginScopes.join(','),
};
const longToken = { access_token: 'long-token', expires_in: 5_184_000, token_type: 'bearer' };
const profile = {
  user_id: '17841400000000001',
  username: 'example_account',
  id: 'different-app-scoped-id',
};
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe('Instagram Login HTTP adapter', () => {
  it('builds authorization using the Instagram app ID, exact callback, scopes, and state', () => {
    const url = new URL(createInstagramLoginClient(config).authorizationUrl('random-state'));
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: config.appId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: instagramLoginScopes.join(','),
      state: 'random-state',
      force_reauth: 'true',
    });
    expect(url.toString()).not.toContain(config.appSecret);
  });

  it.each([true, false])(
    'exchanges tokens and reads the professional ID (data wrapper: %s)',
    async (wrapped) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(wrapped ? { data: [shortToken] } : shortToken))
        .mockResolvedValueOnce(json(longToken))
        .mockResolvedValueOnce(json(wrapped ? { data: [profile] } : profile));
      const result = await createInstagramLoginClient(config, fetcher, () => 1_000).completeLogin(
        'code-with+symbols',
      );
      expect(result).toEqual({
        accessToken: 'long-token',
        instagramUserId: profile.user_id,
        username: profile.username,
        tokenExpiresAt: new Date(1_000 + longToken.expires_in * 1000),
      });
      const [tokenUrl, options] = fetcher.mock.calls[0]!;
      expect(tokenUrl).toBe('https://api.instagram.com/oauth/access_token');
      expect(options?.method).toBe('POST');
      expect(Object.fromEntries((options?.body as FormData).entries())).toEqual({
        client_id: config.appId,
        client_secret: config.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
        code: 'code-with+symbols',
      });
      const exchange = new URL(String(fetcher.mock.calls[1]![0]));
      expect(exchange.origin + exchange.pathname).toBe('https://graph.instagram.com/access_token');
      expect(exchange.searchParams.get('grant_type')).toBe('ig_exchange_token');
      expect(exchange.searchParams.get('access_token')).toBe('short-token');
      expect(exchange.searchParams.get('client_secret')).toBe(config.appSecret);
      const [profileUrl, profileOptions] = fetcher.mock.calls[2]!;
      expect(String(profileUrl)).toBe(
        'https://graph.instagram.com/v24.0/me?fields=user_id%2Cusername',
      );
      expect(profileOptions?.headers).toEqual({ Authorization: 'Bearer long-token' });
      for (const [, request] of fetcher.mock.calls) {
        expect(request?.redirect).toBe('error');
        expect(request?.signal).toBeInstanceOf(AbortSignal);
      }
    },
  );

  it('preserves a numeric Instagram ID larger than JavaScript safe integers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [shortToken] }))
      .mockResolvedValueOnce(json(longToken))
      .mockResolvedValueOnce(new Response('{"user_id":17841400000000001,"username":"example"}'));
    expect(
      (await createInstagramLoginClient(config, fetcher).completeLogin('code')).instagramUserId,
    ).toBe('17841400000000001');
  });

  it('rejects missing comment permission before exchanging the token further', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ ...shortToken, permissions: 'instagram_business_basic' }));
    await expect(
      createInstagramLoginClient(config, fetcher).completeLogin('code'),
    ).rejects.toMatchObject({ permissionsMissing: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([0, 1, 2])(
    'sanitizes provider HTTP failures at stage %s without retrying',
    async (stage) => {
      const responses = [json(shortToken), json(longToken), json(profile)];
      responses[stage] = new Response('secret-provider-response', { status: 400 });
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
      await expect(
        createInstagramLoginClient(config, fetcher).completeLogin('secret-code'),
      ).rejects.toThrow('Instagram login failed');
      expect(fetcher).toHaveBeenCalledTimes(stage + 1);
    },
  );

  it.each([
    [{ data: [] }, longToken, profile],
    [{ data: [shortToken, shortToken] }, longToken, profile],
    [{ access_token: 'short' }, longToken, profile],
    [shortToken, { ...longToken, expires_in: -1 }, profile],
    [shortToken, longToken, { id: 'wrong-id', username: 'example' }],
    [shortToken, longToken, { ...profile, username: '' }],
  ])('rejects malformed provider responses', async (short, long, identity) => {
    const responses = [json(short), json(long), json(identity)];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
    await expect(createInstagramLoginClient(config, fetcher).completeLogin('code')).rejects.toThrow(
      'Instagram login failed',
    );
  });

  it('sanitizes invalid JSON and network timeouts', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not json'))
      .mockRejectedValueOnce(new DOMException('secret-url', 'TimeoutError'));
    const client = createInstagramLoginClient(config, fetcher);
    await expect(client.completeLogin('code')).rejects.toThrow('Instagram login failed');
    await expect(client.completeLogin('code')).rejects.toThrow('Instagram login failed');
  });
});
