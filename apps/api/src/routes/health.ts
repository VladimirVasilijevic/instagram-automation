import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';

import {
  databaseConnectedResponseSchema,
  databaseUnavailableResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
} from '../contracts/http.js';
import type { DatabaseHealthChecker } from '../database/database.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';

const healthRoute = createRoute({
  description: 'Confirms that the Node.js API process is accepting requests.',
  method: 'get',
  path: '/api/health',
  responses: {
    200: {
      content: { 'application/json': { schema: healthResponseSchema } },
      description: 'The API process is healthy.',
    },
    500: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'An unexpected internal error occurred.',
    },
  },
  summary: 'Check API health',
  tags: ['Health'],
});

const databaseHealthRoute = createRoute({
  description: 'Runs `select 1` through the configured runtime PostgreSQL connection.',
  method: 'get',
  path: '/api/health/database',
  responses: {
    200: {
      content: { 'application/json': { schema: databaseConnectedResponseSchema } },
      description: 'PostgreSQL accepted the health query.',
    },
    500: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'An unexpected internal error occurred.',
    },
    503: {
      content: { 'application/json': { schema: databaseUnavailableResponseSchema } },
      description: 'PostgreSQL is unavailable. The response never exposes raw database errors.',
    },
  },
  summary: 'Check database connectivity',
  tags: ['Health'],
});

/** Dependencies required by the health HTTP handlers. */
export interface HealthRouteDependencies {
  /** Database capability used by the database health route. */
  database: DatabaseHealthChecker;

  /** Server-side logger used for sanitized failure reporting. */
  logger: Logger;
}

/**
 * Registers API and database health endpoints on an OpenAPI-aware Hono application.
 *
 * @param app - Hono application that receives the route definitions.
 * @param dependencies - Database and logging dependencies used by the handlers.
 */
export const registerHealthRoutes = (
  app: OpenAPIHono,
  dependencies: HealthRouteDependencies,
): void => {
  app.openapi(healthRoute, (context) => context.json({ status: 'ok' as const }, 200));

  app.openapi(databaseHealthRoute, async (context) => {
    try {
      await dependencies.database.checkHealth();

      return context.json({ database: 'connected' as const, status: 'ok' as const }, 200);
    } catch (error) {
      dependencies.logger.error('Database health check failed', toSafeErrorContext(error));

      return context.json({ database: 'unavailable' as const, status: 'error' as const }, 503);
    }
  });
};
