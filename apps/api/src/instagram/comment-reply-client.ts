import { z } from 'zod';

/** Server-side input for publishing one public reply to an Instagram comment. */
export interface ReplyToCommentInput {
  /** Server-only access token decrypted immediately before the provider request. */
  accessToken: string;

  /** Opaque Instagram comment identifier that receives the public reply. */
  commentId: string;

  /** Owner-configured public reply text. */
  message: string;
}

/** Confirmed provider result from publishing one public comment reply. */
export interface ReplyToCommentResult {
  /** Opaque Meta identifier for the created reply. */
  replyId: string;
}

/** Instagram boundary used to publish public replies to comments. */
export interface InstagramCommentReplyClient {
  /** Publishes one public reply to the supplied Instagram comment. */
  replyToComment(input: ReplyToCommentInput): Promise<ReplyToCommentResult>;
}

/** Safe provider-failure metadata suitable for server logs. */
export interface InstagramCommentReplyDiagnostics {
  /** HTTP response status when Meta responded. */
  httpStatus?: number;

  /** Numeric Meta error code when supplied. */
  metaErrorCode?: number;

  /** Numeric Meta error subcode when supplied. */
  metaErrorSubcode?: number;

  /** Application-owned failure category. */
  reason: 'http_error' | 'invalid_json' | 'invalid_response' | 'network_error' | 'timeout';
}

/** Sanitized failure from the Instagram public comment-reply endpoint. */
export class InstagramCommentReplyError extends Error {
  constructor(
    private readonly diagnostics: InstagramCommentReplyDiagnostics,
    options?: ErrorOptions,
  ) {
    super('Instagram comment reply failed', options);
    this.name = 'InstagramCommentReplyError';
  }

  /** Returns the conservative recovery decision without exposing provider content. */
  recoveryKind(): 'authentication' | 'permanent' | 'retryable' | 'uncertain' {
    if (this.diagnostics.reason !== 'http_error') return 'uncertain';
    if (
      this.diagnostics.httpStatus === 401 ||
      this.diagnostics.httpStatus === 403 ||
      this.diagnostics.metaErrorCode === 190
    )
      return 'authentication';
    if (this.diagnostics.httpStatus === 429) return 'retryable';
    if (
      this.diagnostics.httpStatus &&
      this.diagnostics.httpStatus >= 400 &&
      this.diagnostics.httpStatus < 500
    )
      return 'permanent';
    return 'uncertain';
  }

  /** Returns only application-selected diagnostic values. */
  toLogContext(): Readonly<Record<string, string>> {
    const context: Record<string, string> = {
      errorName: 'InstagramCommentReplyError',
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

/** Versioned Graph API settings shared by comment-reply requests. */
export interface InstagramCommentReplyConfig {
  /** Explicit Graph API version used for the reply request. */
  apiVersion: string;
}

const responseSchema = z.object({ id: z.string().trim().min(1) });

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

const parseJson = (text: string): unknown =>
  JSON.parse(text, (key, value: unknown, context?: { source?: string }) =>
    key === 'id' && typeof value === 'number' && context?.source ? context.source : value,
  ) as unknown;

/** Creates the Meta adapter that publishes a public reply to an Instagram comment. */
export const createInstagramCommentReplyClient = (
  config: InstagramCommentReplyConfig,
  fetcher: typeof fetch = fetch,
): InstagramCommentReplyClient => ({
  async replyToComment({ accessToken, commentId, message }): Promise<{ replyId: string }> {
    const url = new URL(`https://graph.instagram.com/${config.apiVersion}/${commentId}/replies`);
    let httpStatus: number | undefined;
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: new URLSearchParams({ message }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      httpStatus = response.status;
      const text = await response.text();
      let payload: unknown;
      try {
        payload = parseJson(text);
      } catch (error) {
        if (!response.ok)
          throw new InstagramCommentReplyError(
            { reason: 'http_error', httpStatus },
            { cause: error },
          );
        throw new InstagramCommentReplyError(
          { reason: 'invalid_json', httpStatus },
          { cause: error },
        );
      }
      if (!response.ok) {
        throw new InstagramCommentReplyError({
          reason: 'http_error',
          httpStatus,
          ...providerErrorCodes(payload),
        });
      }
      if (!responseSchema.safeParse(payload).success) {
        throw new InstagramCommentReplyError({ reason: 'invalid_response', httpStatus });
      }
      return { replyId: responseSchema.parse(payload).id };
    } catch (error) {
      if (error instanceof InstagramCommentReplyError) throw error;
      throw new InstagramCommentReplyError(
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
