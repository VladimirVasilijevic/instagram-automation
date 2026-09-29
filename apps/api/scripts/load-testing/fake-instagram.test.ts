import { describe, expect, it } from 'vitest';

import { createFakeInstagramReplyClients } from './fake-instagram.js';

describe('fake Instagram reply clients', () => {
  it('returns deterministic public and private provider identifiers', async () => {
    const clients = createFakeInstagramReplyClients(0);
    await expect(
      clients.instagramCommentReplyClient.replyToComment({
        accessToken: 'fake',
        commentId: 'run-success-1',
        message: 'message',
      }),
    ).resolves.toEqual({ replyId: 'fake-public-run-success-1' });
    await expect(
      clients.instagramPrivateReplyClient.sendPrivateReply({
        accessToken: 'fake',
        commentId: 'run-success-1',
        instagramUserId: 'load-test-account',
        message: 'message',
      }),
    ).resolves.toEqual({
      recipientId: 'fake-recipient',
      replyId: 'fake-private-run-success-1',
    });
  });

  it.each([
    ['rate-limit', 'retryable'],
    ['permanent', 'permanent'],
    ['timeout', 'uncertain'],
  ] as const)('classifies %s behavior as %s', async (name, expectedKind) => {
    const client = createFakeInstagramReplyClients(0).instagramCommentReplyClient;
    const result = client.replyToComment({
      accessToken: 'fake',
      commentId: `run-${name}-1`,
      message: 'message',
    });
    await expect(result).rejects.toMatchObject({ name: 'InstagramCommentReplyError' });
    await result.catch((error: unknown) => {
      expect(
        error && typeof error === 'object' && 'recoveryKind' in error
          ? (error as { recoveryKind(): string }).recoveryKind()
          : undefined,
      ).toBe(expectedKind);
    });
  });
});
