import { z } from 'zod';

/** One media item normalized from the Instagram Graph API. */
export interface InstagramMedia {
  /** Opaque Instagram media identifier. */
  id: string;

  /** Optional caption supplied by Instagram. */
  caption: string | null;

  /** Optional canonical Instagram URL for the media. */
  permalink: string | null;

  /** Instagram media type, such as IMAGE, VIDEO, or CAROUSEL_ALBUM. */
  mediaType: string;

  /** Optional media asset URL supplied by Instagram. */
  mediaUrl: string | null;

  /** Optional preview asset URL supplied by Instagram. */
  thumbnailUrl: string | null;

  /** Optional timestamp supplied by Instagram. */
  timestamp: string | null;
}

/** Input required to list media belonging to one connected Instagram account. */
export interface ListRecentMediaInput {
  /** Server-only access token decrypted immediately before the provider request. */
  accessToken: string;

  /** Professional Instagram account identifier returned during login. */
  instagramUserId: string;

  /** Maximum number of items to return, from one through twelve. */
  limit: number;
}

/** Server-side provider boundary for recent Instagram media. */
export interface InstagramMediaClient {
  /** Lists the most recent media for the authenticated Instagram account. */
  listRecentMedia(input: ListRecentMediaInput): Promise<InstagramMedia[]>;
}

/** Application-owned request stage used in sanitized logs and route errors. */
export type InstagramMediaStage = 'media';

/** Safe diagnostic metadata that deliberately omits tokens and provider response content. */
export interface InstagramMediaDiagnostics {
  /** Provider request that failed. */
  stage: InstagramMediaStage;

  /** Stable application-owned failure category. */
  reason: 'http_error' | 'network_error' | 'timeout' | 'invalid_json' | 'invalid_response';

  /** HTTP status when Instagram returned a response. */
  httpStatus?: number;

  /** Numeric Meta error code when supplied. */
  metaErrorCode?: number;

  /** Numeric Meta error subcode when supplied. */
  metaErrorSubcode?: number;

  /** Known response fields that did not match the expected shape. */
  invalidFields?: string;

  /** Known field names paired with fixed type labels, never their values. */
  invalidFieldTypes?: string;
}

/** Sanitized media-provider failure safe for server logs and route-level mapping. */
export class InstagramMediaError extends Error {
  private readonly diagnostics: InstagramMediaDiagnostics | undefined;

  constructor(options?: ErrorOptions & { diagnostics?: InstagramMediaDiagnostics }) {
    super('Instagram media request failed', options);
    this.name = 'InstagramMediaError';
    this.diagnostics = options?.diagnostics;
  }

  /** Returns explicitly selected safe diagnostic fields only. */
  toLogContext(): Readonly<Record<string, string>> {
    const context: Record<string, string> = { errorName: 'InstagramMediaError' };
    if (!this.diagnostics) return context;
    const {
      stage,
      reason,
      httpStatus,
      metaErrorCode,
      metaErrorSubcode,
      invalidFields,
      invalidFieldTypes,
    } = this.diagnostics;
    context.stage = stage;
    context.reason = reason;
    if (httpStatus !== undefined) context.httpStatus = String(httpStatus);
    if (metaErrorCode !== undefined) context.metaErrorCode = String(metaErrorCode);
    if (metaErrorSubcode !== undefined) context.metaErrorSubcode = String(metaErrorSubcode);
    if (invalidFields) context.invalidFields = invalidFields;
    if (invalidFieldTypes) context.invalidFieldTypes = invalidFieldTypes;
    return context;
  }
}

/** Versioned Graph API configuration shared by media requests. */
export interface InstagramMediaConfig {
  /** Explicit Graph API version, such as v24.0. */
  apiVersion: string;
}

const mediaFields = [
  'id',
  'media_type',
  'media_url',
  'thumbnail_url',
  'caption',
  'timestamp',
  'permalink',
] as const;
const safeFieldNames = new Set(['data', ...mediaFields]);
const mediaItemSchema = z.object({
  caption: z.string().nullable().optional(),
  id: z.string().regex(/^\d+$/),
  media_type: z.string().trim().min(1),
  media_url: z.string().url().nullable().optional(),
  permalink: z.string().url().nullable().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  timestamp: z.string().trim().min(1).nullable().optional(),
});
const mediaResponseSchema = z.object({ data: z.array(mediaItemSchema) });

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

