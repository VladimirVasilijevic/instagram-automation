import { describe, expect, it, vi } from 'vitest';

import {
  createInstagramLoginClient,
  InstagramLoginError,
  instagramLoginScopes,
} from './login-client.js';

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
const stages = ['short_token', 'long_token', 'profile'] as const;

const failureContext = async (operation: Promise<unknown>) => {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(InstagramLoginError);
    return (error as InstagramLoginError).toLogContext();
  }
  throw new Error('Expected Instagram login to fail');
};

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

  it.each([
    { wrapped: false, permissions: [...instagramLoginScopes] },
    { wrapped: true, permissions: [...instagramLoginScopes] },
    {
      wrapped: true,
      permissions: [
        ' instagram_business_basic ',
        'instagram_business_manage_comments',
        'instagram_business_basic',
        '',
      ],
    },
    {
      wrapped: false,
      permissions: ' instagram_business_basic , instagram_business_manage_comments, ',
    },
  ])('normalizes string and array permissions: %j', async ({ wrapped, permissions }) => {
    const token = { ...shortToken, permissions };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(wrapped ? { data: [token] } : token))
      .mockResolvedValueOnce(json(longToken))
      .mockResolvedValueOnce(json(profile));
    await expect(
      createInstagramLoginClient(config, fetcher).completeLogin('code'),
    ).resolves.toMatchObject({
      accessToken: longToken.access_token,
      instagramUserId: profile.user_id,
      username: profile.username,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    '',
    [],
    ['instagram_business_basic'],
    ['instagram_business_manage_comments'],
    [' ', 'unknown_scope'],
  ])('rejects ungranted required permissions after normalization: %j', async (permissions) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...shortToken, permissions }));
    const operation = createInstagramLoginClient(config, fetcher).completeLogin('code');
    await expect(operation).rejects.toMatchObject({ permissionsMissing: true });
    expect(await failureContext(operation)).toEqual({
      errorName: 'InstagramLoginError',
      stage: 'short_token',
      reason: 'permissions',
      httpStatus: '200',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { permissions: undefined, type: 'missing' },
    { permissions: null, type: 'null' },
    { permissions: 42, type: 'number' },
    { permissions: true, type: 'boolean' },
    { permissions: { 'private-field': 'private-value' }, type: 'object' },
    {
      permissions: ['instagram_business_basic', { 'private-field': 'private-value' }],
      type: 'array',
    },
    { permissions: [...instagramLoginScopes, null], type: 'array' },
  ])('reports only a safe type for malformed permissions: %j', async ({ permissions, type }) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...shortToken, permissions }));
    expect(
      await failureContext(
        createInstagramLoginClient(config, fetcher).completeLogin('private-code'),
      ),
    ).toEqual({
      errorName: 'InstagramLoginError',
      stage: 'short_token',
      reason: 'invalid_response',
      httpStatus: '200',
      invalidFields: 'permissions',
      invalidFieldTypes: `permissions:${type}`,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects missing comment permission before exchanging the token further', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ ...shortToken, permissions: 'instagram_business_basic' }));
    const operation = createInstagramLoginClient(config, fetcher).completeLogin('code');
    await expect(operation).rejects.toMatchObject({ permissionsMissing: true });
    expect(await failureContext(operation)).toEqual({
      errorName: 'InstagramLoginError',
      stage: 'short_token',
      reason: 'permissions',
      httpStatus: '200',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([0, 1, 2])(
    'sanitizes provider HTTP failures at stage %s without retrying',
    async (stage) => {
      const responses = [json(shortToken), json(longToken), json(profile)];
      responses[stage] = new Response('secret-provider-response', { status: 400 });
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
      const operation = createInstagramLoginClient(config, fetcher).completeLogin('secret-code');
      await expect(operation).rejects.toThrow('Instagram login failed');
      expect(await failureContext(operation)).toEqual({
        errorName: 'InstagramLoginError',
        stage: stages[stage],
        reason: 'http_error',
        httpStatus: '400',
      });
      expect(fetcher).toHaveBeenCalledTimes(stage + 1);
    },
  );

  it.each([
    [{ data: [] }, longToken, profile, 'short_token', 'response', 'missing'],
    [{ data: [shortToken, shortToken] }, longToken, profile, 'short_token', 'response', 'missing'],
    [{ access_token: 'short' }, longToken, profile, 'short_token', 'permissions', 'missing'],
    [shortToken, { ...longToken, expires_in: -1 }, profile, 'long_token', 'expires_in', 'number'],
    [
      shortToken,
      longToken,
      { id: 'wrong-id', username: 'example' },
      'profile',
      'user_id',
      'missing',
    ],
    [shortToken, longToken, { ...profile, username: '' }, 'profile', 'username', 'string'],
  ])(
    'rejects malformed provider responses',
    async (short, long, identity, stage, invalidFields, type) => {
      const responses = [json(short), json(long), json(identity)];
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
      expect(
        await failureContext(createInstagramLoginClient(config, fetcher).completeLogin('code')),
      ).toEqual({
        errorName: 'InstagramLoginError',
        stage,
        reason: 'invalid_response',
        httpStatus: '200',
        invalidFields,
        invalidFieldTypes: `${invalidFields}:${type}`,
      });
    },
  );

  it.each([0, 1, 2])(
    'reports numeric Meta errors without response details at stage %s',
    async (stage) => {
      const responses = [json(shortToken), json(longToken), json(profile)];
      responses[stage] = new Response(
        JSON.stringify({
          error: {
            code: 190,
            error_subcode: 463,
            type: 'private-error-type',
            message: 'private-provider-message',
            error_user_msg: 'private-user-message',
            fbtrace_id: 'private-trace',
          },
          access_token: 'private-response-token',
        }),
        { status: 400 },
      );
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
      expect(
        await failureContext(
          createInstagramLoginClient(config, fetcher).completeLogin('private-code'),
        ),
      ).toEqual({
        errorName: 'InstagramLoginError',
        stage: stages[stage],
        reason: 'http_error',
        httpStatus: '400',
        metaErrorCode: '190',
        metaErrorSubcode: '463',
      });
      expect(fetcher).toHaveBeenCalledTimes(stage + 1);
    },
  );

  it('reads top-level Instagram error codes without copying messages or types', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 400,
          error_type: 'private-type',
          error_message: 'private-message',
        }),
        { status: 400 },
      ),
    );
    expect(
      await failureContext(createInstagramLoginClient(config, fetcher).completeLogin('code')),
    ).toEqual({
      errorName: 'InstagramLoginError',
      stage: 'short_token',
      reason: 'http_error',
      httpStatus: '400',
      metaErrorCode: '400',
    });
  });

  it.each(['private-token', -1, 1.5, 2_147_483_648, null, { value: 'private-token' }])(
    'omits invalid Meta error-code values: %j',
    async (code) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code, error_subcode: code, message: 'private-provider-message' },
          }),
          { status: 400 },
        ),
      );
      expect(
        await failureContext(createInstagramLoginClient(config, fetcher).completeLogin('code')),
      ).toEqual({
        errorName: 'InstagramLoginError',
        stage: 'short_token',
        reason: 'http_error',
        httpStatus: '400',
      });
    },
  );

  it.each([0, 1, 2])(
    'distinguishes JSON, timeout, and network failures at stage %s',
    async (stage) => {
      for (const reason of ['invalid_json', 'timeout', 'network_error'] as const) {
        const responses = [json(shortToken), json(longToken), json(profile)];
        const cause =
          reason === 'timeout'
            ? new DOMException('private-url-with-token', 'TimeoutError')
            : new TypeError('private-network-detail');
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
          if (fetcher.mock.calls.length === stage + 1) {
            if (reason === 'invalid_json') return new Response('private-non-json');
            throw cause;
          }
          return responses.shift()!;
        });
        expect(
          await failureContext(
            createInstagramLoginClient(config, fetcher).completeLogin('private-code'),
          ),
        ).toEqual({
          errorName: 'InstagramLoginError',
          stage: stages[stage],
          reason,
          ...(reason === 'invalid_json' ? { httpStatus: '200' } : {}),
        });
        expect(fetcher).toHaveBeenCalledTimes(stage + 1);
      }
    },
  );

  it('retains the HTTP status when reading a response body times out', async () => {
    const response = json(shortToken);
    vi.spyOn(response, 'text').mockRejectedValue(new DOMException('private-url', 'TimeoutError'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    expect(
      await failureContext(createInstagramLoginClient(config, fetcher).completeLogin('code')),
    ).toEqual({
      errorName: 'InstagramLoginError',
      stage: 'short_token',
      reason: 'timeout',
      httpStatus: '200',
    });
  });

  it('preserves the internal cause while excluding it from log context', async () => {
    const cause = new TypeError('private-url');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(cause);
    const operation = createInstagramLoginClient(config, fetcher).completeLogin('code');
    await expect(operation).rejects.toMatchObject({ cause });
    expect(await failureContext(operation)).toEqual({
      errorName: 'InstagramLoginError',
      stage: 'short_token',
      reason: 'network_error',
    });
    expect(new InstagramLoginError().toLogContext()).toEqual({ errorName: 'InstagramLoginError' });
  });
});
