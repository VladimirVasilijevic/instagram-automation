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

/** Application-owned labels identifying the failed Instagram request. */
export type InstagramLoginStage = 'short_token' | 'long_token' | 'profile';

/** Safe diagnostic metadata; provider messages and response values are deliberately excluded. */
export interface InstagramLoginDiagnostics {
  /** Request that failed. */
  stage: InstagramLoginStage;
  /** Application-owned failure classification. */
  reason:
    | 'http_error'
    | 'network_error'
    | 'timeout'
    | 'invalid_json'
    | 'invalid_response'
    | 'permissions';
  /** HTTP status, when a response was received. */
  httpStatus?: number;
  /** Numeric Meta error code, when supplied. */
  metaErrorCode?: number;
  /** Numeric Meta error subcode, when supplied. */
  metaErrorSubcode?: number;
  /** Known schema fields that failed validation, without their values. */
  invalidFields?: string;
}

/** Sanitized provider failure; raw responses are never suitable for browser output. */
export class InstagramLoginError extends Error {
  /** Whether required permissions were declined. */
  readonly permissionsMissing: boolean;

  private readonly diagnostics: InstagramLoginDiagnostics | undefined;

  /** Creates a safe error while retaining an optional internal cause. */
  constructor(
    permissionsMissing = false,
    options?: ErrorOptions & { diagnostics?: InstagramLoginDiagnostics },
  ) {
    super(
      permissionsMissing
        ? 'Required Instagram permissions were not granted'
        : 'Instagram login failed',
      options,
    );
    this.name = 'InstagramLoginError';
    this.permissionsMissing = permissionsMissing;
    this.diagnostics = options?.diagnostics;
  }

  /** Returns only explicitly selected diagnostic fields, never the error or its cause. */
  toLogContext(): Readonly<Record<string, string>> {
    const context: Record<string, string> = { errorName: 'InstagramLoginError' };
    if (!this.diagnostics) return context;
    const { stage, reason, httpStatus, metaErrorCode, metaErrorSubcode, invalidFields } =
      this.diagnostics;
    context.stage = stage;
    context.reason = reason;
    if (httpStatus !== undefined) context.httpStatus = String(httpStatus);
    if (metaErrorCode !== undefined) context.metaErrorCode = String(metaErrorCode);
    if (metaErrorSubcode !== undefined) context.metaErrorSubcode = String(metaErrorSubcode);
    if (invalidFields) context.invalidFields = invalidFields;
    return context;
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

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const numericErrorCode = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
    ? value
    : undefined;

const metaErrorCodes = (payload: unknown) => {
  const root = record(payload);
  const error = record(root?.error) ?? root;
  return {
    metaErrorCode: numericErrorCode(error?.code),
    metaErrorSubcode: numericErrorCode(error?.error_subcode),
  };
};

const diagnosticFields = new Set([
  'access_token',
  'permissions',
  'expires_in',
  'user_id',
  'username',
]);

const parseResponse = <T>(
  schema: z.ZodType<T>,
  payload: unknown,
  stage: InstagramLoginStage,
  httpStatus: number,
): T => {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  const invalidFields = [
    ...new Set(
      result.error.issues.map((issue) => {
        const field = issue.path[0];
        return typeof field === 'string' && diagnosticFields.has(field) ? field : 'response';
      }),
    ),
  ].join(',');
  throw new InstagramLoginError(false, {
    diagnostics: { stage, reason: 'invalid_response', httpStatus, invalidFields },
  });
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
  const request = async (
    stage: InstagramLoginStage,
    url: string | URL,
    init?: RequestInit,
  ): Promise<{ payload: unknown; httpStatus: number }> => {
    let httpStatus: number | undefined;
    try {
      const response = await fetcher(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      httpStatus = response.status;
      const text = await response.text();
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          // Non-JSON error bodies are not useful diagnostic metadata.
        }
        throw new InstagramLoginError(false, {
          diagnostics: { stage, reason: 'http_error', httpStatus, ...metaErrorCodes(payload) },
        });
      }
      // Meta IDs may exceed Number.MAX_SAFE_INTEGER. Node 24 exposes the original JSON literal.
      let payload: unknown;
      try {
        payload = JSON.parse(text, (key, value: unknown, context?: { source?: string }) =>
          key === 'user_id' && typeof value === 'number' && context?.source
            ? context.source
            : value,
        ) as unknown;
      } catch (error) {
        throw new InstagramLoginError(false, {
          cause: error,
          diagnostics: { stage, reason: 'invalid_json', httpStatus },
        });
      }
      return { payload, httpStatus };
    } catch (error) {
      if (error instanceof InstagramLoginError) throw error;
      throw new InstagramLoginError(false, {
        cause: error,
        diagnostics: {
          stage,
          reason:
            error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error',
          httpStatus,
        },
      });
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
      const shortResponse = await request(
        'short_token',
        'https://api.instagram.com/oauth/access_token',
        {
          method: 'POST',
          body,
        },
      );
      const shortToken = parseResponse(
        shortTokenSchema,
        singleResult(shortResponse.payload),
        'short_token',
        shortResponse.httpStatus,
      );
      const permissions = new Set(shortToken.permissions.split(',').map((scope) => scope.trim()));
      if (instagramLoginScopes.some((scope) => !permissions.has(scope)))
        throw new InstagramLoginError(true, {
          diagnostics: {
            stage: 'short_token',
            reason: 'permissions',
            httpStatus: shortResponse.httpStatus,
          },
        });

      const exchangeUrl = new URL('https://graph.instagram.com/access_token');
      exchangeUrl.search = new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: config.appSecret,
        access_token: shortToken.access_token,
      }).toString();
      const issuedAt = now();
      const longResponse = await request('long_token', exchangeUrl);
      const longToken = parseResponse(
        longTokenSchema,
        longResponse.payload,
        'long_token',
        longResponse.httpStatus,
      );

      const profileUrl = new URL(`https://graph.instagram.com/${config.apiVersion}/me`);
      profileUrl.searchParams.set('fields', 'user_id,username');
      const profileResponse = await request('profile', profileUrl, {
        headers: { Authorization: `Bearer ${longToken.access_token}` },
      });
      const profile = parseResponse(
        profileSchema,
        singleResult(profileResponse.payload),
        'profile',
        profileResponse.httpStatus,
      );
      return {
        accessToken: longToken.access_token,
        instagramUserId: profile.user_id,
        username: profile.username,
        tokenExpiresAt: new Date(issuedAt + longToken.expires_in * 1000),
      };
    },
  };
};
