import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';

import { errorResponseSchema } from '../contracts/http.js';
import type { SessionRepository } from '../database/repositories.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  clearSessionCookie,
  getSessionCookie,
  type SessionCookieConfig,
} from '../security/session-cookie.js';
import { hashSessionToken, isSessionToken } from '../security/session-token.js';

const logoutRoute = createRoute({
  description: 'Revokes the current application session and expires its browser cookie.',
  method: 'post',
  path: '/api/auth/logout',
  responses: {
    204: {
      description: 'The browser no longer has an active session credential.',
    },
    500: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'An unexpected internal error occurred.',
    },
    503: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Session storage is unavailable, so revocation should be retried.',
    },
  },
  summary: 'Log out',
  tags: ['Authentication'],
});

/** Dependencies required by the logout HTTP handler. */
export interface AuthRouteDependencies {
  /** Server-side logger used for sanitized failure reporting. */
  logger: Logger;

  /** Browser session-cookie settings. */
  sessionCookie: SessionCookieConfig;

  /** Session deletion capability used to revoke the presented credential. */
  sessionRepository: Pick<SessionRepository, 'deleteByTokenHash'>;
}

/**
 * Registers application authentication endpoints.
 *
 * @param app - Hono application that receives the route definitions.
 * @param dependencies - Session storage, cookie, and logging dependencies.
 */
export const registerAuthRoutes = (app: OpenAPIHono, dependencies: AuthRouteDependencies): void => {
  app.openapi(logoutRoute, async (context) => {
    const token = getSessionCookie(context, dependencies.sessionCookie);

    if (!token || !isSessionToken(token)) {
      clearSessionCookie(context, dependencies.sessionCookie);

      return context.body(null, 204);
    }

    try {
      await dependencies.sessionRepository.deleteByTokenHash(hashSessionToken(token));
    } catch (error) {
      dependencies.logger.error('Session logout failed', toSafeErrorContext(error));

      return context.json(
        {
          error: {
            code: 'SESSION_STORE_UNAVAILABLE',
            message: 'Logout could not be completed',
          },
        },
        503,
      );
    }

    clearSessionCookie(context, dependencies.sessionCookie);

    return context.body(null, 204);
  });
};
