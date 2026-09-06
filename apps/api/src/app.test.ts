import { describe, expect, it, vi } from 'vitest';

import { createApp, type AppDependencies } from './app.js';
import type { DatabaseHealthChecker } from './database/database.js';
import type { SessionRepository } from './database/repositories.js';
import type { Logger } from './logging/logger.js';

const createLogger = (): Logger => ({
  error: vi.fn(),
  info: vi.fn(),
});

const createSessionRepository = (): SessionRepository => ({
  createSession: vi.fn(),
  deleteByTokenHash: vi.fn(),
  findActiveByTokenHash: vi.fn(),
});

const createAppDependencies = (overrides: Partial<AppDependencies> = {}): AppDependencies => ({
  database: { checkHealth: vi.fn() },
  logger: createLogger(),
  sessionCookie: { name: 'igauto_session', secure: false, ttlSeconds: 604800 },
  sessionRepository: createSessionRepository(),
  ...overrides,
});

describe('API application', () => {
  it('reports that the API is healthy without querying the database', async () => {
    const database: DatabaseHealthChecker = { checkHealth: vi.fn() };
    const app = createApp(createAppDependencies({ database }));

    const response = await app.request('/api/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(database.checkHealth).not.toHaveBeenCalled();
  });

  it('reports a successful database connection', async () => {
    const database: DatabaseHealthChecker = { checkHealth: vi.fn().mockResolvedValue(undefined) };
    const app = createApp(createAppDependencies({ database }));

    const response = await app.request('/api/health/database');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ database: 'connected', status: 'ok' });
    expect(database.checkHealth).toHaveBeenCalledOnce();
  });

  it('returns a sanitized response when the database is unavailable', async () => {
    const database: DatabaseHealthChecker = {
      checkHealth: vi.fn().mockRejectedValue(new Error('secret database detail')),
    };
    const logger = createLogger();
    const app = createApp(createAppDependencies({ database, logger }));

    const response = await app.request('/api/health/database');
    const responseBody = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(responseBody)).toEqual({ database: 'unavailable', status: 'error' });
    expect(responseBody).not.toContain('secret database detail');
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'secret database detail',
    );
  });

  it('returns a JSON response for an unknown route', async () => {
    const app = createApp(createAppDependencies());

    const response = await app.request('/unknown');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  it('does not expose unexpected errors', async () => {
    const logger = createLogger();
    const app = createApp(createAppDependencies({ logger }));
    app.get('/api/test-error', () => {
      throw new Error('private implementation detail');
    });

    const response = await app.request('/api/test-error');
    const responseBody = await response.text();

    expect(response.status).toBe(500);
    expect(responseBody).not.toContain('private implementation detail');
    expect(JSON.parse(responseBody)).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'private implementation detail',
    );
  });

  it('serves an OpenAPI document for the registered endpoints', async () => {
    const app = createApp(createAppDependencies());

    const response = await app.request('/api/openapi.json');
    const document = (await response.json()) as {
      info: { title: string };
      paths: Record<
        string,
        {
          get?: { responses: Record<string, unknown> };
          post?: { responses: Record<string, unknown> };
        }
      >;
    };

    expect(response.status).toBe(200);
    expect(document.info.title).toBe('Instagram Automation API');
    expect(document.paths['/api/health']?.get?.responses).toHaveProperty('200');
    expect(document.paths['/api/health/database']?.get?.responses).toHaveProperty('200');
    expect(document.paths['/api/health/database']?.get?.responses).toHaveProperty('503');
    expect(document.paths['/api/auth/logout']?.post?.responses).toHaveProperty('204');
    expect(document.paths['/api/auth/logout']?.post?.responses).toHaveProperty('503');
  });

  it('serves Swagger UI configured with the OpenAPI document', async () => {
    const app = createApp(createAppDependencies());

    const response = await app.request('/api/docs');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('/api/openapi.json');
  });

  it('does not expose documentation routes when documentation is disabled', async () => {
    const app = createApp(createAppDependencies({ docsEnabled: false }));

    expect((await app.request('/api/docs')).status).toBe(404);
    expect((await app.request('/api/openapi.json')).status).toBe(404);
  });
});
