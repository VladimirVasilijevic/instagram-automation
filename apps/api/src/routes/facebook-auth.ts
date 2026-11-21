import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type {
  IdentityRepository,
  SocialConnectionRepository,
} from '../database/identity-repositories.js';
import { ConnectionLimitError, IdentityOwnershipError } from '../database/identity-repositories.js';
import type { SessionRepository } from '../database/repositories.js';
import type { FacebookLoginClient } from '../facebook/login-client.js';
import { hasFacebookCommentTask, type FacebookPageClient } from '../facebook/page-client.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import { createRequireSessionMiddleware } from '../middleware/session.js';
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

/** Dependencies for Facebook sign-in and explicit Page connection. */
export interface FacebookAuthRouteDependencies {
  /** Fixed browser origin for callbacks and safe redirects. */
  appBaseUrl: string;
  /** Verified Facebook identity persistence. */
  identityRepository: IdentityRepository;
  /** Facebook Login OAuth adapter. */
  facebookLoginClient: FacebookLoginClient;
  /** Page discovery adapter. */
  facebookPageClient: Pick<FacebookPageClient, 'listManagedPages'>;
  /** Social connection and short-lived Page choice persistence. */
  socialConnectionRepository: SocialConnectionRepository;
  /** Single-use browser-bound OAuth state. */
  oauthStateRepository: OAuthStateRepository;
  /** Application session persistence. */
  sessionRepository: SessionRepository;
  /** Session and OAuth cookie policy. */
  sessionCookie: SessionCookieConfig;
  /** Encrypts Page tokens before writing private storage. */
  tokenProtector: TokenProtector;
  /** Safe server-side diagnostics. */
  logger: Logger;
}

const startRoute = createRoute({
  method: 'get',
  path: '/api/auth/facebook/start',
  tags: ['Authentication'],
  summary: 'Start Facebook sign-in',
  responses: { 302: { description: 'Redirect to Facebook consent or a safe error page.' } },
});
const callbackRoute = createRoute({
  method: 'get',
  path: '/api/auth/facebook/callback',
  tags: ['Authentication'],
  summary: 'Complete Facebook sign-in or Page authorization',
  responses: { 302: { description: 'Redirect to the dashboard or a safe error page.' } },
});
const connectRoute = createRoute({
  method: 'get',
  path: '/api/connections/facebook/start',
  tags: ['Connections'],
  summary: 'Start a signed-in user’s Facebook Page connection',
  responses: { 302: { description: 'Redirect to Facebook consent or the dashboard.' } },
});
const pendingRoute = createRoute({
  method: 'get',
  path: '/api/connections/facebook/pending',
  tags: ['Connections'],
  summary: 'List authorized Pages awaiting owner selection',
  request: { query: z.object({ selectionId: z.uuid() }) },
  responses: {
    200: {
      description: 'Safe Page names and identifiers; credentials remain server-side.',
      content: {
        'application/json': {
          schema: z.object({ pages: z.array(z.object({ id: z.string(), name: z.string() })) }),
        },
      },
    },
    404: { description: 'Selection expired or is not owned by this user.' },
  },
});
const selectRoute = createRoute({
  method: 'post',
  path: '/api/connections/facebook/select',
  tags: ['Connections'],
  summary: 'Connect one explicitly selected Facebook Page',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ selectionId: z.uuid(), pageId: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    204: { description: 'Page connected.' },
    400: { description: 'Selection expired or Page was not authorized.' },
    409: { description: 'Another social account is already connected.' },
  },
});

