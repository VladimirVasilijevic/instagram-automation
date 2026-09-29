import { describe, expect, it, vi } from 'vitest';

import {
  loadTestBaseUrl,
  loadTestRunId,
  requireIsolatedLoadTestDatabase,
  toSafeLoadTestError,
} from './config.js';

describe('load-test safety configuration', () => {
  it('requires an explicit isolation confirmation', () => {
    expect(() =>
      requireIsolatedLoadTestDatabase('postgres://test.example/test', undefined),
    ).toThrowError(/LOAD_TEST_CONFIRM_ISOLATED/);
  });

  it('rejects the same database identity even when credentials differ', () => {
    expect(() =>
      requireIsolatedLoadTestDatabase(
        'postgres://load:one@test.example:6543/postgres',
        'I_UNDERSTAND_THIS_DATABASE_WILL_BE_MUTATED',
        ['postgres://application:two@test.example:6543/postgres'],
      ),
    ).toThrowError(/must differ/);
  });

  it('accepts an explicitly isolated PostgreSQL database', () => {
    expect(
      requireIsolatedLoadTestDatabase(
        'postgres://load@test.example:6543/postgres',
        'I_UNDERSTAND_THIS_DATABASE_WILL_BE_MUTATED',
        ['postgres://application@production.example:6543/postgres'],
      ),
    ).toBe('postgres://load@test.example:6543/postgres');
  });

  it('refuses production runtimes', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() =>
      requireIsolatedLoadTestDatabase(
        'postgres://load@test.example:6543/postgres',
        'I_UNDERSTAND_THIS_DATABASE_WILL_BE_MUTATED',
      ),
    ).toThrowError(/production/);
    vi.unstubAllEnvs();
  });

  it('creates and validates safe run identifiers', () => {
    expect(loadTestRunId(undefined, new Date('2026-09-29T12:34:56Z'))).toBe('run-20260929123456');
    expect(() => loadTestRunId('Unsafe value')).toThrowError(/LOAD_TEST_RUN_ID/);
  });

  it('allows only a local load-test target', () => {
    expect(loadTestBaseUrl(undefined)).toBe('http://127.0.0.1:3400');
    expect(loadTestBaseUrl('http://localhost:3400')).toBe('http://localhost:3400');
    expect(() => loadTestBaseUrl('https://production.example')).toThrowError(/localhost/);
    expect(() => loadTestBaseUrl('http://127.0.0.1:3400/api')).toThrowError(/localhost/);
  });

  it('sanitizes unexpected errors', () => {
    expect(toSafeLoadTestError(new Error('postgres://user:secret@example.test/db'))).toBe(
      'Load-test command failed (Error)',
    );
  });
});
