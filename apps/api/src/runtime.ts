import type { OpenAPIHono } from '@hono/zod-openapi';

import { createApp } from './app.js';
import { parseEnvironment, type Environment } from './config/environment.js';
import { createDatabase, type Database } from './database/database.js';
import { logger } from './logging/logger.js';
import { createInstagramCommentReplyClient } from './instagram/comment-reply-client.js';
import { createInstagramDirectMessageClient } from './instagram/direct-message-client.js';
import { createInstagramLoginClient } from './instagram/login-client.js';
import { createInstagramMediaClient } from './instagram/media-client.js';
import { createInstagramPrivateReplyClient } from './instagram/private-reply-client.js';
import { createInstagramWebhookClient } from './instagram/webhook-client.js';
import { createInstagramTokenRefreshClient } from './instagram/token-refresh-client.js';
import { createFacebookLoginClient } from './facebook/login-client.js';
import { createFacebookPageClient } from './facebook/page-client.js';
import { createFacebookCommentReplyClient } from './facebook/comment-reply-client.js';
import { createFacebookPrivateReplyClient } from './facebook/private-reply-client.js';
import { createFacebookDirectMessageClient } from './facebook/direct-message-client.js';
import { processFacebookComment } from './automation/process-facebook-comment.js';
import { processFacebookMessage } from './automation/process-facebook-message.js';
import { runMaintenance } from './maintenance/run-maintenance.js';
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
  const instagramWebhookClient = createInstagramWebhookClient({
    apiVersion: environment.META_API_VERSION,
  });
  const instagramDirectMessageClient = createInstagramDirectMessageClient({
    apiVersion: environment.META_API_VERSION,
  });
  const facebookConfigured = Boolean(
    environment.FACEBOOK_APP_ID &&
    environment.FACEBOOK_APP_SECRET &&
    environment.FACEBOOK_API_VERSION &&
    environment.FACEBOOK_REDIRECT_URI &&
    environment.FACEBOOK_WEBHOOK_VERIFY_TOKEN,
  );
  const facebookPageClient = facebookConfigured
    ? createFacebookPageClient({ apiVersion: environment.FACEBOOK_API_VERSION! })
    : undefined;
  const facebookCommentReplyClient = facebookConfigured
    ? createFacebookCommentReplyClient({ apiVersion: environment.FACEBOOK_API_VERSION! })
    : undefined;
  const facebookPrivateReplyClient = facebookConfigured
    ? createFacebookPrivateReplyClient({ apiVersion: environment.FACEBOOK_API_VERSION! })
    : undefined;
  const facebookDirectMessageClient = facebookConfigured
    ? createFacebookDirectMessageClient({ apiVersion: environment.FACEBOOK_API_VERSION! })
    : undefined;
  const instagramCommentReplyClient = createInstagramCommentReplyClient({
    apiVersion: environment.META_API_VERSION,
  });
  const instagramPrivateReplyClient = createInstagramPrivateReplyClient({
    apiVersion: environment.META_API_VERSION,
  });
  const facebookDelivery = facebookConfigured
    ? {
        facebookCommentReplyClient: facebookCommentReplyClient!,
        facebookPrivateReplyClient: facebookPrivateReplyClient!,
        facebookDirectMessageClient: facebookDirectMessageClient!,
        socialConnectionRepository: database.socialConnectionRepository,
      }
    : {};
  const app = createApp({
    ...(facebookConfigured
      ? {
          facebookWebhook: {
            appSecret: environment.FACEBOOK_APP_SECRET!,
            verifyToken: environment.FACEBOOK_WEBHOOK_VERIFY_TOKEN!,
            processFacebookComment: async (event: Parameters<typeof processFacebookComment>[0]) => {
              await processFacebookComment(event, {
                automationRepository: database.automationRepository,
                executionRepository: database.executionRepository,
                instagramCommentReplyClient,
                instagramPrivateReplyClient,
                tokenRefreshRepository: database.tokenRefreshRepository,
                tokenProtector,
                logger,
                facebookCommentReplyClient: facebookCommentReplyClient!,
                facebookPrivateReplyClient: facebookPrivateReplyClient!,
                socialConnectionRepository: database.socialConnectionRepository,
              });
            },
            processFacebookMessage: async (event: Parameters<typeof processFacebookMessage>[0]) => {
              await processFacebookMessage(event, {
                dmConversationRepository: database.dmConversationRepository,
                instagramDirectMessageClient,
                tokenRefreshRepository: database.tokenRefreshRepository,
                tokenProtector,
                logger,
                facebookDirectMessageClient: facebookDirectMessageClient!,
                socialConnectionRepository: database.socialConnectionRepository,
              });
            },
          },
        }
      : {}),
    ...(facebookPageClient
      ? {
          facebookPage: {
            facebookPageClient,
            socialConnectionRepository: database.socialConnectionRepository,
          },
        }
      : {}),
    ...(facebookConfigured
      ? {
          facebookAuth: {
            appBaseUrl: environment.APP_BASE_URL,
            identityRepository: database.identityRepository,
            facebookLoginClient: createFacebookLoginClient({
              appId: environment.FACEBOOK_APP_ID!,
              appSecret: environment.FACEBOOK_APP_SECRET!,
              apiVersion: environment.FACEBOOK_API_VERSION!,
              redirectUri: environment.FACEBOOK_REDIRECT_URI!,
            }),
            facebookPageClient: facebookPageClient!,
            socialConnectionRepository: database.socialConnectionRepository,
            oauthStateRepository: database.oauthStateRepository,
            tokenProtector,
          },
        }
      : {}),
    automationRepository: database.automationRepository,
    dmConversationRepository: database.dmConversationRepository,
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
      identityRepository: database.identityRepository,
      oauthStateRepository: database.oauthStateRepository,
      tokenProtector,
    },
    instagramMedia: {
      instagramMediaClient: createInstagramMediaClient({
        apiVersion: environment.META_API_VERSION,
      }),
      tokenProtector,
    },
    instagramSubscription: {
      instagramWebhookClient,
      tokenRefreshRepository: database.tokenRefreshRepository,
    },
    instagramWebhook: {
      accountRepository: database.accountRepository,
      appSecret: environment.META_APP_SECRET,
      instagramCommentReplyClient,
      instagramDirectMessageClient,
      instagramPrivateReplyClient,
      tokenProtector,
      verifyToken: environment.META_WEBHOOK_VERIFY_TOKEN,
    },
    maintenance: {
      cronSecret: environment.CRON_SECRET,
      maintenanceHealthRepository: database.maintenanceHealthRepository,
      runMaintenance: () =>
        runMaintenance({
          dmConversationRepository: database.dmConversationRepository,
          executionRepository: database.executionRepository,
          instagramCommentReplyClient,
          instagramPrivateReplyClient,
          instagramDirectMessageClient,
          instagramTokenRefreshClient: createInstagramTokenRefreshClient(),
          logger,
          tokenProtector,
          tokenRefreshRepository: database.tokenRefreshRepository,
          ...facebookDelivery,
        }),
    },
    maintenanceHealth: {
      maintenanceHealthRepository: database.maintenanceHealthRepository,
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
