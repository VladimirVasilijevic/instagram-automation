import { serve } from '@hono/node-server';

import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database/database.js';
import type { Logger } from '../src/logging/logger.js';
import { AesGcmTokenProtector } from '../src/security/aes-gcm-token-protector.js';
import {
  loadTestAppSecret,
  loadTestEncryptionKey,
  loadTestSessionCookieName,
  requireIsolatedLoadTestDatabase,
  toSafeLoadTestError,
} from './load-testing/config.js';
import { createFakeInstagramReplyClients } from './load-testing/fake-instagram.js';

const integer = (
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
};

const main = (): void => {
  const databaseUrl = requireIsolatedLoadTestDatabase(
    process.env.LOAD_TEST_DATABASE_URL,
    process.env.LOAD_TEST_CONFIRM_ISOLATED,
    [process.env.DATABASE_URL, process.env.DATABASE_MIGRATION_URL],
  );
  const port = integer('LOAD_TEST_PORT', process.env.LOAD_TEST_PORT, 3400, 1, 65_535);
  const slowDelayMs = integer(
    'LOAD_TEST_PROVIDER_SLOW_MS',
    process.env.LOAD_TEST_PROVIDER_SLOW_MS,
    1_000,
    0,
    30_000,
  );
  const database = createDatabase(databaseUrl);
  const tokenProtector = new AesGcmTokenProtector(loadTestEncryptionKey);
  const logCounts = new Map<string, number>();
  const count = (level: string, message: string): void => {
    const key = `${level}:${message}`;
    logCounts.set(key, (logCounts.get(key) ?? 0) + 1);
  };
  const logger: Logger = {
    error: (message) => count('error', message),
    info: (message) => count('info', message),
  };
  const replyClients = createFakeInstagramReplyClients(slowDelayMs);
  const app = createApp({
    automationRepository: database.automationRepository,
    executionRepository: database.executionRepository,
    database,
    docsEnabled: false,
    instagramAuth: {
      accountRepository: database.accountRepository,
      appBaseUrl: `http://127.0.0.1:${port}`,
      instagramClient: {
        authorizationUrl: () => 'https://invalid.load-test.local/',
        completeLogin: () => Promise.reject(new Error('OAuth is disabled in load tests')),
      },
      oauthStateRepository: database.oauthStateRepository,
      redirectUri: `http://127.0.0.1:${port}/api/auth/instagram/callback`,
      tokenProtector,
    },
    instagramMedia: {
      instagramMediaClient: {
        listRecentMedia: async () => [
          {
            caption: 'Synthetic load-test media',
            id: 'load-test-media',
            mediaType: 'IMAGE',
            mediaUrl: null,
            permalink: null,
            thumbnailUrl: null,
            timestamp: null,
          },
        ],
      },
      tokenProtector,
    },
    instagramSubscription: {
      instagramWebhookClient: { subscribeToComments: async () => undefined },
      tokenRefreshRepository: database.tokenRefreshRepository,
    },
    instagramWebhook: {
      accountRepository: database.accountRepository,
      appSecret: loadTestAppSecret,
      ...replyClients,
      tokenProtector,
      verifyToken: 'load-test-verify-token',
    },
    logger,
    maintenanceHealth: { maintenanceHealthRepository: database.maintenanceHealthRepository },
    sessionCookie: { name: loadTestSessionCookieName, secure: false, ttlSeconds: 86_400 },
    sessionRepository: database.sessionRepository,
  });
  const server = serve({ fetch: app.fetch, port }, ({ port: listeningPort }) => {
    console.info(`Load-test API listening on http://127.0.0.1:${listeningPort}`);
  });
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      await database.close();
      console.info('Load-test API stopped', Object.fromEntries(logCounts));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

try {
  main();
} catch (error) {
  console.error(toSafeLoadTestError(error));
  process.exitCode = 1;
}
