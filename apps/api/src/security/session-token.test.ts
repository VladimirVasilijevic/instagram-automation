import { describe, expect, it } from 'vitest';

import { createSessionToken, hashSessionToken } from './session-token.js';

describe('session tokens', () => {
  it('creates a 256-bit random token and a separate SHA-256 hash', () => {
    const sessionToken = createSessionToken();

    expect(Buffer.from(sessionToken.token, 'base64url')).toHaveLength(32);
    expect(sessionToken.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionToken.tokenHash).not.toBe(sessionToken.token);
    expect(sessionToken.tokenHash).toBe(hashSessionToken(sessionToken.token));
  });

  it('creates unique credentials', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => createSessionToken().token));

    expect(tokens).toHaveLength(100);
  });

  it('hashes the same token deterministically', () => {
    expect(hashSessionToken('high-entropy-token')).toBe(hashSessionToken('high-entropy-token'));
  });

  it('rejects an empty token', () => {
    expect(() => hashSessionToken('')).toThrowError('Session token must not be empty');
  });
});
