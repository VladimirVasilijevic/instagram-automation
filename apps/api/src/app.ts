import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';

import type { DatabaseHealthChecker } from './database/database.js';
import type { InstagramMediaClient } from './instagram/media-client.js';
import type {
  AutomationRepository,
  ExecutionRepository,
  SessionRepository,
} from './database/repositories.js';
import type { Logger } from './logging/logger.js';
import { toSafeErrorContext } from './logging/logger.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAutomationRoutes } from './routes/automation.js';
import { registerHealthRoutes } from './routes/health.js';
import {
  registerInstagramAuthRoutes,
  type InstagramAuthDependencies,
} from './routes/instagram-auth.js';
import { registerMeRoute } from './routes/me.js';
import { registerMediaRoute } from './routes/media.js';
import {
  registerInstagramWebhookRoutes,
  type InstagramWebhookRouteDependencies,
} from './routes/instagram-webhook.js';
import type { SessionCookieConfig } from './security/session-cookie.js';
import type { TokenProtector } from './security/token-protector.js';

/** Media adapter and token protection used by authenticated media and automation routes. */
export interface InstagramMediaDependencies {
  /** Server-side adapter that lists media owned by the connected Instagram account. */
  instagramMediaClient: InstagramMediaClient;

  /** Decrypts the connected account token immediately before provider requests. */
  tokenProtector: TokenProtector;
}

/** Runtime dependencies and options used to construct the HTTP application. */
export interface AppDependencies {
  /** Account-scoped automation persistence used by configuration routes. */
  automationRepository: AutomationRepository;
  /** Idempotent comment-processing persistence used by webhook delivery. */
  executionRepository: ExecutionRepository;

  /** Provider and persistence capabilities needed to connect an Instagram account. */
  instagramAuth: Omit<InstagramAuthDependencies, 'logger' | 'sessionCookie' | 'sessionRepository'>;
  /** Server-side media adapter and token protection used by authenticated media requests. */
  instagramMedia: InstagramMediaDependencies;
  /** Public signed delivery and owner-authenticated comment-subscription capabilities. */
  instagramWebhook?: Omit<
    InstagramWebhookRouteDependencies,
    | 'automationRepository'
    | 'executionRepository'
    | 'logger'
    | 'sessionCookie'
    | 'sessionRepository'
  >;
  /** Database capability injected into routes that verify connectivity. */
  database: DatabaseHealthChecker;

  /** Controls whether interactive and machine-readable API documentation is exposed. */
  docsEnabled?: boolean;

  /** Server-side logger used by route and application error handlers. */
  logger: Logger;

  /** Browser session-cookie settings shared by authentication handlers. */
  sessionCookie: SessionCookieConfig;

  /** Application-session persistence used by authentication handlers and middleware. */
  sessionRepository: SessionRepository;
}

/**
 * Creates the OpenAPI-aware Hono application and registers middleware, routes, and documentation.
 *
 * @param dependencies - Runtime dependencies and documentation options for the application.
 * @returns A configured Hono application using standard web request and response objects.
 */
export const createApp = (dependencies: AppDependencies): OpenAPIHono => {
  const app = new OpenAPIHono();

  app.use('/api/auth/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  app.use('/api/me', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    await next();
  });
  app.use('/api/media', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    await next();
  });
  app.use('/api/automation', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    await next();
  });

  app.onError((error, context) => {
    dependencies.logger.error('Unhandled API error', toSafeErrorContext(error));

    return context.json(
      {
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      500,
    );
  });

  app.notFound((context) =>
    context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
        },
      },
      404,
    ),
  );

  registerHealthRoutes(app, dependencies);
  registerAuthRoutes(app, dependencies);
  registerAutomationRoutes(app, {
    automationRepository: dependencies.automationRepository,
    ...dependencies.instagramMedia,
    logger: dependencies.logger,
    sessionCookie: dependencies.sessionCookie,
    sessionRepository: dependencies.sessionRepository,
  });
  registerInstagramAuthRoutes(app, {
    ...dependencies.instagramAuth,
    logger: dependencies.logger,
    sessionCookie: dependencies.sessionCookie,
    sessionRepository: dependencies.sessionRepository,
  });
  registerMeRoute(app, dependencies);
  registerMediaRoute(app, {
    ...dependencies.instagramMedia,
    logger: dependencies.logger,
    sessionCookie: dependencies.sessionCookie,
    sessionRepository: dependencies.sessionRepository,
  });
  if (dependencies.instagramWebhook) {
    registerInstagramWebhookRoutes(app, {
      ...dependencies.instagramWebhook,
      automationRepository: dependencies.automationRepository,
      executionRepository: dependencies.executionRepository,
      logger: dependencies.logger,
      sessionCookie: dependencies.sessionCookie,
      sessionRepository: dependencies.sessionRepository,
    });
  }

  if (dependencies.docsEnabled ?? true) {
    app.doc('/api/openapi.json', {
      info: {
        description: 'HTTP API for the Instagram comment automation vertical slice.',
        title: 'Instagram Automation API',
        version: '0.1.0',
      },
      openapi: '3.0.0',
    });
    app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));
  }

  return app;
};
