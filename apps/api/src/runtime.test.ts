import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDatabase } from './database/database.js';
import { createRuntime } from './runtime.js';

vi.mock('./database/database.js', () => ({
  createDatabase: vi.fn(() => ({
    checkHealth: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    sessionRepository: { deleteByTokenHash: vi.fn() },
  })),
}));

const environment = {
  APP_BASE_URL: 'https://app.example',
  META_APP_ID: '12345',
  META_APP_SECRET: 'test-secret',
  META_API_VERSION: 'v24.0',
  META_REDIRECT_URI: 'https://app.example/api/auth/instagram/callback',
  META_WEBHOOK_VERIFY_TOKEN: 'test-webhook-token',
  DATABASE_URL: 'postgres://test:test@localhost/test',
  SESSION_COOKIE_NAME: 'deployment_session',
  SESSION_TTL_SECONDS: '3600',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('application runtime', () => {
  it('validates configuration before constructing database resources', () => {
    expect(() => createRuntime({})).toThrow('Invalid environment configuration');
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it.each(['development', 'production'])('serves health requests in %s', async (mode) => {
    const { app, database } = createRuntime({ ...environment, NODE_ENV: mode });

    const health = await app.request('/api/health');
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });
    expect(database.checkHealth).not.toHaveBeenCalled();

    const databaseHealth = await app.request('/api/health/database');
    expect(databaseHealth.status).toBe(200);
    await expect(databaseHealth.json()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    });
    expect(database.checkHealth).toHaveBeenCalledOnce();
  });

  it.each([
    ['development', false],
    ['production', true],
  ] as const)('applies documentation and cookie policy in %s', async (mode, secure) => {
    const { app } = createRuntime({ ...environment, NODE_ENV: mode });

    expect((await app.request('/api/docs')).status).toBe(200);
    expect((await app.request('/api/openapi.json')).status).toBe(200);

    const logout = await app.request('/api/auth/logout', { method: 'POST' });
    expect(logout.status).toBe(204);
    const cookie = logout.headers.get('set-cookie');
    expect(cookie).toContain('deployment_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie?.includes('Secure')).toBe(secure);
  });

  it('exports a reusable Vercel application without installing shutdown handlers', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.stubEnv('NODE_ENV', 'production');
    const signalCounts = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];

    const { default: app } = await import('./index.js');
    const { default: sameApp } = await import('./index.js');

    expect(sameApp).toBe(app);
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await sameApp.request('/api/health/database')).status).toBe(200);
    expect(createDatabase).toHaveBeenCalledOnce();
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(
      signalCounts,
    );
  });
});
