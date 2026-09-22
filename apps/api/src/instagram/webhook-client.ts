import { z } from 'zod';

/** Server-side input for subscribing one Instagram professional account to comment deliveries. */
export interface SubscribeToCommentsInput {
  /** Long-lived token decrypted only immediately before the provider request. */
  accessToken: string;
  /** Instagram professional account receiving the subscription. */
  instagramUserId: string;
}

/** Instagram boundary used to request comment webhook deliveries for a connected account. */
export interface InstagramWebhookClient {
  /** Repeated requests keep the account subscribed to comment webhook events. */
  subscribeToComments(input: SubscribeToCommentsInput): Promise<void>;
}

/** Safe provider-failure metadata suitable for server logs. */
export interface InstagramWebhookDiagnostics {
  /** HTTP response status when Meta responded. */
  httpStatus?: number;
  /** Numeric Meta error code when supplied. */
  metaErrorCode?: number;
  /** Numeric Meta error subcode when supplied. */
  metaErrorSubcode?: number;
  /** Application-owned failure category. */
  reason: 'http_error' | 'invalid_json' | 'invalid_response' | 'network_error' | 'timeout';
}

/** Sanitized failure from the Instagram comment-subscription endpoint. */
export class InstagramWebhookError extends Error {
  constructor(
    private readonly diagnostics: InstagramWebhookDiagnostics,
    options?: ErrorOptions,
  ) {
    super('Instagram comment subscription failed', options);
    this.name = 'InstagramWebhookError';
  }

  /** Returns only application-selected diagnostic values. */
  toLogContext(): Readonly<Record<string, string>> {
    const context: Record<string, string> = {
      errorName: 'InstagramWebhookError',
      reason: this.diagnostics.reason,
    };
    if (this.diagnostics.httpStatus !== undefined)
      context.httpStatus = String(this.diagnostics.httpStatus);
    if (this.diagnostics.metaErrorCode !== undefined)
      context.metaErrorCode = String(this.diagnostics.metaErrorCode);
    if (this.diagnostics.metaErrorSubcode !== undefined)
      context.metaErrorSubcode = String(this.diagnostics.metaErrorSubcode);
    return context;
  }
}

/** Versioned Graph API settings shared by webhook subscription requests. */
export interface InstagramWebhookConfig {
  /** Explicit Graph API version used for the subscription request. */
  apiVersion: string;
}

const numericErrorCode = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
    ? value
    : undefined;

const providerErrorCodes = (payload: unknown) => {
  const root =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;
  const error =
    root?.error !== null && typeof root?.error === 'object' && !Array.isArray(root.error)
      ? (root.error as Record<string, unknown>)
      : root;
  return {
    metaErrorCode: numericErrorCode(error?.code),
    metaErrorSubcode: numericErrorCode(error?.error_subcode),
  };
};

const successSchema = z.object({ success: z.literal(true) });

/** Creates the Meta adapter that requests an idempotent comments subscription for one account. */
export const createInstagramWebhookClient = (
  config: InstagramWebhookConfig,
  fetcher: typeof fetch = fetch,
): InstagramWebhookClient => ({
  async subscribeToComments({ accessToken, instagramUserId }): Promise<void> {
    const url = new URL(
      `https://graph.instagram.com/${config.apiVersion}/${instagramUserId}/subscribed_apps`,
    );
    url.searchParams.set('subscribed_fields', 'comments');
    let httpStatus: number | undefined;
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      httpStatus = response.status;
      const text = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch (error) {
        throw new InstagramWebhookError({ reason: 'invalid_json', httpStatus }, { cause: error });
      }
      if (!response.ok)
        throw new InstagramWebhookError({
          reason: 'http_error',
          httpStatus,
          ...providerErrorCodes(payload),
        });
      if (!successSchema.safeParse(payload).success)
        throw new InstagramWebhookError({ reason: 'invalid_response', httpStatus });
    } catch (error) {
      if (error instanceof InstagramWebhookError) throw error;
      throw new InstagramWebhookError(
        {
          reason:
            error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error',
          httpStatus,
        },
        { cause: error },
      );
    }
  },
});
