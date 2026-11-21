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
            user: z.object({ id: z.string().uuid() }),
            connection: z
              .object({
                id: z.string().uuid(),
                provider: z.enum(['instagram', 'facebook']),
                externalAccountId: z.string(),
                displayName: z.string(),
                connectionStatus: z.enum(['active', 'reconnect_required']),
              })
              .nullable(),
            account: z
              .object({
                id: z.string().uuid(),
                instagramUserId: z.string(),
                connectionStatus: z.enum(['active', 'reconnect_required']),
                username: z.string(),
              })
              .nullable(),
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
    const { user, connection, account } = context.get('authenticatedSession');
    return context.json(
      {
        user: { id: user.id },
        connection: connection
          ? {
              id: connection.id,
              provider: connection.provider,
              externalAccountId: connection.externalAccountId,
              displayName: connection.displayName,
              connectionStatus: account?.connectionStatus ?? connection.connectionStatus,
            }
          : null,
        account: account
          ? {
              id: account.id,
              instagramUserId: account.instagramUserId,
              connectionStatus: account.connectionStatus,
              username: account.username,
            }
          : null,
      },
      200,
    );
  });
};
