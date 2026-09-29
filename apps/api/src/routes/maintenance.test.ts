import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../logging/logger.js';
import type { MaintenanceSummary } from '../maintenance/run-maintenance.js';
import { registerMaintenanceRoute } from './maintenance.js';

const summary: MaintenanceSummary = {
  expiredTokenCount: 0,
  reconnectRequiredCount: 1,
  replyFailedCount: 0,
  replyRetryPendingCount: 1,
  replySucceededCount: 2,
  replyUncertainCount: 0,
  staleExecutionCount: 1,
  tokenRefreshFailedCount: 0,
  tokenRefreshedCount: 3,
};

const fixture = () => {
  const app = new OpenAPIHono();
  const logger: Logger = { error: vi.fn(), info: vi.fn() };
  const maintenanceHealthRepository = {
    recordFailure: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
  };
  const runMaintenance = vi.fn().mockResolvedValue(summary);
  registerMaintenanceRoute(app, {
    cronSecret: 'c'.repeat(32),
    logger,
    maintenanceHealthRepository,
    runMaintenance,
  });
  return { app, logger, maintenanceHealthRepository, runMaintenance };
};

describe('scheduled maintenance route', () => {
  it('rejects missing and incorrect bearer credentials without running maintenance', async () => {
    const f = fixture();

    expect((await f.app.request('/api/internal/maintenance', { method: 'POST' })).status).toBe(401);
    expect(
      (
        await f.app.request('/api/internal/maintenance', {
          method: 'POST',
          headers: { authorization: `Bearer ${'x'.repeat(32)}` },
        })
      ).status,
    ).toBe(401);
    expect(f.runMaintenance).not.toHaveBeenCalled();
  });

  it('returns only aggregate counts for an authorized run', async () => {
    const f = fixture();
    const response = await f.app.request('/api/internal/maintenance', {
      method: 'POST',
      headers: { authorization: `Bearer ${'c'.repeat(32)}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual(summary);
    expect(f.runMaintenance).toHaveBeenCalledOnce();
    expect(f.maintenanceHealthRepository.recordSuccess).toHaveBeenCalledWith(summary);
  });

  it('sanitizes maintenance failures', async () => {
    const f = fixture();
    f.runMaintenance.mockRejectedValue(new Error('private database detail'));
    const response = await f.app.request('/api/internal/maintenance', {
      method: 'POST',
      headers: { authorization: `Bearer ${'c'.repeat(32)}` },
    });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain('private database detail');
    expect(f.logger.error).toHaveBeenCalledWith('Instagram maintenance failed', {
      errorName: 'Error',
    });
    expect(f.maintenanceHealthRepository.recordFailure).toHaveBeenCalledWith('MAINTENANCE_FAILED');
  });

  it('still returns a sanitized failure when the failure heartbeat cannot be stored', async () => {
    const f = fixture();
    f.runMaintenance.mockRejectedValue(new Error('private provider detail'));
    f.maintenanceHealthRepository.recordFailure.mockRejectedValue(
      new Error('private database detail'),
    );

    const response = await f.app.request('/api/internal/maintenance', {
      method: 'POST',
      headers: { authorization: `Bearer ${'c'.repeat(32)}` },
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private');
    expect(f.logger.error).toHaveBeenCalledTimes(2);
  });
});