/** Registers Facebook identity OAuth and explicit Page selection endpoints. */
export const registerFacebookAuthRoutes = (
  app: OpenAPIHono,
  dependencies: FacebookAuthRouteDependencies,
): void => {
  const redirect = (path: string): string => new URL(path, dependencies.appBaseUrl).toString();
  const fail = (intent: 'sign_in' | 'connect_page', reason: string): string =>
    redirect(
      intent === 'connect_page'
        ? `/app?facebook_connect_error=${reason}`
        : `/?facebook_login_error=${reason}`,
    );
  const activeUserId = async (context: Context): Promise<string | null> => {
    const token = getSessionCookie(context, dependencies.sessionCookie);
    if (!token || !isSessionToken(token)) return null;
    const session = await dependencies.sessionRepository.findActiveByTokenHash(
      hashSessionToken(token),
    );
    return session?.user.id ?? null;
  };
  const start = async (
    context: Context,
    intent: 'sign_in' | 'connect_page',
    intendedUserId: string | null,
  ) => {
    clearOAuthCookie(context, dependencies.sessionCookie, 'facebook');
    try {
      const state = createSessionToken();
      const binding = createSessionToken();
      await dependencies.oauthStateRepository.createState({
        stateHash: state.tokenHash,
        browserBindingHash: binding.tokenHash,
        expiresAt: new Date(Date.now() + oauthStateTtlSeconds * 1000),
        provider: 'facebook',
        intent,
        intendedUserId,
      });
      setOAuthCookie(context, dependencies.sessionCookie, binding.token, 'facebook');
      return context.redirect(
        dependencies.facebookLoginClient.authorizationUrl(state.token, intent),
        302,
      );
    } catch (error) {
      dependencies.logger.error('Facebook authorization start failed', toSafeErrorContext(error));
      return context.redirect(fail(intent, 'unavailable'), 302);
    }
  };

  app.openapi(startRoute, async (context) =>
    start(context, 'sign_in', await activeUserId(context)),
  );
  app.use('/api/connections/facebook/*', createRequireSessionMiddleware(dependencies));
  app.openapi(connectRoute, async (context) => {
    const { user, connection } = context.get('authenticatedSession');
    if (connection?.provider === 'instagram')
      return context.redirect(fail('connect_page', 'already_connected'), 302);
    return start(context, 'connect_page', user.id);
  });
  app.openapi(callbackRoute, async (context) => {
    const binding = getOAuthCookie(context, dependencies.sessionCookie, 'facebook');
    clearOAuthCookie(context, dependencies.sessionCookie, 'facebook');
    const states = context.req.queries('state') ?? [];
    const state = states[0];
    if (
      states.length !== 1 ||
      !state ||
      !isSessionToken(state) ||
      !binding ||
      !isSessionToken(binding)
    )
      return context.redirect(fail('sign_in', 'invalid_state'), 302);
    let intent: 'sign_in' | 'connect_page' = 'sign_in';
    try {
      const attempt = await dependencies.oauthStateRepository.consumeStateDetails(
        hashSessionToken(state),
        hashSessionToken(binding),
      );
      if (!attempt || attempt.provider !== 'facebook')
        return context.redirect(fail('sign_in', 'invalid_state'), 302);
      intent = attempt.intent;
      if (attempt.intendedUserId && (await activeUserId(context)) !== attempt.intendedUserId)
        return context.redirect(fail(attempt.intent, 'invalid_session'), 302);
      if ((context.req.queries('error') ?? []).length > 0)
        return context.redirect(fail(attempt.intent, 'cancelled'), 302);
      const codes = context.req.queries('code') ?? [];
      const code = codes[0];
      if (codes.length !== 1 || !code || code.length > 4096)
        return context.redirect(fail(attempt.intent, 'unavailable'), 302);

      const login = await dependencies.facebookLoginClient.completeLogin(code);
      if (attempt.intent === 'sign_in') {
        const user = await dependencies.identityRepository.completeSignIn({
          provider: 'facebook',
          externalUserId: login.facebookUserId,
          displayName: login.displayName,
          intendedUserId: attempt.intendedUserId,
        });
        const sessionToken = createSessionToken();
        await dependencies.sessionRepository.createSession({
          userId: user.id,
          tokenHash: sessionToken.tokenHash,
          expiresAt: new Date(Date.now() + dependencies.sessionCookie.ttlSeconds * 1000),
        });
        const previousToken = getSessionCookie(context, dependencies.sessionCookie);
        if (previousToken && isSessionToken(previousToken)) {
          await dependencies.sessionRepository.deleteByTokenHash(hashSessionToken(previousToken));
        }
        setSessionCookie(context, dependencies.sessionCookie, sessionToken.token);
        return context.redirect(redirect('/app'), 302);
      }

      const userId = attempt.intendedUserId;
      if (!userId) return context.redirect(fail('connect_page', 'invalid_session'), 302);
      await dependencies.identityRepository.completeSignIn({
        provider: 'facebook',
        externalUserId: login.facebookUserId,
        displayName: login.displayName,
        intendedUserId: userId,
      });
      const pages = (
        await dependencies.facebookPageClient.listManagedPages(login.accessToken)
      ).filter(hasFacebookCommentTask);
      if (pages.length === 0)
        return context.redirect(fail('connect_page', 'insufficient_page_access'), 302);
      const selection = await dependencies.socialConnectionRepository.createPendingPageSelection({
        userId,
        pages: pages.map((page) => ({
          id: page.id,
          name: page.name,
          accessTokenCiphertext: dependencies.tokenProtector.encrypt(page.accessToken),
        })),
      });
      return context.redirect(redirect(`/app?facebook_selection=${selection.selectionId}`), 302);
    } catch (error) {
      dependencies.logger.error(
        'Facebook authorization callback failed',
        toSafeErrorContext(error),
      );
      const reason = error instanceof IdentityOwnershipError ? 'identity_owned' : 'unavailable';
      return context.redirect(fail(intent, reason), 302);
    }
  });
  app.openapi(pendingRoute, async (context) => {
    const { user } = context.get('authenticatedSession');
    const selectionId = context.req.valid('query').selectionId;
    const pending = await dependencies.socialConnectionRepository.getPendingPageSelection({
      userId: user.id,
      selectionId,
    });
    if (!pending) return context.json({ error: 'Selection unavailable' }, 404);
    return context.json({ pages: pending.pages }, 200);
  });
  app.openapi(selectRoute, async (context) => {
    const { user } = context.get('authenticatedSession');
    const { selectionId, pageId } = context.req.valid('json');
    try {
      const connection = await dependencies.socialConnectionRepository.consumeSelectedPage({
        userId: user.id,
        selectionId,
        pageId,
      });
      if (!connection) return context.json({ error: 'Selection unavailable' }, 400);
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof ConnectionLimitError)
        return context.json({ error: 'Already connected' }, 409);
      dependencies.logger.error('Facebook Page selection failed', toSafeErrorContext(error));
      return context.json({ error: 'Page connection unavailable' }, 503);
    }
  });
};
