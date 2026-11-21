import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';

import type { SessionCookieConfig } from './session-cookie.js';
import type { SessionTokenHash } from './session-token.js';
import type { SocialProvider } from '@instagram-automation/contracts';

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
  /** Social provider owning this authorization attempt. */
  provider?: SocialProvider;
  /** Whether this attempt signs in or connects a Facebook Page. */
  intent?: 'sign_in' | 'connect_page';
  /** Existing user who started an identity-link or Page-connection attempt. */
  intendedUserId?: string | null;
}

/** Provider and owner bound to a consumed OAuth attempt. */
export interface ConsumedOAuthState {
  /** Provider that issued the callback. */
  provider: SocialProvider;
  /** Authorized purpose of the attempt. */
  intent: 'sign_in' | 'connect_page';
  /** User who initiated a link or Page connection, if any. */
  intendedUserId: string | null;
}

/** Shared persistence for single-use OAuth state across serverless instances. */
export interface OAuthStateRepository {
  /** Saves an authorization attempt and removes expired attempts. */
  createState(input: OAuthStateInput): Promise<void>;
  /** Atomically deletes and accepts a matching unexpired attempt at most once. */
  consumeState(stateHash: SessionTokenHash, browserBindingHash: SessionTokenHash): Promise<boolean>;
  /** Atomically consumes an attempt and returns its provider and owner binding. */
  consumeStateDetails(
    stateHash: SessionTokenHash,
    browserBindingHash: SessionTokenHash,
  ): Promise<ConsumedOAuthState | null>;
}

const cookieName = (config: SessionCookieConfig, provider: SocialProvider): string =>
  provider === 'instagram' ? `${config.name}_oauth` : `${config.name}_${provider}_oauth`;
const cookieOptions = (config: SessionCookieConfig, provider: SocialProvider) => ({
  httpOnly: true,
  path: `/api/auth/${provider}`,
  sameSite: 'Lax' as const,
  secure: config.secure,
});

/** Sets the short-lived credential binding a login attempt to its initiating browser. */
export const setOAuthCookie = (
  context: Context,
  config: SessionCookieConfig,
  token: string,
  provider: SocialProvider = 'instagram',
): void => {
  setCookie(context, cookieName(config, provider), token, {
    ...cookieOptions(config, provider),
    maxAge: oauthStateTtlSeconds,
  });
};

/** Reads the untrusted browser binding credential. */
export const getOAuthCookie = (
  context: Context,
  config: SessionCookieConfig,
  provider: SocialProvider = 'instagram',
): string | undefined => getCookie(context, cookieName(config, provider));

/** Expires the browser binding cookie when an authorization attempt finishes. */
export const clearOAuthCookie = (
  context: Context,
  config: SessionCookieConfig,
  provider: SocialProvider = 'instagram',
): void => {
  deleteCookie(context, cookieName(config, provider), cookieOptions(config, provider));
};
