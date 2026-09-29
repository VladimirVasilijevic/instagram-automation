import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMaintenanceHealth } from './maintenance-health.js';

afterEach(() => vi.unstubAllGlobals());

const health = {
  checkedAt: '2026-09-29T10:00:00.000Z',
  counts: {
    expiredTokenCount: 0,
    reconnectRequiredCount: 0,
    replyFailedCount: 0,
    replyRetryPendingCount: 0,
    replySucceededCount: 0,
    replyUncertainCount: 0,
    staleExecutionCount: 0,
    tokenRefreshFailedCount: 0,
    tokenRefreshedCount: 0,
  },
  lastFailedAt: null,
  lastFailureCode: null,
  lastSucceededAt: '2026-09-29T09:45:00.000Z',
  status: 'healthy',
};

describe('maintenance health API client', () => {
  it('loads safe health with same-origin credentials and no cache', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(health)));
    vi.stubGlobal('fetch', fetcher);

    await expect(getMaintenanceHealth()).resolves.toEqual(health);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/maintenance-health',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it.each([
    {},
    { ...health, status: 'unknown' },
    { ...health, checkedAt: 'not-a-date' },
    { ...health, counts: { ...health.counts, replyFailedCount: -1 } },
  ])('rejects an invalid response: %j', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(getMaintenanceHealth()).rejects.toThrow('invalid response');
  });
});
