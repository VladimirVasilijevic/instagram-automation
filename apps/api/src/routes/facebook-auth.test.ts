import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';

import type {
  CreatePendingPageSelectionInput,
  SocialConnection,
  User,
} from '../database/identity-repositories.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import type { OAuthStateInput } from '../security/oauth-state.js';
import { createSessionToken } from '../security/session-token.js';
import { registerFacebookAuthRoutes } from './facebook-auth.js';

const callbackPath = '/api/auth/facebook/callback';
const userOne: User = {
  id: 'f756e1ae-2097-42c8-a410-7ca11ef89117',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};
const userTwo: User = {
  id: 'bb591bbc-5580-4210-b56a-45c1eb514eff',
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
};
const selectionId = '2eab84b2-d4bd-4a5d-861f-f15b541f3f90';

const createFixture = () => {
  const app = new OpenAPIHono();
  const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 7).toString('base64'));
  const oauthStates = new Map<string, OAuthStateInput>();
  const activeSessions = new Map<string, { user: User; connection: SocialConnection | null }>();
  const pendingSelections = new Map<
    string,
    { userId: string; pages: { id: string; name: string }[] }
  >();
  const currentConnection = new Map<string, SocialConnection | null>();
  const sessionRepository = {
    createSession: vi.fn(
      async (input: { userId?: string; accountId?: string; expiresAt: Date }) => ({
        id: 'session-new',
        userId: input.userId ?? userOne.id,
        accountId: input.accountId ?? null,
        expiresAt: input.expiresAt,
        createdAt: new Date(),
      }),
    ),
    deleteByTokenHash: vi.fn(async () => true),
    findActiveByTokenHash: vi.fn(async (hash: string) => {
      const found = activeSessions.get(hash);
      return found
        ? {
            user: found.user,
            connection: found.connection,
            account: null,
            session: {
              id: 'session-existing',
              userId: found.user.id,
              accountId: null,
              expiresAt: new Date(Date.now() + 60_000),
              createdAt: new Date(),
            },
          }
        : null;
    }),
  };
  const oauthStateRepository = {
    createState: vi.fn(async (input: OAuthStateInput) => {
      oauthStates.set(input.stateHash, input);
    }),
    consumeState: vi.fn(async () => false),
    consumeStateDetails: vi.fn(async (stateHash: string, bindingHash: string) => {
      const row = oauthStates.get(stateHash);
      if (!row || row.browserBindingHash !== bindingHash || row.expiresAt.getTime() <= Date.now())
        return null;
      oauthStates.delete(stateHash);
      return {
        provider: row.provider ?? ('instagram' as const),
        intent: row.intent ?? ('sign_in' as const),
        intendedUserId: row.intendedUserId ?? null,
      };
    }),
  };
  const identityRepository = {
    completeSignIn: vi.fn(async () => userOne),
    completeInstagramLogin: vi.fn(),
  };
  const facebookLoginClient = {
    authorizationUrl: vi.fn(
      (state: string, intent: string) =>
        `https://www.facebook.com/v24.0/dialog/oauth?state=${state}&intent=${intent}`,
    ),
    completeLogin: vi.fn(async () => ({
      facebookUserId: 'facebook-person-1',
      displayName: 'Example Owner',
      accessToken: 'private-user-token',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    })),
  };
  const facebookPageClient = {
    listManagedPages: vi.fn(async () => [
      {
        id: 'page-1',
        name: 'Example Page',
        accessToken: 'private-page-token',
        tasks: ['MODERATE'],
      },
    ]),
  };
  const socialConnectionRepository = {
    connectFacebookPage: vi.fn(),
    createPendingPageSelection: vi.fn(async (input: CreatePendingPageSelectionInput) => {
      pendingSelections.set(selectionId, {
        userId: input.userId,
        pages: input.pages.map(({ id, name }) => ({ id, name })),
      });
      return { selectionId, pages: pendingSelections.get(selectionId)!.pages };
    }),
    getPendingPageSelection: vi.fn(async (input: { userId: string; selectionId: string }) => {
      const pending = pendingSelections.get(input.selectionId);
      return pending?.userId === input.userId
        ? { selectionId: input.selectionId, pages: pending.pages }
        : null;
    }),
    consumeSelectedPage: vi.fn(
      async (input: { userId: string; selectionId: string; pageId: string }) => {
        const pending = pendingSelections.get(input.selectionId);
        const page = pending?.pages.find(({ id }) => id === input.pageId);
        if (!pending || pending.userId !== input.userId || !page) return null;
        pendingSelections.delete(input.selectionId);
        return {
          id: 'connection-1',
          userId: input.userId,
          provider: 'facebook' as const,
          externalAccountId: page.id,
          displayName: page.name,
          connectionStatus: 'active' as const,
        };
      },
    ),
    findFirstByUserId: vi.fn(async (userId: string) => currentConnection.get(userId) ?? null),
    findFacebookPageByPageId: vi.fn(),
    markReconnectRequired: vi.fn(async () => true),
  };
  const logger = { error: vi.fn(), info: vi.fn() };
  registerFacebookAuthRoutes(app, {
    appBaseUrl: 'https://app.example',
    identityRepository,
    facebookLoginClient,
    facebookPageClient,
    socialConnectionRepository,
    oauthStateRepository,
    sessionRepository,
    sessionCookie: { name: 'replykit_session', secure: true, ttlSeconds: 3_600 },
    tokenProtector,
    logger,
  });

  const existingSession = (user: User, connection: SocialConnection | null = null) => {
    const token = createSessionToken();
    activeSessions.set(token.tokenHash, { user, connection });
    currentConnection.set(user.id, connection);
    return `replykit_session=${token.token}`;
  };
  const start = async (path: string, sessionCookie?: string) => {
    const response = await app.request(path, {
      headers: sessionCookie ? { Cookie: sessionCookie } : {},
    });
    const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
    const binding = response.headers
      .get('set-cookie')!
      .match(/replykit_session_facebook_oauth=([A-Za-z0-9_-]+)/)![1]!;
    return { response, state, oauthCookie: `replykit_session_facebook_oauth=${binding}` };
  };
  const callback = (state: string, oauthCookie: string, sessionCookie?: string) =>
    app.request(`${callbackPath}?state=${state}&code=one-time-code`, {
      headers: { Cookie: [oauthCookie, sessionCookie].filter(Boolean).join('; ') },
    });
  return {
    app,
    tokenProtector,
    oauthStateRepository,
    identityRepository,
    facebookLoginClient,
    facebookPageClient,
    socialConnectionRepository,
    sessionRepository,
    logger,
    existingSession,
    start,
    callback,
  };
};

