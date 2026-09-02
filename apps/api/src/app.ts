import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';

import type { DatabaseHealthChecker } from './database/database.js';
import type { Logger } from './logging/logger.js';
import { toSafeErrorContext } from './logging/logger.js';
import { registerHealthRoutes } from './routes/health.js';

/** Runtime dependencies and options used to construct the HTTP application. */
export interface AppDependencies {
  /** Database capability injected into routes that verify connectivity. */
  database: DatabaseHealthChecker;

  /** Controls whether interactive and machine-readable API documentation is exposed. */
  docsEnabled?: boolean;

  /** Server-side logger used by route and application error handlers. */
  logger: Logger;
}

/**
 * Creates the OpenAPI-aware Hono application and registers middleware, routes, and documentation.
 *
 * @param dependencies - Runtime dependencies and documentation options for the application.
 * @returns A configured Hono application using standard web request and response objects.
 */
export const createApp = (dependencies: AppDependencies): OpenAPIHono => {
  const app = new OpenAPIHono();

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
