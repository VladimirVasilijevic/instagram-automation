import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { Execution, InstagramAccount, Session } from '../database/repositories.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 7).toString('base64'));
const account: InstagramAccount = {
  accessTokenCiphertext: tokenProtector.encrypt('private-instagram-token'),
  connectionStatus: 'active',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  id: 'account-id',
  instagramUserId: '17841400000000001',
  tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  tokenRefreshFailureCode: null,
  tokenRefreshLastSucceededAt: null,
  tokenRefreshNextAttemptAt: null,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  username: 'example',
};
const sessionToken = createSessionToken();
const session: Session = {
  accountId: account.id,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  id: 'session-id',
};
const execution: Execution = {
  attemptCount: 1,
  automationId: 'automation-id',
  commenterInstagramId: null,
  commenterUsername: 'commenter',
  commentText: '#Hello',
  createdAt: new Date('2026-09-24T12:00:00.000Z'),
  deliveryChannel: 'public',
  dispatchStartedAt: null,
  errorCode: null,
  errorMessage: null,
  failureKind: null,
  id: 'execution-id',
  instagramCommentId: 'comment-id',
  leaseExpiresAt: null,
  leaseId: null,
  mediaId: 'selected-post-id',
  messageText: 'Thanks!',
  nextAttemptAt: null,
  providerReplyId: null,
  status: 'succeeded',
  updatedAt: new Date('2026-09-24T12:00:00.000Z'),
};

const createFixture = () => {
  const executionRepository = {
    claimExecutions: vi.fn(),
    listRecentByAccountId: vi.fn().mockResolvedValue([execution]),
    markDispatchStarted: vi.fn(),
    markFailed: vi.fn(),
    markRetryPending: vi.fn(),
    markSucceeded: vi.fn(),
    markUncertain: vi.fn(),
  };
  const app = createApp({
    automationRepository: {
      findByAccountId: vi.fn(),
      findEnabledByAccountAndMedia: vi.fn(),
      saveAutomation: vi.fn(),
    },
    executionRepository,
    instagramAuth: {
      appBaseUrl: 'https://app.example',
      redirectUri: 'https://app.example/api/auth/instagram/callback',
      instagramClient: { authorizationUrl: vi.fn(), completeLogin: vi.fn() },
      accountRepository: { upsertConnectedAccount: vi.fn(), findByInstagramUserId: vi.fn() },
      oauthStateRepository: { createState: vi.fn(), consumeState: vi.fn() },
      tokenProtector,
    },
    instagramMedia: { instagramMediaClient: { listRecentMedia: vi.fn() }, tokenProtector },
    instagramSubscription: {
      instagramWebhookClient: { subscribeToComments: vi.fn() },
      tokenRefreshRepository: { markAccountReconnectRequired: vi.fn() },
    },
    database: { checkHealth: vi.fn() },
    logger: { error: vi.fn(), info: vi.fn() },
    sessionCookie: { name: 'igauto_session', secure: false, ttlSeconds: 3600 },
    sessionRepository: {
      createSession: vi.fn(),
      deleteByTokenHash: vi.fn(),
      findActiveByTokenHash: vi.fn(async (tokenHash: string) =>
        tokenHash === sessionToken.tokenHash ? { account, session } : null,
      ),
    },
  });
  return {
    app,
    executionRepository,
    headers: { Cookie: `igauto_session=${sessionToken.token}` },
  };
};

describe('execution activity route', () => {
  it('returns all recent activity when no post filter is supplied', async () => {
    const fixture = createFixture();
    const response = await fixture.app.request('/api/executions?limit=50', {
      headers: fixture.headers,
    });

    expect(response.status).toBe(200);
    expect(fixture.executionRepository.listRecentByAccountId).toHaveBeenCalledWith(
      account.id,
      50,
      undefined,
    );
    await expect(response.json()).resolves.toEqual({
      executions: [
        {
          commenterUsername: 'commenter',
          commentText: '#Hello',
          createdAt: '2026-09-24T12:00:00.000Z',
          deliveries: [
            { channel: 'public', errorCode: null, errorMessage: null, status: 'succeeded' },
          ],
          mediaId: 'selected-post-id',
        },
      ],
    });
  });

  it('passes a selected post filter to the account-owned repository query', async () => {
    const fixture = createFixture();
    const response = await fixture.app.request(
      '/api/executions?limit=50&mediaId=selected-post-id',
      {
        headers: fixture.headers,
      },
    );

    expect(response.status).toBe(200);
    expect(fixture.executionRepository.listRecentByAccountId).toHaveBeenCalledWith(
      account.id,
      50,
      'selected-post-id',
    );
  });

  it('rejects an empty post filter', async () => {
    const fixture = createFixture();
    const response = await fixture.app.request('/api/executions?mediaId=%20', {
      headers: fixture.headers,
    });

    expect(response.status).toBe(400);
    expect(fixture.executionRepository.listRecentByAccountId).not.toHaveBeenCalled();
  });
});
