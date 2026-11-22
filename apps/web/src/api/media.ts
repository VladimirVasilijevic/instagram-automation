import type { SocialMediaItem, SocialContentKind } from '@instagram-automation/contracts';

/** A recent media item returned by the authenticated application API. */
export type RecentMedia = SocialMediaItem;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const request = async (path: string, signal?: AbortSignal): Promise<Response> => {
  try {
    const deadline = AbortSignal.timeout(10_000);
    return await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch (error) {
    throw new Error('Media service is unavailable. Please try again.', { cause: error });
  }
};

const readMedia = (value: unknown): RecentMedia => {
  if (
    !isRecord(value) ||
    (value.contentKind !== 'post' &&
      value.contentKind !== 'reel' &&
      value.contentKind !== 'story') ||
    typeof value.id !== 'string' ||
    value.id.trim() === '' ||
    typeof value.mediaType !== 'string' ||
    value.mediaType.trim() === '' ||
    !isNullableString(value.caption) ||
    !isNullableString(value.permalink) ||
    !isNullableString(value.mediaUrl) ||
    !isNullableString(value.thumbnailUrl) ||
    !isNullableString(value.timestamp)
  ) {
    throw new Error('Invalid media');
  }
  return {
    id: value.id,
    contentKind: value.contentKind,
    caption: value.caption,
    mediaType: value.mediaType,
    mediaUrl: value.mediaUrl,
    permalink: value.permalink,
    thumbnailUrl: value.thumbnailUrl,
    timestamp: value.timestamp,
  };
};

/** One provider-owned catalog page, with an opaque continuation cursor. */
export interface MediaPage {
  media: RecentMedia[];
  nextCursor: string | null;
}

/** Loads a section of the selected connection’s catalog. */
export const getMediaPage = async (
  input: { kind: SocialContentKind; cursor?: string },
  signal?: AbortSignal,
): Promise<MediaPage> => {
  const query = new URLSearchParams({ limit: '12', kind: input.kind });
  if (input.cursor) query.set('cursor', input.cursor);
  const response = await request(`/api/media?${query}`, signal);
  if (!response.ok) throw new Error('Media service is unavailable. Please try again.');
  try {
    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.media) ||
      payload.media.length > 12 ||
      !isNullableString(payload.nextCursor)
    )
      throw new Error('Invalid media page');
    return { media: payload.media.map(readMedia), nextCursor: payload.nextCursor };
  } catch (error) {
    throw new Error('Media service returned an invalid response. Please try again.', {
      cause: error,
    });
  }
};
