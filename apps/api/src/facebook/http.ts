import { RECOVERY_KIND, type RecoveryKind } from '../automation/recovery.js';

/** Failure categories exposed by the Facebook Graph adapter without raw provider data. */
export type FacebookRequestFailureReason =
  'http_error' | 'invalid_json' | 'invalid_response' | 'network_error' | 'timeout';

/** Sanitized error from a Facebook Graph request. */
export class FacebookClientError extends Error {
  /** Operation that failed, selected by application code. */
  readonly operation: string;
  /** Failure category without response content. */
  readonly reason: FacebookRequestFailureReason;
  /** HTTP status when Meta returned a response. */
  readonly httpStatus?: number;
  /** Numeric Meta error code when present. */
  readonly metaErrorCode?: number;

  constructor(
    operation: string,
    reason: FacebookRequestFailureReason,
    options: ErrorOptions & { httpStatus?: number; metaErrorCode?: number } = {},
  ) {
    super(`Facebook ${operation} failed`, { cause: options.cause });
    this.name = 'FacebookClientError';
    this.operation = operation;
    this.reason = reason;
    this.httpStatus = options.httpStatus;
    this.metaErrorCode = options.metaErrorCode;
  }

  /** Conservative classification for an attempted provider send. */
  recoveryKind(): RecoveryKind {
    if (this.reason !== 'http_error') return RECOVERY_KIND.UNCERTAIN;
    if (this.httpStatus === 401 || this.metaErrorCode === 190) return RECOVERY_KIND.AUTHENTICATION;
    if (this.httpStatus === 429 || this.metaErrorCode === 613 || this.metaErrorCode === 80001)
      return RECOVERY_KIND.RETRYABLE;
    if (this.httpStatus !== undefined && this.httpStatus >= 400 && this.httpStatus < 500)
      return RECOVERY_KIND.PERMANENT;
    return RECOVERY_KIND.UNCERTAIN;
  }

  /** Safe fields for application logs. */
  toLogContext(): Readonly<Record<string, string>> {
    return {
      errorName: this.name,
      operation: this.operation,
      reason: this.reason,
      ...(this.httpStatus === undefined ? {} : { httpStatus: String(this.httpStatus) }),
      ...(this.metaErrorCode === undefined ? {} : { metaErrorCode: String(this.metaErrorCode) }),
    };
  }
}

const numericMetaCode = (payload: unknown): number | undefined => {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return undefined;
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'number' && Number.isSafeInteger(error.code)
    ? error.code
    : undefined;
};

/** Parses a Graph response while preserving large numeric Meta identifiers as strings. */
export const parseFacebookJson = (body: string): unknown =>
  JSON.parse(body, (key, value: unknown, context?: { source?: string }) =>
    /(?:^id$|_id$|^mid$)/.test(key) && typeof value === 'number' && context?.source
      ? context.source
      : value,
  ) as unknown;

/** Makes one bounded Graph request and returns its JSON body. */
export const requestFacebookJson = async (
  operation: string,
  url: URL,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<unknown> => {
  let httpStatus: number | undefined;
  try {
    const response = await fetcher(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = response.status;
    const body = await response.text();
    let payload: unknown;
    try {
      payload = parseFacebookJson(body);
    } catch (error) {
      throw new FacebookClientError(operation, response.ok ? 'invalid_json' : 'http_error', {
        cause: error,
        httpStatus,
      });
    }
    if (!response.ok)
      throw new FacebookClientError(operation, 'http_error', {
        httpStatus,
        metaErrorCode: numericMetaCode(payload),
      });
    return payload;
  } catch (error) {
    if (error instanceof FacebookClientError) throw error;
    throw new FacebookClientError(
      operation,
      error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error',
      { cause: error, httpStatus },
    );
  }
};

/** Validates an expected Graph shape without retaining provider response values. */
export const expectFacebookResponse = <T>(
  operation: string,
  parse: (value: unknown) => { success: true; data: T } | { success: false },
  value: unknown,
): T => {
  const result = parse(value);
  if (!result.success) throw new FacebookClientError(operation, 'invalid_response');
  return result.data;
};
