import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutomationSaveError, getAutomation, saveAutomation } from '../api/automation.js';
import { getRecentMedia } from '../api/media.js';
import { AutomationEditor } from './AutomationEditor.js';

vi.mock('../api/automation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/automation.js')>()),
  getAutomation: vi.fn(),
  saveAutomation: vi.fn(),
}));
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
    const onSelectedMediaChange = vi.fn();
    vi.mocked(getAutomation).mockResolvedValue({
      deliveryMode: 'public',
      enabled: false,
      mediaId: media[1]!.id,
      privateReplyText: null,
      replyText: 'Existing reply',
      triggerText: '#Hello',
    });
    vi.mocked(saveAutomation).mockResolvedValue({
      deliveryMode: 'public',
      enabled: true,
      mediaId: media[0]!.id,
      privateReplyText: null,
      replyText: 'Updated reply',
      triggerText: '#Hello',
    });
    render(<AutomationEditor onSelectedMediaChange={onSelectedMediaChange} />);

    expect(await screen.findByRole('button', { name: 'Select Second post' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(onSelectedMediaChange).toHaveBeenLastCalledWith(media[1]!.id);
    fireEvent.click(screen.getByRole('button', { name: 'Select First post' }));
    expect(onSelectedMediaChange).toHaveBeenLastCalledWith(media[0]!.id);
    fireEvent.change(screen.getByLabelText('Public reply'), {
      target: { value: ' Updated reply ' },
    });
    fireEvent.click(screen.getByLabelText('Enable automatic reply'));
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    await waitFor(() =>
      expect(saveAutomation).toHaveBeenCalledWith({
        deliveryMode: 'public',
        enabled: true,
        mediaId: media[0]!.id,
        privateReplyText: null,
        replyText: 'Updated reply',
        triggerText: '#Hello',
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

  it('explains that previous settings remain active when comment delivery cannot be enabled', async () => {
    vi.mocked(saveAutomation).mockRejectedValue(
      new AutomationSaveError('INSTAGRAM_COMMENT_SUBSCRIPTION_UNAVAILABLE'),
    );
    render(<AutomationEditor />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Previous automation settings, if any, remain active',
    );
  });

  it('offers Instagram reconnection after definite credential rejection', async () => {
    vi.mocked(saveAutomation).mockRejectedValue(
      new AutomationSaveError('INSTAGRAM_RECONNECT_REQUIRED'),
    );
    render(<AutomationEditor />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect Instagram');
    expect(screen.getByRole('link', { name: 'Reconnect Instagram' })).toHaveAttribute(
      'href',
      '/api/auth/instagram/start',
    );
  });

  it('saves separate public and private messages in both mode', async () => {
    vi.mocked(saveAutomation).mockResolvedValue({
      deliveryMode: 'both',
      enabled: true,
      mediaId: media[0]!.id,
      privateReplyText: 'Private message',
      replyText: 'Public message',
      triggerText: '#test',
    });
    render(<AutomationEditor />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.change(screen.getByLabelText('Comment trigger'), { target: { value: ' #test ' } });
    fireEvent.click(screen.getByLabelText('Public reply and private DM'));
    fireEvent.change(screen.getByLabelText('Public reply'), {
      target: { value: ' Public message ' },
    });
    fireEvent.change(screen.getByLabelText('Private message'), {
      target: { value: ' Private message ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    await waitFor(() =>
      expect(saveAutomation).toHaveBeenCalledWith({
        deliveryMode: 'both',
        enabled: true,
        mediaId: media[0]!.id,
        privateReplyText: 'Private message',
        replyText: 'Public message',
        triggerText: '#test',
      }),
    );
  });

  it('requires a current selected post when saved media is no longer recent', async () => {
    vi.mocked(getAutomation).mockResolvedValue({
      deliveryMode: 'public',
      enabled: true,
      mediaId: 'older-media',
      privateReplyText: null,
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
