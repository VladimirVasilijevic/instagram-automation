import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';

import type { SessionRepository } from '../database/repositories.js';
import type { Logger } from '../logging/logger.js';
import type { SessionCookieConfig } from '../security/session-cookie.js';
import { createSessionToken } from '../security/session-token.js';
import { registerAuthRoutes } from './auth.js';

const sessionCookie: SessionCookieConfig = {
  name: 'igauto_session',
  secure: false,
  ttlSeconds: 604800,
};

const createLogger = (): Logger => ({
  error: vi.fn(),
  info: vi.fn(),
});

const createAuthApp = (
  deleteByTokenHash: SessionRepository['deleteByTokenHash'],
  logger: Logger = createLogger(),
): OpenAPIHono => {
  const app = new OpenAPIHono();

  registerAuthRoutes(app, {
    logger,
    sessionCookie,
    sessionRepository: { deleteByTokenHash },
  });

  return app;
};

describe('authentication routes', () => {
  it('clears a missing session cookie without querying storage', async () => {
    const deleteByTokenHash = vi.fn();
    const response = await createAuthApp(deleteByTokenHash).request('/api/auth/logout', {
      method: 'POST',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(deleteByTokenHash).not.toHaveBeenCalled();
  });

  it('clears a malformed session cookie without querying storage', async () => {
    const deleteByTokenHash = vi.fn();
    const response = await createAuthApp(deleteByTokenHash).request('/api/auth/logout', {
      headers: { Cookie: 'igauto_session=malformed-token' },
      method: 'POST',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(deleteByTokenHash).not.toHaveBeenCalled();
  });

  it('hashes and revokes a valid session before clearing its cookie', async () => {
    const sessionToken = createSessionToken();
    const deleteByTokenHash = vi.fn().mockResolvedValue(true);
    const response = await createAuthApp(deleteByTokenHash).request('/api/auth/logout', {
      headers: { Cookie: `igauto_session=${sessionToken.token}` },
      method: 'POST',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(deleteByTokenHash).toHaveBeenCalledWith(sessionToken.tokenHash);
    expect(deleteByTokenHash).not.toHaveBeenCalledWith(sessionToken.token);
  });

  it('is idempotent when a valid credential has already been revoked', async () => {
    const sessionToken = createSessionToken();
    const deleteByTokenHash = vi.fn().mockResolvedValue(false);
    const response = await createAuthApp(deleteByTokenHash).request('/api/auth/logout', {
      headers: { Cookie: `igauto_session=${sessionToken.token}` },
      method: 'POST',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('retains the cookie and returns a sanitized response when storage fails', async () => {
    const sessionToken = createSessionToken();
    const deleteByTokenHash = vi.fn().mockRejectedValue(new Error('secret database detail'));
    const logger = createLogger();
    const response = await createAuthApp(deleteByTokenHash, logger).request('/api/auth/logout', {
      headers: { Cookie: `igauto_session=${sessionToken.token}` },
      method: 'POST',
    });
    const responseBody = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(JSON.parse(responseBody)).toEqual({
      error: {
        code: 'SESSION_STORE_UNAVAILABLE',
        message: 'Logout could not be completed',
      },
    });
    expect(responseBody).not.toContain('secret database detail');
    expect(responseBody).not.toContain(sessionToken.token);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'secret database detail',
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(sessionToken.token);
  });
});
