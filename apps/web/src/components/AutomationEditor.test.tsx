import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AutomationSaveError,
  getAutomations,
  saveAutomation,
  type Automation,
} from '../api/automation.js';
import { getMediaPage, type MediaPage, type RecentMedia } from '../api/media.js';
import { AutomationEditor } from './AutomationEditor.js';

vi.mock('../api/automation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/automation.js')>()),
  getAutomations: vi.fn(),
  saveAutomation: vi.fn(),
}));
vi.mock('../api/media.js', () => ({ getMediaPage: vi.fn() }));

const media = [
  {
    id: '17841400000000002',
    mediaType: 'IMAGE',
    contentKind: 'post' as const,
    mediaUrl: 'https://cdn.example/media.jpg',
    thumbnailUrl: null,
    caption: 'First post',
    timestamp: '2026-09-22T12:00:00+0000',
    permalink: 'https://www.instagram.com/p/first/',
  },
  {
    id: '17841400000000003',
    mediaType: 'VIDEO',
    contentKind: 'post' as const,
    mediaUrl: null,
    thumbnailUrl: 'https://cdn.example/thumbnail.jpg',
    caption: 'Second post',
    timestamp: null,
    permalink: null,
  },
] satisfies RecentMedia[];

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMediaPage).mockResolvedValue({ media, nextCursor: null });
  vi.mocked(getAutomations).mockResolvedValue([]);
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
    expect(getMediaPage).toHaveBeenCalledOnce();
    expect(getAutomations).toHaveBeenCalledOnce();
  });

  it('restores saved settings, selects the matching post, and saves trimmed input', async () => {
    const onSelectedMediaChange = vi.fn();
    vi.mocked(getAutomations).mockResolvedValue([
      {
        deliveryMode: 'public',
        enabled: false,
        mediaId: media[1]!.id,
        privateReplyText: null,
        replyText: 'Existing reply',
        triggerMode: 'exact',
        triggerText: '#Hello',
      },
    ]);
    vi.mocked(saveAutomation).mockResolvedValue({
      deliveryMode: 'public',
      enabled: true,
      mediaId: media[0]!.id,
      privateReplyText: null,
      replyText: 'Updated reply',
      triggerMode: 'exact',
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
    if (!(screen.getByLabelText('Enable automatic reply') as HTMLInputElement).checked)
      fireEvent.click(screen.getByLabelText('Enable automatic reply'));
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    await waitFor(() =>
      expect(saveAutomation).toHaveBeenCalledWith({
        deliveryMode: 'public',
        enabled: true,
        mediaId: media[0]!.id,
        privateReplyText: null,
        quickReplyOptions: [],
        replyText: 'Updated reply',
        triggerMode: 'exact',
        triggerText: '#Hello',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Automation saved');
  });

  it('shows safe load and save failures with retry support', async () => {
    vi.mocked(getMediaPage)
      .mockRejectedValueOnce(new Error('private provider response'))
      .mockResolvedValueOnce({ media, nextCursor: null });
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

  it.each([
    ['instagram', 'INSTAGRAM_RECONNECT_REQUIRED', 'Instagram', '/api/auth/instagram/start'],
    ['facebook', 'FACEBOOK_RECONNECT_REQUIRED', 'Facebook Page', '/api/connections/facebook/start'],
  ] as const)(
    'offers %s reconnection after credential rejection',
    async (provider, code, label, href) => {
      vi.mocked(saveAutomation).mockRejectedValue(new AutomationSaveError(code));
      render(<AutomationEditor provider={provider} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(`Reconnect ${label}`);
      expect(screen.getByRole('link', { name: `Reconnect ${label}` })).toHaveAttribute(
        'href',
        href,
      );
    },
  );

  it('saves separate public and private messages in both mode', async () => {
    vi.mocked(saveAutomation).mockResolvedValue({
      deliveryMode: 'both',
      enabled: true,
      mediaId: media[0]!.id,
      privateReplyText: 'Private message',
      replyText: 'Public message',
      triggerMode: 'contains',
      triggerText: '#test',
    });
    render(<AutomationEditor />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.click(screen.getByLabelText('Contains whole word or hashtag'));
    fireEvent.change(screen.getByLabelText('Comment trigger text'), {
      target: { value: ' #test ' },
    });
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
        quickReplyOptions: [],
        replyText: 'Public message',
        triggerMode: 'contains',
        triggerText: '#test',
      }),
    );
  });

  it('configures a quick reply with one follow-up message', async () => {
    vi.mocked(saveAutomation).mockImplementation(async (input) => ({
      ...input,
      quickReplyOptions: input.quickReplyOptions ?? [],
    }));
    render(<AutomationEditor />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.click(screen.getByLabelText('Private DM only'));
    fireEvent.click(screen.getByLabelText('Prompt with quick replies'));
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add quick reply' }));
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Quick reply 1'), { target: { value: ' Yes ' } });
    fireEvent.change(screen.getByLabelText('Follow-up for reply 1'), {
      target: { value: ' Here is more information. ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    await waitFor(() =>
      expect(saveAutomation).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryMode: 'private',
          quickReplyOptions: [
            { id: expect.any(String), title: 'Yes', followUpText: 'Here is more information.' },
          ],
        }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Automation saved');
    fireEvent.click(screen.getByRole('button', { name: 'Remove quick reply 1' }));
    expect(screen.queryByLabelText('Quick reply 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeDisabled();
  });

  it('restores the quick-reply format and clears choices when saving a private message only', async () => {
    const option = {
      id: 'c2881688-51c5-4e9a-a30b-2b085a901949',
      title: 'Yes',
      followUpText: 'Here is more information.',
    };
    vi.mocked(getAutomations).mockResolvedValue([
      {
        deliveryMode: 'private',
        enabled: true,
        mediaId: media[0]!.id,
        privateReplyText: 'Would you like more?',
        quickReplyOptions: [option],
        replyText: '',
        triggerMode: 'exact',
        triggerText: '#Hello',
      },
    ]);
    vi.mocked(saveAutomation).mockImplementation(async (input) => ({
      ...input,
      quickReplyOptions: input.quickReplyOptions ?? [],
    }));
    render(<AutomationEditor />);

    expect(await screen.findByLabelText('Prompt with quick replies')).toBeChecked();
    expect(screen.getByLabelText('Quick reply 1')).toHaveValue('Yes');
    fireEvent.click(screen.getByLabelText('Private message only'));
    expect(screen.queryByLabelText('Quick reply 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    await waitFor(() =>
      expect(saveAutomation).toHaveBeenCalledWith(
        expect.objectContaining({
          privateReplyText: 'Would you like more?',
          quickReplyOptions: [],
        }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Automation saved');
    expect(screen.getByLabelText('Private message only')).toBeChecked();
  });

  it('saves every top-level comment mode without trigger text', async () => {
    vi.mocked(saveAutomation).mockResolvedValue({
      deliveryMode: 'public',
      enabled: true,
      mediaId: media[0]!.id,
      privateReplyText: null,
      replyText: 'Hello! Thanks for commenting.',
      triggerMode: 'all',
      triggerText: null,
    });
    render(<AutomationEditor />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.click(screen.getByLabelText('Every top-level comment'));
    expect(screen.queryByLabelText('Comment trigger text')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));

    await waitFor(() =>
      expect(saveAutomation).toHaveBeenCalledWith({
        deliveryMode: 'public',
        enabled: true,
        mediaId: media[0]!.id,
        privateReplyText: null,
        quickReplyOptions: [],
        replyText: 'Hello! Thanks for commenting.',
        triggerMode: 'all',
        triggerText: null,
      }),
    );
  });

  it('restores independent saved rules and preserves unsaved drafts when switching posts', async () => {
    const first = {
      deliveryMode: 'public' as const,
      enabled: true,
      mediaId: media[0]!.id,
      privateReplyText: null,
      replyText: 'First saved reply',
      triggerMode: 'exact' as const,
      triggerText: '#First',
    };
    const second = {
      ...first,
      mediaId: media[1]!.id,
      enabled: false,
      replyText: 'Second saved reply',
      triggerText: '#Second',
    };
    vi.mocked(getAutomations).mockResolvedValue([first, second]);
    vi.mocked(saveAutomation).mockImplementation(async (input) => input);
    const onSelectedMediaChange = vi.fn();
    render(<AutomationEditor onSelectedMediaChange={onSelectedMediaChange} />);
    await screen.findByRole('button', { name: 'Select First post' });
    expect(screen.getByLabelText('Public reply')).toHaveValue('First saved reply');
    fireEvent.change(screen.getByLabelText('Public reply'), {
      target: { value: 'Unsaved first reply' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select Second post' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Second saved reply');
    expect(screen.getByLabelText('Comment trigger text')).toHaveValue('#Second');
    expect(screen.getByLabelText('Enable automatic reply')).not.toBeChecked();
    expect(onSelectedMediaChange).toHaveBeenLastCalledWith(second.mediaId);
    fireEvent.click(screen.getByRole('button', { name: 'Select First post' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Unsaved first reply');
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    await screen.findByText('Automation saved.');
    expect(saveAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: first.mediaId, replyText: 'Unsaved first reply' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Second post' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Second saved reply');
    expect(screen.getByLabelText('Enable automatic reply')).not.toBeChecked();
  });

  it('browses Posts and Reels with continuation pages while keeping the selected post draft', async () => {
    const reel = {
      ...media[0]!,
      id: 'reel-one',
      contentKind: 'reel' as const,
      caption: 'First reel',
    };
    const olderReel = { ...reel, id: 'reel-two', caption: 'Older reel' };
    vi.mocked(getMediaPage).mockImplementation(async ({ kind, cursor }) => {
      if (kind === 'post') return { media, nextCursor: null };
      if (kind === 'reel' && cursor === 'opaque-cursor')
        return { media: [olderReel], nextCursor: null };
      if (kind === 'reel' && !cursor) return { media: [reel], nextCursor: 'opaque-cursor' };
      throw new Error('Unexpected catalog query');
    });
    const onSelectedMediaChange = vi.fn();
    render(<AutomationEditor onSelectedMediaChange={onSelectedMediaChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.change(screen.getByLabelText('Public reply'), { target: { value: 'Post draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reels' }));
    await screen.findByRole('button', { name: 'Select First reel' });
    expect(screen.queryByRole('button', { name: 'Select First post' })).not.toBeInTheDocument();
    expect(onSelectedMediaChange).toHaveBeenLastCalledWith(media[0]!.id);
    fireEvent.click(screen.getByRole('button', { name: 'Select First reel' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Hello! Thanks for commenting.');
    fireEvent.change(screen.getByLabelText('Public reply'), { target: { value: 'Reel draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load more reels' }));
    await screen.findByRole('button', { name: 'Select Older reel' });
    expect(screen.getByRole('button', { name: 'Select First reel' })).toBeInTheDocument();
    expect(getMediaPage).toHaveBeenCalledWith(
      { kind: 'reel', cursor: 'opaque-cursor' },
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Post draft');
    expect(onSelectedMediaChange).toHaveBeenLastCalledWith(media[0]!.id);
  });

  it('keeps an unsaved rule after a failed save and through another post selection', async () => {
    vi.mocked(saveAutomation).mockRejectedValue(new Error('save unavailable'));
    render(<AutomationEditor />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.change(screen.getByLabelText('Public reply'), {
      target: { value: 'Retain this draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not save');
    expect(screen.getByLabelText('Public reply')).toHaveValue('Retain this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Select Second post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select First post' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Retain this draft');
  });

  it('disables a saved rule outside the loaded catalog without replacing another post', async () => {
    const older = {
      deliveryMode: 'public' as const,
      enabled: true,
      mediaId: 'older-media',
      privateReplyText: null,
      replyText: 'Older reply',
      triggerMode: 'exact' as const,
      triggerText: '#Older',
    };
    vi.mocked(getAutomations).mockResolvedValue([older]);
    vi.mocked(saveAutomation).mockImplementation(async (input) => input);
    render(<AutomationEditor />);
    fireEvent.click(await screen.findByRole('button', { name: /Select saved post older-media/ }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Older reply');
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Enable automatic reply'));
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    await screen.findByText('Automation saved.');
    expect(saveAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'older-media', enabled: false, replyText: 'Older reply' }),
    );
    expect(screen.getByRole('button', { name: /Select saved post older-media/ })).toHaveTextContent(
      'Disabled',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select First post' }));
    expect(screen.getByRole('button', { name: 'Save automation' })).toBeEnabled();
    expect(screen.getByLabelText('Public reply')).not.toHaveValue('Older reply');
  });
  it('configures Story reply matching with private delivery and keeps post and Story drafts separate', async () => {
    const story = {
      ...media[0]!,
      id: 'story-one',
      caption: 'First Story',
      contentKind: 'story' as const,
    };
    vi.mocked(getMediaPage).mockImplementation(async (input) => ({
      media: input.kind === 'story' ? [story] : media,
      nextCursor: null,
    }));
    vi.mocked(saveAutomation).mockImplementation(async (input) => ({
      ...input,
      triggerKind: 'story_reply',
    }));
    render(<AutomationEditor />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.change(screen.getByLabelText('Public reply'), {
      target: { value: 'Keep public post draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stories' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select First Story' }));
    expect(screen.getByLabelText('Private DM only')).toBeChecked();
    expect(screen.queryByLabelText('Public reply only')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Public reply and private DM')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Public reply')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Story reply trigger text'), {
      target: { value: '#Story' },
    });
    fireEvent.change(screen.getByLabelText('Private message'), {
      target: { value: 'A private Story answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Keep public post draft');
    fireEvent.click(screen.getByRole('button', { name: 'Stories' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select First Story' }));
    expect(screen.getByLabelText('Story reply trigger text')).toHaveValue('#Story');
    expect(screen.getByLabelText('Private message')).toHaveValue('A private Story answer');
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    await screen.findByText('Automation saved.');
    expect(saveAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: story.id,
        deliveryMode: 'private',
        replyText: '',
        privateReplyText: 'A private Story answer',
        triggerText: '#Story',
      }),
    );
    expect(vi.mocked(saveAutomation).mock.calls[0]![0]).not.toHaveProperty('triggerKind');
  });

  it('restores archived Story reply settings and quick replies without public delivery', async () => {
    vi.mocked(getAutomations).mockResolvedValue([
      {
        mediaId: 'archived-story',
        triggerKind: 'story_reply',
        deliveryMode: 'private',
        enabled: true,
        replyText: '',
        privateReplyText: 'Choose your answer',
        triggerMode: 'all',
        triggerText: null,
        quickReplyOptions: [{ id: 'yes', title: 'Yes', followUpText: 'Follow up privately' }],
      },
    ]);
    vi.mocked(saveAutomation).mockImplementation(async (input) => ({
      ...input,
      triggerKind: 'story_reply',
    }));
    render(<AutomationEditor />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Select saved Story archived-story/ }),
    );
    expect(screen.getByLabelText('Every Story reply')).toBeChecked();
    expect(screen.getByLabelText('Quick reply prompt')).toHaveValue('Choose your answer');
    expect(screen.getByLabelText('Quick reply 1')).toHaveValue('Yes');
    expect(screen.getByLabelText('Follow-up for reply 1')).toHaveValue('Follow up privately');
    expect(screen.queryByLabelText('Public reply only')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Enable automatic reply'));
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    await screen.findByText('Automation saved.');
    expect(saveAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'archived-story',
        enabled: false,
        deliveryMode: 'private',
        quickReplyOptions: [{ id: 'yes', title: 'Yes', followUpText: 'Follow up privately' }],
      }),
    );
  });

  it('does not offer Facebook Story browsing', async () => {
    render(<AutomationEditor provider="facebook" />);
    await screen.findByRole('button', { name: 'Select First post' });
    expect(screen.getByRole('button', { name: 'Stories' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reels' })).toBeDisabled();
    expect(getMediaPage).toHaveBeenCalledTimes(1);
  });
});

describe('automation editor asynchronous ownership', () => {
  it('ignores a stale category response and its cursor after switching to Stories', async () => {
    const reels = deferred<MediaPage>();
    const stories = deferred<MediaPage>();
    const story: RecentMedia = {
      ...media[0]!,
      id: 'story-new',
      contentKind: 'story',
      caption: 'Latest Story',
    };
    vi.mocked(getMediaPage).mockImplementation(({ kind }) =>
      kind === 'post'
        ? Promise.resolve({ media, nextCursor: null })
        : kind === 'reel'
          ? reels.promise
          : stories.promise,
    );
    render(<AutomationEditor />);
    await screen.findByRole('button', { name: 'Select First post' });
    fireEvent.click(screen.getByRole('button', { name: 'Reels' }));
    const reelSignal = vi.mocked(getMediaPage).mock.calls[1]![1]!;
    fireEvent.click(screen.getByRole('button', { name: 'Stories' }));
    expect(reelSignal.aborted).toBe(true);
    await act(async () => stories.resolve({ media: [story], nextCursor: null }));
    expect(screen.getByRole('button', { name: 'Select Latest Story' })).toBeInTheDocument();
    await act(async () =>
      reels.resolve({
        media: [{ ...media[0]!, id: 'stale-reel', contentKind: 'reel', caption: 'Stale Reel' }],
        nextCursor: 'stale-cursor',
      }),
    );
    expect(screen.getByRole('button', { name: 'Stories' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Select Stale Reel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more stories' })).not.toBeInTheDocument();
  });

  it('preserves a post draft through a failed category request and retry', async () => {
    const failed = deferred<MediaPage>();
    const reel: RecentMedia = {
      ...media[0]!,
      id: 'retry-reel',
      contentKind: 'reel',
      caption: 'Recovered Reel',
    };
    let reelAttempts = 0;
    vi.mocked(getMediaPage).mockImplementation(({ kind }) =>
      kind === 'post'
        ? Promise.resolve({ media, nextCursor: null })
        : ++reelAttempts === 1
          ? failed.promise
          : Promise.resolve({ media: [reel], nextCursor: null }),
    );
    render(<AutomationEditor />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.change(screen.getByLabelText('Public reply'), {
      target: { value: 'Unsent post draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reels' }));
    await act(async () => failed.reject(new Error('private-category-detail')));
    expect(screen.getByRole('alert')).toHaveTextContent('could not load this section');
    expect(screen.queryByText('private-category-detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reels' }));
    await screen.findByRole('button', { name: 'Select Recovered Reel' });
    fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('Unsent post draft');
  });

  it('locks selection during save and applies its response only to the submitted post', async () => {
    const pending = deferred<Automation>();
    vi.mocked(saveAutomation).mockReturnValue(pending.promise);
    render(<AutomationEditor />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select First post' }));
    fireEvent.change(screen.getByLabelText('Public reply'), {
      target: { value: 'First saved response' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    expect(screen.getByRole('button', { name: 'Select Second post' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reels' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stories' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select Second post' }));
    expect(screen.getByLabelText('Public reply')).toHaveValue('First saved response');
    await act(async () =>
      pending.resolve({ ...vi.mocked(saveAutomation).mock.calls[0]![0], quickReplyOptions: [] }),
    );
    expect(screen.getByRole('button', { name: 'Select First post' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Select First post' })).toHaveTextContent(
      'Automation enabled',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Second post' }));
    expect(screen.getByLabelText('Public reply')).not.toHaveValue('First saved response');
    expect(screen.getByRole('button', { name: 'Select Second post' })).toHaveTextContent(
      'No automation',
    );
    expect(saveAutomation).toHaveBeenCalledTimes(1);
  });

  it('deduplicates overlapping continuation results without losing the saved rule badge', async () => {
    vi.mocked(getAutomations).mockResolvedValue([
      {
        mediaId: media[0]!.id,
        deliveryMode: 'public',
        enabled: false,
        privateReplyText: null,
        replyText: 'Saved response',
        triggerMode: 'exact',
        triggerText: '#Old',
      },
    ]);
    vi.mocked(getMediaPage).mockImplementation(({ cursor }) =>
      Promise.resolve(
        cursor
          ? { media: [media[0]!, media[1]!], nextCursor: null }
          : { media: [media[0]!], nextCursor: 'next-page' },
      ),
    );
    render(<AutomationEditor />);
    const first = await screen.findByRole('button', { name: 'Select First post' });
    expect(first).toHaveTextContent('Automation disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Load more posts' }));
    await screen.findByRole('button', { name: 'Select Second post' });
    expect(screen.getAllByRole('button', { name: 'Select First post' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Select First post' })).toHaveTextContent(
      'Automation disabled',
    );
    expect(screen.getByLabelText('Public reply')).toHaveValue('Saved response');
    expect(screen.queryByRole('button', { name: 'Load more posts' })).not.toBeInTheDocument();
  });
});
