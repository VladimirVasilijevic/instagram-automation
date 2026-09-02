import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment.js';

const tokenEncryptionKey = Buffer.alloc(32, 1).toString('base64');

describe('parseEnvironment', () => {
  it('uses safe defaults when all required values are present', () => {
    expect(
      parseEnvironment({
        DATABASE_URL: 'postgresql://example',
        TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
      }),
    ).toEqual({
      API_PORT: 3000,
      DATABASE_URL: 'postgresql://example',
      NODE_ENV: 'development',
      TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
    });
  });

  it('coerces a configured API port', () => {
    expect(
      parseEnvironment({
        API_PORT: '4000',
        DATABASE_URL: 'postgresql://example',
        NODE_ENV: 'production',
        TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
      }),
    ).toMatchObject({ API_PORT: 4000, NODE_ENV: 'production' });
  });

  it('rejects a missing database URL without including other environment values', () => {
    expect(() => parseEnvironment({ META_APP_SECRET: 'must-not-appear-in-error' })).toThrowError(
      /DATABASE_URL is required/,
    );

    try {
      parseEnvironment({ META_APP_SECRET: 'must-not-appear-in-error' });
    } catch (error) {
      expect(String(error)).not.toContain('must-not-appear-in-error');
    }
  });

  it('rejects an invalid API port', () => {
    expect(() =>
      parseEnvironment({
        API_PORT: '70000',
        DATABASE_URL: 'postgresql://example',
        TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
      }),
    ).toThrowError(/API_PORT/);
  });

  it('rejects a missing token-encryption key', () => {
    expect(() => parseEnvironment({ DATABASE_URL: 'postgresql://example' })).toThrowError(
      /TOKEN_ENCRYPTION_KEY is required/,
    );
  });

  it.each([
    ['plain text', 'not-a-key'],
    ['too few bytes', Buffer.alloc(31, 1).toString('base64')],
    ['too many bytes', Buffer.alloc(33, 1).toString('base64')],
    ['empty text', ''],
  ])('rejects a %s token-encryption key', (_description, value) => {
    expect(() =>
      parseEnvironment({ DATABASE_URL: 'postgresql://example', TOKEN_ENCRYPTION_KEY: value }),
    ).toThrowError(/TOKEN_ENCRYPTION_KEY/);
  });
});
