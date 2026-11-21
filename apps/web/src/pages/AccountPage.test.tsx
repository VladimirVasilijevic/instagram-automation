import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCurrentViewer, logout } from '../api/auth.js';
import { getCapabilities } from '../api/capabilities.js';
import { getAutomation } from '../api/automation.js';
import { getRecentExecutions } from '../api/executions.js';
import { getPendingFacebookPages, selectFacebookPage } from '../api/facebook-pages.js';
import { getRecentDmAnswers } from '../api/dm-answers.js';
import { getMaintenanceHealth } from '../api/maintenance-health.js';
import { getRecentMedia } from '../api/media.js';
import { AccountPage } from './AccountPage.js';

vi.mock('../api/auth.js', () => ({ getCurrentViewer: vi.fn(), logout: vi.fn() }));
vi.mock('../api/capabilities.js', () => ({ getCapabilities: vi.fn() }));
vi.mock('../api/automation.js', () => ({ getAutomation: vi.fn(), saveAutomation: vi.fn() }));
vi.mock('../api/executions.js', () => ({ getRecentExecutions: vi.fn() }));
vi.mock('../api/facebook-pages.js', () => ({
  getPendingFacebookPages: vi.fn(),
  selectFacebookPage: vi.fn(),
}));
vi.mock('../api/dm-answers.js', () => ({ getRecentDmAnswers: vi.fn() }));
vi.mock('../api/maintenance-health.js', () => ({ getMaintenanceHealth: vi.fn() }));
vi.mock('../api/media.js', () => ({ getRecentMedia: vi.fn() }));

