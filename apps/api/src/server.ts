import { serve } from '@hono/node-server';

import { logger } from './logging/logger.js';
import { createRuntime } from './runtime.js';

const { app, database, environment } = createRuntime();

const server = serve(
  {
    fetch: app.fetch,
    port: environment.API_PORT,
  },
  ({ port }) => {
    logger.info('API server started', { port });
  },
);

let isShuttingDown = false;

const shutDown = (signal: NodeJS.Signals): void => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info('API server shutting down', { signal });

  server.close(async (serverError) => {
    try {
      await database.close();
    } catch (error) {
      logger.error('Database shutdown failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      process.exitCode = 1;
    }

    if (serverError) {
      logger.error('API server shutdown failed', {
        errorName: serverError.name,
      });
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', shutDown);
process.once('SIGTERM', shutDown);
