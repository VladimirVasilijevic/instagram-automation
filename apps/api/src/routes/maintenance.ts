import { timingSafeEqual } from 'node:crypto';

import type { OpenAPIHono } from '@hono/zod-openapi';

import type { MaintenanceSummary } from '../maintenance/run-maintenance.js';
import type { MaintenanceHealthRepository } from '../database/repositories.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';

/** Internal scheduler route configuration. */
export interface MaintenanceRouteDependencies {
  /** Server-only bearer credential shared with the scheduler. */
  cronSecret: string;
  /** Structured logger that receives only sanitized maintenance failures. */
  logger: Logger;
  /** Persists durable success and failure timestamps for owner-visible monitoring. */
  maintenanceHealthRepository: Pick<MaintenanceHealthRepository, 'recordFailure' | 'recordSuccess'>;
  /** Runs one bounded maintenance pass after authentication succeeds. */
  runMaintenance(): Promise<MaintenanceSummary>;
}

const equal = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

/** Registers the bearer-protected endpoint invoked by Supabase Cron. */
export const registerMaintenanceRoute = (
  app: OpenAPIHono,
  dependencies: MaintenanceRouteDependencies,
): void => {
  app.post('/api/internal/maintenance', async (context) => {
    context.header('Cache-Control', 'no-store');
    const authorization = context.req.header('authorization');
    if (!authorization || !equal(authorization, `Bearer ${dependencies.cronSecret}`))
      return context.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401);
    try {
      const summary = await dependencies.runMaintenance();
      await dependencies.maintenanceHealthRepository.recordSuccess(summary);
      return context.json(summary, 200);
    } catch (error) {
      dependencies.logger.error('Instagram maintenance failed', toSafeErrorContext(error));
      try {
        await dependencies.maintenanceHealthRepository.recordFailure('MAINTENANCE_FAILED');
      } catch (recordError) {
        dependencies.logger.error(
          'Maintenance failure heartbeat could not be recorded',
          toSafeErrorContext(recordError),
        );
      }
      return context.json(
        { error: { code: 'MAINTENANCE_FAILED', message: 'Maintenance could not be completed' } },
        500,
      );
    }
  });
};
