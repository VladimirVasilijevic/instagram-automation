import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getApiHealth, getDatabaseHealth } from './api/health.js';
import { App } from './App.js';

vi.mock('./api/health.js', () => ({
  getApiHealth: vi.fn(),
  getDatabaseHealth: vi.fn(),
}));

const apiHealthMock = vi.mocked(getApiHealth);
const databaseHealthMock = vi.mocked(getDatabaseHealth);

beforeEach(() => {
  apiHealthMock.mockReset();
  databaseHealthMock.mockReset();
});

describe('App', () => {
  it('shows independent connected states', async () => {
    apiHealthMock.mockResolvedValue({ status: 'ok' });
    databaseHealthMock.mockResolvedValue({ database: 'connected', status: 'ok' });

    render(<App />);

    expect(screen.getByText('Checking status…')).toBeDisabled();
    await waitFor(() => expect(screen.getAllByText('Connected')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled();
  });

  it('keeps the database result visible when the API check fails', async () => {
    apiHealthMock.mockRejectedValue(new Error('API unavailable'));
    databaseHealthMock.mockResolvedValue({ database: 'connected', status: 'ok' });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument());
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows a database unavailable response independently', async () => {
    apiHealthMock.mockResolvedValue({ status: 'ok' });
    databaseHealthMock.mockResolvedValue({ database: 'unavailable', status: 'error' });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument());
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows both services as unavailable when both checks fail', async () => {
    apiHealthMock.mockRejectedValue(new Error('API unavailable'));
    databaseHealthMock.mockRejectedValue(new Error('Database unavailable'));

    render(<App />);

    await waitFor(() => expect(screen.getAllByText('Unavailable')).toHaveLength(2));
  });

  it('refreshes both service states', async () => {
    apiHealthMock
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValue({ status: 'ok' });
    databaseHealthMock
      .mockResolvedValueOnce({ database: 'unavailable', status: 'error' })
      .mockResolvedValue({ database: 'connected', status: 'ok' });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText('Unavailable')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => expect(screen.getAllByText('Connected')).toHaveLength(2));
    expect(apiHealthMock).toHaveBeenCalledTimes(2);
    expect(databaseHealthMock).toHaveBeenCalledTimes(2);
  });

  it('links to the same-origin Swagger documentation', async () => {
    apiHealthMock.mockResolvedValue({ status: 'ok' });
    databaseHealthMock.mockResolvedValue({ database: 'connected', status: 'ok' });

    render(<App />);

    expect(screen.getByRole('link', { name: 'Open API documentation' })).toHaveAttribute(
      'href',
      '/api/docs',
    );
  });
});
