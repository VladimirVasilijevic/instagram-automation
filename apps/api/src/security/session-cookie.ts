import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

/** Browser-cookie settings shared by session creation, authentication, and logout. */
export interface SessionCookieConfig {
  /** Name of the cookie carrying the opaque session credential. */
  name: string;

  /** Whether browsers may send the cookie only over HTTPS. */
  secure: boolean;

  /** Cookie lifetime in seconds, matching the server-side session lifetime. */
  ttlSeconds: number;
}

/**
 * Reads the untrusted session credential supplied by the browser.
 *
 * @param context - Current Hono request context.
 * @param config - Configured session-cookie name and attributes.
 * @returns The cookie value, or `undefined` when it was not supplied.
 */
export const getSessionCookie = (
  context: Context,
  config: SessionCookieConfig,
): string | undefined => getCookie(context, config.name);

/**
 * Writes an opaque session credential using the application's security attributes.
 *
 * @param context - Current Hono request context.
 * @param config - Configured session-cookie name, lifetime, and environment security mode.
 * @param token - Newly generated raw session credential returned only to the browser.
 */
export const setSessionCookie = (
  context: Context,
  config: SessionCookieConfig,
  token: string,
): void => {
  setCookie(context, config.name, token, {
    httpOnly: true,
    maxAge: config.ttlSeconds,
    path: '/',
    sameSite: 'Lax',
    secure: config.secure,
  });
};

/**
 * Expires the browser session cookie using attributes matching session creation.
 *
 * @param context - Current Hono request context.
 * @param config - Configured session-cookie name and environment security mode.
 */
export const clearSessionCookie = (context: Context, config: SessionCookieConfig): void => {
  deleteCookie(context, config.name, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: config.secure,
  });
};
