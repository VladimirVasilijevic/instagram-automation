import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment.js';

describe('parseEnvironment', () => {
  it('uses safe defaults for optional values', () => {
    expect(parseEnvironment({ DATABASE_URL: 'postgresql://example' })).toEqual({
      API_PORT: 3000,
      DATABASE_URL: 'postgresql://example',
      NODE_ENV: 'development',
    });
  });

  it('coerces a configured API port', () => {
    expect(
      parseEnvironment({
        API_PORT: '4000',
        DATABASE_URL: 'postgresql://example',
        NODE_ENV: 'production',
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
      parseEnvironment({ API_PORT: '70000', DATABASE_URL: 'postgresql://example' }),
    ).toThrowError(/API_PORT/);
  });
});
