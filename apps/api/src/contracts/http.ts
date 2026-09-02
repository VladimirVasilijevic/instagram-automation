import { z } from '@hono/zod-openapi';

/** Describes a successful API process health response. */
export const healthResponseSchema = z
  .object({
    status: z.literal('ok').openapi({ example: 'ok' }),
  })
  .openapi('HealthResponse');

/** Describes a successful database connectivity response. */
export const databaseConnectedResponseSchema = z
  .object({
    database: z.literal('connected').openapi({ example: 'connected' }),
    status: z.literal('ok').openapi({ example: 'ok' }),
  })
  .openapi('DatabaseConnectedResponse');

/** Describes a sanitized database-unavailable response. */
export const databaseUnavailableResponseSchema = z
  .object({
    database: z.literal('unavailable').openapi({ example: 'unavailable' }),
    status: z.literal('error').openapi({ example: 'error' }),
  })
  .openapi('DatabaseUnavailableResponse');

/** Describes the standard JSON error envelope returned by the API. */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'INTERNAL_SERVER_ERROR' }),
      message: z.string().openapi({ example: 'An unexpected error occurred' }),
    }),
  })
  .openapi('ErrorResponse');