const fieldType = (value: unknown): string => {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
      return typeof value;
    default:
      return 'unknown';
  }
};

const issueField = (path: PropertyKey[]): string => {
  const field = [...path].reverse().find((part) => typeof part === 'string');
  return typeof field === 'string' && safeFieldNames.has(field) ? field : 'response';
};

const valueAtPath = (value: unknown, path: PropertyKey[]): unknown => {
  let current = value;
  for (const part of path) {
    if (typeof part === 'number' && Array.isArray(current)) {
      current = current[part];
    } else if (typeof part === 'string') {
      current = record(current)?.[part];
    } else {
      return undefined;
    }
  }
  return current;
};

const parseResponse = (payload: unknown, httpStatus: number): InstagramMedia[] => {
  const result = mediaResponseSchema.safeParse(payload);
  if (result.success) {
    return result.data.data.map((item) => ({
      id: item.id,
      caption: item.caption ?? null,
      mediaType: item.media_type,
      mediaUrl: item.media_url ?? null,
      permalink: item.permalink ?? null,
      thumbnailUrl: item.thumbnail_url ?? null,
      timestamp: item.timestamp ?? null,
    }));
  }

  const fieldIssues = new Map<string, PropertyKey[]>();
  for (const issue of result.error.issues) {
    const field = issueField(issue.path);
    if (!fieldIssues.has(field)) fieldIssues.set(field, issue.path);
  }
  const invalidFields = [...fieldIssues.keys()];
  const invalidFieldTypes = invalidFields
    .map((field) => `${field}:${fieldType(valueAtPath(payload, fieldIssues.get(field)!))}`)
    .join(',');
  throw new InstagramMediaError({
    diagnostics: {
      stage: 'media',
      reason: 'invalid_response',
      httpStatus,
      invalidFields: invalidFields.join(','),
      invalidFieldTypes,
    },
  });
};

const parseJson = (text: string, httpStatus: number): unknown => {
  try {
    // Instagram IDs can exceed Number.MAX_SAFE_INTEGER. Node preserves the original numeric literal.
    return JSON.parse(text, (key, value: unknown, context?: { source?: string }) =>
      key === 'id' && typeof value === 'number' && context?.source ? context.source : value,
    ) as unknown;
  } catch (error) {
    throw new InstagramMediaError({
      cause: error,
      diagnostics: { stage: 'media', reason: 'invalid_json', httpStatus },
    });
  }
};

/** Creates the Meta Graph API adapter for recent media with an injectable HTTP transport. */
export const createInstagramMediaClient = (
  config: InstagramMediaConfig,
  fetcher: typeof fetch = fetch,
): InstagramMediaClient => ({
  async listRecentMedia({ accessToken, instagramUserId, limit }): Promise<InstagramMedia[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 12) {
      throw new RangeError('Media limit must be an integer from 1 through 12');
    }

    const url = new URL(
      `https://graph.instagram.com/${config.apiVersion}/${instagramUserId}/media`,
    );
    url.search = new URLSearchParams({
      fields: mediaFields.join(','),
      limit: String(limit),
    }).toString();
    let httpStatus: number | undefined;
    try {
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
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
          // Non-JSON provider error bodies contain no useful safe diagnostic fields.
        }
        throw new InstagramMediaError({
          diagnostics: {
            stage: 'media',
            reason: 'http_error',
            httpStatus,
            ...metaErrorCodes(payload),
          },
        });
      }
      return parseResponse(parseJson(text, httpStatus), httpStatus).slice(0, limit);
    } catch (error) {
      if (error instanceof InstagramMediaError || error instanceof RangeError) throw error;
      throw new InstagramMediaError({
        cause: error,
        diagnostics: {
          stage: 'media',
          reason:
            error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error',
          httpStatus,
        },
      });
    }
  },
});
