import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeToCommentDelivery } from '../api/webhook.js';
import { WebhookSubscription } from './WebhookSubscription.js';

vi.mock('../api/webhook.js', () => ({ subscribeToCommentDelivery: vi.fn() }));

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.clearAllMocks());

describe('comment delivery subscription', () => {
  it('enables comment delivery with a safe success state', async () => {
    vi.mocked(subscribeToCommentDelivery).mockResolvedValue(undefined);
    render(<WebhookSubscription />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable comment delivery' }));
    await waitFor(() => expect(subscribeToCommentDelivery).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('Comment delivery is enabled');
    expect(screen.getByRole('button', { name: 'Enable comment delivery' })).toBeDisabled();
  });

  it('does not expose subscription failure details', async () => {
    vi.mocked(subscribeToCommentDelivery).mockRejectedValue(new Error('private Meta response'));
    render(<WebhookSubscription />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable comment delivery' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be enabled');
    expect(screen.queryByText('private Meta response')).not.toBeInTheDocument();
  });
});
