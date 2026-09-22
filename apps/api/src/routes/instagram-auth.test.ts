import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { InstagramAccount, Session } from '../database/repositories.js';
import { createInstagramLoginClient, InstagramLoginError } from '../instagram/login-client.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import type { OAuthStateInput } from '../security/oauth-state.js';
import { createSessionToken, hashSessionToken } from '../security/session-token.js';

const callbackPath = '/api/auth/instagram/callback';
const createFixture = () => {
  const stateRows = new Map<string, OAuthStateInput>();
  const sessions = new Map<string, Session>();
  const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 5).toString('base64'));
  const account: InstagramAccount = {
    id: 'e9e90c93-1843-43d1-91d8-9ef894c26f4f',
    instagramUserId: '17841400000000001',
    username: 'example',
    accessTokenCiphertext: tokenProtector.encrypt('private-instagram-token'),
    tokenExpiresAt: new Date(Date.now() + 5_184_000_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const oauthStateRepository = {
    createState: vi.fn(async (input: OAuthStateInput) => {
      stateRows.set(input.stateHash, input);
    }),
    consumeState: vi.fn(async (stateHash: string, bindingHash: string) => {
      const row = stateRows.get(stateHash);
      if (!row || row.browserBindingHash !== bindingHash || row.expiresAt.getTime() <= Date.now())
        return false;
      return stateRows.delete(stateHash);
    }),
  };
  const sessionRepository = {
    createSession: vi.fn(
      async (input: { accountId: string; tokenHash: string; expiresAt: Date }) => {
        const session = {
          id: 'session-id',
          accountId: input.accountId,
          expiresAt: input.expiresAt,
          createdAt: new Date(),
        };
        sessions.set(input.tokenHash, session);
        return session;
      },
    ),
    deleteByTokenHash: vi.fn(async (hash: string) => sessions.delete(hash)),
    findActiveByTokenHash: vi.fn(async (hash: string) => {
      const session = sessions.get(hash);
      return session && session.expiresAt.getTime() > Date.now() ? { session, account } : null;
    }),
  };
  const accountRepository = {
    upsertConnectedAccount: vi.fn().mockResolvedValue(account),
    findByInstagramUserId: vi.fn(),
  };
  const instagramClient = {
    authorizationUrl: vi.fn(
      (state: string) => `https://www.instagram.com/oauth/authorize?state=${state}`,
    ),
    completeLogin: vi.fn().mockResolvedValue({
      accessToken: 'private-instagram-token',
      instagramUserId: account.instagramUserId,
      username: account.username,
      tokenExpiresAt: account.tokenExpiresAt,
    }),
  };
  const logger = { error: vi.fn(), info: vi.fn() };
  const dependencies = {
    automationRepository: {
      findByAccountId: vi.fn(),
      findEnabledByAccountAndMedia: vi.fn(),
      saveAutomation: vi.fn(),
    },
    database: { checkHealth: vi.fn() },
    logger,
    sessionCookie: { name: 'igauto_session', secure: true, ttlSeconds: 3600 },
    sessionRepository,
    instagramAuth: {
      appBaseUrl: 'https://app.example',
      redirectUri: `https://app.example${callbackPath}`,
      tokenProtector,
      accountRepository,
      oauthStateRepository,
      instagramClient,
    },
    instagramMedia: {
      instagramMediaClient: { listRecentMedia: vi.fn() },
      tokenProtector,
    },
  };
  const app = createApp(dependencies);
  const begin = async () => {
    const response = await app.request('/api/auth/instagram/start');
    const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
    const binding = response.headers
      .get('set-cookie')!
      .match(/igauto_session_oauth=([A-Za-z0-9_-]+)/)![1]!;
    return { response, state, binding, cookie: `igauto_session_oauth=${binding}` };
  };
  const callback = (state: string, cookie?: string, query = '&code=test-code') =>
    app.request(`${callbackPath}?state=${state}${query}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
  return {
    app,
    begin,
    callback,
    dependencies,
    account,
    tokenProtector,
    stateRows,
    sessions,
    sessionRepository,
    accountRepository,
    oauthStateRepository,
    instagramClient,
    logger,
  };
};

describe('Instagram browser login', () => {
  it('stores only state and browser digests and sets a short-lived secure HTTP-only cookie', async () => {
    const f = createFixture();
    const { response, state, binding } = await f.begin();
    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const row = f.stateRows.get(hashSessionToken(state))!;
    expect(row.browserBindingHash).toBe(hashSessionToken(binding));
    expect(state).not.toBe(binding);
    expect(JSON.stringify(row)).not.toContain(state);
    expect(JSON.stringify(row)).not.toContain(binding);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 590_000);
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=600/);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
  });

  it('encrypts Instagram credentials, persists a hashed session, survives reload, and logs out', async () => {
    const f = createFixture();
    const { state, cookie } = await f.begin();
    const response = await f.callback(state, cookie);
    expect(response.headers.get('location')).toBe('https://app.example/app');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const input = f.accountRepository.upsertConnectedAccount.mock.calls[0]![0];
    expect(input.instagramUserId).toBe(f.account.instagramUserId);
    expect(input.accessTokenCiphertext).not.toBe('private-instagram-token');
    expect(f.tokenProtector.decrypt(input.accessTokenCiphertext)).toBe('private-instagram-token');
    const sessionToken = response.headers
      .get('set-cookie')!
      .match(/igauto_session=([A-Za-z0-9_-]+)/)![1]!;
    expect(f.sessions.has(hashSessionToken(sessionToken))).toBe(true);
    expect(f.sessions.has(sessionToken)).toBe(false);
    const headers = { Cookie: `igauto_session=${sessionToken}` };
    for (let i = 0; i < 2; i++) {
      const me = await f.app.request('/api/me', { headers });
      expect(me.status).toBe(200);
      expect(me.headers.get('cache-control')).toBe('no-store');
      await expect(me.json()).resolves.toEqual({
        account: {
          id: f.account.id,
          instagramUserId: f.account.instagramUserId,
          username: f.account.username,
        },
      });
    }
    expect((await f.app.request('/api/auth/logout', { method: 'POST', headers })).status).toBe(204);
    expect((await f.app.request('/api/me', { headers })).status).toBe(401);
    expect(await response.text()).not.toContain('private-instagram-token');
  });

  it.each(['missing_cookie', 'wrong_browser', 'expired', 'missing_state', 'duplicate_state'])(
    'rejects %s before contacting Instagram',
    async (scenario) => {
      const f = createFixture();
      const { state, cookie } = await f.begin();
      if (scenario === 'expired') f.stateRows.get(hashSessionToken(state))!.expiresAt = new Date(0);
      const sentCookie =
        scenario === 'missing_cookie'
          ? undefined
          : scenario === 'wrong_browser'
            ? `igauto_session_oauth=${createSessionToken().token}`
            : cookie;
      const response = await f.callback(
        scenario === 'missing_state' ? '' : state,
        sentCookie,
        scenario === 'duplicate_state' ? `&state=${state}&code=code` : '&code=code',
      );
      expect(response.headers.get('location')).toBe(
        'https://app.example/?login_error=invalid_state',
      );
      expect(f.instagramClient.completeLogin).not.toHaveBeenCalled();
      expect(f.sessionRepository.createSession).not.toHaveBeenCalled();
    },
  );

  it('accepts only one of two concurrent callbacks, including across application instances', async () => {
    const f = createFixture();
    const { state, cookie } = await f.begin();
    const secondInstance = createApp(f.dependencies);
    const results = await Promise.all([
      f.callback(state, cookie),
      secondInstance.request(`${callbackPath}?state=${state}&code=code`, {
        headers: { Cookie: cookie },
      }),
    ]);
    expect(results.map((r) => r.headers.get('location')).sort()).toEqual(
      ['https://app.example/?login_error=invalid_state', 'https://app.example/app'].sort(),
    );
    expect(f.instagramClient.completeLogin).toHaveBeenCalledOnce();
    expect(f.sessionRepository.createSession).toHaveBeenCalledOnce();
  });

  it('consumes state on cancellation without reflecting provider descriptions', async () => {
    const f = createFixture();
    const { state, cookie } = await f.begin();
    const response = await f.callback(
      state,
      cookie,
      '&error=access_denied&error_description=secret',
    );
    expect(response.headers.get('location')).toBe('https://app.example/?login_error=cancelled');
    expect(f.stateRows.size).toBe(0);
    expect(f.instagramClient.completeLogin).not.toHaveBeenCalled();
  });

  it.each(['', '&code=a&code=b'])(
    'rejects missing or duplicated authorization codes',
    async (query) => {
      const f = createFixture();
      const { state, cookie } = await f.begin();
      expect((await f.callback(state, cookie, query)).headers.get('location')).toContain(
        'login_error=unavailable',
      );
      expect(f.instagramClient.completeLogin).not.toHaveBeenCalled();
    },
  );

  it.each(['provider', 'account', 'session', 'state'])(
    'handles %s failure without issuing a session cookie or leaking details',
    async (stage) => {
      const f = createFixture();
      const { state, cookie } = await f.begin();
      const error = new Error('private-instagram-token');
      if (stage === 'provider') f.instagramClient.completeLogin.mockRejectedValueOnce(error);
      if (stage === 'account')
        f.accountRepository.upsertConnectedAccount.mockRejectedValueOnce(error);
      if (stage === 'session') f.sessionRepository.createSession.mockRejectedValueOnce(error);
      if (stage === 'state') f.oauthStateRepository.consumeState.mockRejectedValueOnce(error);
      const response = await f.callback(state, cookie);
      expect(response.headers.get('location')).toBe('https://app.example/?login_error=unavailable');
      expect(response.headers.get('set-cookie')).not.toMatch(/igauto_session=[A-Za-z0-9_-]+/);
      expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain(error.message);
    },
  );

  it('explains declined permissions through an application-owned error code', async () => {
    const f = createFixture();
    const { state, cookie } = await f.begin();
    f.instagramClient.completeLogin.mockRejectedValueOnce(new InstagramLoginError(true));
    expect((await f.callback(state, cookie)).headers.get('location')).toContain(
      'login_error=permissions',
    );
  });

  it('creates a session when Instagram returns granted permissions as an array', async () => {
    const f = createFixture();
    const { state, cookie } = await f.begin();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                access_token: 'short-token',
                permissions: ['instagram_business_basic', 'instagram_business_manage_comments'],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'private-instagram-token', expires_in: 3600 })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user_id: f.account.instagramUserId, username: f.account.username }),
        ),
      );
    const client = createInstagramLoginClient(
      {
        appId: '12345',
        appSecret: 'private-app-secret',
        apiVersion: 'v24.0',
        redirectUri: `https://app.example${callbackPath}`,
      },
      fetcher,
    );
    f.instagramClient.completeLogin.mockImplementation(client.completeLogin);
    const response = await f.callback(state, cookie);
    expect(response.headers.get('location')).toBe('https://app.example/app');
    expect(response.headers.get('set-cookie')).toMatch(/igauto_session=[A-Za-z0-9_-]+/);
    expect(f.accountRepository.upsertConnectedAccount).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        instagramUserId: f.account.instagramUserId,
        username: f.account.username,
      }),
    );
    expect(f.sessionRepository.createSession).toHaveBeenCalledOnce();
    expect(f.logger.error).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('logs a missing permissions field without creating a session or exposing response values', async () => {
    const f = createFixture();
    const { state, cookie } = await f.begin();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'private-instagram-token',
          user_id: 'private-id',
          'private-field': 'private-value',
        }),
      ),
    );
    const client = createInstagramLoginClient(
      {
        appId: '12345',
        appSecret: 'private-app-secret',
        apiVersion: 'v24.0',
        redirectUri: `https://app.example${callbackPath}`,
      },
      fetcher,
    );
    f.instagramClient.completeLogin.mockImplementation(client.completeLogin);
    const response = await f.callback(state, cookie);
    expect(response.headers.get('location')).toBe('https://app.example/?login_error=unavailable');
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith('Instagram login callback failed', {
      errorName: 'InstagramLoginError',
      stage: 'short_token',
      reason: 'invalid_response',
      httpStatus: '200',
      invalidFields: 'permissions',
      invalidFieldTypes: 'permissions:missing',
    });
    expect(f.accountRepository.upsertConnectedAccount).not.toHaveBeenCalled();
    expect(f.sessionRepository.createSession).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).not.toMatch(/igauto_session=[A-Za-z0-9_-]+/);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([0, 1, 2])(
    'logs safe adapter diagnostics at stage %s without leaking into the browser',
    async (stage) => {
      const f = createFixture();
      const { state, cookie, binding } = await f.begin();
      const secret = 'private-instagram-token';
      const responses = [
        new Response(
          JSON.stringify({
            access_token: secret,
            permissions: 'instagram_business_basic,instagram_business_manage_comments',
          }),
        ),
        new Response(JSON.stringify({ access_token: secret, expires_in: 3600 })),
        new Response(
          JSON.stringify({ user_id: '17841400000000001', username: 'private-username' }),
        ),
      ];
      responses[stage] = new Response(
        JSON.stringify({
          error: {
            code: 190,
            error_subcode: 463,
            message: secret,
            type: secret,
            fbtrace_id: secret,
          },
        }),
        { status: 400 },
      );
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
      const app = createApp({
        ...f.dependencies,
        instagramAuth: {
          ...f.dependencies.instagramAuth,
          instagramClient: createInstagramLoginClient(
            {
              appId: '12345',
              appSecret: 'private-app-secret',
              apiVersion: 'v24.0',
              redirectUri: `https://app.example${callbackPath}`,
            },
            fetcher,
          ),
        },
      });
      const response = await app.request(`${callbackPath}?state=${state}&code=private-auth-code`, {
        headers: { Cookie: cookie },
      });
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith('Instagram login callback failed', {
        errorName: 'InstagramLoginError',
        stage: ['short_token', 'long_token', 'profile'][stage],
        reason: 'http_error',
        httpStatus: '400',
        metaErrorCode: '190',
        metaErrorSubcode: '463',
      });
      expect(response.headers.get('location')).toBe('https://app.example/?login_error=unavailable');
      expect(response.headers.get('set-cookie')).not.toMatch(/igauto_session=[A-Za-z0-9_-]+/);
      expect(f.accountRepository.upsertConnectedAccount).not.toHaveBeenCalled();
      expect(f.sessionRepository.createSession).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(stage + 1);
      const visible =
        JSON.stringify(f.logger.error.mock.calls) +
        JSON.stringify([...response.headers]) +
        (await response.text());
      for (const value of [
        secret,
        'private-app-secret',
        'private-auth-code',
        'private-username',
        state,
        binding,
      ]) {
        expect(visible).not.toContain(value);
      }
    },
  );

  it('rotates an existing session and rejects expired sessions', async () => {
    const f = createFixture();
    const previous = createSessionToken();
    await f.sessionRepository.createSession({
      accountId: f.account.id,
      tokenHash: previous.tokenHash,
      expiresAt: new Date(0),
    });
    expect(
      (await f.app.request('/api/me', { headers: { Cookie: `igauto_session=${previous.token}` } }))
        .status,
    ).toBe(401);
    const { state, cookie } = await f.begin();
    await f.callback(state, `${cookie}; igauto_session=${previous.token}`);
    expect(f.sessionRepository.deleteByTokenHash).toHaveBeenCalledWith(previous.tokenHash);
    expect(f.sessions.has(previous.tokenHash)).toBe(false);
  });

  it('returns 401 for anonymous me and sanitizes lookup failures', async () => {
    const f = createFixture();
    expect((await f.app.request('/api/me')).status).toBe(401);
    f.sessionRepository.findActiveByTokenHash.mockRejectedValueOnce(new Error('private-detail'));
    const response = await f.app.request('/api/me', {
      headers: { Cookie: `igauto_session=${createSessionToken().token}` },
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('private-detail');
  });

  it('refuses mixed local/production origins before saving state', async () => {
    const f = createFixture();
    f.dependencies.instagramAuth.appBaseUrl = 'http://localhost:5173';
    const response = await createApp(f.dependencies).request('/api/auth/instagram/start');
    expect(response.headers.get('location')).toBe(
      'http://localhost:5173/?login_error=configuration',
    );
    expect(f.oauthStateRepository.createState).not.toHaveBeenCalled();
  });

  it('redirects safely when the state database is unavailable', async () => {
    const f = createFixture();
    f.oauthStateRepository.createState.mockRejectedValueOnce(new Error('secret-detail'));
    const response = await f.app.request('/api/auth/instagram/start');
    expect(response.headers.get('location')).toContain('login_error=unavailable');
    expect(f.instagramClient.authorizationUrl).not.toHaveBeenCalled();
  });
});
