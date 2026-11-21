import { describe, expect, it, vi } from 'vitest';

import type { Automation, Execution } from '../database/repositories.js';
import type { FacebookPageConnection } from '../database/identity-repositories.js';
import type { FacebookCommentEvent } from '../facebook/webhook-events.js';
import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { processFacebookComment } from './process-facebook-comment.js';

const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 9).toString('base64'));
const now = new Date('2026-11-21T12:00:00.000Z');
const page: FacebookPageConnection = {
  id: 'connection-1',
  userId: 'user-1',
  provider: 'facebook',
  externalAccountId: 'page-1',
  displayName: 'Owner Page',
  connectionStatus: 'active',
  accessTokenCiphertext: tokenProtector.encrypt('private-page-token'),
};
const event: FacebookCommentEvent = {
  pageId: 'page-1',
  postId: 'post-1',
  commentId: 'comment-1',
  parentCommentId: null,
  commenterId: 'buyer-1',
  commenterName: 'Buyer',
  text: '#price',
  receivedAt: now,
};
const automation: Automation = {
  id: 'automation-1',
  accountId: page.id,
  mediaId: event.postId,
  deliveryMode: 'public',
  enabled: true,
  replyText: 'Public response',
  privateReplyText: 'Private response',
  quickReplyOptions: [],
  triggerMode: 'exact',
  triggerText: '#price',
  createdAt: now,
  updatedAt: now,
};
const execution = (
  channel: 'public' | 'private',
  options: Execution['quickReplyOptions'] = [],
): Execution => ({
  id: `${channel}-execution`,
  automationId: automation.id,
  mediaId: event.postId,
  commenterInstagramId: event.commenterId,
  commenterUsername: event.commenterName,
  commentText: event.text,
  createdAt: now,
  deliveryChannel: channel,
  dispatchStartedAt: null,
  errorCode: null,
  errorMessage: null,
  failureKind: null,
  instagramCommentId: event.commentId,
  attemptCount: 1,
  leaseExpiresAt: new Date(now.getTime() + 120_000),
  leaseId: `${channel}-lease`,
  messageText: channel === 'public' ? 'Public response' : 'Private response',
  quickReplyOptions: options,
  nextAttemptAt: null,
  providerReplyId: null,
  status: 'processing',
  updatedAt: now,
});

const fixture = () => {
  const publicExecution = execution('public');
  const privateExecution = execution('private');
  const dependencies = {
    socialConnectionRepository: {
      findFacebookPageByPageId: vi.fn().mockResolvedValue(page),
      markReconnectRequired: vi.fn().mockResolvedValue(true),
    },
    automationRepository: { findEnabledByAccountAndMedia: vi.fn().mockResolvedValue(automation) },
    executionRepository: {
      claimExecutions: vi.fn().mockResolvedValue([publicExecution]),
      markDispatchStarted: vi.fn().mockResolvedValue(true),
      markFailed: vi.fn().mockResolvedValue({ ...publicExecution, status: 'failed' }),
      markRetryPending: vi.fn().mockResolvedValue({ ...publicExecution, status: 'retry_pending' }),
      markSucceeded: vi.fn().mockResolvedValue({ ...publicExecution, status: 'succeeded' }),
      markUncertain: vi.fn().mockResolvedValue({ ...publicExecution, status: 'uncertain' }),
    },
    facebookCommentReplyClient: {
      replyToComment: vi.fn().mockResolvedValue({ replyId: 'public-reply' }),
    },
    facebookPrivateReplyClient: {
      sendPrivateReply: vi
        .fn()
        .mockResolvedValue({ replyId: 'private-reply', recipientId: 'psid-1' }),
    },
    instagramCommentReplyClient: { replyToComment: vi.fn() },
    instagramPrivateReplyClient: { sendPrivateReply: vi.fn() },
    tokenRefreshRepository: { markAccountReconnectRequired: vi.fn() },
    tokenProtector,
    logger: { info: vi.fn(), error: vi.fn() },
  };
  return { dependencies, publicExecution, privateExecution };
};

