import { describe, expect, it, vi } from 'vitest';

import type { Execution, InstagramAccount } from '../database/repositories.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { processComment } from './process-comment.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 6).toString('base64'));
const account: InstagramAccount = {
  id: 'account-id',
  instagramUserId: '17841400000000001',
  username: 'owner',
  accessTokenCiphertext: tokenProtector.encrypt('private-access-token'),
  tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};
const event = {
  instagramAccountId: account.instagramUserId,
  commentId: '17841400000000002',
  mediaId: '17841400000000003',
  username: 'commenter',
  text: '#Hello',
  receivedAt: new Date('2026-09-23T12:00:00.000Z'),
};
const execution: Execution = {
  id: 'execution-id',
  automationId: 'automation-id',
  instagramCommentId: event.commentId,
  commenterUsername: event.username,
  commentText: event.text,
  status: 'processing',
  errorCode: null,
  errorMessage: null,
  createdAt: event.receivedAt,
  updatedAt: event.receivedAt,
};

const createFixture = () => {
  const dependencies = {
    accountRepository: { findByInstagramUserId: vi.fn().mockResolvedValue(account) },
    automationRepository: {
      findEnabledByAccountAndMedia: vi.fn().mockResolvedValue({
        id: 'automation-id',
        accountId: account.id,
        mediaId: event.mediaId,
        triggerText: '#Hello',
        replyText: 'Thanks for commenting!',
        enabled: true,
      }),
    },
    executionRepository: {
      claimExecution: vi.fn().mockResolvedValue(execution),
      markFailed: vi.fn().mockResolvedValue({ ...execution, status: 'failed' }),
      markSucceeded: vi.fn().mockResolvedValue({ ...execution, status: 'succeeded' }),
    },
    instagramCommentReplyClient: { replyToComment: vi.fn().mockResolvedValue(undefined) },
    logger: { error: vi.fn(), info: vi.fn() },
    tokenProtector,
  };
  return dependencies;
};

describe('processComment', () => {
  it('ignores unknown accounts, unmatched media, and non-exact trigger text', async () => {
    const unknown = createFixture();
    unknown.accountRepository.findByInstagramUserId.mockResolvedValue(null);
    await expect(processComment(event, unknown)).resolves.toEqual({
      outcome: 'ignored',
      reason: 'account_not_connected',
    });

    const missingAutomation = createFixture();
    missingAutomation.automationRepository.findEnabledByAccountAndMedia.mockResolvedValue(null);
    await expect(processComment(event, missingAutomation)).resolves.toEqual({
      outcome: 'ignored',
      reason: 'no_enabled_automation',
    });

    for (const text of ['#hello', 'Hello', '#Hello!', '#Hello please']) {
      const nonMatch = createFixture();
      await expect(processComment({ ...event, text }, nonMatch)).resolves.toEqual({
        outcome: 'ignored',
        reason: 'trigger_not_matched',
      });
      expect(nonMatch.executionRepository.claimExecution).not.toHaveBeenCalled();
      expect(nonMatch.instagramCommentReplyClient.replyToComment).not.toHaveBeenCalled();
    }
  });

  it('claims, replies to, and completes one exact trigger match', async () => {
    const f = createFixture();

    await expect(processComment({ ...event, text: ' #Hello ' }, f)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(f.executionRepository.claimExecution).toHaveBeenCalledWith({
      automationId: 'automation-id',
      commenterUsername: event.username,
      commentText: ' #Hello ',
      instagramCommentId: event.commentId,
    });
    expect(f.instagramCommentReplyClient.replyToComment).toHaveBeenCalledWith({
      accessToken: 'private-access-token',
      commentId: event.commentId,
      message: 'Thanks for commenting!',
    });
    expect(f.executionRepository.markSucceeded).toHaveBeenCalledWith(execution.id);
  });

  it('stops a duplicate before calling Meta', async () => {
    const f = createFixture();
    f.executionRepository.claimExecution.mockResolvedValue(null);

    await expect(processComment(event, f)).resolves.toEqual({ outcome: 'duplicate' });
    expect(f.instagramCommentReplyClient.replyToComment).not.toHaveBeenCalled();
  });

  it('records a safe failure without logging comment content or provider details', async () => {
    const f = createFixture();
    f.instagramCommentReplyClient.replyToComment.mockRejectedValue(
      new Error('private provider detail'),
    );

    await expect(processComment(event, f)).resolves.toEqual({ outcome: 'failed' });
    expect(f.executionRepository.markFailed).toHaveBeenCalledWith(execution.id, {
      errorCode: 'INSTAGRAM_REPLY_UNAVAILABLE',
      errorMessage: 'The public reply could not be sent.',
    });
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain(event.text);
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain('private provider detail');
  });
});
