import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiHealth, getDatabaseHealth } from './health.js';

const mockFetch = (response: Response): void => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('health API client', () => {
  it('returns a validated API health response', async () => {
    mockFetch(Response.json({ status: 'ok' }));

    await expect(getApiHealth()).resolves.toEqual({ status: 'ok' });
    expect(fetch).toHaveBeenCalledWith('/api/health', {
      headers: { accept: 'application/json' },
      signal: undefined,
    });
  });

  it('returns a validated connected database response', async () => {
    mockFetch(Response.json({ database: 'connected', status: 'ok' }));

    await expect(getDatabaseHealth()).resolves.toEqual({
      database: 'connected',
      status: 'ok',
    });
  });

  it('accepts the documented database unavailable response', async () => {
    mockFetch(Response.json({ database: 'unavailable', status: 'error' }, { status: 503 }));

    await expect(getDatabaseHealth()).resolves.toEqual({
      database: 'unavailable',
      status: 'error',
    });
  });

  it('reports a safe error for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network detail')));

    await expect(getApiHealth()).rejects.toThrow('API is unavailable');
    await expect(getApiHealth()).rejects.not.toThrow('private network detail');
  });

  it('rejects malformed JSON', async () => {
    mockFetch(new Response('not-json', { headers: { 'content-type': 'application/json' } }));

    await expect(getApiHealth()).rejects.toThrow('API returned an invalid response');
  });

  it('rejects an unexpected response shape', async () => {
    mockFetch(Response.json({ status: 'maybe' }));

    await expect(getApiHealth()).rejects.toThrow('API is unavailable');
  });
});