const instagramViewer = {
  user: { id: 'user-id', displayName: 'Ava' },
  connection: {
    id: 'connection-id',
    provider: 'instagram' as const,
    externalAccountId: '17841400000000001',
    displayName: 'example',
    connectionStatus: 'active' as const,
  },
};
const facebookViewer = {
  user: { id: 'user-id', displayName: 'Ava' },
  connection: {
    id: 'page-connection-id',
    provider: 'facebook' as const,
    externalAccountId: 'page-id',
    displayName: 'My Bakery',
    connectionStatus: 'active' as const,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCapabilities).mockResolvedValue({ facebookLoginEnabled: true });
  vi.mocked(getRecentMedia).mockResolvedValue([]);
  vi.mocked(getAutomation).mockResolvedValue(null);
  vi.mocked(getRecentExecutions).mockResolvedValue([]);
  vi.mocked(getRecentDmAnswers).mockResolvedValue([]);
  vi.mocked(getMaintenanceHealth).mockResolvedValue({
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
  });
  window.history.replaceState(null, '', '/');
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('ReplyKit account screens', () => {
  it('offers both sign-in providers when signed out', async () => {
    vi.mocked(getCurrentViewer).mockResolvedValue(null);
    render(<AccountPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(await screen.findByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute(
      'href',
      '/api/auth/instagram/start',
    );
    expect(await screen.findByRole('link', { name: 'Continue with Facebook' })).toHaveAttribute(
      'href',
      '/api/auth/facebook/start',
    );
  });

  it('offers connection choices to a signed-in user with no connection', async () => {
    vi.mocked(getCurrentViewer).mockResolvedValue({ ...instagramViewer, connection: null });
    render(<AccountPage />);
    expect(
      await screen.findByRole('heading', { name: 'Connect a social account' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect Instagram' })).toHaveAttribute(
      'href',
      '/api/auth/instagram/start',
    );
    expect(await screen.findByRole('link', { name: 'Connect Facebook Page' })).toHaveAttribute(
      'href',
      '/api/connections/facebook/start',
    );
    expect(screen.queryByText('Create your automation')).not.toBeInTheDocument();
  });

  it('hides Facebook entry points when the API does not enable Facebook login', async () => {
    vi.mocked(getCapabilities).mockResolvedValue({ facebookLoginEnabled: false });
    vi.mocked(getCurrentViewer).mockResolvedValue(null);
    render(<AccountPage />);
    await screen.findByRole('link', { name: 'Continue with Instagram' });
    expect(screen.queryByRole('link', { name: 'Continue with Facebook' })).not.toBeInTheDocument();
  });

  it('shows the connected Instagram workspace and keeps the user menu separate', async () => {
    vi.mocked(getCurrentViewer).mockResolvedValue(instagramViewer);
    render(<AccountPage />);
    expect(await screen.findByRole('heading', { name: 'Connected' })).toBeInTheDocument();
    expect(screen.getByLabelText('Account menu for Ava')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View account' })).toHaveAttribute('href', '/account');
    expect(screen.getByText('Instagram connection')).toBeInTheDocument();
  });

  it('shows Facebook Page identity and provider-specific reconnect action', async () => {
    window.history.replaceState(null, '', '/account');
    vi.mocked(getCurrentViewer).mockResolvedValue({
      ...facebookViewer,
      connection: { ...facebookViewer.connection, connectionStatus: 'reconnect_required' },
    });
    render(<AccountPage />);
    expect(await screen.findByText('Connected as My Bakery')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reconnect Facebook Page' })).toHaveAttribute(
      'href',
      '/api/connections/facebook/start',
    );
    expect(screen.getByRole('heading', { name: 'Automation health' })).toBeInTheDocument();
  });

  it('hides an unavailable Facebook reconnect action', async () => {
    window.history.replaceState(null, '', '/account');
    vi.mocked(getCapabilities).mockResolvedValue({ facebookLoginEnabled: false });
    vi.mocked(getCurrentViewer).mockResolvedValue({
      ...facebookViewer,
      connection: { ...facebookViewer.connection, connectionStatus: 'reconnect_required' },
    });
    render(<AccountPage />);
    expect(await screen.findByText('Connected as My Bakery')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reconnect Facebook Page' })).not.toBeInTheDocument();
  });

  it('requires explicit selection when Facebook returns multiple Pages', async () => {
    window.history.replaceState(null, '', '/app?facebook_selection=selection-id');
    vi.mocked(getCurrentViewer)
      .mockResolvedValueOnce({ ...facebookViewer, connection: null })
      .mockResolvedValueOnce(facebookViewer);
    vi.mocked(getPendingFacebookPages).mockResolvedValue([
      { id: 'page-a', name: 'Bakery A' },
      { id: 'page-b', name: 'Bakery B' },
    ]);
    vi.mocked(selectFacebookPage).mockResolvedValue(undefined);
    render(<AccountPage />);
    expect(await screen.findByRole('button', { name: 'Connect Bakery A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Bakery B' })).toBeInTheDocument();
    expect(selectFacebookPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Bakery B' }));
    await waitFor(() => expect(selectFacebookPage).toHaveBeenCalledWith('selection-id', 'page-b'));
    expect(await screen.findByText('Facebook Page connection')).toBeInTheDocument();
  });

  it('lets a connected Facebook Page owner select a Page after reauthorization', async () => {
    window.history.replaceState(null, '', '/app?facebook_selection=reauthorization-id');
    vi.mocked(getCurrentViewer).mockResolvedValue(facebookViewer);
    vi.mocked(getPendingFacebookPages).mockResolvedValue([{ id: 'page-a', name: 'Bakery A' }]);
    vi.mocked(selectFacebookPage).mockResolvedValue(undefined);
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Bakery A' }));
    await waitFor(() =>
      expect(selectFacebookPage).toHaveBeenCalledWith('reauthorization-id', 'page-a'),
    );
  });

  it('does not expose a pending Page query value in an error', async () => {
    window.history.replaceState(null, '', '/app?facebook_selection=secret-detail');
    vi.mocked(getCurrentViewer).mockResolvedValue({ ...facebookViewer, connection: null });
    vi.mocked(getPendingFacebookPages).mockRejectedValue(new Error('secret-detail'));
    render(<AccountPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not load your Pages');
    expect(screen.queryByText('secret-detail')).not.toBeInTheDocument();
  });

  it('logs out without keeping the connected identity visible', async () => {
    vi.mocked(getCurrentViewer).mockResolvedValue(instagramViewer);
    vi.mocked(logout).mockResolvedValue(undefined);
    render(<AccountPage />);
    fireEvent.click(await screen.findByLabelText('Account menu for Ava'));
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('link', { name: 'Continue with Instagram' });
    expect(screen.queryByLabelText('Account menu for Ava')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
