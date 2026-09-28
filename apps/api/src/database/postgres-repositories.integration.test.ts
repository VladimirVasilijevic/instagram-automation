import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';
import {
  createPostgresAccountRepository,
  createPostgresAutomationRepository,
  createPostgresExecutionRepository,
  createPostgresSessionRepository,
} from './postgres-repositories.js';

const integrationTestsEnabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === 'true';

if (integrationTestsEnabled) {
  process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env.local'));
}

const describeDatabase = integrationTestsEnabled ? describe : describe.skip;
const multichannelMigrationPath = resolve(
  import.meta.dirname,
  '../../../../db/migrations/0004_multichannel_replies.sql',
);

describeDatabase('PostgreSQL repositories', () => {
  const rollbackSignal = new Error('rollback integration transaction');
  const databaseUrl = process.env.DATABASE_URL;
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Repository integration tests must not run in production');
    }

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for repository integration tests');
    }

    sql = postgres(databaseUrl, {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 1,
      prepare: false,
    });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('persists protected account and session values and rolls back every test row', async () => {
    const instagramUserId = `integration-${randomUUID()}`;
    const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 3).toString('base64'));
    const firstPlaintextAccessToken = 'first-plaintext-instagram-token';
    const secondPlaintextAccessToken = 'second-plaintext-instagram-token';
    const firstProtectedAccessToken = tokenProtector.encrypt(firstPlaintextAccessToken);
    const secondProtectedAccessToken = tokenProtector.encrypt(secondPlaintextAccessToken);
    const activeSessionToken = createSessionToken();
    const expiredSessionToken = createSessionToken();

    try {
      await sql.begin(async (transactionSql) => {
        const accountRepository = createPostgresAccountRepository(transactionSql);
        const sessionRepository = createPostgresSessionRepository(transactionSql);
        const firstAccount = await accountRepository.upsertConnectedAccount({
          accessTokenCiphertext: firstProtectedAccessToken,
          instagramUserId,
          tokenExpiresAt: new Date(Date.now() + 86_400_000),
          username: 'first_username',
        });
        const refreshedAccount = await accountRepository.upsertConnectedAccount({
          accessTokenCiphertext: secondProtectedAccessToken,
          instagramUserId,
          tokenExpiresAt: new Date(Date.now() + 172_800_000),
          username: 'refreshed_username',
        });

        expect(refreshedAccount.id).toBe(firstAccount.id);
        expect(refreshedAccount.createdAt).toEqual(firstAccount.createdAt);
        expect(refreshedAccount.username).toBe('refreshed_username');
        expect(refreshedAccount.accessTokenCiphertext).toBe(secondProtectedAccessToken);

        const foundAccount = await accountRepository.findByInstagramUserId(instagramUserId);

        expect(foundAccount).toEqual(refreshedAccount);

        const storedAccountRows = await transactionSql<
          { access_token_ciphertext: string; plaintext_was_stored: boolean }[]
        >`
          select
            access_token_ciphertext,
            access_token_ciphertext in (
              ${firstPlaintextAccessToken},
              ${secondPlaintextAccessToken}
            ) as plaintext_was_stored
          from app_private.instagram_accounts
          where id = ${firstAccount.id}
        `;

        expect(storedAccountRows[0]).toEqual({
          access_token_ciphertext: secondProtectedAccessToken,
          plaintext_was_stored: false,
        });

        const activeSession = await sessionRepository.createSession({
          accountId: firstAccount.id,
          expiresAt: new Date(Date.now() + 3_600_000),
          tokenHash: activeSessionToken.tokenHash,
        });
        await sessionRepository.createSession({
          accountId: firstAccount.id,
          expiresAt: new Date(Date.now() - 3_600_000),
          tokenHash: expiredSessionToken.tokenHash,
        });

        expect(activeSession.accountId).toBe(firstAccount.id);
        await expect(
          sessionRepository.findActiveByTokenHash(activeSessionToken.tokenHash),
        ).resolves.toEqual({ account: refreshedAccount, session: activeSession });
        await expect(
          sessionRepository.findActiveByTokenHash(expiredSessionToken.tokenHash),
        ).resolves.toBeNull();

        const storedSessionRows = await transactionSql<
          { raw_token_was_stored: boolean; token_hash: string }[]
        >`
          select
            token_hash,
            token_hash = ${activeSessionToken.token} as raw_token_was_stored
          from app_private.sessions
          where id = ${activeSession.id}
        `;

        expect(storedSessionRows[0]).toEqual({
          raw_token_was_stored: false,
          token_hash: activeSessionToken.tokenHash,
        });

        await expect(
          sessionRepository.deleteByTokenHash(activeSessionToken.tokenHash),
        ).resolves.toBe(true);
        await expect(
          sessionRepository.deleteByTokenHash(activeSessionToken.tokenHash),
        ).resolves.toBe(false);
        await expect(
          sessionRepository.findActiveByTokenHash(activeSessionToken.tokenHash),
        ).resolves.toBeNull();

        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) {
        throw error;
      }
    }

    const remainingRows = await sql<{ account_count: number; session_count: number }[]>`
      select
        (
          select count(*)::integer
          from app_private.instagram_accounts
          where instagram_user_id = ${instagramUserId}
        ) as account_count,
        (
          select count(*)::integer
          from app_private.sessions
          where token_hash in (
            ${activeSessionToken.tokenHash},
            ${expiredSessionToken.tokenHash}
          )
        ) as session_count
    `;

    expect(remainingRows[0]).toEqual({ account_count: 0, session_count: 0 });
  });

  it('persists automations, atomically claims executions, and isolates recent activity', async () => {
    const instagramUserId = `automation-integration-${randomUUID()}`;
    const otherInstagramUserId = `other-automation-integration-${randomUUID()}`;
    const firstCommentId = `comment-${randomUUID()}`;
    const legacyCommentId = `legacy-comment-${randomUUID()}`;
    const secondCommentId = `comment-${randomUUID()}`;
    const otherCommentId = `comment-${randomUUID()}`;
    const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 4).toString('base64'));
    const protectedAccessToken = tokenProtector.encrypt('automation-test-token');

    try {
      await sql.begin(async (transactionSql) => {
        const [schemaState] = await transactionSql<{ migration_applied: boolean }[]>`
          select exists (
            select 1
            from information_schema.columns
            where table_schema = 'app_private'
              and table_name = 'automations'
              and column_name = 'delivery_mode'
          ) as migration_applied
        `;
        if (!schemaState?.migration_applied) {
          await transactionSql.unsafe(await readFile(multichannelMigrationPath, 'utf8'));
        }

        const accountRepository = createPostgresAccountRepository(transactionSql);
        const automationRepository = createPostgresAutomationRepository(transactionSql);
        const executionRepository = createPostgresExecutionRepository(transactionSql);
        const account = await accountRepository.upsertConnectedAccount({
          accessTokenCiphertext: protectedAccessToken,
          instagramUserId,
          tokenExpiresAt: new Date(Date.now() + 86_400_000),
          username: 'automation_owner',
        });
        const otherAccount = await accountRepository.upsertConnectedAccount({
          accessTokenCiphertext: protectedAccessToken,
          instagramUserId: otherInstagramUserId,
          tokenExpiresAt: new Date(Date.now() + 86_400_000),
          username: 'other_automation_owner',
        });
        const firstAutomation = await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'public',
          enabled: false,
          mediaId: 'first-media',
          privateReplyText: null,
          replyText: 'First reply',
          triggerText: '#Hello',
        });
        const updatedAutomation = await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'public',
          enabled: true,
          mediaId: 'selected-media',
          privateReplyText: null,
          replyText: 'Updated reply',
          triggerText: '#Hello',
        });

        expect(updatedAutomation).toMatchObject({
          accountId: account.id,
          deliveryMode: 'public',
          enabled: true,
          id: firstAutomation.id,
          mediaId: 'selected-media',
          privateReplyText: null,
          replyText: 'Updated reply',
          triggerText: '#Hello',
        });
        expect(updatedAutomation.createdAt).toEqual(firstAutomation.createdAt);

        const [legacyExecution] = await transactionSql<
          {
            delivery_channel: string;
            id: string;
            message_text: string;
          }[]
        >`
          insert into app_private.executions (
            automation_id,
            instagram_comment_id,
            commenter_username,
            comment_text,
            status,
            lease_id,
            lease_expires_at
          ) values (
            ${updatedAutomation.id},
            ${legacyCommentId},
            'legacy_commenter',
            '#Hello',
            'processing',
            gen_random_uuid(),
            ${new Date(Date.now() + 120_000)}
          )
          returning id, delivery_channel, message_text
        `;
        expect(legacyExecution).toMatchObject({
          delivery_channel: 'public',
          message_text: updatedAutomation.replyText,
        });
        await transactionSql`
          delete from app_private.executions
          where id = ${legacyExecution!.id}
        `;

        await expect(automationRepository.findByAccountId(account.id)).resolves.toEqual(
          updatedAutomation,
        );
        await expect(
          automationRepository.findEnabledByAccountAndMedia(account.id, 'selected-media'),
        ).resolves.toEqual(updatedAutomation);
        await expect(
          automationRepository.findEnabledByAccountAndMedia(account.id, 'wrong-media'),
        ).resolves.toBeNull();
        await expect(
          automationRepository.findEnabledByAccountAndMedia(otherAccount.id, 'selected-media'),
        ).resolves.toBeNull();

        const disabledAutomation = await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'public',
          enabled: false,
          mediaId: 'selected-media',
          privateReplyText: null,
          replyText: 'Updated reply',
          triggerText: '#Hello',
        });

        await expect(
          automationRepository.findEnabledByAccountAndMedia(account.id, 'selected-media'),
        ).resolves.toBeNull();

        const enabledAutomation = await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'public',
          enabled: true,
          mediaId: disabledAutomation.mediaId,
          privateReplyText: null,
          replyText: disabledAutomation.replyText,
          triggerText: '#Hello',
        });
        const otherAutomation = await automationRepository.saveAutomation({
          accountId: otherAccount.id,
          deliveryMode: 'public',
          enabled: true,
          mediaId: 'other-media',
          privateReplyText: null,
          replyText: 'Other reply',
          triggerText: '#Hello',
        });
        const firstExecution = await executionRepository.claimExecution({
          automationId: enabledAutomation.id,
          commenterInstagramId: 'first-commenter-id',
          commenterUsername: 'first_commenter',
          commentText: '#Hello',
          instagramCommentId: firstCommentId,
          deliveryChannel: 'public',
          leaseExpiresAt: new Date(Date.now() + 120_000),
          messageText: 'Updated reply',
        });

        expect(firstExecution).toMatchObject({
          automationId: enabledAutomation.id,
          commenterUsername: 'first_commenter',
          commentText: '#Hello',
          errorCode: null,
          errorMessage: null,
          instagramCommentId: firstCommentId,
          status: 'processing',
        });
        await expect(
          executionRepository.claimExecution({
            automationId: otherAutomation.id,
            commenterInstagramId: 'duplicate-commenter-id',
            commenterUsername: 'duplicate_commenter',
            commentText: '#Hello',
            instagramCommentId: firstCommentId,
            deliveryChannel: 'public',
            leaseExpiresAt: new Date(Date.now() + 120_000),
            messageText: 'Other reply',
          }),
        ).resolves.toBeNull();

        if (!firstExecution) {
          throw new Error('First execution claim unexpectedly returned null');
        }

        const succeededExecution = await executionRepository.markSucceeded(
          firstExecution.id,
          firstExecution.leaseId!,
          'reply-first',
        );

        expect(succeededExecution).toMatchObject({
          errorCode: null,
          errorMessage: null,
          id: firstExecution.id,
          status: 'succeeded',
        });
        await expect(
          executionRepository.markSucceeded(
            firstExecution.id,
            firstExecution.leaseId!,
            'reply-first',
          ),
        ).resolves.toBeNull();
        await expect(
          executionRepository.markFailed(firstExecution.id, firstExecution.leaseId!, {
            errorCode: 'provider_rejected',
            errorMessage: 'The provider rejected the reply.',
            failureKind: 'permanent',
          }),
        ).resolves.toBeNull();

        const secondExecution = await executionRepository.claimExecution({
          automationId: enabledAutomation.id,
          commenterInstagramId: null,
          commenterUsername: null,
          commentText: '#Hello',
          instagramCommentId: secondCommentId,
          deliveryChannel: 'public',
          leaseExpiresAt: new Date(Date.now() + 120_000),
          messageText: 'Updated reply',
        });

        if (!secondExecution) {
          throw new Error('Second execution claim unexpectedly returned null');
        }

        await expect(
          executionRepository.markFailed(secondExecution.id, secondExecution.leaseId!, {
            errorCode: ' ',
            errorMessage: 'Safe message',
            failureKind: 'permanent',
          }),
        ).rejects.toThrow(TypeError);

        const failedExecution = await executionRepository.markFailed(
          secondExecution.id,
          secondExecution.leaseId!,
          {
            errorCode: 'provider_unavailable',
            errorMessage: 'The reply provider is temporarily unavailable.',
            failureKind: 'permanent',
          },
        );

        expect(failedExecution).toMatchObject({
          errorCode: 'provider_unavailable',
          errorMessage: 'The reply provider is temporarily unavailable.',
          id: secondExecution.id,
          status: 'failed',
        });
        await expect(
          executionRepository.markSucceeded(
            secondExecution.id,
            secondExecution.leaseId!,
            'reply-second',
          ),
        ).resolves.toBeNull();

        const otherExecution = await executionRepository.claimExecution({
          automationId: otherAutomation.id,
          commenterInstagramId: 'other-commenter-id',
          commenterUsername: 'other_commenter',
          commentText: '#Hello',
          instagramCommentId: otherCommentId,
          deliveryChannel: 'public',
          leaseExpiresAt: new Date(Date.now() + 120_000),
          messageText: 'Other reply',
        });

        if (!otherExecution) {
          throw new Error('Other execution claim unexpectedly returned null');
        }

        await transactionSql`
          update app_private.executions
          set created_at = case
            when id = ${firstExecution.id} then '2026-01-01T10:00:00Z'::timestamptz
            when id = ${secondExecution.id} then '2026-01-01T11:00:00Z'::timestamptz
            else created_at
          end
          where id in (${firstExecution.id}, ${secondExecution.id})
        `;

        await expect(executionRepository.listRecentByAccountId(account.id, 1)).resolves.toEqual([
          expect.objectContaining({ id: secondExecution.id, status: 'failed' }),
        ]);

        const accountActivity = await executionRepository.listRecentByAccountId(account.id, 50);

        expect(accountActivity.map(({ id }) => id)).toEqual([
          secondExecution.id,
          firstExecution.id,
        ]);
        expect(accountActivity).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: otherExecution.id })]),
        );
        const [privateExecution] = await executionRepository.claimExecutions([
          {
            automationId: enabledAutomation.id,
            commenterInstagramId: 'first-commenter-id',
            commenterUsername: 'first_commenter',
            commentText: '#Hello',
            deliveryChannel: 'private',
            instagramCommentId: firstCommentId,
            leaseExpiresAt: new Date(Date.now() + 120_000),
            messageText: 'Private reply',
          },
        ]);
        expect(privateExecution).toMatchObject({
          deliveryChannel: 'private',
          instagramCommentId: firstCommentId,
          messageText: 'Private reply',
        });
        await expect(executionRepository.listRecentByAccountId(account.id, 1)).resolves.toEqual([
          expect.objectContaining({ id: firstExecution.id, deliveryChannel: 'public' }),
          expect.objectContaining({ id: privateExecution!.id, deliveryChannel: 'private' }),
        ]);
        await expect(executionRepository.listRecentByAccountId(account.id, 0)).rejects.toThrow(
          RangeError,
        );
        await expect(executionRepository.listRecentByAccountId(account.id, 51)).rejects.toThrow(
          RangeError,
        );
        await expect(executionRepository.listRecentByAccountId(account.id, 1.5)).rejects.toThrow(
          RangeError,
        );

        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) {
        throw error;
      }
    }

    const remainingRows = await sql<
      { account_count: number; automation_count: number; execution_count: number }[]
    >`
      select
        (
          select count(*)::integer
          from app_private.instagram_accounts
          where instagram_user_id in (${instagramUserId}, ${otherInstagramUserId})
        ) as account_count,
        (
          select count(*)::integer
          from app_private.automations as automation
          inner join app_private.instagram_accounts as account on account.id = automation.account_id
          where account.instagram_user_id in (${instagramUserId}, ${otherInstagramUserId})
        ) as automation_count,
        (
          select count(*)::integer
          from app_private.executions
          where instagram_comment_id in (${firstCommentId}, ${secondCommentId}, ${otherCommentId})
        ) as execution_count
    `;

    expect(remainingRows[0]).toEqual({
      account_count: 0,
      automation_count: 0,
      execution_count: 0,
    });
  });
});
