import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RecentMedia } from '../api/media.js';
import type { Automation } from '../api/automation.js';
import { MediaPicker } from './MediaPicker.js';

const item = (id: string, overrides: Partial<RecentMedia> = {}): RecentMedia => ({
  id,
  caption: 'Example post',
  contentKind: 'post',
  mediaType: 'IMAGE',
  mediaUrl: 'https://cdn.example/asset.jpg',
  thumbnailUrl: null,
  permalink: null,
  timestamp: null,
  ...overrides,
});
const rule = (enabled: boolean): Automation => ({
  mediaId: 'owned',
  enabled,
  deliveryMode: 'public',
  replyText: 'Reply',
  privateReplyText: null,
  triggerMode: 'all',
  triggerText: null,
});

describe('media picker', () => {
  it.each([
    ['thumbnail', 'https://cdn.example/thumbnail.jpg', 'https://cdn.example/thumbnail.jpg'],
    ['media asset', null, 'https://cdn.example/asset.jpg'],
  ])('uses the %s preview', (_label, thumbnailUrl, expected) => {
    render(
      <MediaPicker
        media={[item('owned', { thumbnailUrl })]}
        selectedMediaId="owned"
        rules={{}}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('img', { name: 'Example post' })).toHaveAttribute('src', expected);
    expect(screen.getByRole('button', { name: 'Select Example post' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('provides a usable label and placeholder when caption and preview are missing', () => {
    const onSelect = vi.fn();
    render(
      <MediaPicker
        media={[item('bare', { caption: null, mediaUrl: null })]}
        selectedMediaId=""
        rules={{}}
        disabled={false}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.getByText('No caption')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Select image bare' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith('bare');
  });

  it('shows per-item rule status and content category without leaking selection between items', () => {
    render(
      <MediaPicker
        media={[
          item('owned'),
          item('reel', { caption: 'Reel clip', contentKind: 'reel', mediaType: 'VIDEO' }),
          item('story', { caption: 'Story clip', contentKind: 'story', mediaType: 'VIDEO' }),
        ]}
        selectedMediaId="reel"
        rules={{ owned: rule(true), reel: rule(false) }}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Select Example post' })).toHaveTextContent(
      'Automation enabled',
    );
    expect(screen.getByRole('button', { name: 'Select Reel clip' })).toHaveTextContent(
      'Automation disabled',
    );
    expect(screen.getByRole('button', { name: 'Select Story clip' })).toHaveTextContent(
      'No automation',
    );
    expect(screen.getByRole('button', { name: 'Select Reel clip' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Select Story clip' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('Reel')).toBeInTheDocument();
    expect(screen.getByText('Story')).toBeInTheDocument();
  });

  it('never selects an item while disabled', () => {
    const onSelect = vi.fn();
    render(
      <MediaPicker
        media={[item('owned')]}
        selectedMediaId=""
        rules={{}}
        disabled
        onSelect={onSelect}
      />,
    );
    const button = screen.getByRole('button', { name: 'Select Example post' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
