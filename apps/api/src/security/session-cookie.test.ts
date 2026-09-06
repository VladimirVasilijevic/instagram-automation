import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createSessionToken } from './session-token.js';
import {
  clearSessionCookie,
  getSessionCookie,
  setSessionCookie,
  type SessionCookieConfig,
} from './session-cookie.js';

const developmentConfig: SessionCookieConfig = {
  name: 'igauto_session',
  secure: false,
  ttlSeconds: 604800,
};

describe('session cookie', () => {
  it('writes an HTTP-only same-site cookie with the configured lifetime', async () => {
    const app = new Hono();
    const token = createSessionToken().token;

    app.get('/set', (context) => {
      setSessionCookie(context, developmentConfig, token);

      return context.body(null, 204);
    });

    const response = await app.request('/set');
    const setCookie = response.headers.get('set-cookie');

    expect(setCookie).toContain(`igauto_session=${token}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Max-Age=604800');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('Secure');
  });

  it('adds the secure attribute in production mode', async () => {
    const app = new Hono();

    app.get('/set', (context) => {
      setSessionCookie(context, { ...developmentConfig, secure: true }, createSessionToken().token);

      return context.body(null, 204);
    });

    const response = await app.request('/set');

    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('reads the configured cookie without selecting unrelated cookies', async () => {
    const app = new Hono();

    app.get('/read', (context) =>
      context.json({ token: getSessionCookie(context, developmentConfig) ?? null }),
    );

    const response = await app.request('/read', {
      headers: { Cookie: 'unrelated=value; igauto_session=expected-token' },
    });

    await expect(response.json()).resolves.toEqual({ token: 'expected-token' });
  });

  it('clears the cookie with matching security attributes', async () => {
    const app = new Hono();

    app.get('/clear', (context) => {
      clearSessionCookie(context, { ...developmentConfig, secure: true });

      return context.body(null, 204);
    });

    const response = await app.request('/clear', {
      headers: { Cookie: 'igauto_session=old-token' },
    });
    const setCookie = response.headers.get('set-cookie');

    expect(setCookie).toContain('igauto_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
  });
});
