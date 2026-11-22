import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import type { InstagramCommentReplyClient } from '../../src/instagram/comment-reply-client.js';
import { InstagramCommentReplyError } from '../../src/instagram/comment-reply-client.js';
import type { InstagramPrivateReplyClient } from '../../src/instagram/private-reply-client.js';
import { InstagramPrivateReplyError } from '../../src/instagram/private-reply-client.js';
import type { InstagramDirectMessageClient } from '../../src/instagram/direct-message-client.js';
import { InstagramDirectMessageError } from '../../src/instagram/direct-message-client.js';
import type { FacebookCommentReplyClient } from '../../src/facebook/comment-reply-client.js';
import type { FacebookPrivateReplyClient } from '../../src/facebook/private-reply-client.js';
import type { FacebookDirectMessageClient } from '../../src/facebook/direct-message-client.js';
import { FacebookClientError } from '../../src/facebook/http.js';

/** One attempted synthetic dispatch, including failed provider responses. */
export interface FakeDispatch {
  key: string;
  message: string;
}
/** Failure selected solely by synthetic event IDs. */
export const fakeStatus = (id: string): string =>
  id.includes('-rate-limit-')
    ? 'retry_pending'
    : id.includes('-permanent-')
      ? 'failed'
      : id.includes('-timeout-')
        ? 'uncertain'
        : 'succeeded';
/** Exact fake and persistence evidence; an empty run never counts as verification. */
export const verifyExactEvidence = (
  expected: readonly FakeDispatch[],
  actual: readonly FakeDispatch[],
): void => {
  assert(expected.length > 0, 'Zero expected work is invalid');
  assert.equal(
    new Set(expected.map((item) => item.key)).size,
    expected.length,
    'Duplicate expected evidence key',
  );
  assert.equal(actual.length, expected.length, 'Incorrect dispatch or execution count');
  const actualByKey = new Map(actual.map((item) => [item.key, item.message]));
  assert.equal(actualByKey.size, actual.length, 'Duplicate dispatch or execution');
  for (const item of expected)
    assert.equal(
      actualByKey.get(item.key),
      item.message,
      `Wrong rule/provider evidence: ${item.key}`,
    );
};

/** Supplies every Meta send port without constructing any network adapter. */
export const createFakeMeta = (
  credentials: Map<string, { owner: string; provider: string }>,
  slowMs: number,
) => {
  const dispatches: FakeDispatch[] = [];
  const choices = new Map<string, string>();
  const send = async (
    provider: string,
    token: string,
    target: string,
    channel: string,
    message: string,
    quickReplies?: readonly { payload: string }[],
  ) => {
    const credential = credentials.get(token);
    assert(
      credential && credential.provider === provider,
      'Cross-provider or unknown synthetic credential',
    );
    const key = `${credential.owner}|${target}|${channel}`;
    dispatches.push({ key: `${key}|${message}`, message });
    if (target.includes('-slow-')) await delay(slowMs);
    const status = fakeStatus(target);
    if (status !== 'succeeded') {
      const diagnostics =
        status === 'uncertain'
          ? { reason: 'timeout' as const }
          : { reason: 'http_error' as const, httpStatus: status === 'retry_pending' ? 429 : 400 };
      if (provider === 'facebook')
        throw new FacebookClientError(channel, diagnostics.reason, diagnostics);
      if (channel === 'public') throw new InstagramCommentReplyError(diagnostics);
      if (channel === 'private') throw new InstagramPrivateReplyError(diagnostics);
      throw new InstagramDirectMessageError(diagnostics);
    }
    if (quickReplies?.[0]) choices.set(key, quickReplies[0].payload);
    return {
      recipientId: channel === 'private' ? `recipient-${target}` : target,
      replyId: `fake-${key}`,
    };
  };
  const assertOwner = (token: string, owner: string) =>
    assert.equal(credentials.get(token)?.owner, owner, 'Wrong provider account path');
  const instagramCommentReplyClient: InstagramCommentReplyClient = {
    replyToComment: async (input) => ({
      replyId: (
        await send('instagram', input.accessToken, input.commentId, 'public', input.message)
      ).replyId,
    }),
  };
  const instagramPrivateReplyClient: InstagramPrivateReplyClient = {
    sendPrivateReply: (input) => {
      assertOwner(input.accessToken, input.instagramUserId);
      return send(
        'instagram',
        input.accessToken,
        input.commentId,
        'private',
        input.message,
        input.quickReplies,
      );
    },
  };
  const instagramDirectMessageClient: InstagramDirectMessageClient = {
    sendDirectMessage: (input) => {
      assertOwner(input.accessToken, input.instagramUserId);
      return send(
        'instagram',
        input.accessToken,
        input.recipientId,
        'direct',
        input.message,
        input.quickReplies,
      );
    },
  };
  const facebookCommentReplyClient: FacebookCommentReplyClient = {
    replyToComment: async (input) => ({
      replyId: (
        await send('facebook', input.pageAccessToken, input.commentId, 'public', input.message)
      ).replyId,
    }),
  };
  const facebookPrivateReplyClient: FacebookPrivateReplyClient = {
    sendPrivateReply: (input) => {
      assertOwner(input.pageAccessToken, input.pageId);
      return send(
        'facebook',
        input.pageAccessToken,
        input.commentId,
        'private',
        input.message,
        input.quickReplies,
      );
    },
  };
  const facebookDirectMessageClient: FacebookDirectMessageClient = {
    sendDirectMessage: (input) => {
      assertOwner(input.pageAccessToken, input.pageId);
      return send('facebook', input.pageAccessToken, input.recipientId, 'direct', input.message);
    },
  };
  return {
    dispatches,
    choices,
    instagramCommentReplyClient,
    instagramPrivateReplyClient,
    instagramDirectMessageClient,
    facebookCommentReplyClient,
    facebookPrivateReplyClient,
    facebookDirectMessageClient,
  };
};
