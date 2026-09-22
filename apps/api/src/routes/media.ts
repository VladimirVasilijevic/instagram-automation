import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { errorResponseSchema } from '../contracts/http.js';
import type { InstagramMediaClient } from '../instagram/media-client.js';
import { InstagramMediaError } from '../instagram/media-client.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  createRequireSessionMiddleware,
  type SessionMiddlewareDependencies,
} from '../middleware/session.js';
import type { TokenProtector } from '../security/token-protector.js';

const mediaItemSchema = z.object({
  caption: z.string().nullable(),
  id: z.string(),
  mediaType: z.string(),
  mediaUrl: z.string().url().nullable(),
  permalink: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  timestamp: z.string().nullable(),
});
const mediaLimitSchema = z.coerce.number().int().min(1).max(12);

const mediaRoute = createRoute({
  method: 'get',
  path: '/api/media',
  tags: ['Automation'],
  summary: 'List recent Instagram media',
  request: {
    query: z.object({
      limit: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .openapi({
          example: '12',
          description: 'Optional integer from 1 through 12. Defaults to 12.',
        }),
    }),
  },
  responses: {
    200: {
      description: 'Up to twelve recent media items owned by the signed-in account.',
      content: {
        'application/json': { schema: z.object({ media: z.array(mediaItemSchema).max(12) }) },
      },
    },
    400: {
      description: 'The requested media limit is invalid.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'No active application session.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    502: {
      description: 'Instagram media is unavailable or returned an invalid response.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

/** Dependencies for authenticated recent-media requests. */
export interface MediaRouteDependencies extends SessionMiddlewareDependencies {
  /** Server-side adapter for the connected Instagram account's media. */
  instagramMediaClient: InstagramMediaClient;

  /** Logger receiving sanitized provider diagnostics only. */
  logger: Logger;

  /** Decrypts the connected account token immediately before the provider request. */
  tokenProtector: TokenProtector;
}

/** Registers the authenticated route that lists at most twelve recent Instagram media items. */
export const registerMediaRoute = (
  app: OpenAPIHono,
  dependencies: MediaRouteDependencies,
): void => {
  app.use('/api/media', createRequireSessionMiddleware(dependencies));
  app.openapi(mediaRoute, async (context) => {
    const limitValues = context.req.queries('limit') ?? [];
    const parsedLimit =
      limitValues.length <= 1 ? mediaLimitSchema.safeParse(limitValues[0] ?? '12') : undefined;
    if (!parsedLimit?.success) {
      return context.json(
        {
          error: {
            code: 'INVALID_MEDIA_LIMIT',
            message: 'Media limit must be an integer from 1 through 12',
          },
        },
        400,
      );
    }

    try {
      const { account } = context.get('authenticatedSession');
      const media = await dependencies.instagramMediaClient.listRecentMedia({
        accessToken: dependencies.tokenProtector.decrypt(account.accessTokenCiphertext),
        instagramUserId: account.instagramUserId,
        limit: parsedLimit.data,
      });
      return context.json({ media }, 200);
    } catch (error) {
      dependencies.logger.error(
        'Instagram media request failed',
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
  });
};
