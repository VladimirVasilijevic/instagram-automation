import type { OpenAPIHono } from '@hono/zod-openapi';

import { createApp } from './app.js';
import { parseEnvironment, type Environment } from './config/environment.js';
import { createDatabase, type Database } from './database/database.js';
import { logger } from './logging/logger.js';

/** Application resources shared by the local server and the Vercel entry point. */
export interface AppRuntime {
  /** Configured HTTP application; constructing it does not open a listening socket. */
  app: OpenAPIHono;

  /** Database connection reused across requests and closed by the local server on shutdown. */
  database: Database;

  /** Validated server-only settings. */
  environment: Environment;
}

/**
 * Initializes one application instance without starting a server or installing signal handlers.
 *
 * @param input - Environment variables supplied by the host or the local development command.
 * @returns Application, database, and configuration for the hosting entry point.
 */
export const createRuntime = (input: NodeJS.ProcessEnv = process.env): AppRuntime => {
  const environment = parseEnvironment(input);
  const database = createDatabase(environment.DATABASE_URL);
  const app = createApp({
    database,
    docsEnabled: environment.NODE_ENV !== 'production',
    logger,
    sessionCookie: {
      name: environment.SESSION_COOKIE_NAME,
      secure: environment.NODE_ENV === 'production',
      ttlSeconds: environment.SESSION_TTL_SECONDS,
    },
    sessionRepository: database.sessionRepository,
  });

  return { app, database, environment };
};
