import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecentExecutions } from '../api/executions.js';
import { RecentActivity } from './RecentActivity.js';

vi.mock('../api/executions.js', () => ({ getRecentExecutions: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe('RecentActivity', () => {
  it('renders empty and successful activity states', async () => {
    vi.mocked(getRecentExecutions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          commenterUsername: 'commenter',
          commentText: '#Hello',
          createdAt: '2026-09-24T12:00:00.000Z',
          errorCode: null,
          errorMessage: null,
          status: 'succeeded',
        },
      ]);
    render(<RecentActivity />);
    expect(await screen.findByText('No automation activity yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
    expect(await screen.findByText('@commenter')).toBeInTheDocument();
    expect(screen.getByText('Reply sent')).toBeInTheDocument();
  });

  it('renders safe failures and retries loading', async () => {
    vi.mocked(getRecentExecutions)
      .mockRejectedValueOnce(new Error('private database detail'))
      .mockResolvedValueOnce([
        {
          commenterUsername: null,
          commentText: '#Hello',
          createdAt: '2026-09-24T12:00:00.000Z',
          errorCode: 'INSTAGRAM_REPLY_UNAVAILABLE',
          errorMessage: 'The public reply could not be sent.',
          status: 'failed',
        },
      ]);
    render(<RecentActivity />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not load');
    expect(screen.queryByText('private database detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument());
    expect(screen.getByText('The public reply could not be sent.')).toBeInTheDocument();
  });
});
