/** A recent media item returned by the authenticated application API. */
export interface RecentMedia {
  /** Opaque Instagram media identifier. */
  id: string;
  /** Optional Instagram caption. */
  caption: string | null;
  /** Optional canonical Instagram URL. */
  permalink: string | null;
  /** Instagram media type, such as IMAGE or VIDEO. */
  mediaType: string;
  /** Optional media asset URL. */
  mediaUrl: string | null;
  /** Optional preview asset URL. */
  thumbnailUrl: string | null;
  /** Optional provider timestamp. */
  timestamp: string | null;
}

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
    caption: value.caption,
    mediaType: value.mediaType,
    mediaUrl: value.mediaUrl,
    permalink: value.permalink,
    thumbnailUrl: value.thumbnailUrl,
    timestamp: value.timestamp,
  };
};

/** Loads up to twelve recent media items through the same-origin authenticated API. */
export const getRecentMedia = async (signal?: AbortSignal): Promise<RecentMedia[]> => {
  const response = await request('/api/media?limit=12', signal);
  if (!response.ok) throw new Error('Media service is unavailable. Please try again.');
  try {
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.media) || payload.media.length > 12)
      throw new Error('Invalid media list');
    return payload.media.map(readMedia);
  } catch (error) {
    throw new Error('Media service returned an invalid response. Please try again.', {
      cause: error,
    });
  }
};
