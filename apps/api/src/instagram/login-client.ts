import { z } from 'zod';

/** Permissions needed by the first Instagram comment automation slice. */
export const instagramLoginScopes = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
] as const;

/** Server-only connection details obtained after an Instagram authorization. */
export interface InstagramLoginResult {
  /** Long-lived token that must be encrypted before persistence. */
  accessToken: string;
  /** Professional account ID used by Instagram webhooks, not the app-scoped ID. */
  instagramUserId: string;
  /** Current Instagram username. */
  username: string;
  /** Expiration calculated from Meta's reported token lifetime. */
  tokenExpiresAt: Date;
}

/** Provider boundary used by the browser login routes. */
export interface InstagramLoginClient {
  /** Builds an Instagram authorization URL containing the caller's random state. */
  authorizationUrl(state: string): string;
  /** Exchanges a single-use code and fetches the authorized professional identity. */
  completeLogin(code: string): Promise<InstagramLoginResult>;
}

/** Configuration used only by the server-side Instagram Login adapter. */
export interface InstagramLoginConfig {
  /** Instagram product's OAuth client ID. */
  appId: string;
  /** Instagram product's OAuth client secret. */
  appSecret: string;
  /** Pinned Graph API version. */
  apiVersion: string;
  /** Exact redirect URI used during both authorization and code exchange. */
  redirectUri: string;
}

/** Sanitized provider failure; raw responses are never suitable for browser output. */
export class InstagramLoginError extends Error {
  /** Whether required permissions were declined. */
  readonly permissionsMissing: boolean;

  /** Creates a safe error while retaining an optional internal cause. */
  constructor(permissionsMissing = false, options?: ErrorOptions) {
    super(
      permissionsMissing
        ? 'Required Instagram permissions were not granted'
        : 'Instagram login failed',
      options,
    );
    this.name = 'InstagramLoginError';
    this.permissionsMissing = permissionsMissing;
  }
}

const shortTokenSchema = z.object({
  access_token: z.string().min(1),
  permissions: z.string(),
});
const longTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().max(31_536_000),
});
const profileSchema = z.object({
  user_id: z.string().regex(/^\d+$/),
  username: z.string().trim().min(1),
});

const singleResult = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return Array.isArray(payload.data) && payload.data.length === 1 ? payload.data[0] : undefined;
  }
  return payload;
};

/**
 * Creates the real Meta adapter with injectable HTTP transport for isolated tests.
 * Requests have a ten-second deadline and never follow redirects carrying credentials.
 */
export const createInstagramLoginClient = (
  config: InstagramLoginConfig,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): InstagramLoginClient => {
  const request = async (url: string | URL, init?: RequestInit): Promise<unknown> => {
    try {
      const response = await fetcher(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new InstagramLoginError();
      // Meta IDs may exceed Number.MAX_SAFE_INTEGER. Node 24 exposes the original JSON literal.
      return JSON.parse(
        await response.text(),
        (key, value: unknown, context?: { source?: string }) =>
          key === 'user_id' && typeof value === 'number' && context?.source
            ? context.source
            : value,
      ) as unknown;
    } catch (error) {
      throw new InstagramLoginError(false, { cause: error });
    }
  };

  return {
    authorizationUrl(state): string {
      const url = new URL('https://www.instagram.com/oauth/authorize');
      url.search = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: instagramLoginScopes.join(','),
        state,
        force_reauth: 'true',
      }).toString();
      return url.toString();
    },
    async completeLogin(code): Promise<InstagramLoginResult> {
      const body = new FormData();
      body.set('client_id', config.appId);
      body.set('client_secret', config.appSecret);
      body.set('grant_type', 'authorization_code');
      body.set('redirect_uri', config.redirectUri);
      body.set('code', code);
      const shortToken = shortTokenSchema.safeParse(
        singleResult(
          await request('https://api.instagram.com/oauth/access_token', { method: 'POST', body }),
        ),
      );
      if (!shortToken.success) throw new InstagramLoginError();
      const permissions = new Set(
        shortToken.data.permissions.split(',').map((scope) => scope.trim()),
      );
      if (instagramLoginScopes.some((scope) => !permissions.has(scope)))
        throw new InstagramLoginError(true);

      const exchangeUrl = new URL('https://graph.instagram.com/access_token');
      exchangeUrl.search = new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: config.appSecret,
        access_token: shortToken.data.access_token,
      }).toString();
      const issuedAt = now();
      const longToken = longTokenSchema.safeParse(await request(exchangeUrl));
      if (!longToken.success) throw new InstagramLoginError();

      const profileUrl = new URL(`https://graph.instagram.com/${config.apiVersion}/me`);
      profileUrl.searchParams.set('fields', 'user_id,username');
      const profile = profileSchema.safeParse(
        singleResult(
          await request(profileUrl, {
            headers: { Authorization: `Bearer ${longToken.data.access_token}` },
          }),
        ),
      );
      if (!profile.success) throw new InstagramLoginError();
      return {
        accessToken: longToken.data.access_token,
        instagramUserId: profile.data.user_id,
        username: profile.data.username,
        tokenExpiresAt: new Date(issuedAt + longToken.data.expires_in * 1000),
      };
    },
  };
};