describe('Facebook auth routes', () => {
  it('signs in a new Facebook user without connecting a Page', async () => {
    const f = createFixture();
    const { state, oauthCookie } = await f.start('/api/auth/facebook/start');
    const response = await f.callback(state, oauthCookie);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://app.example/app');
    expect(f.identityRepository.completeSignIn).toHaveBeenCalledWith({
      provider: 'facebook',
      externalUserId: 'facebook-person-1',
      displayName: 'Example Owner',
      intendedUserId: null,
    });
    expect(f.sessionRepository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: userOne.id }),
    );
    expect(f.socialConnectionRepository.consumeSelectedPage).not.toHaveBeenCalled();
    expect(JSON.stringify(response.headers)).not.toContain('private-user-token');
  });

  it('links Facebook identity only to the signed-in user and rotates the session', async () => {
    const f = createFixture();
    const sessionCookie = f.existingSession(userOne);
    const { state, oauthCookie } = await f.start('/api/auth/facebook/start', sessionCookie);
    const response = await f.callback(state, oauthCookie, sessionCookie);
    expect(response.status).toBe(302);
    expect(f.identityRepository.completeSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ intendedUserId: userOne.id }),
    );
    expect(f.sessionRepository.deleteByTokenHash).toHaveBeenCalledOnce();
  });

  it('rejects linking when the session changed during OAuth', async () => {
    const f = createFixture();
    const firstCookie = f.existingSession(userOne);
    const secondCookie = f.existingSession(userTwo);
    const { state, oauthCookie } = await f.start('/api/auth/facebook/start', firstCookie);
    const response = await f.callback(state, oauthCookie, secondCookie);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('invalid_session');
    expect(f.facebookLoginClient.completeLogin).not.toHaveBeenCalled();
    expect(f.identityRepository.completeSignIn).not.toHaveBeenCalled();
  });

  it('keeps Page tokens server-side and enforces owned one-time Page selection', async () => {
    const f = createFixture();
    const ownerCookie = f.existingSession(userOne);
    const otherCookie = f.existingSession(userTwo);
    const { state, oauthCookie } = await f.start('/api/connections/facebook/start', ownerCookie);
    const callback = await f.callback(state, oauthCookie, ownerCookie);
    const location = callback.headers.get('location')!;
    expect(location).toBe(`https://app.example/app?facebook_selection=${selectionId}`);
    expect(location).not.toContain('private-page-token');
    expect(f.facebookPageClient.listManagedPages).toHaveBeenCalledWith('private-user-token');
    const saved = f.socialConnectionRepository.createPendingPageSelection.mock.calls[0]?.[0];
    expect(saved?.pages[0]?.accessTokenCiphertext).not.toBe('private-page-token');
    expect(f.tokenProtector.decrypt(saved!.pages[0]!.accessTokenCiphertext)).toBe(
      'private-page-token',
    );

    const otherView = await f.app.request(
      `/api/connections/facebook/pending?selectionId=${selectionId}`,
      {
        headers: { Cookie: otherCookie },
      },
    );
    expect(otherView.status).toBe(404);
    const ownerView = await f.app.request(
      `/api/connections/facebook/pending?selectionId=${selectionId}`,
      {
        headers: { Cookie: ownerCookie },
      },
    );
    expect(ownerView.status).toBe(200);
    expect(await ownerView.json()).toEqual({ pages: [{ id: 'page-1', name: 'Example Page' }] });

    const select = () =>
      f.app.request('/api/connections/facebook/select', {
        method: 'POST',
        headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectionId, pageId: 'page-1' }),
      });
    expect((await select()).status).toBe(204);
    expect((await select()).status).toBe(400);
    expect(f.socialConnectionRepository.consumeSelectedPage).toHaveBeenCalledWith({
      userId: userOne.id,
      selectionId,
      pageId: 'page-1',
    });
  });

  it('allows an existing Facebook Page to be reauthorized', async () => {
    const f = createFixture();
    const sessionCookie = f.existingSession(userOne, {
      id: 'connection-1',
      userId: userOne.id,
      provider: 'facebook',
      externalAccountId: 'page-1',
      displayName: 'Example Page',
      connectionStatus: 'reconnect_required',
    });
    const response = await f.start('/api/connections/facebook/start', sessionCookie);
    expect(response.response.status).toBe(302);
    expect(f.facebookLoginClient.authorizationUrl).toHaveBeenCalledWith(
      expect.any(String),
      'connect_page',
    );
  });
});
