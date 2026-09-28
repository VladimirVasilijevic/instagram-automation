import { z } from 'zod';

/** Refreshed long-lived Instagram credential returned by Meta. */
export interface InstagramTokenRefreshResult {
  /** New long-lived token returned by Meta. */
  accessToken: string;
  /** Calculated instant after which the new token must not be used. */
  tokenExpiresAt: Date;
}

/** Provider boundary for refreshing one unexpired long-lived Instagram token. */
export interface InstagramTokenRefreshClient {
  /** Exchanges one unexpired long-lived token for a renewed credential. */
  refresh(accessToken: string): Promise<InstagramTokenRefreshResult>;
}

/** Sanitized token refresh failure with a stable recovery decision. */
export class InstagramTokenRefreshError extends Error {
  /** Whether only a new Instagram login can repair the credential. */
  readonly reconnectRequired: boolean;

  /** Stable transport or response failure category. */
  readonly reason: 'http_error' | 'invalid_json' | 'invalid_response' | 'network_error' | 'timeout';

  /** Provider HTTP status when a response was received. */
  readonly httpStatus?: number;

  /** Sanitized numeric Meta error code when available. */
  readonly metaErrorCode?: number;

  constructor(
    reconnectRequired: boolean,
    reason: 'http_error' | 'invalid_json' | 'invalid_response' | 'network_error' | 'timeout',
    httpStatus?: number,
    metaErrorCode?: number,
    options?: ErrorOptions,
  ) {
    super('Instagram token refresh failed', options);
    this.name = 'InstagramTokenRefreshError';
    this.reconnectRequired = reconnectRequired;
    this.reason = reason;
    this.httpStatus = httpStatus;
    this.metaErrorCode = metaErrorCode;
  }

  /** Returns only application-selected diagnostics safe for server logs. */
  toLogContext(): Readonly<Record<string, string>> {
    const context: Record<string, string> = {
      errorName: this.name,
      reason: this.reason,
      reconnectRequired: String(this.reconnectRequired),
    };
    if (this.httpStatus !== undefined) context.httpStatus = String(this.httpStatus);
    if (this.metaErrorCode !== undefined) context.metaErrorCode = String(this.metaErrorCode);
    return context;
  }
}

const refreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().max(31_536_000),
});

const errorCode = (payload: unknown): number | undefined => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const root = payload as Record<string, unknown>;
  const error =
    root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? (root.error as Record<string, unknown>)
      : root;
  return typeof error.code === 'number' && Number.isSafeInteger(error.code)
    ? error.code
    : undefined;
};

/** Creates the real Meta long-lived-token refresh adapter. */
export const createInstagramTokenRefreshClient = (
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): InstagramTokenRefreshClient => ({
  async refresh(accessToken) {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', accessToken);
    let httpStatus: number | undefined;
    try {
      const response = await fetcher(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      httpStatus = response.status;
      const text = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch (error) {
        throw new InstagramTokenRefreshError(
          !response.ok && [401, 403].includes(response.status),
          'invalid_json',
          response.status,
          undefined,
          { cause: error },
        );
      }
      if (!response.ok) {
        const code = errorCode(payload);
        throw new InstagramTokenRefreshError(
          response.status === 401 || response.status === 403 || code === 190,
          'http_error',
          response.status,
          code,
        );
      }
      const parsed = refreshSchema.safeParse(payload);
      if (!parsed.success)
        throw new InstagramTokenRefreshError(false, 'invalid_response', response.status);
      return {
        accessToken: parsed.data.access_token,
        tokenExpiresAt: new Date(now() + parsed.data.expires_in * 1000),
      };
    } catch (error) {
      if (error instanceof InstagramTokenRefreshError) throw error;
      throw new InstagramTokenRefreshError(
        false,
        error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error',
        httpStatus,
        undefined,
        { cause: error },
      );
    }
  },
});
