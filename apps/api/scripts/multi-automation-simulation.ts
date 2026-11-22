import assert from 'node:assert/strict';
import { AssertionError } from 'node:assert';
import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import { processStoryReply } from '../src/automation/process-story-reply.js';
import { processComment } from '../src/automation/process-comment.js';
import { processFacebookComment } from '../src/automation/process-facebook-comment.js';
import { createDatabase } from '../src/database/database.js';
import { AesGcmTokenProtector } from '../src/security/aes-gcm-token-protector.js';
import {
  knownApplicationDatabaseUrls,
  loadTestEncryptionKey,
  requireIsolatedLoadTestDatabase,
  toSafeLoadTestError,
} from './load-testing/config.js';

/** Exercises independent Post/Reel rules with real isolated persistence and fake provider sends. */
const main = async (): Promise<void> => {
  const url = requireIsolatedLoadTestDatabase(
    process.env.LOAD_TEST_DATABASE_URL,
    process.env.LOAD_TEST_CONFIRM_ISOLATED,
    knownApplicationDatabaseUrls(),
  );
  const database = createDatabase(url);
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  const protector = new AesGcmTokenProtector(loadTestEncryptionKey);
  const prefix = `simulation-${randomUUID()}`;
  const owners: string[] = [];
  const connections: string[] = [];
  const sends = new Set<string>();
  const logger = { info: () => undefined, error: () => undefined };
  const record = (provider: string, channel: string, commentId: string, message: string) => {
    const key = `${provider}:${channel}:${commentId}`;
    assert(!sends.has(key), 'Duplicate provider dispatch');
    const kind = commentId.includes('-story-')
      ? 'story'
      : commentId.includes('-reel-')
        ? 'reel'
        : 'post';
    assert.equal(message, `${provider}-${kind}-${channel}`, 'Wrong automation selected');
    sends.add(key);
    return { recipientId: 'synthetic-recipient', replyId: `fake-${key}` };
  };
  const instagramCommentReplyClient = {
    replyToComment: async (input: { commentId: string; message: string }) => ({
      replyId: record('instagram', 'public', input.commentId, input.message).replyId,
    }),
  };
  const instagramPrivateReplyClient = {
    sendPrivateReply: async (input: { commentId: string; message: string }) =>
      record('instagram', 'private', input.commentId, input.message),
  };
  const facebookCommentReplyClient = {
    replyToComment: async (input: { commentId: string; message: string }) => ({
      replyId: record('facebook', 'public', input.commentId, input.message).replyId,
    }),
  };
  const facebookPrivateReplyClient = {
    sendPrivateReply: async (input: { commentId: string; message: string }) =>
      record('facebook', 'private', input.commentId, input.message),
  };
  const shared = {
    automationRepository: database.automationRepository,
    executionRepository: database.executionRepository,
    instagramCommentReplyClient,
    instagramPrivateReplyClient,
    tokenRefreshRepository: database.tokenRefreshRepository,
    tokenProtector: protector,
    logger,
  };
  const work: (() => Promise<unknown>)[] = [];
  const start = performance.now();
  try {
    const instagramId = `${prefix}-instagram`;
    const ig = await database.identityRepository.completeInstagramLogin({
      instagramUserId: instagramId,
      username: 'synthetic_owner',
      accessTokenCiphertext: protector.encrypt('fake-instagram-token'),
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
    });
    owners.push(ig.user.id);
    connections.push(ig.connection.id);
    const facebookUser = await database.identityRepository.completeSignIn({
      provider: 'facebook',
      externalUserId: `${prefix}-owner`,
      displayName: 'Synthetic owner',
    });
    owners.push(facebookUser.id);
    const pageId = `${prefix}-page`;
    const page = await database.socialConnectionRepository.connectFacebookPage({
      userId: facebookUser.id,
      pageId,
      pageName: 'Synthetic Page',
      accessTokenCiphertext: protector.encrypt('fake-facebook-token'),
    });
    connections.push(page.id);
    for (const provider of ['instagram', 'facebook'] as const) {
      const connectionId = provider === 'instagram' ? ig.connection.id : page.id;
      for (const kind of ['post', 'reel'] as const) {
        const mediaId = `${prefix}-${provider}-${kind}`;
        await database.automationRepository.saveAutomation({
          accountId: connectionId,
          mediaId,
          enabled: true,
          deliveryMode: 'both',
          triggerMode: 'all',
          triggerText: null,
          replyText: `${provider}-${kind}-public`,
          privateReplyText: `${provider}-${kind}-private`,
        });
        for (let index = 0; index < 20; index += 1) {
          const common = {
            commentId: `${mediaId}-${index}`,
            commenterId: 'synthetic-buyer',
            parentCommentId: null,
            text: 'Synthetic comment',
            receivedAt: new Date(),
          };
          const task =
            provider === 'instagram'
              ? () =>
                  processComment(
                    { ...common, instagramAccountId: instagramId, mediaId, username: 'buyer' },
                    { ...shared, accountRepository: database.accountRepository },
                  )
              : () =>
                  processFacebookComment(
                    { ...common, pageId, postId: mediaId, commenterName: 'Buyer' },
                    {
                      ...shared,
                      socialConnectionRepository: database.socialConnectionRepository,
                      facebookCommentReplyClient,
                      facebookPrivateReplyClient,
                    },
                  );
          work.push(task, task);
        }
      }
    }
    const storyId = `${prefix}-instagram-story`;
    await database.automationRepository.saveAutomation({
      accountId: ig.connection.id,
      mediaId: storyId,
      enabled: true,
      triggerKind: 'story_reply',
      deliveryMode: 'private',
      triggerMode: 'all',
      triggerText: null,
      replyText: '',
      privateReplyText: 'instagram-story-private',
    });
    for (let index = 0; index < 20; index += 1) {
      const senderId = `${storyId}-${index}`;
      const event = {
        instagramAccountId: instagramId,
        recipientId: instagramId,
        senderId,
        storyId,
        messageId: `${storyId}-message-${index}`,
        text: 'Story question',
        quickReplyPayload: null,
        timestamp: new Date(),
      };
      const task = () =>
        processStoryReply(event, {
          ...shared,
          accountRepository: database.accountRepository,
          instagramDirectMessageClient: {
            sendDirectMessage: async (input) => ({
              ...record('instagram', 'private', input.recipientId, input.message),
              recipientId: input.recipientId,
            }),
          },
        });
      work.push(task, task);
    }
    assert.equal((await database.automationRepository.listByAccountId(ig.connection.id)).length, 3);
    assert.equal((await database.automationRepository.listByAccountId(page.id)).length, 2);
    let cursor = 0;
    const workers = await Promise.allSettled(
      Array.from({ length: 10 }, async () => {
        while (cursor < work.length) {
          const task = work[cursor++];
          await task!();
        }
      }),
    );
    const failed = workers.find((worker) => worker.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const [result] = await sql<{ count: number; succeeded: number }[]>`
      select count(*)::integer as count,
        count(*) filter (where e.status='succeeded')::integer as succeeded
      from app_private.executions e join app_private.automations a on a.id=e.automation_id
      where a.connection_id in ${sql(connections)}
    `;
    console.info(
      JSON.stringify({
        persisted: result,
        dispatches: sends.size,
        outcomes:
          await sql`select c.provider, e.delivery_channel, e.status, e.error_code, count(*)::integer as count
        from app_private.executions e join app_private.automations a on a.id=e.automation_id
        join app_private.social_connections c on c.id=a.connection_id
        where c.id in ${sql(connections)} group by c.provider,e.delivery_channel,e.status,e.error_code`,
      }),
    );
    assert.equal(result?.count, 180, 'Execution count');
    assert.equal(result?.succeeded, 180, 'Succeeded count');
    assert.equal(sends.size, 180, 'Dispatch count');
    console.info(
      JSON.stringify({
        inputEvents: work.length,
        concurrency: 10,
        distinctComments: 80,
        distinctStoryReplies: 20,
        providerDispatches: sends.size,
        succeeded: result.succeeded,
        elapsedMs: Math.round(performance.now() - start),
      }),
    );
  } finally {
    if (owners.length)
      await sql.begin(async (tx) => {
        const ids = owners;
        await tx`delete from app_private.executions where automation_id in (
        select id from app_private.automations where connection_id in (
          select id from app_private.social_connections where user_id = any(${ids}::uuid[])))`;
        await tx`delete from app_private.automations where connection_id in (
        select id from app_private.social_connections where user_id = any(${ids}::uuid[]))`;
        await tx`delete from app_private.facebook_pages where connection_id in (
        select id from app_private.social_connections where user_id = any(${ids}::uuid[]))`;
        await tx`delete from app_private.instagram_accounts where id in (
        select id from app_private.social_connections where user_id = any(${ids}::uuid[]))`;
        await tx`delete from app_private.social_connections where user_id = any(${ids}::uuid[])`;
        await tx`delete from app_private.login_identities where user_id = any(${ids}::uuid[])`;
        await tx`delete from app_private.users where id = any(${ids}::uuid[])`;
      });
    await database.close();
    await sql.end({ timeout: 5 });
  }
};

main().catch((error: unknown) => {
  if (error instanceof AssertionError)
    console.error(
      JSON.stringify({
        assertion: error.message,
        expected: error.expected,
        actual: error.actual,
      }),
    );
  console.error(toSafeLoadTestError(error));
  process.exitCode = 1;
});
