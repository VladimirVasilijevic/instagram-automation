import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMaintenanceHealth } from '../api/maintenance-health.js';
import { MaintenanceHealthCard } from './MaintenanceHealthCard.js';

vi.mock('../api/maintenance-health.js', () => ({ getMaintenanceHealth: vi.fn() }));

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
  status: 'healthy' as const,
};

beforeEach(() => vi.resetAllMocks());

describe('maintenance health card', () => {
  it.each([
    ['healthy', 'Maintenance healthy'],
    ['attention', 'Maintenance needs attention'],
    ['delayed', 'Maintenance delayed'],
    ['never_run', 'Maintenance not observed'],
  ] as const)('shows the %s state', async (status, label) => {
    vi.mocked(getMaintenanceHealth).mockResolvedValue({ ...health, status });
    render(<MaintenanceHealthCard />);
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('shows a recoverable load failure', async () => {
    vi.mocked(getMaintenanceHealth)
      .mockRejectedValueOnce(new Error('private detail'))
      .mockResolvedValueOnce(health);
    render(<MaintenanceHealthCard />);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText('private detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Maintenance healthy')).toBeInTheDocument();
  });
});
