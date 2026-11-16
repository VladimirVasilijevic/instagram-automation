import { describe, expect, it, vi } from 'vitest';

import type {
  DmFollowup,
  DmFollowupClaim,
  TokenRefreshRepository,
} from '../database/repositories.js';
import { InstagramDirectMessageError } from '../instagram/direct-message-client.js';
import type { Logger } from '../logging/logger.js';
import type { ProtectedToken } from '../security/token-protector.js';
import { deliverFollowup } from './deliver-followup.js';

const now = new Date('2026-11-16T10:00:00.000Z');

const createFixture = () => {
  const followup: DmFollowup = {
    id: 'followup-id',
    accountId: 'account-id',
    answerId: 'answer-id',
    recipientIgsid: 'recipient-id',
    messageText: 'Follow-up for this choice',
    expiresAt: new Date('2026-11-17T09:00:00.000Z'),
    status: 'processing',
    attemptCount: 1,
    nextAttemptAt: null,
    leaseId: 'lease-id',
    leaseExpiresAt: new Date('2026-11-16T10:02:00.000Z'),
    dispatchStartedAt: null,
    providerReplyId: null,
    failureKind: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
  const claim: DmFollowupClaim = {
    followup,
    accessTokenCiphertext: 'encrypted-token' as ProtectedToken,
    instagramUserId: 'business-id',
  };
  const dmConversationRepository = {
    markFollowupDispatchStarted: vi.fn().mockResolvedValue(true),
    markFollowupFailed: vi.fn().mockImplementation(async () => ({ ...followup, status: 'failed' })),
    markFollowupRetryPending: vi
      .fn()
      .mockImplementation(async () => ({ ...followup, status: 'retry_pending' })),
    markFollowupSucceeded: vi
      .fn()
      .mockImplementation(async () => ({ ...followup, status: 'succeeded' })),
    markFollowupUncertain: vi
      .fn()
      .mockImplementation(async () => ({ ...followup, status: 'uncertain' })),
  };
  const instagramDirectMessageClient = {
    sendDirectMessage: vi
      .fn()
      .mockResolvedValue({ replyId: 'provider-id', recipientId: 'recipient-id' }),
  };
  const logger: Logger = { error: vi.fn(), info: vi.fn() };
  const tokenProtector = {
    decrypt: vi.fn().mockReturnValue('access-token'),
    encrypt: vi.fn(),
  };
  const tokenRefreshRepository: Pick<TokenRefreshRepository, 'markAccountReconnectRequired'> = {
    markAccountReconnectRequired: vi.fn(),
  };
  return {
    claim,
    dependencies: {
      dmConversationRepository,
      instagramDirectMessageClient,
      logger,
      tokenProtector,
      tokenRefreshRepository,
    },
    followup,
  };
};

describe('deliverFollowup', () => {
  it('sends the saved branch message once after marking the dispatch boundary', async () => {
    const fixture = createFixture();
    const { dependencies, followup } = fixture;

    await expect(deliverFollowup(fixture.claim, dependencies, now)).resolves.toBe('succeeded');
    expect(dependencies.dmConversationRepository.markFollowupDispatchStarted).toHaveBeenCalledWith(
      followup.id,
      'lease-id',
      now,
    );
    expect(dependencies.instagramDirectMessageClient.sendDirectMessage).toHaveBeenCalledWith({
      accessToken: 'access-token',
      instagramUserId: 'business-id',
      recipientId: 'recipient-id',
      message: 'Follow-up for this choice',
    });
    expect(dependencies.dmConversationRepository.markFollowupSucceeded).toHaveBeenCalledWith(
      followup.id,
      'lease-id',
      'provider-id',
    );
  });

  it('fails without a Meta call when the messaging window has closed', async () => {
    const fixture = createFixture();
    fixture.claim.followup.expiresAt = now;

    await expect(deliverFollowup(fixture.claim, fixture.dependencies, now)).resolves.toBe('failed');
    expect(
      fixture.dependencies.instagramDirectMessageClient.sendDirectMessage,
    ).not.toHaveBeenCalled();
    expect(fixture.dependencies.dmConversationRepository.markFollowupFailed).toHaveBeenCalledWith(
      'followup-id',
      'lease-id',
      expect.objectContaining({ errorCode: 'FOLLOWUP_WINDOW_EXPIRED' }),
    );
  });

  it('schedules a controlled retry only while the window stays open', async () => {
    const fixture = createFixture();
    fixture.dependencies.instagramDirectMessageClient.sendDirectMessage.mockRejectedValue(
      new InstagramDirectMessageError({ reason: 'http_error', httpStatus: 429 }),
    );

    await expect(deliverFollowup(fixture.claim, fixture.dependencies, now)).resolves.toBe(
      'retry_pending',
    );
    expect(
      fixture.dependencies.dmConversationRepository.markFollowupRetryPending,
    ).toHaveBeenCalledWith(
      'followup-id',
      'lease-id',
      expect.objectContaining({ failureKind: 'retryable' }),
      new Date('2026-11-16T10:15:00.000Z'),
    );

    fixture.claim.followup.expiresAt = new Date('2026-11-16T10:10:00.000Z');
    await expect(deliverFollowup(fixture.claim, fixture.dependencies, now)).resolves.toBe('failed');
    expect(fixture.dependencies.dmConversationRepository.markFollowupFailed).toHaveBeenCalledWith(
      'followup-id',
      'lease-id',
      expect.objectContaining({ errorCode: 'FOLLOWUP_WINDOW_EXPIRED' }),
    );
  });

  it('stops after an ambiguous provider result and does not schedule a retry', async () => {
    const fixture = createFixture();
    fixture.dependencies.instagramDirectMessageClient.sendDirectMessage.mockRejectedValue(
      new Error('private network detail'),
    );

    await expect(deliverFollowup(fixture.claim, fixture.dependencies, now)).resolves.toBe(
      'uncertain',
    );
    expect(
      fixture.dependencies.dmConversationRepository.markFollowupUncertain,
    ).toHaveBeenCalledWith(
      'followup-id',
      'lease-id',
      expect.objectContaining({ errorCode: 'FOLLOWUP_OUTCOME_UNKNOWN' }),
    );
    expect(
      fixture.dependencies.dmConversationRepository.markFollowupRetryPending,
    ).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(fixture.dependencies.logger.error).mock.calls)).not.toContain(
      'private network detail',
    );
  });

  it('marks an authentication rejection for reconnect', async () => {
    const fixture = createFixture();
    fixture.dependencies.instagramDirectMessageClient.sendDirectMessage.mockRejectedValue(
      new InstagramDirectMessageError({ reason: 'http_error', httpStatus: 401 }),
    );

    await expect(deliverFollowup(fixture.claim, fixture.dependencies, now)).resolves.toBe(
      'retry_pending',
    );
    expect(
      fixture.dependencies.tokenRefreshRepository.markAccountReconnectRequired,
    ).toHaveBeenCalledWith('account-id', 'TOKEN_REJECTED');
  });
});
