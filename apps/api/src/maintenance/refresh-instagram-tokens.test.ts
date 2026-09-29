import { describe, expect, it, vi } from 'vitest';

import type { InstagramAccount, TokenRefreshRepository } from '../database/repositories.js';
import { InstagramTokenRefreshError } from '../instagram/token-refresh-client.js';
import type { Logger } from '../logging/logger.js';
import type { ProtectedToken } from '../security/token-protector.js';
import { refreshInstagramTokens } from './refresh-instagram-tokens.js';

const now = new Date('2026-09-28T12:00:00.000Z');
const account: InstagramAccount = {
  accessTokenCiphertext: 'encrypted-old-token' as ProtectedToken,
  connectionStatus: 'active',
  createdAt: now,
  id: 'account-id',
  instagramUserId: 'instagram-user-id',
  tokenExpiresAt: new Date('2026-10-01T12:00:00.000Z'),
  tokenRefreshFailureCode: null,
  tokenRefreshLastSucceededAt: null,
  tokenRefreshNextAttemptAt: null,
  updatedAt: now,
  username: 'owner',
};

const fixture = () => {
  const repository: TokenRefreshRepository = {
    claimExpiringAccounts: vi.fn().mockResolvedValue([{ account, leaseId: 'lease-id' }]),
    completeTokenRefresh: vi.fn().mockResolvedValue(true),
    failTokenRefresh: vi.fn().mockResolvedValue(true),
    markAccountReconnectRequired: vi.fn(),
    markExpiredAccountsReconnectRequired: vi.fn().mockResolvedValue(0),
  };
  const logger: Logger = { error: vi.fn(), info: vi.fn() };
  const tokenRefreshClient = {
    refresh: vi.fn().mockResolvedValue({
      accessToken: 'new-token',
      tokenExpiresAt: new Date('2026-11-27T12:00:00.000Z'),
    }),
  };
  const tokenProtector = {
    decrypt: vi.fn().mockReturnValue('old-token'),
    encrypt: vi.fn().mockReturnValue('encrypted-new-token' as ProtectedToken),
  };
  return { dependencies: { logger, repository, tokenProtector, tokenRefreshClient }, repository };
};

describe('Instagram token maintenance', () => {
  it('claims only the seven-day window and atomically records refreshed credentials', async () => {
    const f = fixture();

    await expect(refreshInstagramTokens(f.dependencies, now)).resolves.toEqual({
      expiredCount: 0,
      failedCount: 0,
      reconnectRequiredCount: 0,
      refreshedCount: 1,
    });

    expect(f.repository.claimExpiringAccounts).toHaveBeenCalledWith(
      now,
      new Date('2026-10-05T12:00:00.000Z'),
      new Date('2026-09-28T12:02:00.000Z'),
      10,
    );
    expect(f.repository.completeTokenRefresh).toHaveBeenCalledWith(
      'account-id',
      'lease-id',
      'encrypted-new-token',
      new Date('2026-11-27T12:00:00.000Z'),
      now,
    );
  });

  it('backs off temporary provider failures for one hour', async () => {
    const f = fixture();
    f.dependencies.tokenRefreshClient.refresh.mockRejectedValue(
      new InstagramTokenRefreshError(false, 'network_error'),
    );

    await expect(refreshInstagramTokens(f.dependencies, now)).resolves.toEqual({
      expiredCount: 0,
      failedCount: 1,
      reconnectRequiredCount: 0,
      refreshedCount: 0,
    });
    expect(f.repository.failTokenRefresh).toHaveBeenCalledWith('account-id', 'lease-id', {
      errorCode: 'TOKEN_REFRESH_TEMPORARY',
      reconnectRequired: false,
      retryAt: new Date('2026-09-28T13:00:00.000Z'),
    });
  });

  it('requires reconnection when the stored token cannot be decrypted', async () => {
    const f = fixture();
    f.dependencies.tokenProtector.decrypt.mockImplementation(() => {
      throw new Error('private cipher detail');
    });

    await expect(refreshInstagramTokens(f.dependencies, now)).resolves.toEqual({
      expiredCount: 0,
      failedCount: 0,
      reconnectRequiredCount: 1,
      refreshedCount: 0,
    });
    expect(f.repository.failTokenRefresh).toHaveBeenCalledWith('account-id', 'lease-id', {
      errorCode: 'TOKEN_DECRYPTION_FAILED',
      reconnectRequired: true,
      retryAt: null,
    });
    expect(f.dependencies.tokenRefreshClient.refresh).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(f.dependencies.logger.error).mock.calls)).not.toContain(
      'private cipher detail',
    );
  });
});
