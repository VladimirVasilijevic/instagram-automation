import type { OpenAPIHono } from '@hono/zod-openapi';

import { createApp } from './app.js';
import { parseEnvironment, type Environment } from './config/environment.js';
import { createDatabase, type Database } from './database/database.js';
import { logger } from './logging/logger.js';
import { createInstagramCommentReplyClient } from './instagram/comment-reply-client.js';
import { createInstagramLoginClient } from './instagram/login-client.js';
import { createInstagramMediaClient } from './instagram/media-client.js';
import { createInstagramWebhookClient } from './instagram/webhook-client.js';
import { AesGcmTokenProtector } from './security/aes-gcm-token-protector.js';

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
  const tokenProtector = new AesGcmTokenProtector(environment.TOKEN_ENCRYPTION_KEY);
  const app = createApp({
    automationRepository: database.automationRepository,
    executionRepository: database.executionRepository,
    instagramAuth: {
      appBaseUrl: environment.APP_BASE_URL,
      redirectUri: environment.META_REDIRECT_URI,
      instagramClient: createInstagramLoginClient({
        appId: environment.META_APP_ID,
        appSecret: environment.META_APP_SECRET,
        apiVersion: environment.META_API_VERSION,
        redirectUri: environment.META_REDIRECT_URI,
      }),
      accountRepository: database.accountRepository,
      oauthStateRepository: database.oauthStateRepository,
      tokenProtector,
    },
    instagramMedia: {
      instagramMediaClient: createInstagramMediaClient({
        apiVersion: environment.META_API_VERSION,
      }),
      tokenProtector,
    },
    instagramWebhook: {
      accountRepository: database.accountRepository,
      appSecret: environment.META_APP_SECRET,
      instagramCommentReplyClient: createInstagramCommentReplyClient({
        apiVersion: environment.META_API_VERSION,
      }),
      instagramWebhookClient: createInstagramWebhookClient({
        apiVersion: environment.META_API_VERSION,
      }),
      tokenProtector,
      verifyToken: environment.META_WEBHOOK_VERIFY_TOKEN,
    },
    database,
    docsEnabled: true,
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
