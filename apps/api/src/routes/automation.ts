import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { DELIVERY_MODE } from '@instagram-automation/contracts';

import { errorResponseSchema } from '../contracts/http.js';
import type { Automation, AutomationRepository } from '../database/repositories.js';
import type { InstagramMediaClient } from '../instagram/media-client.js';
import { InstagramMediaError } from '../instagram/media-client.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  createRequireSessionMiddleware,
  type SessionMiddlewareDependencies,
} from '../middleware/session.js';
import type { TokenProtector } from '../security/token-protector.js';

const automationSchema = z.object({
  deliveryMode: z.enum(DELIVERY_MODE),
  enabled: z.boolean(),
  mediaId: z.string(),
  privateReplyText: z.string().nullable(),
  replyText: z.string(),
  triggerText: z.string(),
});
const automationResponseSchema = z.object({ automation: automationSchema.nullable() });
const saveAutomationSchema = z
  .object({
    deliveryMode: z.enum(DELIVERY_MODE),
    enabled: z.boolean(),
    mediaId: z.string().trim().min(1),
    privateReplyText: z.string().trim().max(1000).nullable(),
    replyText: z.string().trim().max(2200),
    triggerText: z
      .string()
      .trim()
      .regex(/^#\S{1,99}$/),
  })
  .strict()
  .superRefine((value, context) => {
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
    503: {
      description: 'Automation storage is unavailable.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    502: {
      description: 'Instagram media cannot be checked before saving.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

/** Dependencies for authenticated automation configuration routes. */
export interface AutomationRouteDependencies extends SessionMiddlewareDependencies {
  /** Account-scoped automation storage. */
  automationRepository: Pick<AutomationRepository, 'findByAccountId' | 'saveAutomation'>;

  /** Logger receiving sanitized persistence failures only. */
  logger: Logger;

  /** Server-side adapter used to confirm selected media belongs to the connected account. */
  instagramMediaClient: InstagramMediaClient;

  /** Decrypts the connected account token immediately before media ownership validation. */
  tokenProtector: TokenProtector;
}

const toAutomationResponse = (automation: Automation) => ({
  deliveryMode: automation.deliveryMode,
  enabled: automation.enabled,
  mediaId: automation.mediaId,
  privateReplyText: automation.privateReplyText,
  replyText: automation.replyText,
  triggerText: automation.triggerText,
});

/** Registers authenticated load and save operations for one comment automation per account. */
export const registerAutomationRoutes = (
  app: OpenAPIHono,
  dependencies: AutomationRouteDependencies,
): void => {
  app.use('/api/automation', createRequireSessionMiddleware(dependencies));
  app.openapi(getAutomationRoute, async (context) => {
    try {
      const { account } = context.get('authenticatedSession');
      const automation = await dependencies.automationRepository.findByAccountId(account.id);
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

    const { account } = context.get('authenticatedSession');
    try {
      const media = await dependencies.instagramMediaClient.listRecentMedia({
        accessToken: dependencies.tokenProtector.decrypt(account.accessTokenCiphertext),
        instagramUserId: account.instagramUserId,
        limit: 12,
      });
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
        'Instagram media validation failed',
        error instanceof InstagramMediaError ? error.toLogContext() : toSafeErrorContext(error),
      );
      return context.json(
        {
          error: {
            code: 'INSTAGRAM_MEDIA_UNAVAILABLE',
            message: 'Instagram media is unavailable. Please try again.',
          },
        },
        502,
      );
    }

    try {
      const automation = await dependencies.automationRepository.saveAutomation({
        accountId: account.id,
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