describe('processFacebookComment', () => {
  it('claims and sends a Page public reply for the exact Page and post', async () => {
    const f = fixture();
    await expect(processFacebookComment(event, f.dependencies)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(f.dependencies.automationRepository.findEnabledByAccountAndMedia).toHaveBeenCalledWith(
      page.id,
      event.postId,
    );
    expect(f.dependencies.executionRepository.claimExecutions).toHaveBeenCalledWith([
      expect.objectContaining({
        automationId: automation.id,
        mediaId: event.postId,
        instagramCommentId: event.commentId,
        deliveryChannel: 'public',
        messageText: 'Public response',
      }),
    ]);
    expect(f.dependencies.facebookCommentReplyClient.replyToComment).toHaveBeenCalledWith({
      pageAccessToken: 'private-page-token',
      commentId: event.commentId,
      message: 'Public response',
    });
    expect(f.dependencies.instagramCommentReplyClient.replyToComment).not.toHaveBeenCalled();
  });

  it('sends private only with stored quick-reply choices', async () => {
    const f = fixture();
    const choices = [{ id: 'yes', title: 'Yes', followUpText: 'More details' }];
    f.dependencies.automationRepository.findEnabledByAccountAndMedia.mockResolvedValue({
      ...automation,
      deliveryMode: 'private',
      quickReplyOptions: choices,
    });
    f.dependencies.executionRepository.claimExecutions.mockResolvedValue([
      execution('private', choices),
    ]);
    await expect(processFacebookComment(event, f.dependencies)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(f.dependencies.executionRepository.claimExecutions).toHaveBeenCalledWith([
      expect.objectContaining({ deliveryChannel: 'private', quickReplyOptions: choices }),
    ]);
    expect(f.dependencies.facebookPrivateReplyClient.sendPrivateReply).toHaveBeenCalledWith({
      pageId: page.externalAccountId,
      pageAccessToken: 'private-page-token',
      commentId: event.commentId,
      message: 'Private response',
      quickReplies: [{ title: 'Yes', payload: 'qr:private-execution:yes' }],
    });
    expect(f.dependencies.facebookCommentReplyClient.replyToComment).not.toHaveBeenCalled();
  });

  it('claims public and private independently in both mode', async () => {
    const f = fixture();
    f.dependencies.automationRepository.findEnabledByAccountAndMedia.mockResolvedValue({
      ...automation,
      deliveryMode: 'both',
    });
    f.dependencies.executionRepository.claimExecutions.mockResolvedValue([
      f.publicExecution,
      f.privateExecution,
    ]);
    await expect(processFacebookComment(event, f.dependencies)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(f.dependencies.executionRepository.claimExecutions).toHaveBeenCalledWith([
      expect.objectContaining({ deliveryChannel: 'public', quickReplyOptions: [] }),
      expect.objectContaining({ deliveryChannel: 'private', quickReplyOptions: [] }),
    ]);
    expect(f.dependencies.facebookCommentReplyClient.replyToComment).toHaveBeenCalledOnce();
    expect(f.dependencies.facebookPrivateReplyClient.sendPrivateReply).toHaveBeenCalledOnce();
  });

  it('never claims nested, owner, disconnected, or unmatched comments', async () => {
    for (const [changed, reason] of [
      [{ ...event, parentCommentId: 'parent-1' }, 'nested_comment'],
      [{ ...event, commenterId: page.externalAccountId }, 'own_comment'],
      [{ ...event, commenterId: null, commenterName: 'OWNER PAGE' }, 'own_comment'],
      [{ ...event, text: '#other' }, 'trigger_not_matched'],
    ] as const) {
      const f = fixture();
      await expect(processFacebookComment(changed, f.dependencies)).resolves.toEqual({
        outcome: 'ignored',
        reason,
      });
      expect(f.dependencies.executionRepository.claimExecutions).not.toHaveBeenCalled();
    }
    const f = fixture();
    f.dependencies.socialConnectionRepository.findFacebookPageByPageId.mockResolvedValue({
      ...page,
      connectionStatus: 'reconnect_required',
    });
    await expect(processFacebookComment(event, f.dependencies)).resolves.toEqual({
      outcome: 'ignored',
      reason: 'connection_inactive',
    });
  });

  it('stops a duplicate claim before any provider call', async () => {
    const f = fixture();
    f.dependencies.executionRepository.claimExecutions.mockResolvedValue([]);
    await expect(processFacebookComment(event, f.dependencies)).resolves.toEqual({
      outcome: 'duplicate',
    });
    expect(f.dependencies.facebookCommentReplyClient.replyToComment).not.toHaveBeenCalled();
    expect(f.dependencies.facebookPrivateReplyClient.sendPrivateReply).not.toHaveBeenCalled();
  });
});
