import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { MAINTENANCE_STATUS, type MaintenanceStatus } from '@instagram-automation/contracts';

import { errorResponseSchema } from '../contracts/http.js';
import type {
  MaintenanceCounts,
  MaintenanceHealth,
  MaintenanceHealthRepository,
} from '../database/repositories.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import {
  createRequireSessionMiddleware,
  type SessionMiddlewareDependencies,
} from '../middleware/session.js';

const maintenanceStatusSchema = z.enum(MAINTENANCE_STATUS);
const countsSchema = z.object({
  expiredTokenCount: z.number().int().nonnegative(),
  reconnectRequiredCount: z.number().int().nonnegative(),
  replyFailedCount: z.number().int().nonnegative(),
  replyRetryPendingCount: z.number().int().nonnegative(),
  replySucceededCount: z.number().int().nonnegative(),
  replyUncertainCount: z.number().int().nonnegative(),
  staleExecutionCount: z.number().int().nonnegative(),
  tokenRefreshFailedCount: z.number().int().nonnegative(),
  tokenRefreshedCount: z.number().int().nonnegative(),
});
const healthResponseSchema = z.object({
  checkedAt: z.string().datetime(),
  counts: countsSchema,
  lastFailedAt: z.string().datetime().nullable(),
  lastFailureCode: z.string().nullable(),
  lastSucceededAt: z.string().datetime().nullable(),
  status: maintenanceStatusSchema,
});
const maintenanceHealthRoute = createRoute({
  method: 'get',
  path: '/api/maintenance-health',
  tags: ['Operations'],
  summary: 'Get scheduled-maintenance health for the signed-in owner',
  responses: {
    200: {
      description: 'Safe durable maintenance heartbeat and aggregate counters.',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
    401: {
      description: 'No active application session.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    503: {
      description: 'Maintenance health storage is unavailable.',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

/** Dependencies for the authenticated maintenance-health endpoint. */
export interface MaintenanceHealthRouteDependencies extends SessionMiddlewareDependencies {
  /** Receives only sanitized storage failures. */
  logger: Logger;
  /** Loads the durable scheduler heartbeat. */
  maintenanceHealthRepository: Pick<MaintenanceHealthRepository, 'getHealth'>;
}

const emptyCounts = (): MaintenanceCounts => ({
  expiredTokenCount: 0,
  reconnectRequiredCount: 0,
  replyFailedCount: 0,
  replyRetryPendingCount: 0,
  replySucceededCount: 0,
  replyUncertainCount: 0,
  staleExecutionCount: 0,
  tokenRefreshFailedCount: 0,
  tokenRefreshedCount: 0,
});

const maintenanceCounts = (health: MaintenanceCounts): MaintenanceCounts => ({
  expiredTokenCount: health.expiredTokenCount,
  reconnectRequiredCount: health.reconnectRequiredCount,
  replyFailedCount: health.replyFailedCount,
  replyRetryPendingCount: health.replyRetryPendingCount,
  replySucceededCount: health.replySucceededCount,
  replyUncertainCount: health.replyUncertainCount,
  staleExecutionCount: health.staleExecutionCount,
  tokenRefreshFailedCount: health.tokenRefreshFailedCount,
  tokenRefreshedCount: health.tokenRefreshedCount,
});

const hasActionableCounts = (health: MaintenanceCounts): boolean =>
  health.expiredTokenCount > 0 ||
  health.reconnectRequiredCount > 0 ||
  health.replyFailedCount > 0 ||
  health.replyUncertainCount > 0 ||
  health.tokenRefreshFailedCount > 0;

const maintenanceStatus = (health: MaintenanceHealth | null): MaintenanceStatus => {
  if (
    health?.lastFailedAt &&
    (!health.lastSucceededAt || health.lastFailedAt > health.lastSucceededAt)
  )
    return MAINTENANCE_STATUS.ATTENTION;
  if (!health?.lastSucceededAt) return MAINTENANCE_STATUS.NEVER_RUN;
  if (health.checkedAt.getTime() - health.lastSucceededAt.getTime() > 45 * 60 * 1000)
    return MAINTENANCE_STATUS.DELAYED;
  return hasActionableCounts(health) ? MAINTENANCE_STATUS.ATTENTION : MAINTENANCE_STATUS.HEALTHY;
};

/** Registers the session-protected durable maintenance-health endpoint. */
export const registerMaintenanceHealthRoute = (
  app: OpenAPIHono,
  dependencies: MaintenanceHealthRouteDependencies,
): void => {
  app.use('/api/maintenance-health', createRequireSessionMiddleware(dependencies));
  app.openapi(maintenanceHealthRoute, async (context) => {
    try {
      const health = await dependencies.maintenanceHealthRepository.getHealth();
      const checkedAt = health?.checkedAt ?? new Date();
      return context.json(
        {
          checkedAt: checkedAt.toISOString(),
          counts: health ? maintenanceCounts(health) : emptyCounts(),
          lastFailedAt: health?.lastFailedAt?.toISOString() ?? null,
          lastFailureCode: health?.lastFailureCode ?? null,
          lastSucceededAt: health?.lastSucceededAt?.toISOString() ?? null,
          status: maintenanceStatus(health),
        },
        200,
      );
    } catch (error) {
      dependencies.logger.error('Maintenance health load failed', toSafeErrorContext(error));
      return context.json(
        {
          error: {
            code: 'MAINTENANCE_HEALTH_UNAVAILABLE',
            message: 'Maintenance health is unavailable. Please try again.',
          },
        },
        503,
      );
    }
  });
};
