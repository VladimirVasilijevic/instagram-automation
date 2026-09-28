import type { TokenRefreshRepository } from '../database/repositories.js';
import {
  InstagramTokenRefreshError,
  type InstagramTokenRefreshClient,
} from '../instagram/token-refresh-client.js';
import type { Logger } from '../logging/logger.js';
import { toSafeErrorContext } from '../logging/logger.js';
import type { TokenProtector } from '../security/token-protector.js';

const dayMilliseconds = 24 * 60 * 60 * 1000;

/** Safe aggregate result from one bounded token-maintenance pass. */
export interface TokenRefreshSummary {
  /** Active accounts found after their credential expiry. */
  expiredCount: number;
  /** Temporary refresh failures eligible for a later attempt. */
  failedCount: number;
  /** Connections that require the owner to sign in again. */
  reconnectRequiredCount: number;
  /** Credentials successfully refreshed and persisted. */
  refreshedCount: number;
}

/** Refreshes tokens due within seven days while preserving encrypted storage and lease ownership. */
export const refreshInstagramTokens = async (
  dependencies: {
    logger: Logger;
    repository: TokenRefreshRepository;
    tokenProtector: TokenProtector;
    tokenRefreshClient: InstagramTokenRefreshClient;
  },
  now: Date = new Date(),
): Promise<TokenRefreshSummary> => {
  const summary: TokenRefreshSummary = {
    expiredCount: await dependencies.repository.markExpiredAccountsReconnectRequired(now),
    failedCount: 0,
    reconnectRequiredCount: 0,
    refreshedCount: 0,
  };
  const claims = await dependencies.repository.claimExpiringAccounts(
    now,
    new Date(now.getTime() + 7 * dayMilliseconds),
    new Date(now.getTime() + 2 * 60 * 1000),
    25,
  );
  for (const claim of claims) {
    let accessToken: string;
    try {
      accessToken = dependencies.tokenProtector.decrypt(claim.account.accessTokenCiphertext);
    } catch (error) {
      const recorded = await dependencies.repository.failTokenRefresh(
        claim.account.id,
        claim.leaseId,
        {
          errorCode: 'TOKEN_DECRYPTION_FAILED',
          reconnectRequired: true,
          retryAt: null,
        },
      );
      if (!recorded)
        throw new Error('Token refresh failure lease ownership was lost', { cause: error });
      summary.reconnectRequiredCount += 1;
      dependencies.logger.error('Instagram token decryption failed', toSafeErrorContext(error));
      continue;
    }
    try {
      const refreshed = await dependencies.tokenRefreshClient.refresh(accessToken);
      const completed = await dependencies.repository.completeTokenRefresh(
        claim.account.id,
        claim.leaseId,
        dependencies.tokenProtector.encrypt(refreshed.accessToken),
        refreshed.tokenExpiresAt,
        now,
      );
      if (!completed) throw new Error('Token refresh lease ownership was lost');
      summary.refreshedCount += 1;
    } catch (error) {
      const reconnectRequired =
        error instanceof InstagramTokenRefreshError && error.reconnectRequired;
      const recorded = await dependencies.repository.failTokenRefresh(
        claim.account.id,
        claim.leaseId,
        {
          errorCode: reconnectRequired ? 'TOKEN_RECONNECT_REQUIRED' : 'TOKEN_REFRESH_TEMPORARY',
          reconnectRequired,
          retryAt: reconnectRequired ? null : new Date(now.getTime() + 60 * 60 * 1000),
        },
      );
      if (!recorded)
        throw new Error('Token refresh failure lease ownership was lost', { cause: error });
      if (reconnectRequired) summary.reconnectRequiredCount += 1;
      else summary.failedCount += 1;
      dependencies.logger.error(
        'Instagram token refresh failed',
        error instanceof InstagramTokenRefreshError
          ? error.toLogContext()
          : toSafeErrorContext(error),
      );
    }
  }
  return summary;
};
