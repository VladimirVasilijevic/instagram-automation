import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';

import type { AuthenticatedSession, SessionRepository } from '../database/repositories.js';
import {
  clearSessionCookie,
  getSessionCookie,
  type SessionCookieConfig,
} from '../security/session-cookie.js';
import { hashSessionToken, isSessionToken } from '../security/session-token.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** Active application session resolved from the request cookie. */
    authenticatedSession: AuthenticatedSession;
  }
}

/** Dependencies required to authenticate a request from its session cookie. */
export interface SessionMiddlewareDependencies {
  /** Browser session-cookie settings. */
  sessionCookie: SessionCookieConfig;

  /** Session lookup capability used after hashing a valid browser credential. */
  sessionRepository: Pick<SessionRepository, 'findActiveByTokenHash'>;
}

/**
 * Creates route-specific middleware that requires an active application session.
 *
 * @param dependencies - Cookie settings and session lookup capability.
 * @returns Hono middleware that attaches `authenticatedSession` or returns a sanitized `401`.
 */
export const createRequireSessionMiddleware = (
  dependencies: SessionMiddlewareDependencies,
): MiddlewareHandler =>
  createMiddleware(async (context, next) => {
    const token = getSessionCookie(context, dependencies.sessionCookie);

    if (!token || !isSessionToken(token)) {
      if (token) {
        clearSessionCookie(context, dependencies.sessionCookie);
      }

      return context.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication is required' } },
        401,
      );
    }

    const authenticatedSession = await dependencies.sessionRepository.findActiveByTokenHash(
      hashSessionToken(token),
    );

    if (!authenticatedSession) {
      clearSessionCookie(context, dependencies.sessionCookie);

      return context.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication is required' } },
        401,
      );
    }

    context.set('authenticatedSession', authenticatedSession);
    await next();
  });
