import { describe, expect, it, vi } from 'vitest';

import type { Execution } from '../database/repositories.js';
import { InstagramCommentReplyError } from '../instagram/comment-reply-client.js';
import type { Logger } from '../logging/logger.js';
import type { ProtectedToken } from '../security/token-protector.js';
import { deliverReply } from './deliver-reply.js';

const now = new Date('2026-09-28T12:00:00.000Z');
const execution = (attemptCount = 1): Execution => ({
  attemptCount,
  automationId: 'automation-id',
  commenterUsername: 'commenter',
  commentText: '#Hello',
  createdAt: now,
  dispatchStartedAt: null,
  errorCode: null,
  errorMessage: null,
  failureKind: null,
  id: 'execution-id',
  instagramCommentId: 'comment-id',
  leaseExpiresAt: new Date(now.getTime() + 120_000),
  leaseId: 'lease-id',
  nextAttemptAt: null,
  providerReplyId: null,
  status: 'processing',
  updatedAt: now,
});

const fixture = () => {
  const logger: Logger = { error: vi.fn(), info: vi.fn() };
  const executionRepository = {
    markDispatchStarted: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue({ ...execution(), status: 'failed' }),
    markRetryPending: vi.fn().mockResolvedValue({ ...execution(), status: 'retry_pending' }),
    markSucceeded: vi.fn().mockResolvedValue({ ...execution(), status: 'succeeded' }),
    markUncertain: vi.fn().mockResolvedValue({ ...execution(), status: 'uncertain' }),
  };
  const instagramCommentReplyClient = {
    replyToComment: vi.fn().mockResolvedValue({ replyId: 'reply-id' }),
  };
  const tokenRefreshRepository = { markAccountReconnectRequired: vi.fn() };
  return {
    dependencies: {
      executionRepository,
      instagramCommentReplyClient,
      logger,
      tokenProtector: {
        decrypt: vi.fn().mockReturnValue('plaintext-token'),
        encrypt: vi.fn(),
      },
      tokenRefreshRepository,
    },
    executionRepository,
    instagramCommentReplyClient,
    tokenRefreshRepository,
  };
};

const input = (value: Execution) => ({
  accountId: 'account-id',
  accessTokenCiphertext: 'encrypted-token' as ProtectedToken,
  commentId: 'comment-id',
  execution: value,
  message: 'Thanks!',
});

describe('reply delivery recovery policy', () => {
  it('records dispatch before sending and persists the provider reply ID', async () => {
    const f = fixture();

    await expect(deliverReply(input(execution()), f.dependencies, now)).resolves.toBe('succeeded');

    expect(f.executionRepository.markDispatchStarted).toHaveBeenCalledWith(
      'execution-id',
      'lease-id',
      now,
    );
    expect(f.executionRepository.markDispatchStarted.mock.invocationCallOrder[0]).toBeLessThan(
      f.instagramCommentReplyClient.replyToComment.mock.invocationCallOrder[0]!,
    );
    expect(f.executionRepository.markSucceeded).toHaveBeenCalledWith(
      'execution-id',
      'lease-id',
      'reply-id',
    );
  });

  it('schedules only explicit rate-limit failures and stops after three attempts', async () => {
    const f = fixture();
    f.instagramCommentReplyClient.replyToComment.mockRejectedValue(
      new InstagramCommentReplyError({ reason: 'http_error', httpStatus: 429 }),
    );

    await expect(deliverReply(input(execution(1)), f.dependencies, now)).resolves.toBe(
      'retry_pending',
    );
    expect(f.executionRepository.markRetryPending).toHaveBeenCalledWith(
      'execution-id',
      'lease-id',
      expect.objectContaining({ failureKind: 'retryable' }),
      new Date('2026-09-28T12:15:00.000Z'),
    );

    f.executionRepository.markFailed.mockResolvedValue({ ...execution(3), status: 'failed' });
    await expect(deliverReply(input(execution(3)), f.dependencies, now)).resolves.toBe('failed');
    expect(f.executionRepository.markFailed).toHaveBeenCalledWith(
      'execution-id',
      'lease-id',
      expect.objectContaining({
        errorCode: 'RETRY_ATTEMPTS_EXHAUSTED',
        failureKind: 'permanent',
      }),
    );
  });

  it('marks ambiguous delivery uncertain and never schedules a retry', async () => {
    const f = fixture();
    f.instagramCommentReplyClient.replyToComment.mockRejectedValue(
      new InstagramCommentReplyError({ reason: 'timeout' }),
    );

    await expect(deliverReply(input(execution()), f.dependencies, now)).resolves.toBe('uncertain');

    expect(f.executionRepository.markUncertain).toHaveBeenCalledWith(
      'execution-id',
      'lease-id',
      expect.objectContaining({ failureKind: 'uncertain' }),
    );
    expect(f.executionRepository.markRetryPending).not.toHaveBeenCalled();
  });

  it('pauses the account after an authentication rejection', async () => {
    const f = fixture();
    f.instagramCommentReplyClient.replyToComment.mockRejectedValue(
      new InstagramCommentReplyError({
        reason: 'http_error',
        httpStatus: 400,
        metaErrorCode: 190,
      }),
    );

    await expect(deliverReply(input(execution()), f.dependencies, now)).resolves.toBe(
      'retry_pending',
    );

    expect(f.tokenRefreshRepository.markAccountReconnectRequired).toHaveBeenCalledWith(
      'account-id',
      'TOKEN_REJECTED',
    );
  });
});
