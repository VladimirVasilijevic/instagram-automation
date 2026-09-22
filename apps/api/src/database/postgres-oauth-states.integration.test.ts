import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSessionToken } from '../security/session-token.js';
import { createPostgresOAuthStateRepository } from './postgres-oauth-states.js';

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === 'true';
const describeDatabase = enabled ? describe : describe.skip;

describeDatabase('PostgreSQL OAuth state', () => {
  let first: ReturnType<typeof postgres>;
  let second: ReturnType<typeof postgres>;

  beforeAll(() => {
    // This suite deliberately does not load .env.local or use the production runtime connection.
    const url = process.env.TEST_DATABASE_URL;
    if (!url || process.env.NODE_ENV === 'production' || url === process.env.DATABASE_URL) {
      throw new Error(
        'A separate non-production TEST_DATABASE_URL with migrations applied is required',
      );
    }
    const options = { max: 1, prepare: false, connect_timeout: 10 };
    first = postgres(url, options);
    second = postgres(url, options);
  });
  afterAll(async () => {
    await Promise.all([first?.end({ timeout: 5 }), second?.end({ timeout: 5 })]);
  });

  it('enforces browser binding, expiry, and a single winner across independent connections', async () => {
    const repository = createPostgresOAuthStateRepository(first);
    const otherInstance = createPostgresOAuthStateRepository(second);
    const state = createSessionToken();
    const expired = createSessionToken();
    const binding = createSessionToken();
    const wrongBinding = createSessionToken();
    try {
      await repository.createState({
        stateHash: state.tokenHash,
        browserBindingHash: binding.tokenHash,
        expiresAt: new Date(Date.now() + 600_000),
      });
      await repository.createState({
        stateHash: expired.tokenHash,
        browserBindingHash: binding.tokenHash,
        expiresAt: new Date(0),
      });
      expect(await repository.consumeState(state.tokenHash, wrongBinding.tokenHash)).toBe(false);
      expect(await repository.consumeState(expired.tokenHash, binding.tokenHash)).toBe(false);
      const results = await Promise.all([
        repository.consumeState(state.tokenHash, binding.tokenHash),
        otherInstance.consumeState(state.tokenHash, binding.tokenHash),
      ]);
      expect(results.sort()).toEqual([false, true]);
      expect(await repository.consumeState(state.tokenHash, binding.tokenHash)).toBe(false);
    } finally {
      await first`delete from app_private.oauth_states where state_hash in (${state.tokenHash}, ${expired.tokenHash})`;
    }
  });
});
