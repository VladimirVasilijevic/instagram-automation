import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedSession, MaintenanceHealth } from '../database/repositories.js';
import type { Logger } from '../logging/logger.js';
import { createSessionToken } from '../security/session-token.js';
import type { ProtectedToken } from '../security/token-protector.js';
import { registerMaintenanceHealthRoute } from './maintenance-health.js';

const now = new Date('2026-09-29T10:00:00.000Z');
const counts = {
  expiredTokenCount: 0,
  reconnectRequiredCount: 0,
  replyFailedCount: 0,
  replyRetryPendingCount: 0,
  replySucceededCount: 0,
  replyUncertainCount: 0,
  staleExecutionCount: 0,
  tokenRefreshFailedCount: 0,
  tokenRefreshedCount: 0,
};
const authenticatedSession: AuthenticatedSession = {
  account: {
    accessTokenCiphertext: 'protected-token' as ProtectedToken,
    connectionStatus: 'active',
    createdAt: now,
    id: '24e76a49-b1c7-4351-bc24-c4c7ad7a8a1f',
    instagramUserId: 'instagram-user-id',
    tokenExpiresAt: new Date('2026-11-01T00:00:00.000Z'),
    tokenRefreshFailureCode: null,
    tokenRefreshLastSucceededAt: null,
    tokenRefreshNextAttemptAt: null,
    updatedAt: now,
    username: 'owner',
  },
  session: {
    accountId: '24e76a49-b1c7-4351-bc24-c4c7ad7a8a1f',
    createdAt: now,
    expiresAt: new Date('2026-09-30T10:00:00.000Z'),
    id: '7bea89b7-b9da-4d6a-bff7-c68c3f408e16',
  },
};

const fixture = (health: MaintenanceHealth | null) => {
  const app = new OpenAPIHono();
  const logger: Logger = { error: vi.fn(), info: vi.fn() };
  const sessionToken = createSessionToken();
  const maintenanceHealthRepository = { getHealth: vi.fn().mockResolvedValue(health) };
  registerMaintenanceHealthRoute(app, {
    logger,
    maintenanceHealthRepository,
    sessionCookie: { name: 'igauto_session', secure: false, ttlSeconds: 3600 },
    sessionRepository: {
      findActiveByTokenHash: vi.fn().mockResolvedValue(authenticatedSession),
    },
  });
  return {
    app,
    headers: { Cookie: `igauto_session=${sessionToken.token}` },
    logger,
    maintenanceHealthRepository,
  };
};

describe('maintenance health route', () => {
  it('requires an active application session', async () => {
    const f = fixture(null);
    expect((await f.app.request('/api/maintenance-health')).status).toBe(401);
    expect(f.maintenanceHealthRepository.getHealth).not.toHaveBeenCalled();
  });

  it('returns a healthy recent heartbeat with safe aggregate counters', async () => {
    const f = fixture({
      ...counts,
      checkedAt: now,
      lastFailedAt: null,
      lastFailureCode: null,
      lastSucceededAt: new Date('2026-09-29T09:45:00.000Z'),
    });

    const response = await f.app.request('/api/maintenance-health', { headers: f.headers });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checkedAt: now.toISOString(),
      counts,
      lastFailedAt: null,
      lastFailureCode: null,
      lastSucceededAt: '2026-09-29T09:45:00.000Z',
      status: 'healthy',
    });
  });

  it.each([
    [
      {
        ...counts,
        checkedAt: now,
        lastFailedAt: null,
        lastFailureCode: null,
        lastSucceededAt: new Date('2026-09-29T09:00:00.000Z'),
      },
      'delayed',
    ],
    [
      {
        ...counts,
        checkedAt: now,
        lastFailedAt: new Date('2026-09-29T09:55:00.000Z'),
        lastFailureCode: 'MAINTENANCE_FAILED',
        lastSucceededAt: new Date('2026-09-29T09:45:00.000Z'),
      },
      'attention',
    ],
    [
      {
        ...counts,
        checkedAt: now,
        lastFailedAt: null,
        lastFailureCode: null,
        lastSucceededAt: new Date('2026-09-29T09:45:00.000Z'),
        replyUncertainCount: 1,
      },
      'attention',
    ],
  ] as const)('returns %s as %s', async (health, expectedStatus) => {
    const f = fixture(health);
    const response = await f.app.request('/api/maintenance-health', { headers: f.headers });
    expect((await response.json()).status).toBe(expectedStatus);
  });

  it('returns never_run before the first recorded heartbeat', async () => {
    const f = fixture(null);
    const response = await f.app.request('/api/maintenance-health', { headers: f.headers });
    expect((await response.json()).status).toBe('never_run');
  });

  it('sanitizes storage failures', async () => {
    const f = fixture(null);
    f.maintenanceHealthRepository.getHealth.mockRejectedValue(new Error('private database detail'));
    const response = await f.app.request('/api/maintenance-health', { headers: f.headers });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database detail');
    expect(f.logger.error).toHaveBeenCalledWith('Maintenance health load failed', {
      errorName: 'Error',
    });
  });
});
