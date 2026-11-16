import { z } from 'zod';

import type { RecoveryKind } from '../automation/recovery.js';
import {
  classifyInstagramReplyFailure,
  type InstagramReplyFailureDiagnostics,
} from './reply-recovery.js';

/** Server-side input for a message to someone who has replied in Instagram Direct. */
export interface SendDirectMessageInput {
  /** Long-lived token decrypted immediately before dispatch. */
  accessToken: string;
  /** Professional account sending the message. */
  instagramUserId: string;
  /** Instagram-scoped ID from the confirmed private reply. */
  recipientId: string;
  /** Owner-configured follow-up text. */
  message: string;
}

/** Confirmed Meta response from one direct message. */
export interface SendDirectMessageResult {
  /** Instagram-scoped recipient ID confirmed by Meta. */
  recipientId: string;
  /** Meta identifier of the sent message. */
  replyId: string;
}

/** Provider boundary for recipient-addressed Instagram Direct messages. */
export interface InstagramDirectMessageClient {
  /** Sends one recipient-addressed Instagram Direct message. */
  sendDirectMessage(input: SendDirectMessageInput): Promise<SendDirectMessageResult>;
}

/** Safe direct-message failure metadata suitable for server logs. */
export interface InstagramDirectMessageDiagnostics extends InstagramReplyFailureDiagnostics {
  /** HTTP response status when Meta responded. */
  httpStatus?: number;
  /** Numeric Meta error code when supplied. */
  metaErrorCode?: number;
  /** Numeric Meta error subcode when supplied. */
  metaErrorSubcode?: number;
}

/** Sanitized provider error for a recipient-addressed message. */
export class InstagramDirectMessageError extends Error {
  constructor(
    private readonly diagnostics: InstagramDirectMessageDiagnostics,
    options?: ErrorOptions,
  ) {
    super('Instagram direct message failed', options);
    this.name = 'InstagramDirectMessageError';
  }

  /** Categorizes the failure for safe retry handling. */
  recoveryKind(): RecoveryKind {
    return classifyInstagramReplyFailure(this.diagnostics);
  }

  /** Returns diagnostic fields without credentials or message content. */
  toLogContext(): Readonly<Record<string, string>> {
    const context: Record<string, string> = {
      errorName: 'InstagramDirectMessageError',
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

/** Versioned settings for the recipient-addressed Instagram Direct adapter. */
export interface InstagramDirectMessageConfig {
  /** Version prefix for Meta Graph requests. */
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

/** Creates the Meta adapter for a normal Instagram Direct message. */
export const createInstagramDirectMessageClient = (
  config: InstagramDirectMessageConfig,
  fetcher: typeof fetch = fetch,
): InstagramDirectMessageClient => ({
  async sendDirectMessage(input) {
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
          recipient: { id: input.recipientId },
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
        throw new InstagramDirectMessageError(
          { reason: response.ok ? 'invalid_json' : 'http_error', httpStatus },
          { cause: error },
        );
      }
      if (!response.ok)
        throw new InstagramDirectMessageError({
          reason: 'http_error',
          httpStatus,
          ...providerErrorCodes(payload),
        });
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success)
        throw new InstagramDirectMessageError({ reason: 'invalid_response', httpStatus });
      return { recipientId: parsed.data.recipient_id, replyId: parsed.data.message_id };
    } catch (error) {
      if (error instanceof InstagramDirectMessageError) throw error;
      throw new InstagramDirectMessageError(
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
