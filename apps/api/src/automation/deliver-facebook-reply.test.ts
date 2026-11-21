import { describe, expect, it, vi } from 'vitest';

import type { Execution } from '../database/repositories.js';
import { FacebookClientError } from '../facebook/http.js';
import type { ProtectedToken } from '../security/token-protector.js';
import { deliverReply } from './deliver-reply.js';

const now = new Date('2026-11-21T12:00:00.000Z');
const execution = (deliveryChannel: 'public' | 'private' = 'public'): Execution => ({
  id: 'execution-1',
  automationId: 'automation-1',
  mediaId: 'post-1',
  commenterInstagramId: 'buyer-1',
  commenterUsername: 'Buyer',
  commentText: '#price',
  createdAt: now,
  deliveryChannel,
  dispatchStartedAt: null,
  errorCode: null,
  errorMessage: null,
  failureKind: null,
  instagramCommentId: 'comment-1',
  attemptCount: 1,
  leaseExpiresAt: new Date(now.getTime() + 120_000),
  leaseId: 'lease-1',
  messageText: 'Thanks',
  nextAttemptAt: null,
  providerReplyId: null,
  status: 'processing',
  updatedAt: now,
});
const input = (value: Execution) => ({
  provider: 'facebook' as const,
  accountId: 'connection-1',
  accessTokenCiphertext: 'ciphertext' as ProtectedToken,
  commentId: 'comment-1',
  execution: value,
  instagramUserId: 'page-1',
  message: value.messageText,
});
const fixture = () => {
  const executionRepository = {
    markDispatchStarted: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue({ ...execution(), status: 'failed' }),
    markRetryPending: vi.fn().mockResolvedValue({ ...execution(), status: 'retry_pending' }),
    markSucceeded: vi.fn().mockResolvedValue({ ...execution(), status: 'succeeded' }),
    markUncertain: vi.fn().mockResolvedValue({ ...execution(), status: 'uncertain' }),
  };
  const facebookCommentReplyClient = {
    replyToComment: vi.fn().mockResolvedValue({ replyId: 'comment-reply-1' }),
  };
  const facebookPrivateReplyClient = {
    sendPrivateReply: vi.fn().mockResolvedValue({ replyId: 'message-1', recipientId: 'psid-1' }),
  };
  const socialConnectionRepository = { markReconnectRequired: vi.fn().mockResolvedValue(true) };
  const dependencies = {
    executionRepository,
    facebookCommentReplyClient,
    facebookPrivateReplyClient,
    socialConnectionRepository,
    instagramCommentReplyClient: { replyToComment: vi.fn() },
    instagramPrivateReplyClient: { sendPrivateReply: vi.fn() },
    tokenRefreshRepository: { markAccountReconnectRequired: vi.fn() },
    tokenProtector: { encrypt: vi.fn(), decrypt: vi.fn().mockReturnValue('private-page-token') },
    logger: { error: vi.fn(), info: vi.fn() },
  };
  return {
    dependencies,
    executionRepository,
    facebookCommentReplyClient,
    facebookPrivateReplyClient,
    socialConnectionRepository,
  };
};

describe('Facebook reply delivery', () => {
  it('marks dispatch before public Page comment send and stores the reply ID', async () => {
    const f = fixture();
    await expect(deliverReply(input(execution()), f.dependencies, now)).resolves.toBe('succeeded');
    expect(f.facebookCommentReplyClient.replyToComment).toHaveBeenCalledWith({
      pageAccessToken: 'private-page-token',
      commentId: 'comment-1',
      message: 'Thanks',
    });
    expect(f.executionRepository.markDispatchStarted.mock.invocationCallOrder[0]).toBeLessThan(
      f.facebookCommentReplyClient.replyToComment.mock.invocationCallOrder[0]!,
    );
    expect(f.executionRepository.markSucceeded).toHaveBeenCalledWith(
      'execution-1',
      'lease-1',
      'comment-reply-1',
    );
  });

  it('uses Page comment recipient and preserves quick-reply snapshot for private delivery', async () => {
    const f = fixture();
    const value = {
      ...execution('private'),
      quickReplyOptions: [{ id: 'yes', title: 'Yes', followUpText: 'More details' }],
    };
    await expect(deliverReply(input(value), f.dependencies, now)).resolves.toBe('succeeded');
    expect(f.facebookPrivateReplyClient.sendPrivateReply).toHaveBeenCalledWith({
      pageId: 'page-1',
      pageAccessToken: 'private-page-token',
      commentId: 'comment-1',
      message: 'Thanks',
      quickReplies: [{ title: 'Yes', payload: 'qr:execution-1:yes' }],
    });
    expect(f.executionRepository.markSucceeded).toHaveBeenCalledWith(
      'execution-1',
      'lease-1',
      'message-1',
      'psid-1',
    );
  });

  it('marks Page reconnect required after token rejection without touching Instagram', async () => {
    const f = fixture();
    f.facebookCommentReplyClient.replyToComment.mockRejectedValue(
      new FacebookClientError('public_reply', 'http_error', {
        httpStatus: 401,
        metaErrorCode: 190,
      }),
    );
    await expect(deliverReply(input(execution()), f.dependencies, now)).resolves.toBe(
      'retry_pending',
    );
    expect(f.socialConnectionRepository.markReconnectRequired).toHaveBeenCalledWith(
      'connection-1',
      'TOKEN_REJECTED',
    );
    expect(
      f.dependencies.tokenRefreshRepository.markAccountReconnectRequired,
    ).not.toHaveBeenCalled();
    expect(f.executionRepository.markRetryPending).toHaveBeenCalledWith(
      'execution-1',
      'lease-1',
      expect.objectContaining({
        errorCode: 'FACEBOOK_RECONNECT_REQUIRED',
        failureKind: 'authentication',
      }),
      new Date('2026-11-21T12:15:00.000Z'),
    );
  });

  it('keeps an ambiguous Page send from retrying automatically', async () => {
    const f = fixture();
    f.facebookCommentReplyClient.replyToComment.mockRejectedValue(
      new FacebookClientError('public_reply', 'network_error'),
    );
    await expect(deliverReply(input(execution()), f.dependencies, now)).resolves.toBe('uncertain');
    expect(f.executionRepository.markUncertain).toHaveBeenCalledWith(
      'execution-1',
      'lease-1',
      expect.objectContaining({ errorCode: 'DELIVERY_OUTCOME_UNKNOWN', failureKind: 'uncertain' }),
    );
    expect(f.executionRepository.markRetryPending).not.toHaveBeenCalled();
  });

  it('treats Facebook permission rejection as permanent without disconnecting the Page', async () => {
    const f = fixture();
    f.facebookCommentReplyClient.replyToComment.mockRejectedValue(
      new FacebookClientError('public_reply', 'http_error', { httpStatus: 403, metaErrorCode: 10 }),
    );
    await expect(deliverReply(input(execution()), f.dependencies, now)).resolves.toBe('failed');
    expect(f.socialConnectionRepository.markReconnectRequired).not.toHaveBeenCalled();
    expect(f.executionRepository.markFailed).toHaveBeenCalledWith(
      'execution-1',
      'lease-1',
      expect.objectContaining({ errorCode: 'FACEBOOK_REPLY_REJECTED', failureKind: 'permanent' }),
    );
  });
});
