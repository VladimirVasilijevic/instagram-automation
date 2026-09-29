import { z } from 'zod';

import type { RecoveryKind } from '../automation/recovery.js';
import {
  classifyInstagramReplyFailure,
  type InstagramReplyFailureDiagnostics,
} from './reply-recovery.js';

/** Server-side input for sending one private reply to an Instagram commenter. */
export interface SendPrivateReplyInput {
  /** Long-lived token decrypted immediately before dispatch. */
  accessToken: string;
  /** Professional account sending the private reply. */
  instagramUserId: string;
  /** Comment that authorizes this one private reply. */
  commentId: string;
  /** Owner-configured private message. */
  message: string;
}

/** Confirmed Meta response from one private reply. */
export interface SendPrivateReplyResult {
  /** Instagram-scoped recipient identifier. */
  recipientId: string;
  /** Opaque Meta message identifier. */
  replyId: string;
}

/** Provider boundary for comment-addressed Instagram private replies. */
export interface InstagramPrivateReplyClient {
  /** Sends the single private reply authorized by a comment. */
  sendPrivateReply(input: SendPrivateReplyInput): Promise<SendPrivateReplyResult>;
}

/** Safe private-reply failure metadata suitable for server logs. */
export interface InstagramPrivateReplyDiagnostics extends InstagramReplyFailureDiagnostics {
  /** HTTP response status when Meta responded. */
  httpStatus?: number;
  /** Numeric Meta error code when supplied. */
  metaErrorCode?: number;
  /** Numeric Meta error subcode when supplied. */
  metaErrorSubcode?: number;
}

/** Sanitized provider error for a private-reply request. */
export class InstagramPrivateReplyError extends Error {
  constructor(
    private readonly diagnostics: InstagramPrivateReplyDiagnostics,
    options?: ErrorOptions,
  ) {
    super('Instagram private reply failed', options);
    this.name = 'InstagramPrivateReplyError';
  }

  /** Returns the conservative automatic-recovery decision. */
  recoveryKind(): RecoveryKind {
    return classifyInstagramReplyFailure(this.diagnostics);
  }

  /** Returns only selected diagnostic values, never response content. */
  toLogContext(): Readonly<Record<string, string>> {
    const context: Record<string, string> = {
      errorName: 'InstagramPrivateReplyError',
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

/** Versioned settings for the Instagram private-reply adapter. */
export interface InstagramPrivateReplyConfig {
  /** Explicit Graph API version. */
  apiVersion: string;
}

const responseSchema = z.object({
  message_id: z.string().trim().min(1),
  recipient_id: z.string().trim().min(1),
});
const numericErrorCode = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
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

/** Creates the Meta adapter for comment-addressed private replies. */
export const createInstagramPrivateReplyClient = (
  config: InstagramPrivateReplyConfig,
  fetcher: typeof fetch = fetch,
): InstagramPrivateReplyClient => ({
  async sendPrivateReply(input) {
    const url = new URL(
      `https://graph.instagram.com/${config.apiVersion}/${input.instagramUserId}/messages`,
    );
    let httpStatus: number | undefined;
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: { text: input.message },
          recipient: { comment_id: input.commentId },
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      httpStatus = response.status;
      const text = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch (error) {
        throw new InstagramPrivateReplyError(
          { reason: response.ok ? 'invalid_json' : 'http_error', httpStatus },
          { cause: error },
        );
      }
      if (!response.ok)
        throw new InstagramPrivateReplyError({
          reason: 'http_error',
          httpStatus,
          ...providerErrorCodes(payload),
        });
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success)
        throw new InstagramPrivateReplyError({ reason: 'invalid_response', httpStatus });
      return { recipientId: parsed.data.recipient_id, replyId: parsed.data.message_id };
    } catch (error) {
      if (error instanceof InstagramPrivateReplyError) throw error;
      throw new InstagramPrivateReplyError(
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
