import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { EXECUTION_STATUS } from '@instagram-automation/contracts';

import { errorResponseSchema } from '../contracts/http.js';
import type { DmConversationRepository } from '../database/repositories.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  createRequireSessionMiddleware,
  type SessionMiddlewareDependencies,
} from '../middleware/session.js';

const answerSchema = z.object({
  choiceTitle: z.string().nullable(),
  commenterUsername: z.string().nullable(),
  followupStatus: z.enum(['pending', ...Object.values(EXECUTION_STATUS)]).nullable(),
  mediaId: z.string().nullable(),
  receivedAt: z.string().datetime(),
  typedText: z.string().nullable(),
});
const route = createRoute({
  method: 'get',
  path: '/api/dm-answers',
  tags: ['Activity'],
  summary: 'List recent quick-reply and typed DM answers for the signed-in account',
  request: {
    query: z.object({ mediaId: z.string().optional().openapi({ example: '17841400000000002' }) }),
  },
  responses: {
    200: {
      description: 'Recent account-owned incoming answers and follow-up statuses.',
      content: { 'application/json': { schema: z.object({ answers: z.array(answerSchema) }) } },
    },
    401: {
      description: 'No active application session.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    400: {
      description: 'The requested post filter is invalid.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    503: {
      description: 'Answer activity is unavailable.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

/** Registers the owner-only recent DM answer feed. */
export const registerDmAnswerRoutes = (
  app: OpenAPIHono,
  dependencies: SessionMiddlewareDependencies & {
    dmConversationRepository: Pick<DmConversationRepository, 'listRecentAnswersByAccountId'>;
    logger: Logger;
  },
): void => {
  app.use('/api/dm-answers', createRequireSessionMiddleware(dependencies));
  app.openapi(route, async (context) => {
    const mediaIdValues = context.req.queries('mediaId') ?? [];
    const parsedMediaId =
      mediaIdValues.length === 1 ? z.string().trim().min(1).safeParse(mediaIdValues[0]) : undefined;
    if (mediaIdValues.length > 1 || (mediaIdValues.length === 1 && !parsedMediaId?.success)) {
      return context.json(
        {
          error: {
            code: 'INVALID_DM_ANSWER_MEDIA_ID',
            message: 'Answer post identifier must be a non-empty value',
          },
        },
        400,
      );
    }
    const { account } = context.get('authenticatedSession');
    try {
      const rows = await dependencies.dmConversationRepository.listRecentAnswersByAccountId(
        account.id,
        50,
        parsedMediaId?.success ? parsedMediaId.data : undefined,
      );
      return context.json(
        {
          answers: rows.map(({ answer, choiceTitle, commenterUsername, followup, mediaId }) => ({
            choiceTitle,
            commenterUsername,
            followupStatus: followup?.status ?? null,
            mediaId,
            receivedAt: answer.receivedAt.toISOString(),
            typedText: answer.optionId ? null : answer.text,
          })),
        },
        200,
      );
    } catch (error) {
      dependencies.logger.error('DM answer activity load failed', toSafeErrorContext(error));
      return context.json(
        { error: { code: 'DM_ANSWERS_UNAVAILABLE', message: 'DM answers are unavailable.' } },
        503,
      );
    }
  });
};
