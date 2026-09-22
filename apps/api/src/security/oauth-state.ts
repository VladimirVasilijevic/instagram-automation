import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';

import type { SessionCookieConfig } from './session-cookie.js';
import type { SessionTokenHash } from './session-token.js';

/** Time allowed to finish an Instagram authorization attempt. */
export const oauthStateTtlSeconds = 600;

/** Hashed, browser-bound authorization attempt persisted without raw credentials. */
export interface OAuthStateInput {
  /** Digest of the random state sent to Instagram. */
  stateHash: SessionTokenHash;
  /** Digest of an independent random credential kept in an HTTP-only browser cookie. */
  browserBindingHash: SessionTokenHash;
  /** Deadline enforced by the database when consuming the attempt. */
  expiresAt: Date;
}

/** Shared persistence for single-use OAuth state across serverless instances. */
export interface OAuthStateRepository {
  /** Saves an authorization attempt and removes expired attempts. */
  createState(input: OAuthStateInput): Promise<void>;
  /** Atomically deletes and accepts a matching unexpired attempt at most once. */
  consumeState(stateHash: SessionTokenHash, browserBindingHash: SessionTokenHash): Promise<boolean>;
}

const cookieName = (config: SessionCookieConfig): string => `${config.name}_oauth`;
const cookieOptions = (config: SessionCookieConfig) => ({
  httpOnly: true,
  path: '/api/auth/instagram',
  sameSite: 'Lax' as const,
  secure: config.secure,
});

/** Sets the short-lived credential binding a login attempt to its initiating browser. */
export const setOAuthCookie = (
  context: Context,
  config: SessionCookieConfig,
  token: string,
): void => {
  setCookie(context, cookieName(config), token, {
    ...cookieOptions(config),
    maxAge: oauthStateTtlSeconds,
  });
};

/** Reads the untrusted browser binding credential. */
export const getOAuthCookie = (context: Context, config: SessionCookieConfig): string | undefined =>
  getCookie(context, cookieName(config));

/** Expires the browser binding cookie when an authorization attempt finishes. */
export const clearOAuthCookie = (context: Context, config: SessionCookieConfig): void => {
  deleteCookie(context, cookieName(config), cookieOptions(config));
};
