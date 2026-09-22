import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { AccountRepository, SessionRepository } from '../database/repositories.js';
import { InstagramLoginError, type InstagramLoginClient } from '../instagram/login-client.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  clearOAuthCookie,
  getOAuthCookie,
  oauthStateTtlSeconds,
  setOAuthCookie,
  type OAuthStateRepository,
} from '../security/oauth-state.js';
import {
  getSessionCookie,
  setSessionCookie,
  type SessionCookieConfig,
} from '../security/session-cookie.js';
import { createSessionToken, hashSessionToken, isSessionToken } from '../security/session-token.js';
import type { TokenProtector } from '../security/token-protector.js';

/** Dependencies for the Instagram OAuth start and callback routes. */
export interface InstagramAuthDependencies {
  /** Trusted frontend origin for fixed redirects; never read from user-controlled query values. */
  appBaseUrl: string;
  /** Registered callback URL; must share the browser's application origin. */
  redirectUri: string;
  /** Provider authorization and identity operations. */
  instagramClient: InstagramLoginClient;
  /** Connected account persistence. */
  accountRepository: AccountRepository;
  /** Single-use OAuth attempt persistence. */
  oauthStateRepository: OAuthStateRepository;
  /** Session persistence used for credential creation and rotation. */
  sessionRepository: SessionRepository;
  /** Browser cookie policy. */
  sessionCookie: SessionCookieConfig;
  /** Encryption capability applied before account persistence. */
  tokenProtector: TokenProtector;
  /** Logger receiving sanitized errors only. */
  logger: Logger;
}

const startRoute = createRoute({
  method: 'get',
  path: '/api/auth/instagram/start',
  tags: ['Authentication'],
  summary: 'Start Instagram login',
  responses: { 302: { description: 'Redirect to Instagram or a safe login error page.' } },
});
const callbackRoute = createRoute({
  method: 'get',
  path: '/api/auth/instagram/callback',
  tags: ['Authentication'],
  summary: 'Complete Instagram login',
  description:
    'Consumes browser-bound state before exchanging the authorization code. Never returns Instagram tokens.',
  responses: { 302: { description: 'Redirect to the account screen or a safe login error page.' } },
});

/** Registers browser-bound OAuth with fixed redirects and encrypted token persistence. */
export const registerInstagramAuthRoutes = (
  app: OpenAPIHono,
  dependencies: InstagramAuthDependencies,
): void => {
  const fail = (
    context: Context,
    reason: 'invalid_state' | 'cancelled' | 'permissions' | 'unavailable' | 'configuration',
  ) => {
    const url = new URL('/', dependencies.appBaseUrl);
    url.searchParams.set('login_error', reason);
    return context.redirect(url.toString(), 302);
  };

  app.openapi(startRoute, async (context) => {
    clearOAuthCookie(context, dependencies.sessionCookie);
    if (new URL(dependencies.appBaseUrl).origin !== new URL(dependencies.redirectUri).origin) {
      return fail(context, 'configuration');
    }
    try {
      const state = createSessionToken();
      const browserBinding = createSessionToken();
      await dependencies.oauthStateRepository.createState({
        stateHash: state.tokenHash,
        browserBindingHash: browserBinding.tokenHash,
        expiresAt: new Date(Date.now() + oauthStateTtlSeconds * 1000),
      });
      setOAuthCookie(context, dependencies.sessionCookie, browserBinding.token);
      return context.redirect(dependencies.instagramClient.authorizationUrl(state.token), 302);
    } catch (error) {
      dependencies.logger.error('Instagram login start failed', toSafeErrorContext(error));
      return fail(context, 'unavailable');
    }
  });

  app.openapi(callbackRoute, async (context) => {
    const binding = getOAuthCookie(context, dependencies.sessionCookie);
    clearOAuthCookie(context, dependencies.sessionCookie);
    const states = context.req.queries('state') ?? [];
    const state = states[0];
    if (
      states.length !== 1 ||
      !state ||
      !isSessionToken(state) ||
      !binding ||
      !isSessionToken(binding)
    ) {
      return fail(context, 'invalid_state');
    }
    try {
      const accepted = await dependencies.oauthStateRepository.consumeState(
        hashSessionToken(state),
        hashSessionToken(binding),
      );
      if (!accepted) return fail(context, 'invalid_state');
      const errors = context.req.queries('error') ?? [];
      if (errors.length)
        return fail(
          context,
          errors.length === 1 && errors[0] === 'access_denied' ? 'cancelled' : 'unavailable',
        );
      const codes = context.req.queries('code') ?? [];
      const code = codes[0];
      if (codes.length !== 1 || !code || code.length > 4096) return fail(context, 'unavailable');

      const connection = await dependencies.instagramClient.completeLogin(code);
      const account = await dependencies.accountRepository.upsertConnectedAccount({
        instagramUserId: connection.instagramUserId,
        username: connection.username,
        accessTokenCiphertext: dependencies.tokenProtector.encrypt(connection.accessToken),
        tokenExpiresAt: connection.tokenExpiresAt,
      });
      const previousToken = getSessionCookie(context, dependencies.sessionCookie);
      if (previousToken && isSessionToken(previousToken)) {
        await dependencies.sessionRepository.deleteByTokenHash(hashSessionToken(previousToken));
      }
      const sessionToken = createSessionToken();
      await dependencies.sessionRepository.createSession({
        accountId: account.id,
        tokenHash: sessionToken.tokenHash,
        expiresAt: new Date(Date.now() + dependencies.sessionCookie.ttlSeconds * 1000),
      });
      setSessionCookie(context, dependencies.sessionCookie, sessionToken.token);
      return context.redirect(new URL('/app', dependencies.appBaseUrl).toString(), 302);
    } catch (error) {
      dependencies.logger.error(
        'Instagram login callback failed',
        error instanceof InstagramLoginError ? error.toLogContext() : toSafeErrorContext(error),
      );
      return fail(
        context,
        error instanceof InstagramLoginError && error.permissionsMissing
          ? 'permissions'
          : 'unavailable',
      );
    }
  });
};
