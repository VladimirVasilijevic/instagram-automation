import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { errorResponseSchema } from '../contracts/http.js';
import {
  createRequireSessionMiddleware,
  type SessionMiddlewareDependencies,
} from '../middleware/session.js';

const meRoute = createRoute({
  method: 'get',
  path: '/api/me',
  tags: ['Authentication'],
  summary: 'Get the signed-in account',
  responses: {
    200: {
      description: 'Safe identity fields for the current session.',
      content: {
        'application/json': {
          schema: z.object({
            account: z.object({
              id: z.string().uuid(),
              instagramUserId: z.string(),
              username: z.string(),
            }),
          }),
        },
      },
    },
    401: {
      description: 'No active session.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    500: {
      description: 'Account lookup failed.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

/** Registers the session-protected endpoint without exposing tokens, hashes, or encryption data. */
export const registerMeRoute = (
  app: OpenAPIHono,
  dependencies: SessionMiddlewareDependencies,
): void => {
  app.use('/api/me', createRequireSessionMiddleware(dependencies));
  app.openapi(meRoute, (context) => {
    const { account } = context.get('authenticatedSession');
    return context.json(
      {
        account: {
          id: account.id,
          instagramUserId: account.instagramUserId,
          username: account.username,
        },
      },
      200,
    );
  });
};
