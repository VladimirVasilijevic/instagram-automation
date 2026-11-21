import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedSession, SessionRepository } from '../database/repositories.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import type { SessionCookieConfig } from '../security/session-cookie.js';
import { createSessionToken } from '../security/session-token.js';
import { createRequireSessionMiddleware } from './session.js';

const sessionCookie: SessionCookieConfig = {
  name: 'igauto_session',
  secure: false,
  ttlSeconds: 604800,
};

const createAuthenticatedSession = (): AuthenticatedSession => {
  const now = new Date();

  return {
    user: { id: 'user-id', createdAt: now },
    connection: {
      id: 'account-id',
      userId: 'user-id',
      provider: 'instagram',
      externalAccountId: 'instagram-user-id',
      displayName: 'session_owner',
      connectionStatus: 'active',
    },
    account: {
      accessTokenCiphertext: new AesGcmTokenProtector(
        Buffer.alloc(32, 5).toString('base64'),
      ).encrypt('protected-provider-token'),
      connectionStatus: 'active',
      createdAt: now,
      id: 'account-id',
      instagramUserId: 'instagram-user-id',
      tokenExpiresAt: new Date(now.getTime() + 86_400_000),
      tokenRefreshFailureCode: null,
      tokenRefreshLastSucceededAt: null,
      tokenRefreshNextAttemptAt: null,
      updatedAt: now,
      username: 'session_owner',
    },
    session: {
      userId: 'user-id',
      accountId: 'account-id',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      id: 'session-id',
    },
  };
};

const createProtectedApp = (
  findActiveByTokenHash: SessionRepository['findActiveByTokenHash'],
): Hono => {
  const app = new Hono();

  app.use(
    '/protected',
    createRequireSessionMiddleware({
      sessionCookie,
      sessionRepository: { findActiveByTokenHash },
    }),
  );
  app.get('/protected', (context) =>
    context.json({
      userId: context.get('authenticatedSession').user.id,
      username: context.get('authenticatedSession').account?.username ?? null,
    }),
  );

  return app;
};

describe('required session middleware', () => {
  it('rejects a missing cookie without querying session storage', async () => {
    const findActiveByTokenHash = vi.fn();
    const response = await createProtectedApp(findActiveByTokenHash).request('/protected');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication is required' },
    });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(findActiveByTokenHash).not.toHaveBeenCalled();
  });

  it('rejects and clears a malformed credential before querying session storage', async () => {
    const findActiveByTokenHash = vi.fn();
    const response = await createProtectedApp(findActiveByTokenHash).request('/protected', {
      headers: { Cookie: 'igauto_session=malformed-token' },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(findActiveByTokenHash).not.toHaveBeenCalled();
  });

  it('hashes a valid credential and attaches its active session', async () => {
    const sessionToken = createSessionToken();
    const authenticatedSession = createAuthenticatedSession();
    const findActiveByTokenHash = vi.fn().mockResolvedValue(authenticatedSession);
    const response = await createProtectedApp(findActiveByTokenHash).request('/protected', {
      headers: { Cookie: `igauto_session=${sessionToken.token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: 'user-id',
      username: 'session_owner',
    });
    expect(findActiveByTokenHash).toHaveBeenCalledWith(sessionToken.tokenHash);
    expect(findActiveByTokenHash).not.toHaveBeenCalledWith(sessionToken.token);
  });

  it('authenticates a Facebook user without a connected account', async () => {
    const sessionToken = createSessionToken();
    const authenticatedSession = {
      ...createAuthenticatedSession(),
      account: null,
      connection: null,
    };
    const findActiveByTokenHash = vi.fn().mockResolvedValue(authenticatedSession);
    const response = await createProtectedApp(findActiveByTokenHash).request('/protected', {
      headers: { Cookie: `igauto_session=${sessionToken.token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ userId: 'user-id', username: null });
  });

  it('rejects and clears an unknown or expired session', async () => {
    const sessionToken = createSessionToken();
    const findActiveByTokenHash = vi.fn().mockResolvedValue(null);
    const response = await createProtectedApp(findActiveByTokenHash).request('/protected', {
      headers: { Cookie: `igauto_session=${sessionToken.token}` },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(findActiveByTokenHash).toHaveBeenCalledWith(sessionToken.tokenHash);
  });
});
