import { SOCIAL_PROVIDER, type SocialProvider } from '@instagram-automation/contracts';

/** Safe connected social account shown in the workspace. */
export interface CurrentConnection {
  /** Whether automation can use the provider credential. */
  connectionStatus: 'active' | 'reconnect_required';
  /** Internal social connection ID. */
  id: string;
  /** Provider account ID, never used as the ReplyKit user ID. */
  externalAccountId: string;
  /** Provider owning this connection. */
  provider: SocialProvider;
  /** Account or Page name returned by the provider. */
  displayName: string;
}

/** Current ReplyKit user and optional social connection. */
export interface CurrentViewer {
  /** The one active connection in the current UI, or null before one is connected. */
  connection: CurrentConnection | null;
  /** Product identity that owns sessions independently of social connections. */
  user: {
    /** Stable application user identifier. */
    id: string;
    /** Optional provider display name when available. */
    displayName?: string | null;
  };
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

/** Loads the current ReplyKit user; an expired session is represented by `null`. */
export const getCurrentViewer = async (signal?: AbortSignal): Promise<CurrentViewer | null> => {
  const response = await request('/api/me', {}, signal);
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Account service is unavailable. Please try again.');
  try {
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('user' in payload) ||
      !('connection' in payload)
    )
      throw new Error('Missing viewer');
    const user = payload.user;
    const connection = payload.connection;
    if (
      !user ||
      typeof user !== 'object' ||
      !('id' in user) ||
      typeof user.id !== 'string' ||
      !user.id ||
      ('displayName' in user &&
        user.displayName !== null &&
        typeof user.displayName !== 'string') ||
      (connection !== null &&
        (!connection ||
          typeof connection !== 'object' ||
          !('id' in connection) ||
          !('provider' in connection) ||
          !('externalAccountId' in connection) ||
          !('displayName' in connection) ||
          !('connectionStatus' in connection) ||
          typeof connection.id !== 'string' ||
          !connection.id ||
          !Object.values(SOCIAL_PROVIDER).includes(connection.provider as SocialProvider) ||
          typeof connection.externalAccountId !== 'string' ||
          !connection.externalAccountId ||
          typeof connection.displayName !== 'string' ||
          !connection.displayName.trim() ||
          !['active', 'reconnect_required'].includes(String(connection.connectionStatus))))
    )
      throw new Error('Invalid viewer');
    return {
      connection:
        connection === null
          ? null
          : {
              connectionStatus:
                connection.connectionStatus as CurrentConnection['connectionStatus'],
              displayName: connection.displayName as string,
              id: connection.id as string,
              provider: connection.provider as CurrentConnection['provider'],
              externalAccountId: connection.externalAccountId as string,
            },
      user: {
        id: user.id,
        ...('displayName' in user && { displayName: user.displayName as string | null }),
      },
    };
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
