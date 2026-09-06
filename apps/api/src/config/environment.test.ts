import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment.js';

const tokenEncryptionKey = Buffer.alloc(32, 1).toString('base64');
const requiredEnvironment = {
  DATABASE_URL: 'postgresql://example',
  SESSION_COOKIE_NAME: 'igauto_session',
  SESSION_TTL_SECONDS: '604800',
  TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
};

describe('parseEnvironment', () => {
  it('uses safe defaults when all required values are present', () => {
    expect(
      parseEnvironment({
        ...requiredEnvironment,
      }),
    ).toEqual({
      API_PORT: 3000,
      DATABASE_URL: 'postgresql://example',
      NODE_ENV: 'development',
      SESSION_COOKIE_NAME: 'igauto_session',
      SESSION_TTL_SECONDS: 604800,
      TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
    });
  });

  it('coerces a configured API port', () => {
    expect(
      parseEnvironment({
        ...requiredEnvironment,
        API_PORT: '4000',
        NODE_ENV: 'production',
      }),
    ).toMatchObject({ API_PORT: 4000, NODE_ENV: 'production' });
  });

  it('rejects a missing database URL without including other environment values', () => {
    expect(() =>
      parseEnvironment({
        ...requiredEnvironment,
        DATABASE_URL: undefined,
        META_APP_SECRET: 'must-not-appear-in-error',
      }),
    ).toThrowError(/DATABASE_URL is required/);

    try {
      parseEnvironment({
        ...requiredEnvironment,
        DATABASE_URL: undefined,
        META_APP_SECRET: 'must-not-appear-in-error',
      });
    } catch (error) {
      expect(String(error)).not.toContain('must-not-appear-in-error');
    }
  });

  it('rejects an invalid API port', () => {
    expect(() =>
      parseEnvironment({
        ...requiredEnvironment,
        API_PORT: '70000',
      }),
    ).toThrowError(/API_PORT/);
  });

  it('rejects a missing token-encryption key', () => {
    expect(() =>
      parseEnvironment({ ...requiredEnvironment, TOKEN_ENCRYPTION_KEY: undefined }),
    ).toThrowError(/TOKEN_ENCRYPTION_KEY is required/);
  });

  it.each([
    ['plain text', 'not-a-key'],
    ['too few bytes', Buffer.alloc(31, 1).toString('base64')],
    ['too many bytes', Buffer.alloc(33, 1).toString('base64')],
    ['empty text', ''],
  ])('rejects a %s token-encryption key', (_description, value) => {
    expect(() =>
      parseEnvironment({ ...requiredEnvironment, TOKEN_ENCRYPTION_KEY: value }),
    ).toThrowError(/TOKEN_ENCRYPTION_KEY/);
  });

  it.each(['session cookie', 'session;cookie', ''])('rejects an invalid cookie name', (value) => {
    expect(() =>
      parseEnvironment({ ...requiredEnvironment, SESSION_COOKIE_NAME: value }),
    ).toThrowError(/SESSION_COOKIE_NAME/);
  });

  it.each(['0', '-1', '1.5', '31536001'])('rejects an invalid session lifetime', (value) => {
    expect(() =>
      parseEnvironment({ ...requiredEnvironment, SESSION_TTL_SECONDS: value }),
    ).toThrowError(/SESSION_TTL_SECONDS/);
  });
});
