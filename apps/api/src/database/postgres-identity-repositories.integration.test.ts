import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { ConnectionLimitError, IdentityOwnershipError } from './identity-repositories.js';
import {
  createPostgresIdentityRepository,
  createPostgresSocialConnectionRepository,
} from './postgres-identity-repositories.js';
import {
  createPostgresDmConversationRepository,
  createPostgresExecutionRepository,
} from './postgres-repositories.js';

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === 'true';
const describeDatabase = enabled ? describe : describe.skip;

describeDatabase('PostgreSQL identity and Page connection', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || process.env.NODE_ENV === 'production' || url === process.env.DATABASE_URL) {
      throw new Error('A separate non-production TEST_DATABASE_URL with migrations is required');
    }
    sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('keeps login identities unique and connects only an explicitly selected Page', async () => {
    const firstProviderId = `fb-person-${randomUUID()}`;
    const secondProviderId = `fb-person-${randomUUID()}`;
    const firstPageId = `fb-page-${randomUUID()}`;
    const secondPageId = `fb-page-${randomUUID()}`;
    const identities = createPostgresIdentityRepository(sql);
    const connections = createPostgresSocialConnectionRepository(sql);
    const protector = new AesGcmTokenProtector(Buffer.alloc(32, 7).toString('base64'));
    const firstToken = protector.encrypt('page-one-secret');
    const secondToken = protector.encrypt('page-two-secret');
    let firstUserId: string | undefined;
    let secondUserId: string | undefined;

    try {
      const first = await identities.completeSignIn({
        provider: 'facebook',
        externalUserId: firstProviderId,
        displayName: 'First person',
      });
      firstUserId = first.id;
      const repeated = await identities.completeSignIn({
        provider: 'facebook',
        externalUserId: firstProviderId,
        displayName: 'Renamed person',
      });
      expect(repeated.id).toBe(first.id);

      const second = await identities.completeSignIn({
        provider: 'facebook',
        externalUserId: secondProviderId,
        displayName: 'Second person',
      });
      secondUserId = second.id;
      await expect(
        identities.completeSignIn({
          provider: 'facebook',
          externalUserId: firstProviderId,
          displayName: 'First person',
          intendedUserId: second.id,
        }),
      ).rejects.toBeInstanceOf(IdentityOwnershipError);

      const pending = await connections.createPendingPageSelection({
        userId: first.id,
        pages: [
          { id: firstPageId, name: 'First Page', accessTokenCiphertext: firstToken },
          { id: secondPageId, name: 'Second Page', accessTokenCiphertext: secondToken },
        ],
      });
      expect(JSON.stringify(pending)).not.toContain(firstToken);
      expect(
        await connections.getPendingPageSelection({
          userId: second.id,
          selectionId: pending.selectionId,
        }),
      ).toBeNull();
      expect(
        await connections.consumeSelectedPage({
          userId: first.id,
          selectionId: pending.selectionId,
          pageId: 'unlisted-page',
        }),
      ).toBeNull();

      const connected = await connections.consumeSelectedPage({
        userId: first.id,
        selectionId: pending.selectionId,
        pageId: secondPageId,
      });
      expect(connected?.externalAccountId).toBe(secondPageId);
      expect(
        await connections.consumeSelectedPage({
          userId: first.id,
          selectionId: pending.selectionId,
          pageId: firstPageId,
        }),
      ).toBeNull();
      const stored = await connections.findFacebookPageByPageId(secondPageId);
      expect(stored?.accessTokenCiphertext).toBe(secondToken);
      await expect(
        connections.connectFacebookPage({
          userId: first.id,
          pageId: firstPageId,
          pageName: 'First Page',
          accessTokenCiphertext: firstToken,
        }),
      ).rejects.toBeInstanceOf(ConnectionLimitError);
    } finally {
      await sql`delete from app_private.pending_page_selections where user_id in (${firstUserId ?? randomUUID()}, ${secondUserId ?? randomUUID()})`;
      await sql`
        delete from app_private.facebook_pages
        where connection_id in (
          select id from app_private.social_connections
          where external_account_id in (${firstPageId}, ${secondPageId})
        )
      `;
      await sql`
        delete from app_private.social_connections
        where external_account_id in (${firstPageId}, ${secondPageId})
      `;
      await sql`
        delete from app_private.login_identities
        where external_user_id in (${firstProviderId}, ${secondProviderId})
      `;
      await sql`
        delete from app_private.users
        where id in (${firstUserId ?? randomUUID()}, ${secondUserId ?? randomUUID()})
      `;
    }
  });

  it('claims Facebook reply retries and follow-ups with the Page credential', async () => {
    const personId = `fb-person-${randomUUID()}`;
    const pageId = `fb-page-${randomUUID()}`;
    const commentId = `fb-comment-${randomUUID()}`;
    const messageId = `fb-message-${randomUUID()}`;
    const identities = createPostgresIdentityRepository(sql);
    const connections = createPostgresSocialConnectionRepository(sql);
    const executions = createPostgresExecutionRepository(sql);
    const conversations = createPostgresDmConversationRepository(sql);
    const protector = new AesGcmTokenProtector(Buffer.alloc(32, 9).toString('base64'));
    const encryptedPageToken = protector.encrypt('facebook-page-secret');
    let userId: string | undefined;
    let connectionId: string | undefined;
    let automationId: string | undefined;
    let executionId: string | undefined;
    let answerId: string | undefined;
    let followupId: string | undefined;

    try {
      const user = await identities.completeSignIn({
        provider: 'facebook',
        externalUserId: personId,
        displayName: 'Page owner',
      });
      userId = user.id;
      const connection = await connections.connectFacebookPage({
        userId: user.id,
        pageId,
        pageName: 'Test Page',
        accessTokenCiphertext: encryptedPageToken,
      });
      connectionId = connection.id;
      const automationRows = await sql<{ id: string }[]>`
        insert into app_private.automations
          (connection_id, media_id, trigger_mode, trigger_text, delivery_mode,
            reply_text, private_reply_text, enabled)
        values (${connection.id}, 'page-post', 'all', null, 'both', 'Public reply',
          'Private reply', true)
        returning id
      `;
      automationId = automationRows[0]!.id;
      const executionRows = await sql<{ id: string }[]>`
        insert into app_private.executions
          (automation_id, instagram_comment_id, comment_text, status,
            delivery_channel, message_text, next_attempt_at)
        values (${automationId}, ${commentId}, 'hello', 'retry_pending',
          'public', 'Public reply', ${new Date(Date.now() - 60_000)})
        returning id
      `;
      executionId = executionRows[0]!.id;
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + 120_000);
      const claimed = await executions.claimDueRetries(now, leaseUntil, 50);
      expect(claimed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'facebook',
            connectionId: connection.id,
            externalAccountId: pageId,
            accessTokenCiphertext: encryptedPageToken,
            execution: expect.objectContaining({ id: executionId }),
          }),
        ]),
      );

      const answerRows = await sql<{ id: string }[]>`
        insert into app_private.inbound_dm_answers
          (connection_id, provider_message_id, sender_igsid, sent_at)
        values (${connection.id}, ${messageId}, 'page-scoped-recipient', ${now})
        returning id
      `;
      answerId = answerRows[0]!.id;
      const followupRows = await sql<{ id: string }[]>`
        insert into app_private.dm_followups
          (connection_id, answer_id, recipient_igsid, message_text, expires_at)
        values (${connection.id}, ${answerId}, 'page-scoped-recipient',
          'Follow-up', ${new Date(now.getTime() + 3600_000)})
        returning id
      `;
      followupId = followupRows[0]!.id;
      await expect(conversations.claimFollowup(followupId, now, leaseUntil)).resolves.toEqual(
        expect.objectContaining({
          provider: 'facebook',
          connectionId: connection.id,
          externalAccountId: pageId,
          accessTokenCiphertext: encryptedPageToken,
          followup: expect.objectContaining({ id: followupId }),
        }),
      );
    } finally {
      if (followupId) await sql`delete from app_private.dm_followups where id = ${followupId}`;
      if (answerId) await sql`delete from app_private.inbound_dm_answers where id = ${answerId}`;
      if (executionId) await sql`delete from app_private.executions where id = ${executionId}`;
      if (automationId) await sql`delete from app_private.automations where id = ${automationId}`;
      if (connectionId) {
        await sql`delete from app_private.facebook_pages where connection_id = ${connectionId}`;
        await sql`delete from app_private.social_connections where id = ${connectionId}`;
      }
      await sql`delete from app_private.login_identities where external_user_id = ${personId}`;
      if (userId) await sql`delete from app_private.users where id = ${userId}`;
    }
  });
});
