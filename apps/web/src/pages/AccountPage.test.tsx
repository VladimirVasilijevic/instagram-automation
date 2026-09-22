import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCurrentAccount, logout } from '../api/auth.js';
import { getAutomation } from '../api/automation.js';
import { getRecentMedia } from '../api/media.js';
import { AccountPage } from './AccountPage.js';

vi.mock('../api/auth.js', () => ({ getCurrentAccount: vi.fn(), logout: vi.fn() }));
vi.mock('../api/automation.js', () => ({ getAutomation: vi.fn(), saveAutomation: vi.fn() }));
vi.mock('../api/media.js', () => ({ getRecentMedia: vi.fn() }));
const account = { id: 'account-id', instagramUserId: '17841400000000001', username: 'example' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getRecentMedia).mockResolvedValue([]);
  vi.mocked(getAutomation).mockResolvedValue(null);
  window.history.replaceState(null, '', '/');
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('account and connect screens', () => {
  it('loads before offering same-origin Instagram login', async () => {
    vi.mocked(getCurrentAccount).mockResolvedValue(null);
    render(<AccountPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your connection');
    expect(await screen.findByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute(
      'href',
      '/api/auth/instagram/start',
    );
    expect(screen.getByRole('link', { name: 'Service status' })).toHaveAttribute('href', '/status');
  });
  it('restores an authenticated account from the server on reload', async () => {
    window.history.replaceState(null, '', '/app');
    vi.mocked(getCurrentAccount).mockResolvedValue(account);
    const first = render(<AccountPage />);
    expect(await screen.findByText('Connected as @example')).toBeInTheDocument();
    first.unmount();
    render(<AccountPage />);
    expect(await screen.findByText('Connected as @example')).toBeInTheDocument();
    expect(getCurrentAccount).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe('/app');
  });
  it('returns an expired /app session to the connect screen', async () => {
    window.history.replaceState(null, '', '/app');
    vi.mocked(getCurrentAccount).mockResolvedValue(null);
    render(<AccountPage />);
    await screen.findByRole('link', { name: 'Continue with Instagram' });
    expect(window.location.pathname).toBe('/');
  });
  it('shows recoverable account lookup errors and retries', async () => {
    vi.mocked(getCurrentAccount)
      .mockRejectedValueOnce(new Error('secret-detail'))
      .mockResolvedValueOnce(account);
    render(<AccountPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not check your account');
    expect(screen.queryByText('secret-detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Connected as @example')).toBeInTheDocument();
  });
  it.each([
    ['invalid_state', 'expired or could not be verified'],
    ['cancelled', 'was cancelled'],
    ['permissions', 'Allow profile and comment access'],
    ['configuration', 'not configured for this website'],
    ['unavailable', 'could not complete Instagram login'],
  ])('displays safe %s callback errors', async (code, message) => {
    window.history.replaceState(null, '', `/?login_error=${code}`);
    vi.mocked(getCurrentAccount).mockResolvedValue(null);
    render(<AccountPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(window.location.search).toBe('');
  });
  it('does not reflect arbitrary query text into the screen', async () => {
    window.history.replaceState(null, '', '/?login_error=secret-detail');
    vi.mocked(getCurrentAccount).mockResolvedValue(null);
    render(<AccountPage />);
    await screen.findByRole('link', { name: 'Continue with Instagram' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-detail')).not.toBeInTheDocument();
  });
  it('logs out and clears the displayed identity', async () => {
    vi.mocked(getCurrentAccount).mockResolvedValue(account);
    vi.mocked(logout).mockResolvedValue(undefined);
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(screen.getByRole('button', { name: 'Logging out…' })).toBeDisabled();
    await screen.findByRole('link', { name: 'Continue with Instagram' });
    expect(screen.queryByText('Connected as @example')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
  it('keeps the identity visible when logout fails and allows a retry', async () => {
    vi.mocked(getCurrentAccount).mockResolvedValue(account);
    vi.mocked(logout)
      .mockRejectedValueOnce(new Error('secret-detail'))
      .mockResolvedValueOnce(undefined);
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Logout could not be completed');
    expect(screen.getByText('Connected as @example')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toBeInTheDocument(),
    );
  });
});
