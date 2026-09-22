import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAutomation, saveAutomation } from '../api/automation.js';
import { getRecentMedia } from '../api/media.js';
import { AutomationEditor } from './AutomationEditor.js';

vi.mock('../api/automation.js', () => ({ getAutomation: vi.fn(), saveAutomation: vi.fn() }));
vi.mock('../api/media.js', () => ({ getRecentMedia: vi.fn() }));

const media = [
  {
    id: '17841400000000002',
    mediaType: 'IMAGE',
    mediaUrl: 'https://cdn.example/media.jpg',
    thumbnailUrl: null,
    caption: 'First post',
    timestamp: '2026-09-22T12:00:00+0000',
    permalink: 'https://www.instagram.com/p/first/',
  },
  {
    id: '17841400000000003',
    mediaType: 'VIDEO',
    mediaUrl: null,
    thumbnailUrl: 'https://cdn.example/thumbnail.jpg',
    caption: 'Second post',
    timestamp: null,
    permalink: null,
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getRecentMedia).mockResolvedValue(media);
  vi.mocked(getAutomation).mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

describe('automation editor', () => {
  it('loads media and starts with no selected post when no automation is saved', async () => {
    render(<AutomationEditor />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your recent posts');
    expect(await screen.findByRole('button', { name: 'Select First post' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeDisabled();
    expect(getRecentMedia).toHaveBeenCalledOnce();
    expect(getAutomation).toHaveBeenCalledOnce();
  });

  it('restores saved settings, selects the matching post, and saves trimmed input', async () => {
    vi.mocked(getAutomation).mockResolvedValue({
      enabled: false,
      mediaId: media[1]!.id,
      replyText: 'Existing reply',
      triggerText: '#Hello',
    });
    vi.mocked(saveAutomation).mockResolvedValue({
      enabled: true,
      mediaId: media[0]!.id,
      replyText: 'Updated reply',
      triggerText: '#Hello',
    });
    render(<AutomationEditor />);

    expect(await screen.findByRole('button', { name: 'Select Second post' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select First post' }));
    fireEvent.change(screen.getByLabelText('Public reply'), {
      target: { value: ' Updated reply ' },
    });
    fireEvent.click(screen.getByLabelText('Enable automatic reply'));
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    await waitFor(() =>
      expect(saveAutomation).toHaveBeenCalledWith({
        enabled: true,
        mediaId: media[0]!.id,
        replyText: 'Updated reply',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Automation saved');
  });

  it('shows safe load and save failures with retry support', async () => {
    vi.mocked(getRecentMedia)
      .mockRejectedValueOnce(new Error('private provider response'))
      .mockResolvedValueOnce(media);
    render(<AutomationEditor />);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not load');
    expect(screen.queryByText('private provider response')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Select First post' });
    fireEvent.click(screen.getByRole('button', { name: 'Select First post' }));
    vi.mocked(saveAutomation).mockRejectedValueOnce(new Error('private save detail'));
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not save');
    expect(screen.queryByText('private save detail')).not.toBeInTheDocument();
  });

  it('requires a current selected post when saved media is no longer recent', async () => {
    vi.mocked(getAutomation).mockResolvedValue({
      enabled: true,
      mediaId: 'older-media',
      replyText: 'Existing reply',
      triggerText: '#Hello',
    });
    render(<AutomationEditor />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no longer among the 12 most recent',
    );
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select First post' }));
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeEnabled();
  });
});
