import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecentExecutions } from '../api/executions.js';
import { getRecentDmAnswers } from '../api/dm-answers.js';
import { RecentActivity } from './RecentActivity.js';

vi.mock('../api/executions.js', () => ({ getRecentExecutions: vi.fn() }));
vi.mock('../api/dm-answers.js', () => ({ getRecentDmAnswers: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getRecentDmAnswers).mockResolvedValue([]);
});

describe('RecentActivity', () => {
  it('renders empty and successful activity states', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.mocked(getRecentExecutions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          commenterUsername: 'commenter',
          commentText: '#Hello',
          createdAt: '2026-09-24T12:00:00.000Z',
          mediaId: 'selected-post',
          deliveries: [
            { channel: 'public', errorCode: null, errorMessage: null, status: 'succeeded' },
            { channel: 'private', errorCode: null, errorMessage: null, status: 'succeeded' },
          ],
        },
      ]);
    render(<RecentActivity selectedMediaId="selected-post" />);
    expect(await screen.findByText(/No activity for this post yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
    expect(await screen.findByText('@commenter')).toBeInTheDocument();
    expect(screen.getByText('Public reply')).toBeInTheDocument();
    expect(screen.getByText('Private DM')).toBeInTheDocument();
    expect(screen.getAllByText('Message sent')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Open Instagram profile' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/commenter/',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy username' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('commenter'));
    expect(screen.getByRole('button', { name: 'Username copied' })).toBeInTheDocument();
  });

  it('renders safe failures and retries loading', async () => {
    vi.mocked(getRecentExecutions)
      .mockRejectedValueOnce(new Error('private database detail'))
      .mockResolvedValueOnce([
        {
          commenterUsername: null,
          commentText: '#Hello',
          createdAt: '2026-09-24T12:00:00.000Z',
          mediaId: 'selected-post',
          deliveries: [
            {
              channel: 'public',
              errorCode: 'INSTAGRAM_REPLY_UNAVAILABLE',
              errorMessage: 'The public reply could not be sent.',
              status: 'failed',
            },
          ],
        },
      ]);
    render(<RecentActivity selectedMediaId="selected-post" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not load');
    expect(screen.queryByText('private database detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument());
    expect(screen.getByText('The public reply could not be sent.')).toBeInTheDocument();
  });

  it('shows selected quick replies, typed answers, and follow-up status', async () => {
    vi.mocked(getRecentExecutions).mockResolvedValue([]);
    vi.mocked(getRecentDmAnswers).mockResolvedValue([
      {
        choiceTitle: 'Yes',
        commenterUsername: 'customer',
        followupStatus: 'succeeded',
        mediaId: 'selected-post',
        receivedAt: '2026-09-24T12:00:00.000Z',
        typedText: null,
      },
      {
        choiceTitle: null,
        commenterUsername: 'other_customer',
        followupStatus: null,
        mediaId: 'selected-post',
        receivedAt: '2026-09-24T12:01:00.000Z',
        typedText: 'Please send details',
      },
    ]);
    render(<RecentActivity selectedMediaId="selected-post" />);

    expect(await screen.findByText('Selected: Yes')).toBeInTheDocument();
    expect(screen.getByText('Typed reply: Please send details')).toBeInTheDocument();
    expect(screen.getByText('Follow-up: Succeeded')).toBeInTheDocument();
    expect(getRecentDmAnswers).toHaveBeenCalledOnce();
    expect(vi.mocked(getRecentDmAnswers).mock.calls[0]?.[1]).toBe('selected-post');
  });

  it('explains scheduled retries and ambiguous deliveries without provider details', async () => {
    vi.mocked(getRecentExecutions).mockResolvedValue([
      {
        commenterUsername: 'retry_user',
        commentText: '#Hello',
        createdAt: '2026-09-24T12:00:00.000Z',
        mediaId: 'selected-post',
        deliveries: [
          {
            channel: 'private',
            errorCode: 'INSTAGRAM_REPLY_RETRY_SCHEDULED',
            errorMessage:
              'Instagram temporarily rejected the reply. A controlled retry is scheduled.',
            status: 'retry_pending',
          },
        ],
      },
      {
        commenterUsername: 'review_user',
        commentText: '#Hello',
        createdAt: '2026-09-24T12:01:00.000Z',
        mediaId: 'selected-post',
        deliveries: [
          {
            channel: 'public',
            errorCode: 'DELIVERY_OUTCOME_UNKNOWN',
            errorMessage: 'Delivery requires manual review to prevent a duplicate reply.',
            status: 'uncertain',
          },
        ],
      },
    ]);

    render(<RecentActivity selectedMediaId="selected-post" />);

    expect(await screen.findByText('Retry scheduled')).toBeInTheDocument();
    expect(screen.getByText('Review needed')).toBeInTheDocument();
    expect(screen.getByText(/manual review to prevent a duplicate reply/)).toBeInTheDocument();
  });

  it('switches between selected-post and all-activity queries', async () => {
    vi.mocked(getRecentExecutions)
      .mockResolvedValueOnce([
        {
          commenterUsername: 'selected_user',
          commentText: '#Hello',
          createdAt: '2026-09-24T12:00:00.000Z',
          deliveries: [
            { channel: 'public', errorCode: null, errorMessage: null, status: 'succeeded' },
          ],
          mediaId: 'selected-post',
        },
      ])
      .mockResolvedValueOnce([
        {
          commenterUsername: 'other_user',
          commentText: '#Hello',
          createdAt: '2026-09-24T12:01:00.000Z',
          deliveries: [
            { channel: 'public', errorCode: null, errorMessage: null, status: 'succeeded' },
          ],
          mediaId: 'other-post',
        },
        {
          commenterUsername: 'legacy_user',
          commentText: '#Hello',
          createdAt: '2026-09-24T12:02:00.000Z',
          deliveries: [
            { channel: 'public', errorCode: null, errorMessage: null, status: 'succeeded' },
          ],
          mediaId: null,
        },
      ])
      .mockResolvedValue([]);

    render(<RecentActivity selectedMediaId="selected-post" />);

    expect(await screen.findByText('@selected_user')).toBeInTheDocument();
    expect(vi.mocked(getRecentExecutions).mock.calls[0]?.[1]).toBe('selected-post');
    await waitFor(() => expect(getRecentDmAnswers).toHaveBeenCalledTimes(1));
    expect(vi.mocked(getRecentDmAnswers).mock.calls[0]?.[1]).toBe('selected-post');
    fireEvent.click(screen.getByRole('button', { name: 'All recent activity' }));
    expect(await screen.findByText('@other_user')).toBeInTheDocument();
    expect(screen.getByText('@legacy_user')).toBeInTheDocument();
    expect(screen.getByText(/Some older activity is not linked to a post/)).toBeInTheDocument();
    expect(vi.mocked(getRecentExecutions).mock.calls[1]?.[1]).toBeUndefined();
    await waitFor(() => expect(getRecentDmAnswers).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getRecentDmAnswers).mock.calls[1]?.[1]).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Selected post' }));
    await waitFor(() => expect(getRecentExecutions).toHaveBeenCalledTimes(3));
    expect(vi.mocked(getRecentExecutions).mock.calls[2]?.[1]).toBe('selected-post');
    await waitFor(() => expect(getRecentDmAnswers).toHaveBeenCalledTimes(3));
    expect(vi.mocked(getRecentDmAnswers).mock.calls[2]?.[1]).toBe('selected-post');
  });

  it('asks the user to select a post before loading selected-post activity', async () => {
    vi.mocked(getRecentExecutions).mockResolvedValue([]);
    render(<RecentActivity selectedMediaId={null} />);

    expect(await screen.findByText(/Select a post in Automation setup/)).toBeInTheDocument();
    expect(getRecentExecutions).not.toHaveBeenCalled();
    expect(getRecentDmAnswers).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh activity' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'All recent activity' }));
    await waitFor(() => expect(getRecentExecutions).toHaveBeenCalledOnce());
    expect(vi.mocked(getRecentExecutions).mock.calls[0]?.[1]).toBeUndefined();
  });
});
