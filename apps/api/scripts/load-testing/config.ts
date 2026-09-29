const isolationConfirmation = 'I_UNDERSTAND_THIS_DATABASE_WILL_BE_MUTATED';
const runIdPattern = /^[a-z0-9][a-z0-9-]{2,39}$/;

export const loadTestAppSecret = 'load-test-app-secret';
export const loadTestEncryptionKey = Buffer.alloc(32, 17).toString('base64');
export const loadTestSessionCookieName = 'igauto_load_test';

/** Stable error for credential-free load-test configuration failures. */
export class LoadTestConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadTestConfigurationError';
  }
}

const required = (name: string, value: string | undefined): string => {
  if (!value?.trim()) throw new LoadTestConfigurationError(`${name} is required`);
  return value.trim();
};

const databaseIdentity = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LoadTestConfigurationError('Load-test database URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new LoadTestConfigurationError('Load-test database URL must use PostgreSQL');
  }
  return `${url.hostname.toLowerCase()}:${url.port}/${url.pathname.replace(/^\//, '')}`;
};

/** Rejects load-test access unless the operator explicitly selected a distinct database. */
export const requireIsolatedLoadTestDatabase = (
  databaseUrl: string | undefined,
  confirmation: string | undefined,
  knownApplicationUrls: Array<string | undefined> = [],
): string => {
  const selectedUrl = required('LOAD_TEST_DATABASE_URL', databaseUrl);
  if (confirmation !== isolationConfirmation) {
    throw new LoadTestConfigurationError(
      `LOAD_TEST_CONFIRM_ISOLATED must equal ${isolationConfirmation}`,
    );
  }
  const selectedIdentity = databaseIdentity(selectedUrl);
  for (const knownUrl of knownApplicationUrls) {
    if (knownUrl?.trim() && databaseIdentity(knownUrl.trim()) === selectedIdentity) {
      throw new LoadTestConfigurationError(
        'Load-test database must differ from configured application databases',
      );
    }
  }
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    throw new LoadTestConfigurationError('Load-test tools cannot run in a production environment');
  }
  return selectedUrl;
};

/** Returns a short identifier safe for fixture keys and targeted cleanup. */
export const loadTestRunId = (value: string | undefined, now: Date = new Date()): string => {
  const runId = value?.trim() || `run-${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
  if (!runIdPattern.test(runId)) {
    throw new LoadTestConfigurationError(
      'LOAD_TEST_RUN_ID must contain 3-40 lowercase letters, digits, or hyphens',
    );
  }
  return runId;
};

/** Restricts the load generator to the local test-only server. */
export const loadTestBaseUrl = (value: string | undefined): string => {
  const selected = value?.trim() || 'http://127.0.0.1:3400';
  let url: URL;
  try {
    url = new URL(selected);
  } catch {
    throw new LoadTestConfigurationError('LOAD_TEST_BASE_URL is invalid');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new LoadTestConfigurationError(
      'LOAD_TEST_BASE_URL must be an HTTP localhost origin without credentials or paths',
    );
  }
  return url.origin;
};

/** Converts unknown failures into safe CLI output without URLs or provider data. */
export const toSafeLoadTestError = (error: unknown): string =>
  error instanceof LoadTestConfigurationError
    ? error.message
    : `Load-test command failed (${error instanceof Error ? error.name : 'UnknownError'})`;

export const loadTestIsolationConfirmation = isolationConfirmation;
