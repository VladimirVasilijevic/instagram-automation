/** Page available to attach to the current ReplyKit user after Facebook consent. */
export interface PendingFacebookPage {
  /** Opaque Meta Page identifier. */
  id: string;
  /** Page display name. */
  name: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const request = async (path: string, init: RequestInit): Promise<Response> => {
  try {
    return await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error('Facebook Pages are unavailable. Please try again.', { cause: error });
  }
};

/** Loads safe Page choices for the session-bound Facebook connection attempt. */
export const getPendingFacebookPages = async (
  selectionId: string,
): Promise<PendingFacebookPage[]> => {
  const response = await request(
    `/api/connections/facebook/pending?${new URLSearchParams({ selectionId })}`,
    {},
  );
  if (!response.ok) throw new Error('Facebook Pages are unavailable. Please try again.');
  try {
    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.pages) ||
      !payload.pages.every(
        (page) =>
          isRecord(page) &&
          typeof page.id === 'string' &&
          page.id.length > 0 &&
          typeof page.name === 'string' &&
          page.name.trim().length > 0,
      )
    )
      throw new Error('Invalid Page list');
    return payload.pages.map((page: Record<string, unknown>) => ({
      id: page.id as string,
      name: page.name as string,
    }));
  } catch (error) {
    throw new Error('Facebook Pages returned an invalid response. Please try again.', {
      cause: error,
    });
  }
};

/** Attaches only the Page explicitly selected by the owner. */
export const selectFacebookPage = async (selectionId: string, pageId: string): Promise<void> => {
  const response = await request('/api/connections/facebook/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selectionId, pageId }),
  });
  if (response.status !== 204) throw new Error('Facebook Page could not be connected. Try again.');
};
