import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { DELIVERY_MODE, TRIGGER_MODE } from '@instagram-automation/contracts';

import { errorResponseSchema } from '../contracts/http.js';
import type {
  Automation,
  AutomationRepository,
  TokenRefreshRepository,
} from '../database/repositories.js';
import type { InstagramMediaClient } from '../instagram/media-client.js';
import { InstagramMediaError } from '../instagram/media-client.js';
import type { InstagramWebhookClient } from '../instagram/webhook-client.js';
import { InstagramWebhookError } from '../instagram/webhook-client.js';
import type { Logger } from '../logging/logger.js';
import type { FacebookPageClient } from '../facebook/page-client.js';
import { FacebookClientError } from '../facebook/http.js';
import type { SocialConnectionRepository } from '../database/identity-repositories.js';
import { RECOVERY_KIND } from '../automation/recovery.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  createRequireSessionMiddleware,
  type SessionMiddlewareDependencies,
} from '../middleware/session.js';
import type { TokenProtector } from '../security/token-protector.js';

const quickReplyOptionSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(20),
  followUpText: z.string().trim().min(1).max(1000),
});

const automationSchema = z.object({
  deliveryMode: z.enum(DELIVERY_MODE),
  enabled: z.boolean(),
  mediaId: z.string(),
  privateReplyText: z.string().nullable(),
  quickReplyOptions: z.array(quickReplyOptionSchema),
  replyText: z.string(),
  triggerMode: z.enum(TRIGGER_MODE),
  triggerText: z.string().nullable(),
});
const automationResponseSchema = z.object({ automation: automationSchema.nullable() });
const saveAutomationSchema = z
  .object({
    deliveryMode: z.enum(DELIVERY_MODE),
    enabled: z.boolean(),
    mediaId: z.string().trim().min(1),
    privateReplyText: z.string().trim().max(1000).nullable(),
    quickReplyOptions: z.array(quickReplyOptionSchema).max(13).default([]),
    replyText: z.string().trim().max(2200),
    triggerMode: z.enum(TRIGGER_MODE),
    triggerText: z.string().trim().max(100).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.triggerMode === TRIGGER_MODE.ALL && value.triggerText !== null) {
      context.addIssue({
        code: 'custom',
        path: ['triggerText'],
        message: 'Trigger text must be null',
      });
    }
    if (value.triggerMode !== TRIGGER_MODE.ALL && !value.triggerText) {
      context.addIssue({
        code: 'custom',
        path: ['triggerText'],
        message: 'Trigger text is required',
      });
    }
    if (
      value.triggerMode === TRIGGER_MODE.CONTAINS &&
      value.triggerText &&
      !/^#?[\p{L}\p{N}_]+$/u.test(value.triggerText)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['triggerText'],
        message: 'Contains trigger must be one word or hashtag',
      });
    }
    if (value.deliveryMode !== DELIVERY_MODE.PRIVATE && value.replyText === '') {
      context.addIssue({
        code: 'custom',
        path: ['replyText'],
        message: 'Public reply is required',
      });
    }
    if (value.deliveryMode !== DELIVERY_MODE.PUBLIC && !value.privateReplyText) {
      context.addIssue({
        code: 'custom',
        path: ['privateReplyText'],
        message: 'Private reply is required',
      });
    }
    if (value.deliveryMode === DELIVERY_MODE.PUBLIC && value.privateReplyText !== null) {
      context.addIssue({
        code: 'custom',
        path: ['privateReplyText'],
        message: 'Private reply must be null',
      });
    }
    if (value.deliveryMode === DELIVERY_MODE.PUBLIC && value.quickReplyOptions.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['quickReplyOptions'],
        message: 'Quick replies require a private message',
      });
    }
    if (
      new Set(value.quickReplyOptions.map((option) => option.id)).size !==
      value.quickReplyOptions.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['quickReplyOptions'],
        message: 'Quick reply IDs must be unique',
      });
    }
  });

