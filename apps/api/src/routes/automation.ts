import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

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
  enabled: z.boolean(),
  mediaId: z.string(),
  replyText: z.string(),
  triggerText: z.literal('#Hello'),
});
const automationResponseSchema = z.object({ automation: automationSchema.nullable() });
const saveAutomationSchema = z
  .object({
    enabled: z.boolean(),
    mediaId: z.string().trim().min(1),
    replyText: z.string().trim().min(1),
  })
  .strict();

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
      description: 'The saved account automation. The trigger is fixed to #Hello.',
      content: { 'application/json': { schema: z.object({ automation: automationSchema }) } },
    },
    400: {
      description:
        'The request is invalid, changes the trigger, or selects media not owned by the account.',
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
  enabled: automation.enabled,
  mediaId: automation.mediaId,
  replyText: automation.replyText,
  triggerText: automation.triggerText,
});

/** Registers authenticated load and save operations for one fixed-trigger automation per account. */
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
            message: 'Automation settings must include a media ID, reply text, and enabled state.',
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
            message: 'Automation settings must include a media ID, reply text, and enabled state.',
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
