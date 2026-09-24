import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { errorResponseSchema } from '../contracts/http.js';
import type { Execution, ExecutionRepository } from '../database/repositories.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  createRequireSessionMiddleware,
  type SessionMiddlewareDependencies,
} from '../middleware/session.js';

const executionSchema = z.object({
  commenterUsername: z.string().nullable(),
  commentText: z.string(),
  createdAt: z.string().datetime(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  status: z.enum(['failed', 'processing', 'succeeded']),
});
const executionLimitSchema = z.coerce.number().int().min(1).max(50);
const executionsRoute = createRoute({
  method: 'get',
  path: '/api/executions',
  tags: ['Activity'],
  summary: 'List recent automation activity for the signed-in account',
  request: {
    query: z.object({
      limit: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .openapi({ example: '50' }),
    }),
  },
  responses: {
    200: {
      description: 'Recent account-owned automation executions, newest first.',
      content: {
        'application/json': { schema: z.object({ executions: z.array(executionSchema) }) },
      },
    },
    400: {
      description: 'The requested activity limit is invalid.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'No active application session.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    503: {
      description: 'Activity storage is unavailable.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

/** Dependencies for the authenticated recent-execution activity endpoint. */
export interface ExecutionRouteDependencies extends SessionMiddlewareDependencies {
  /** Lists executions scoped by the authenticated account ID. */
  executionRepository: Pick<ExecutionRepository, 'listRecentByAccountId'>;
  /** Receives sanitized storage failures. */
  logger: Logger;
}

const toExecutionResponse = (execution: Execution) => ({
  commenterUsername: execution.commenterUsername,
  commentText: execution.commentText,
  createdAt: execution.createdAt.toISOString(),
  errorCode: execution.errorCode,
  errorMessage: execution.errorMessage,
  status: execution.status,
});

/** Registers the session-protected route that returns safe, account-owned automation activity. */
export const registerExecutionRoutes = (
  app: OpenAPIHono,
  dependencies: ExecutionRouteDependencies,
): void => {
  app.use('/api/executions', createRequireSessionMiddleware(dependencies));
  app.openapi(executionsRoute, async (context) => {
    const limitValues = context.req.queries('limit') ?? [];
    const parsedLimit =
      limitValues.length <= 1 ? executionLimitSchema.safeParse(limitValues[0] ?? '50') : undefined;
    if (!parsedLimit?.success) {
      return context.json(
        {
          error: {
            code: 'INVALID_EXECUTION_LIMIT',
            message: 'Activity limit must be an integer from 1 through 50',
          },
        },
        400,
      );
    }
    try {
      const { account } = context.get('authenticatedSession');
      const executions = await dependencies.executionRepository.listRecentByAccountId(
        account.id,
        parsedLimit.data,
      );
      return context.json({ executions: executions.map(toExecutionResponse) }, 200);
    } catch (error) {
      dependencies.logger.error('Execution activity load failed', toSafeErrorContext(error));
      return context.json(
        {
          error: {
            code: 'EXECUTION_STORE_UNAVAILABLE',
            message: 'Activity is unavailable. Please try again.',
          },
        },
        503,
      );
    }
  });
};
