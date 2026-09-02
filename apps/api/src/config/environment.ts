import { z } from 'zod';

/** Validated environment configuration used by the API process. */
export interface Environment {
  /** TCP port used by the local Node.js API server. */
  API_PORT: number;

  /** Server-only PostgreSQL transaction-pooler connection URL. */
  DATABASE_URL: string;

  /** Current application runtime environment. */
  NODE_ENV: 'development' | 'test' | 'production';
}

const environmentSchema: z.ZodType<Environment> = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .trim()
    .min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
