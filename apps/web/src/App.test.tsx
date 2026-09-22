import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

vi.mock('./pages/AccountPage.js', () => ({ AccountPage: () => <p>Account page</p> }));
vi.mock('./pages/PrivacyPage.js', () => ({ PrivacyPage: () => <p>Privacy page</p> }));
vi.mock('./pages/StatusPage.js', () => ({ StatusPage: () => <p>Status page</p> }));

afterEach(() => window.history.replaceState(null, '', '/'));

describe('App routing', () => {
  it.each(['/', '/app'])('renders account screens at %s', (path) => {
    window.history.replaceState(null, '', path);
    render(<App />);
    expect(screen.getByText('Account page')).toBeInTheDocument();
  });
  it('preserves infrastructure status at /status', () => {
    window.history.replaceState(null, '', '/status');
    render(<App />);
    expect(screen.getByText('Status page')).toBeInTheDocument();
  });
  it('renders the public privacy policy at /privacy', () => {
    window.history.replaceState(null, '', '/privacy');
    render(<App />);
    expect(screen.getByText('Privacy page')).toBeInTheDocument();
  });
  it('offers a way back from an unknown route', () => {
    window.history.replaceState(null, '', '/unknown');
    render(<App />);
    expect(screen.getByRole('link', { name: 'Return to Instagram Automation' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