const getAutomationRoute = createRoute({
  method: 'get',
  path: '/api/automation',
  tags: ['Automation'],
  summary: 'Get the signed-in account automation',
  responses: {
    200: {
      description: 'The saved automation, or null when the account has not configured one.',
      content: { 'application/json': { schema: automationResponseSchema } },
    },
    401: {
      description: 'No active application session.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'A social account must be connected before configuring automation.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    503: {
      description: 'Automation storage is unavailable.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
const saveAutomationRoute = createRoute({
  method: 'put',
  path: '/api/automation',
  tags: ['Automation'],
  summary: 'Create or replace the signed-in account automation',
  responses: {
    200: {
      description: 'The saved account automation and selected delivery channels.',
      content: { 'application/json': { schema: z.object({ automation: automationSchema }) } },
    },
    400: {
      description: 'The request is invalid or selects media not owned by the account.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'No active application session.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'A social account must be connected before configuring automation.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    503: {
      description: 'Automation storage is unavailable.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    502: {
      description: 'Instagram media or comment delivery cannot be checked before saving.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

/** Dependencies for authenticated automation configuration routes. */
export interface AutomationRouteDependencies extends SessionMiddlewareDependencies {
  /** Facebook Page post validation and event subscription. */
  facebookPageClient?: Pick<FacebookPageClient, 'listRecentPosts' | 'subscribeToEvents'>;
  /** Resolves encrypted Facebook Page tokens. */
  socialConnectionRepository?: Pick<
    SocialConnectionRepository,
    'findFacebookPageByPageId' | 'markReconnectRequired'
  >;
  /** Account-scoped automation storage. */
  automationRepository: Pick<AutomationRepository, 'findByAccountId' | 'saveAutomation'>;

  /** Logger receiving sanitized persistence failures only. */
  logger: Logger;

  /** Server-side adapter used to confirm selected media belongs to the connected account. */
  instagramMediaClient: InstagramMediaClient;

  /** Provider client that ensures Meta sends comments for enabled automations. */
  instagramWebhookClient: InstagramWebhookClient;

  /** Decrypts the connected account token immediately before media ownership validation. */
  tokenProtector: TokenProtector;

  /** Records definite provider credential rejection without exposing provider details. */
  tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'>;
}

const toAutomationResponse = (automation: Automation) => ({
  deliveryMode: automation.deliveryMode,
  enabled: automation.enabled,
  mediaId: automation.mediaId,
  privateReplyText: automation.privateReplyText,
  quickReplyOptions: automation.quickReplyOptions ?? [],
  replyText: automation.replyText,
  triggerMode: automation.triggerMode,
  triggerText: automation.triggerText,
});

/** Registers authenticated load and save operations for one comment automation per account. */
export const registerAutomationRoutes = (
  app: OpenAPIHono,
  dependencies: AutomationRouteDependencies,
): void => {
  app.use('/api/automation', createRequireSessionMiddleware(dependencies));
  app.openapi(getAutomationRoute, async (context) => {
    const { connection } = context.get('authenticatedSession');
    if (!connection)
      return context.json(
        { error: { code: 'CONNECTION_REQUIRED', message: 'Connect a social account first.' } },
        409,
      );
    try {
      const automation = await dependencies.automationRepository.findByAccountId(connection.id);
      return context.json(
        { automation: automation ? toAutomationResponse(automation) : null },
        200,
      );
    } catch (error) {
      dependencies.logger.error('Automation load failed', toSafeErrorContext(error));
      return context.json(
        {
          error: {
            code: 'AUTOMATION_STORE_UNAVAILABLE',
            message: 'Automation settings are unavailable. Please try again.',
          },
        },
        503,
      );
    }
  });
  app.openapi(saveAutomationRoute, async (context) => {
    let payload: unknown;
    try {
      payload = await context.req.json();
    } catch {
      return context.json(
        {
          error: {
            code: 'INVALID_AUTOMATION_INPUT',
            message: 'Automation settings are incomplete or invalid.',
          },
        },
        400,
      );
    }
    const parsedInput = saveAutomationSchema.safeParse(payload);
    if (!parsedInput.success) {
      return context.json(
        {
          error: {
            code: 'INVALID_AUTOMATION_INPUT',
            message: 'Automation settings are incomplete or invalid.',
          },
        },
        400,
      );
    }

    const { account, connection } = context.get('authenticatedSession');
    if (!connection)
      return context.json(
        { error: { code: 'CONNECTION_REQUIRED', message: 'Connect a social account first.' } },
        409,
      );
    let accessToken: string;
    try {
      const media =
        connection.provider === 'facebook'
          ? await (async () => {
              const page = await dependencies.socialConnectionRepository?.findFacebookPageByPageId(
                connection.externalAccountId,
              );
              if (!page || !dependencies.facebookPageClient)
                throw new Error('Facebook Page adapter unavailable');
              accessToken = dependencies.tokenProtector.decrypt(page.accessTokenCiphertext);
              return dependencies.facebookPageClient.listRecentPosts({
                pageId: page.externalAccountId,
                pageAccessToken: accessToken,
                limit: 12,
              });
            })()
          : await (async () => {
              if (!account) throw new Error('Instagram account unavailable');
              accessToken = dependencies.tokenProtector.decrypt(account.accessTokenCiphertext);
              return dependencies.instagramMediaClient.listRecentMedia({
                accessToken,
                instagramUserId: account.instagramUserId,
                limit: 12,
              });
            })();
      if (!media.some((item) => item.id === parsedInput.data.mediaId)) {
        return context.json(
          {
            error: {
              code: 'SELECTED_MEDIA_UNAVAILABLE',
              message: 'Select one of your current recent posts before saving.',
            },
          },
          400,
        );
      }
    } catch (error) {
      dependencies.logger.error(
        'Social media validation failed',
        error instanceof InstagramMediaError ? error.toLogContext() : toSafeErrorContext(error),
      );
      return context.json(
        {
          error: {
            code:
              connection.provider === 'instagram'
                ? 'INSTAGRAM_MEDIA_UNAVAILABLE'
                : 'FACEBOOK_MEDIA_UNAVAILABLE',
            message:
              connection.provider === 'instagram'
                ? 'Instagram media is unavailable. Please try again.'
                : 'Facebook Page posts are unavailable. Please try again.',
          },
        },
        502,
      );
    }

    if (parsedInput.data.enabled) {
      try {
        if (connection.provider === 'facebook') {
          if (!dependencies.facebookPageClient)
            throw new Error('Facebook Page adapter unavailable');
          await dependencies.facebookPageClient.subscribeToEvents({
            pageId: connection.externalAccountId,
            pageAccessToken: accessToken!,
            includeMessages: parsedInput.data.quickReplyOptions.length > 0,
          });
        } else {
          if (!account) throw new Error('Instagram account unavailable');
          await dependencies.instagramWebhookClient.subscribeToComments({
            accessToken: accessToken!,
            instagramUserId: account.instagramUserId,
            includeMessages: parsedInput.data.quickReplyOptions.length > 0,
          });
        }
      } catch (error) {
        const authenticationRejected =
          (error instanceof InstagramWebhookError && error.authenticationRejected) ||
          (error instanceof FacebookClientError &&
            error.recoveryKind() === RECOVERY_KIND.AUTHENTICATION);
        dependencies.logger.error(
          'Social comment subscription failed while saving automation',
          error instanceof InstagramWebhookError || error instanceof FacebookClientError
            ? error.toLogContext()
            : toSafeErrorContext(error),
        );
        if (authenticationRejected) {
          try {
            if (connection.provider === 'facebook') {
              await dependencies.socialConnectionRepository?.markReconnectRequired(
                connection.id,
                'TOKEN_REJECTED',
              );
            } else if (account) {
              await dependencies.tokenRefreshRepository.markAccountReconnectRequired(
                account.id,
                'TOKEN_REJECTED',
              );
            }
          } catch (persistenceError) {
            dependencies.logger.error(
              'Instagram reconnect state update failed',
              toSafeErrorContext(persistenceError),
            );
          }
          return context.json(
            {
              error: {
                code:
                  connection.provider === 'instagram'
                    ? 'INSTAGRAM_RECONNECT_REQUIRED'
                    : 'FACEBOOK_RECONNECT_REQUIRED',
                message: `Reconnect ${connection.provider === 'instagram' ? 'Instagram' : 'Facebook'} before enabling this automation.`,
              },
            },
            502,
          );
        }
        return context.json(
          {
            error: {
              code:
                connection.provider === 'instagram'
                  ? 'INSTAGRAM_COMMENT_SUBSCRIPTION_UNAVAILABLE'
                  : 'FACEBOOK_COMMENT_SUBSCRIPTION_UNAVAILABLE',
              message: 'Comment delivery could not be enabled. Your changes were not saved.',
            },
          },
          502,
        );
      }
    }

    try {
      const automation = await dependencies.automationRepository.saveAutomation({
        accountId: connection.id,
        ...parsedInput.data,
      });
      return context.json({ automation: toAutomationResponse(automation) }, 200);
    } catch (error) {
      dependencies.logger.error('Automation save failed', toSafeErrorContext(error));
      return context.json(
        {
          error: {
            code: 'AUTOMATION_STORE_UNAVAILABLE',
            message: 'Automation settings are unavailable. Please try again.',
          },
        },
        503,
      );
    }
  });
};
