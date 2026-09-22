import { z } from 'zod';

/** Validated environment configuration used by the API process. */
export interface Environment {
  /** Public frontend origin used for fixed login success and failure redirects. */
  APP_BASE_URL: string;

  /** Instagram Login client ID from the Instagram product settings. */
  META_APP_ID: string;

  /** Server-only Instagram Login client secret. */
  META_APP_SECRET: string;

  /** Explicit Graph API version for Instagram profile requests. */
  META_API_VERSION: string;

  /** Exact OAuth callback URL registered in the Meta dashboard. */
  META_REDIRECT_URI: string;

  /** Secret shared with Meta only for the one-time webhook verification handshake. */
  META_WEBHOOK_VERIFY_TOKEN: string;

  /** TCP port used by the local Node.js API server. */
  API_PORT: number;

  /** Server-only PostgreSQL transaction-pooler connection URL. */
  DATABASE_URL: string;

  /** Current application runtime environment. */
  NODE_ENV: 'development' | 'test' | 'production';

  /** Name of the HTTP-only browser cookie carrying the session credential. */
  SESSION_COOKIE_NAME: string;

  /** Number of seconds before an application session and its browser cookie expire. */
  SESSION_TTL_SECONDS: number;

  /** Base64-encoded 256-bit key used to encrypt sensitive application tokens. */
  TOKEN_ENCRYPTION_KEY: string;
}

const base64EncodedKeyPattern = /^[A-Za-z0-9+/]{43}=$/;
const cookieNamePattern = /^[A-Za-z0-9_-]+$/;

const webUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, 'Must be an HTTP(S) URL without credentials, query, or fragment');

const environmentSchema: z.ZodType<Environment> = z
  .object({
    APP_BASE_URL: webUrl.refine(
      (value) => URL.canParse(value) && new URL(value).pathname === '/',
      'Must be a site origin',
    ),
    META_APP_ID: z.string().trim().regex(/^\d+$/, 'Must be a numeric Instagram app ID'),
    META_APP_SECRET: z.string().trim().min(1, 'META_APP_SECRET is required'),
    META_API_VERSION: z
      .string()
      .trim()
      .regex(/^v\d+\.0$/, 'Must be an explicit version such as v24.0'),
    META_REDIRECT_URI: webUrl.refine(
      (value) => URL.canParse(value) && new URL(value).pathname === '/api/auth/instagram/callback',
      'Must use the /api/auth/instagram/callback path',
    ),
    META_WEBHOOK_VERIFY_TOKEN: z.string().trim().min(1, 'META_WEBHOOK_VERIFY_TOKEN is required'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required' })
      .trim()
      .min(1, 'DATABASE_URL is required'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SESSION_COOKIE_NAME: z
      .string({ error: 'SESSION_COOKIE_NAME is required' })
      .trim()
      .min(1, 'SESSION_COOKIE_NAME is required')
      .regex(cookieNamePattern, 'SESSION_COOKIE_NAME contains unsupported characters'),
    SESSION_TTL_SECONDS: z.coerce
      .number({ error: 'SESSION_TTL_SECONDS is required' })
      .int('SESSION_TTL_SECONDS must be an integer')
      .positive('SESSION_TTL_SECONDS must be positive')
      .max(31_536_000, 'SESSION_TTL_SECONDS must not exceed one year'),
    TOKEN_ENCRYPTION_KEY: z
      .string({ error: 'TOKEN_ENCRYPTION_KEY is required' })
      .trim()
      .refine(
        (value) =>
          base64EncodedKeyPattern.test(value) && Buffer.from(value, 'base64').byteLength === 32,
        'TOKEN_ENCRYPTION_KEY must be a Base64-encoded 32-byte key',
      ),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'production') return;
    if (!URL.canParse(value.APP_BASE_URL) || !URL.canParse(value.META_REDIRECT_URI)) return;
    if (
      !value.APP_BASE_URL.startsWith('https://') ||
      !value.META_REDIRECT_URI.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['META_REDIRECT_URI'],
        message: 'Production login requires HTTPS',
      });
    }
    if (new URL(value.APP_BASE_URL).origin !== new URL(value.META_REDIRECT_URI).origin) {
      context.addIssue({
        code: 'custom',
        path: ['META_REDIRECT_URI'],
        message: 'Production callback and frontend must share an origin',
      });
    }
  });

/**
 * Validates and normalizes environment variables required by the API process.
 *
 * @param input - Environment key-value pairs, normally `process.env`.
 * @returns Validated runtime configuration with defaults applied.
 * @throws When a required variable is missing or a configured value is invalid.
 */
export const parseEnvironment = (input: NodeJS.ProcessEnv): Environment => {
  const result = environmentSchema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');

  throw new Error(`Invalid environment configuration: ${issues}`);
};
