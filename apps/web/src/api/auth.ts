/** Safe account identity returned by the application's authenticated endpoint. */
export interface CurrentAccount {
  /** Internal application account ID. */
  id: string;
  /** Instagram professional account ID. */
  instagramUserId: string;
  /** Instagram username to display to its owner. */
  username: string;
}

const request = async (
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> => {
  try {
    const deadline = AbortSignal.timeout(10_000);
    return await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch (error) {
    throw new Error('Account service is unavailable. Please try again.', { cause: error });
  }
};

/** Loads the current account; a missing or expired session is represented by `null`. */
export const getCurrentAccount = async (signal?: AbortSignal): Promise<CurrentAccount | null> => {
  const response = await request('/api/me', {}, signal);
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Account service is unavailable. Please try again.');
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('account' in payload))
      throw new Error('Missing account');
    const account = payload.account;
    if (
      !account ||
      typeof account !== 'object' ||
      !('id' in account) ||
      !('instagramUserId' in account) ||
      !('username' in account) ||
      typeof account.id !== 'string' ||
      !account.id ||
      typeof account.instagramUserId !== 'string' ||
      !account.instagramUserId ||
      typeof account.username !== 'string' ||
      !account.username.trim()
    )
      throw new Error('Invalid account');
    return { id: account.id, instagramUserId: account.instagramUserId, username: account.username };
  } catch (error) {
    throw new Error('Account service returned an invalid response. Please try again.', {
      cause: error,
    });
  }
};

/** Revokes the current server session; the HTTP-only credential is handled by the browser. */
export const logout = async (): Promise<void> => {
  const response = await request('/api/auth/logout', { method: 'POST' });
  if (response.status !== 204) throw new Error('Logout could not be completed. Please try again.');
};
