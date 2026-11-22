import { describe, expect, it } from 'vitest';

import { FacebookClientError } from '../../src/facebook/http.js';
import { InstagramCommentReplyError } from '../../src/instagram/comment-reply-client.js';
import { InstagramDirectMessageError } from '../../src/instagram/direct-message-client.js';
import { InstagramPrivateReplyError } from '../../src/instagram/private-reply-client.js';
import { createFakeMeta, verifyExactEvidence } from './fake-meta.js';

type FakeMeta = ReturnType<typeof createFakeMeta>;
const fixture = () =>
  createFakeMeta(
    new Map([
      ['ig', { owner: 'ig-one', provider: 'instagram' }],
      ['fb', { owner: 'fb-one', provider: 'facebook' }],
    ]),
    0,
  );
const choices = [{ title: 'Details', payload: 'qr:execution:choice' }];
const ports = [
  {
    name: 'Instagram public',
    owner: 'ig-one',
    channel: 'public',
    error: InstagramCommentReplyError,
    send: async (f: FakeMeta, target: string, owner = 'ig-one') =>
      f.instagramCommentReplyClient.replyToComment({
        accessToken: owner === 'ig-one' ? 'ig' : 'fb',
        commentId: target,
        message: 'Reply',
      }),
  },
  {
    name: 'Instagram private',
    owner: 'ig-one',
    channel: 'private',
    error: InstagramPrivateReplyError,
    send: async (f: FakeMeta, target: string, owner = 'ig-one') =>
      f.instagramPrivateReplyClient.sendPrivateReply({
        accessToken: 'ig',
        instagramUserId: owner,
        commentId: target,
        message: 'Reply',
        quickReplies: choices,
      }),
  },
  {
    name: 'Instagram direct',
    owner: 'ig-one',
    channel: 'direct',
    error: InstagramDirectMessageError,
    send: async (f: FakeMeta, target: string, owner = 'ig-one') =>
      f.instagramDirectMessageClient.sendDirectMessage({
        accessToken: 'ig',
        instagramUserId: owner,
        recipientId: target,
        message: 'Reply',
        quickReplies: choices,
      }),
  },
  {
    name: 'Facebook public',
    owner: 'fb-one',
    channel: 'public',
    error: FacebookClientError,
    send: async (f: FakeMeta, target: string, owner = 'fb-one') =>
      f.facebookCommentReplyClient.replyToComment({
        pageAccessToken: owner === 'fb-one' ? 'fb' : 'ig',
        commentId: target,
        message: 'Reply',
      }),
  },
  {
    name: 'Facebook private',
    owner: 'fb-one',
    channel: 'private',
    error: FacebookClientError,
    send: async (f: FakeMeta, target: string, owner = 'fb-one') =>
      f.facebookPrivateReplyClient.sendPrivateReply({
        pageAccessToken: 'fb',
        pageId: owner,
        commentId: target,
        message: 'Reply',
        quickReplies: choices,
      }),
  },
  {
    name: 'Facebook direct',
    owner: 'fb-one',
    channel: 'direct',
    error: FacebookClientError,
    send: async (f: FakeMeta, target: string, owner = 'fb-one') =>
      f.facebookDirectMessageClient.sendDirectMessage({
        pageAccessToken: 'fb',
        pageId: owner,
        recipientId: target,
        message: 'Reply',
      }),
  },
];

describe('HTTP load evidence', () => {
  it.each([
    { name: 'zero work', expected: [], actual: [], reason: /Zero/ },
    { name: 'missing sends', expected: [{ key: 'a', message: 'A' }], actual: [], reason: /count/ },
    {
      name: 'wrong rule text',
      expected: [{ key: 'a', message: 'A' }],
      actual: [{ key: 'a', message: 'B' }],
      reason: /Wrong rule/,
    },
    {
      name: 'duplicate sends',
      expected: [
        { key: 'a', message: 'A' },
        { key: 'b', message: 'B' },
      ],
      actual: [
        { key: 'a', message: 'A' },
        { key: 'a', message: 'A' },
      ],
      reason: /Duplicate/,
    },
    {
      name: 'duplicate expectations masking an unexpected send',
      expected: [
        { key: 'a', message: 'A' },
        { key: 'a', message: 'A' },
      ],
      actual: [
        { key: 'a', message: 'A' },
        { key: 'b', message: 'B' },
      ],
      reason: /Duplicate expected/,
    },
  ])('rejects $name independently of HTTP acknowledgments', ({ expected, actual, reason }) => {
    expect(() => verifyExactEvidence(expected, actual)).toThrow(reason);
  });

  it('accepts exact evidence independently of completion order', () => {
    const evidence = [
      { key: 'a', message: 'A' },
      { key: 'b', message: 'B' },
    ];
    expect(() => verifyExactEvidence(evidence, [...evidence].reverse())).not.toThrow();
  });
});

for (const port of ports)
  describe(port.name, () => {
    it('returns the production port shape and accounts for exactly one attempted dispatch', async () => {
      const fake = fixture();
      const result = await port.send(fake, 'event');
      expect(result).toEqual({
        replyId: `fake-${port.owner}|event|${port.channel}`,
        ...(port.channel === 'public'
          ? {}
          : { recipientId: port.channel === 'private' ? 'recipient-event' : 'event' }),
      });
      expect(fake.dispatches).toEqual([
        { key: `${port.owner}|event|${port.channel}|Reply`, message: 'Reply' },
      ]);
      const hasChoices = port.channel === 'private' || port.name === 'Instagram direct';
      expect([...fake.choices.values()]).toEqual(hasChoices ? ['qr:execution:choice'] : []);
    });

    it.each([
      ['rate-limit', 'retryable'],
      ['permanent', 'permanent'],
      ['timeout', 'uncertain'],
    ] as const)(
      'classifies %s through the real recovery contract without exposing choices',
      async (failure, recoveryKind) => {
        const fake = fixture();
        const target = `event-${failure}-one`;
        try {
          await port.send(fake, target);
          throw new Error('Expected provider rejection');
        } catch (error) {
          expect(error).toBeInstanceOf(port.error);
          expect((error as InstanceType<typeof port.error>).recoveryKind()).toBe(recoveryKind);
        }
        expect(fake.dispatches).toEqual([
          { key: `${port.owner}|${target}|${port.channel}|Reply`, message: 'Reply' },
        ]);
        expect(fake.choices.size).toBe(0);
      },
    );

    it('rejects mismatched owner paths or cross-provider tokens before dispatch accounting', async () => {
      const fake = fixture();
      await expect(port.send(fake, 'event', 'other-owner')).rejects.toThrow(
        /Wrong provider account path|Cross-provider/,
      );
      expect(fake.dispatches).toEqual([]);
      expect(fake.choices.size).toBe(0);
    });
  });
