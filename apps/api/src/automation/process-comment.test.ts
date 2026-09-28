import { describe, expect, it, vi } from 'vitest';

import type { DeliveryChannel, Execution, InstagramAccount } from '../database/repositories.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { processComment } from './process-comment.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 6).toString('base64'));
const account: InstagramAccount = {
  accessTokenCiphertext: tokenProtector.encrypt('private-access-token'),
  connectionStatus: 'active',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  id: 'account-id',
  instagramUserId: '17841400000000001',
  tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  tokenRefreshFailureCode: null,
  tokenRefreshLastSucceededAt: null,
  tokenRefreshNextAttemptAt: null,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  username: 'owner',
};
const event = {
  commentId: '17841400000000002',
  commenterId: '17841400000000004',
  instagramAccountId: account.instagramUserId,
  mediaId: '17841400000000003',
  parentCommentId: null,
  receivedAt: new Date('2026-09-23T12:00:00.000Z'),
  text: '#Hello',
  username: 'commenter',
};

const execution = (deliveryChannel: DeliveryChannel, messageText: string): Execution => ({
  attemptCount: 1,
  automationId: 'automation-id',
  commenterInstagramId: event.commenterId,
  commenterUsername: event.username,
  commentText: event.text,
  createdAt: event.receivedAt,
  deliveryChannel,
  dispatchStartedAt: null,
  errorCode: null,
  errorMessage: null,
  failureKind: null,
  id: `${deliveryChannel}-execution-id`,
  instagramCommentId: event.commentId,
  leaseExpiresAt: new Date('2026-09-23T12:02:00.000Z'),
  leaseId: `${deliveryChannel}-lease-id`,
  messageText,
  nextAttemptAt: null,
  providerReplyId: null,
  status: 'processing',
  updatedAt: event.receivedAt,
});

const createFixture = () => {
  const publicExecution = execution('public', 'Public response');
  const privateExecution = execution('private', 'Private response');
  const dependencies = {
    accountRepository: { findByInstagramUserId: vi.fn().mockResolvedValue(account) },
    automationRepository: {
      findEnabledByAccountAndMedia: vi.fn().mockResolvedValue({
        accountId: account.id,
        deliveryMode: 'public' as const,
        enabled: true,
        id: 'automation-id',
        mediaId: event.mediaId,
        privateReplyText: null,
        replyText: publicExecution.messageText,
        triggerText: '#Hello',
      }),
    },
    executionRepository: {
      claimExecutions: vi.fn().mockResolvedValue([publicExecution]),
      markDispatchStarted: vi.fn().mockResolvedValue(true),
      markFailed: vi.fn().mockResolvedValue({ ...publicExecution, status: 'failed' }),
      markRetryPending: vi.fn().mockResolvedValue({ ...publicExecution, status: 'retry_pending' }),
      markSucceeded: vi.fn().mockResolvedValue({ ...publicExecution, status: 'succeeded' }),
      markUncertain: vi.fn().mockResolvedValue({ ...publicExecution, status: 'uncertain' }),
    },
    instagramCommentReplyClient: {
      replyToComment: vi.fn().mockResolvedValue({ replyId: 'public-reply-id' }),
    },
    instagramPrivateReplyClient: {
      sendPrivateReply: vi.fn().mockResolvedValue({ replyId: 'private-reply-id' }),
    },
    logger: { error: vi.fn(), info: vi.fn() },
    tokenProtector,
    tokenRefreshRepository: { markAccountReconnectRequired: vi.fn().mockResolvedValue(true) },
  };
  return { dependencies, privateExecution, publicExecution };
};

describe('processComment', () => {
  it('matches trimmed trigger text case-insensitively and sends a public reply', async () => {
    const f = createFixture();

    await expect(processComment({ ...event, text: ' #hELLo ' }, f.dependencies)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(f.dependencies.executionRepository.claimExecutions).toHaveBeenCalledWith([
      expect.objectContaining({
        commenterInstagramId: event.commenterId,
        deliveryChannel: 'public',
        messageText: 'Public response',
      }),
    ]);
    expect(f.dependencies.instagramCommentReplyClient.replyToComment).toHaveBeenCalledWith({
      accessToken: 'private-access-token',
      commentId: event.commentId,
      message: 'Public response',
    });
  });

  it('claims and sends public and private deliveries independently in both mode', async () => {
    const f = createFixture();
    f.dependencies.automationRepository.findEnabledByAccountAndMedia.mockResolvedValue({
      accountId: account.id,
      deliveryMode: 'both',
      enabled: true,
      id: 'automation-id',
      mediaId: event.mediaId,
      privateReplyText: 'Private response',
      replyText: 'Public response',
      triggerText: '#Hello',
    });
    f.dependencies.executionRepository.claimExecutions.mockResolvedValue([
      f.publicExecution,
      f.privateExecution,
    ]);

    await expect(processComment(event, f.dependencies)).resolves.toEqual({ outcome: 'succeeded' });
    expect(f.dependencies.executionRepository.claimExecutions).toHaveBeenCalledWith([
      expect.objectContaining({ deliveryChannel: 'public', messageText: 'Public response' }),
      expect.objectContaining({ deliveryChannel: 'private', messageText: 'Private response' }),
    ]);
    expect(f.dependencies.instagramPrivateReplyClient.sendPrivateReply).toHaveBeenCalledWith({
      accessToken: 'private-access-token',
      commentId: event.commentId,
      instagramUserId: account.instagramUserId,
      message: 'Private response',
    });
  });

  it('ignores nested, owner, and unmatched comments', async () => {
    for (const [changedEvent, reason] of [
      [{ ...event, parentCommentId: 'parent-id' }, 'nested_comment'],
      [{ ...event, commenterId: account.instagramUserId }, 'own_comment'],
      [{ ...event, commenterId: null, username: 'OWNER' }, 'own_comment'],
      [{ ...event, text: '#Hello!' }, 'trigger_not_matched'],
    ] as const) {
      const f = createFixture();
      await expect(processComment(changedEvent, f.dependencies)).resolves.toEqual({
        outcome: 'ignored',
        reason,
      });
      expect(f.dependencies.executionRepository.claimExecutions).not.toHaveBeenCalled();
    }
  });

  it('stops a duplicate before calling Meta', async () => {
    const f = createFixture();
    f.dependencies.executionRepository.claimExecutions.mockResolvedValue([]);

    await expect(processComment(event, f.dependencies)).resolves.toEqual({ outcome: 'duplicate' });
    expect(f.dependencies.instagramCommentReplyClient.replyToComment).not.toHaveBeenCalled();
    expect(f.dependencies.instagramPrivateReplyClient.sendPrivateReply).not.toHaveBeenCalled();
  });

  it('records a safe failure without logging comment content or provider details', async () => {
    const f = createFixture();
    f.dependencies.instagramCommentReplyClient.replyToComment.mockRejectedValue(
      new Error('private provider detail'),
    );

    await expect(processComment(event, f.dependencies)).resolves.toEqual({ outcome: 'failed' });
    expect(JSON.stringify(f.dependencies.logger.error.mock.calls)).not.toContain(event.text);
    expect(JSON.stringify(f.dependencies.logger.error.mock.calls)).not.toContain(
      'private provider detail',
    );
  });
});
