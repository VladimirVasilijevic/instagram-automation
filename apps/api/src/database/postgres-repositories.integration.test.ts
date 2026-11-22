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
  createPostgresDmConversationRepository,
  createPostgresExecutionRepository,
  createPostgresMaintenanceHealthRepository,
  createPostgresSessionRepository,
} from './postgres-repositories.js';

const integrationTestsEnabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === 'true';

const describeDatabase = integrationTestsEnabled ? describe : describe.skip;
const multichannelMigrationPath = resolve(
  import.meta.dirname,
  '../../../../db/migrations/0004_multichannel_replies.sql',
);
const operationalHealthMigrationPath = resolve(
  import.meta.dirname,
  '../../../../db/migrations/0005_operational_health.sql',
);
const executionMediaMigrationPath = resolve(
  import.meta.dirname,
  '../../../../db/migrations/0006_execution_media_attribution.sql',
);
const triggerModesMigrationPath = resolve(
  import.meta.dirname,
  '../../../../db/migrations/0007_automation_trigger_modes.sql',
);
const quickReplyMigrationPath = resolve(
  import.meta.dirname,
  '../../../../db/migrations/0008_quick_reply_conversations.sql',
);

const ensureAutomationSchema = async (transactionSql: postgres.TransactionSql) => {
  const migrations = [
    { column: 'delivery_mode', table: 'automations', path: multichannelMigrationPath },
    { column: 'media_id', table: 'executions', path: executionMediaMigrationPath },
    { column: 'trigger_mode', table: 'automations', path: triggerModesMigrationPath },
    { column: 'quick_reply_options', table: 'automations', path: quickReplyMigrationPath },
  ];
  for (const migration of migrations) {
    const [schemaState] = await transactionSql<{ migration_applied: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'app_private'
          and table_name = ${migration.table}
          and column_name = ${migration.column}
      ) as migration_applied
    `;
    if (!schemaState?.migration_applied) {
      await transactionSql.unsafe(await readFile(migration.path, 'utf8'));
    }
  }
};

describeDatabase('PostgreSQL repositories', () => {
  const rollbackSignal = new Error('rollback integration transaction');
  const databaseUrl = process.env.TEST_DATABASE_URL;
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Repository integration tests must not run in production');
    }

    if (
      !databaseUrl ||
      databaseUrl === process.env.DATABASE_URL ||
      databaseUrl === process.env.DATABASE_MIGRATION_URL
    ) {
      throw new Error('A separate non-production TEST_DATABASE_URL is required');
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
        ).resolves.toEqual({
          user: expect.objectContaining({ id: firstAccount.id }),
          connection: expect.objectContaining({
            id: firstAccount.id,
            userId: firstAccount.id,
            provider: 'instagram',
          }),
          account: refreshedAccount,
          session: activeSession,
        });
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

  it('persists a singleton maintenance heartbeat and preserves the latest success on failure', async () => {
    try {
      await sql.begin(async (transactionSql) => {
        const [schemaState] = await transactionSql<{ migration_applied: boolean }[]>`
          select to_regclass('app_private.maintenance_health') is not null as migration_applied
        `;
        if (!schemaState?.migration_applied) {
          await transactionSql.unsafe(await readFile(operationalHealthMigrationPath, 'utf8'));
        }
        const repository = createPostgresMaintenanceHealthRepository(transactionSql);
        const counts = {
          expiredTokenCount: 0,
          reconnectRequiredCount: 0,
          replyFailedCount: 0,
          replyRetryPendingCount: 1,
          replySucceededCount: 2,
          replyUncertainCount: 0,
          staleExecutionCount: 1,
          tokenRefreshFailedCount: 0,
          tokenRefreshedCount: 1,
        };

        await repository.recordSuccess(counts);
        const succeeded = await repository.getHealth();
        expect(succeeded).toMatchObject({
          ...counts,
          lastFailureCode: null,
        });
        expect(succeeded?.lastSucceededAt).toBeInstanceOf(Date);

        await repository.recordFailure('MAINTENANCE_FAILED');
        const failed = await repository.getHealth();
        expect(failed).toMatchObject({
          ...counts,
          lastFailureCode: 'MAINTENANCE_FAILED',
          lastSucceededAt: succeeded?.lastSucceededAt,
        });
        expect(failed?.lastFailedAt).toBeInstanceOf(Date);

        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) throw error;
    }
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
        await ensureAutomationSchema(transactionSql);

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
          mediaId: 'selected-media',
          privateReplyText: null,
          replyText: 'First reply',
          triggerMode: 'exact',
          triggerText: '#Hello',
        });
        const updatedAutomation = await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'public',
          enabled: true,
          mediaId: 'selected-media',
          privateReplyText: null,
          replyText: 'Updated reply',
          triggerMode: 'contains',
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
          triggerMode: 'contains',
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
          triggerMode: 'contains',
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
          triggerMode: 'all',
          triggerText: null,
        });
        const otherAutomation = await automationRepository.saveAutomation({
          accountId: otherAccount.id,
          deliveryMode: 'public',
          enabled: true,
          mediaId: 'other-media',
          privateReplyText: null,
          replyText: 'Other reply',
          triggerMode: 'exact',
          triggerText: '#Hello',
        });
        const secondMediaAutomation = await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'public',
          enabled: true,
          mediaId: 'second-media',
          privateReplyText: null,
          replyText: 'Second post reply',
          triggerMode: 'all',
          triggerText: null,
        });
        expect(secondMediaAutomation.id).not.toBe(enabledAutomation.id);
        await expect(
          automationRepository.findByAccountAndMedia(account.id, 'selected-media'),
        ).resolves.toEqual(enabledAutomation);
        await expect(
          automationRepository.findByAccountAndMedia(account.id, 'second-media'),
        ).resolves.toEqual(secondMediaAutomation);
        await expect(
          automationRepository.findByAccountAndMedia(otherAccount.id, 'second-media'),
        ).resolves.toBeNull();
        await expect(automationRepository.findByAccountId(account.id)).resolves.toBeNull();
        expect(await automationRepository.listByAccountId(account.id)).toHaveLength(2);

        const firstExecution = await executionRepository.claimExecution({
          automationId: enabledAutomation.id,
          // Preserve a historical media snapshot independently of current rule settings.
          mediaId: 'first-media',
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
          mediaId: 'first-media',
          status: 'processing',
        });
        await expect(
          executionRepository.claimExecution({
            automationId: otherAutomation.id,
            mediaId: otherAutomation.mediaId,
            commenterInstagramId: 'duplicate-commenter-id',
            commenterUsername: 'duplicate_commenter',
            commentText: '#Hello',
            instagramCommentId: firstCommentId,
            deliveryChannel: 'public',
            leaseExpiresAt: new Date(Date.now() + 120_000),
            messageText: 'Other reply',
          }),
        ).resolves.toMatchObject({
          automationId: otherAutomation.id,
          instagramCommentId: firstCommentId,
          deliveryChannel: 'public',
        });

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
          mediaId: enabledAutomation.mediaId,
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
          mediaId: otherAutomation.mediaId,
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
        await expect(
          executionRepository.listRecentByAccountId(account.id, 50, 'selected-media'),
        ).resolves.toEqual([expect.objectContaining({ id: secondExecution.id })]);
        await expect(
          executionRepository.listRecentByAccountId(account.id, 50, 'not-selected-media'),
        ).resolves.toEqual([]);
        const [privateExecution] = await executionRepository.claimExecutions([
          {
            automationId: enabledAutomation.id,
            mediaId: enabledAutomation.mediaId,
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

  it('concurrent saves of the same connection/media retain one stable automation ID', async () => {
    const peer = postgres(databaseUrl!, { connect_timeout: 10, max: 1, prepare: false });
    const ownerId = randomUUID();
    try {
      await sql`insert into app_private.users (id) values (${ownerId})`;
      await sql`insert into app_private.social_connections (id, user_id, provider, external_account_id, display_name)
        values (${ownerId}, ${ownerId}, 'facebook', ${`race-page-${ownerId}`}, 'Concurrent save owner')`;
      const input = {
        accountId: ownerId,
        deliveryMode: 'public' as const,
        enabled: true,
        mediaId: 'same-media',
        privateReplyText: null,
        replyText: 'Reply A',
        triggerMode: 'all' as const,
        triggerText: null,
      };
      const results = await Promise.all([
        createPostgresAutomationRepository(sql).saveAutomation(input),
        createPostgresAutomationRepository(peer).saveAutomation({ ...input, replyText: 'Reply B' }),
      ]);
      expect(results[0]!.id).toBe(results[1]!.id);
      const saved = await createPostgresAutomationRepository(sql).listByAccountId(ownerId);
      expect(saved).toHaveLength(1);
      expect(saved[0]!.id).toBe(results[0]!.id);
      expect(['Reply A', 'Reply B']).toContain(saved[0]!.replyText);
    } finally {
      await peer.end({ timeout: 5 });
      await sql`delete from app_private.automations where connection_id = ${ownerId}`;
      await sql`delete from app_private.social_connections where id = ${ownerId}`;
      await sql`delete from app_private.users where id = ${ownerId}`;
    }
  });

  it('snapshots quick replies, deduplicates answers, and leases one follow-up', async () => {
    const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 7).toString('base64'));
    const optionId = randomUUID();
    const option = { id: optionId, title: 'Yes', followUpText: 'Here is the next step.' };
    const now = new Date();
    try {
      await sql.begin(async (transactionSql) => {
        await ensureAutomationSchema(transactionSql);
        const accountRepository = createPostgresAccountRepository(transactionSql);
        const automationRepository = createPostgresAutomationRepository(transactionSql);
        const executionRepository = createPostgresExecutionRepository(transactionSql);
        const conversationRepository = createPostgresDmConversationRepository(transactionSql);
        const account = await accountRepository.upsertConnectedAccount({
          accessTokenCiphertext: tokenProtector.encrypt('quick-reply-test-token'),
          instagramUserId: `owner-${randomUUID()}`,
          tokenExpiresAt: new Date(now.getTime() + 86_400_000),
          username: 'quick_reply_owner',
        });
        const otherAccount = await accountRepository.upsertConnectedAccount({
          accessTokenCiphertext: tokenProtector.encrypt('other-test-token'),
          instagramUserId: `other-${randomUUID()}`,
          tokenExpiresAt: new Date(now.getTime() + 86_400_000),
          username: 'other_owner',
        });
        const automation = await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'private',
          enabled: true,
          mediaId: 'quick-reply-media',
          privateReplyText: 'Would you like more information?',
          quickReplyOptions: [option],
          replyText: '',
          triggerMode: 'all',
          triggerText: null,
        });
        expect(automation.quickReplyOptions).toEqual([option]);
        const execution = await executionRepository.claimExecution({
          automationId: automation.id,
          mediaId: automation.mediaId,
          commenterInstagramId: 'commenter-id',
          commenterUsername: 'commenter',
          commentText: 'Info please',
          deliveryChannel: 'private',
          instagramCommentId: `comment-${randomUUID()}`,
          leaseExpiresAt: new Date(now.getTime() + 120_000),
          messageText: automation.privateReplyText!,
          quickReplyOptions: automation.quickReplyOptions,
        });
        if (!execution?.leaseId) throw new Error('Private execution was not claimed');
        const succeeded = await executionRepository.markSucceeded(
          execution.id,
          execution.leaseId,
          'first-private-message',
          'recipient-igsid',
        );
        expect(succeeded).toMatchObject({
          quickReplyOptions: [option],
          recipientIgsid: 'recipient-igsid',
          status: 'succeeded',
        });
        await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'private',
          enabled: true,
          mediaId: automation.mediaId,
          privateReplyText: 'Changed question',
          quickReplyOptions: [{ ...option, followUpText: 'Changed follow-up' }],
          replyText: '',
          triggerMode: 'all',
          triggerText: null,
        });
        expect(
          (await executionRepository.listRecentByAccountId(account.id, 1))[0]?.quickReplyOptions,
        ).toEqual([option]);

        const otherMediaRule = await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'private',
          enabled: true,
          mediaId: 'second-quick-reply-media',
          privateReplyText: 'Another question',
          quickReplyOptions: [{ ...option, followUpText: 'Other post follow-up' }],
          replyText: '',
          triggerMode: 'all',
          triggerText: null,
        });
        const otherPrompt = await executionRepository.claimExecution({
          automationId: otherMediaRule.id,
          mediaId: otherMediaRule.mediaId,
          commenterInstagramId: 'commenter-id',
          commenterUsername: 'commenter',
          commentText: 'Second post question',
          deliveryChannel: 'private',
          instagramCommentId: `comment-${randomUUID()}`,
          leaseExpiresAt: new Date(now.getTime() + 120_000),
          messageText: otherMediaRule.privateReplyText!,
          quickReplyOptions: otherMediaRule.quickReplyOptions,
        });
        if (!otherPrompt?.leaseId) throw new Error('Second media prompt was not claimed');
        await executionRepository.markSucceeded(
          otherPrompt.id,
          otherPrompt.leaseId,
          'other-media-message',
          'recipient-igsid',
        );
        await expect(
          conversationRepository.recordInboundAnswer({
            accountId: account.id,
            providerMessageId: `ambiguous-${randomUUID()}`,
            senderIgsid: 'recipient-igsid',
            text: 'Yes',
            quickReplyPayload: null,
            sentAt: new Date(Date.now() + 1_000),
            receivedAt: new Date(),
          }),
        ).resolves.toMatchObject({ answer: { executionId: null, optionId: null }, followup: null });
        // Editing/disabling the current rule must not rewrite an already delivered prompt.
        await automationRepository.saveAutomation({
          accountId: account.id,
          deliveryMode: 'private',
          enabled: false,
          mediaId: automation.mediaId,
          privateReplyText: 'Disabled question',
          quickReplyOptions: [{ ...option, followUpText: 'Disabled follow-up' }],
          replyText: '',
          triggerMode: 'all',
          triggerText: null,
        });

        const choiceInput = {
          accountId: account.id,
          providerMessageId: `inbound-${randomUUID()}`,
          senderIgsid: 'recipient-igsid',
          text: 'Yes',
          quickReplyPayload: `qr:${execution.id}:${optionId}`,
          sentAt: new Date(Date.now() + 1_000),
          receivedAt: new Date(),
        };
        await expect(
          conversationRepository.recordInboundAnswer({
            ...choiceInput,
            accountId: otherAccount.id,
          }),
        ).resolves.toBeNull();
        await expect(
          conversationRepository.recordInboundAnswer({
            ...choiceInput,
            senderIgsid: 'unrelated-recipient',
          }),
        ).resolves.toBeNull();
        const result = await conversationRepository.recordInboundAnswer(choiceInput);
        expect(result).toMatchObject({
          answer: { executionId: execution.id, optionId },
          followup: { messageText: option.followUpText, status: 'pending' },
          duplicate: false,
        });
        await expect(
          conversationRepository.recordInboundAnswer(choiceInput),
        ).resolves.toMatchObject({
          answer: { id: result!.answer.id },
          duplicate: true,
        });
        const followup = result?.followup;
        if (!followup) throw new Error('Choice did not enqueue follow-up');
        const claim = await conversationRepository.claimFollowup(
          followup.id,
          now,
          new Date(now.getTime() + 120_000),
        );
        expect(claim).toMatchObject({
          followup: { id: followup.id, attemptCount: 1, status: 'processing' },
          instagramUserId: account.instagramUserId,
        });
        expect(claim?.accessTokenCiphertext).toBe(account.accessTokenCiphertext);
        await expect(
          conversationRepository.claimFollowup(followup.id, now, new Date(now.getTime() + 120_000)),
        ).resolves.toBeNull();
        expect(
          await conversationRepository.markFollowupDispatchStarted(
            followup.id,
            claim!.followup.leaseId!,
            now,
          ),
        ).toBe(true);
        expect(
          await conversationRepository.markFollowupSucceeded(
            followup.id,
            claim!.followup.leaseId!,
            'follow-up-message',
          ),
        ).toMatchObject({ status: 'succeeded', providerReplyId: 'follow-up-message' });
        await expect(
          conversationRepository.listRecentAnswersByAccountId(account.id, 50, automation.mediaId),
        ).resolves.toMatchObject([
          {
            answer: { optionId },
            choiceTitle: 'Yes',
            commenterUsername: 'commenter',
            mediaId: automation.mediaId,
            followup: { status: 'succeeded' },
          },
        ]);
        await expect(
          conversationRepository.listRecentAnswersByAccountId(otherAccount.id, 50),
        ).resolves.toEqual([]);
        await expect(
          conversationRepository.listRecentAnswersByAccountId(account.id, 50, 'other-post'),
        ).resolves.toEqual([]);
        await expect(
          conversationRepository.listRecentAnswersByAccountId(account.id, 50, automation.mediaId),
        ).resolves.toHaveLength(1);

        const secondExecution = await executionRepository.claimExecution({
          automationId: automation.id,
          mediaId: automation.mediaId,
          commenterInstagramId: 'second-commenter-id',
          commenterUsername: 'second-commenter',
          commentText: 'More info',
          deliveryChannel: 'private',
          instagramCommentId: `comment-${randomUUID()}`,
          leaseExpiresAt: new Date(now.getTime() + 120_000),
          messageText: 'Changed question',
          quickReplyOptions: [{ ...option, followUpText: 'Changed follow-up' }],
        });
        if (!secondExecution?.leaseId) throw new Error('Second private execution was not claimed');
        await executionRepository.markSucceeded(
          secondExecution.id,
          secondExecution.leaseId,
          'second-private-message',
          'second-recipient',
        );
        const staleTyped = await conversationRepository.recordInboundAnswer({
          accountId: account.id,
          providerMessageId: `stale-typed-${randomUUID()}`,
          senderIgsid: 'second-recipient',
          text: 'Before the prompt',
          quickReplyPayload: null,
          sentAt: new Date(now.getTime() - 60_000),
          receivedAt: new Date(),
        });
        expect(staleTyped).toBeNull();
        const lateTyped = await conversationRepository.recordInboundAnswer({
          accountId: account.id,
          providerMessageId: `late-typed-${randomUUID()}`,
          senderIgsid: 'second-recipient',
          text: 'Unrelated much later',
          quickReplyPayload: null,
          sentAt: new Date(Date.now() + 25 * 60 * 60 * 1_000),
          receivedAt: new Date(),
        });
        expect(lateTyped).toBeNull();
        const typed = await conversationRepository.recordInboundAnswer({
          accountId: account.id,
          providerMessageId: `typed-${randomUUID()}`,
          senderIgsid: 'second-recipient',
          text: 'Something else',
          quickReplyPayload: null,
          sentAt: new Date(Date.now() + 1_000),
          receivedAt: new Date(),
        });
        expect(typed).toMatchObject({
          answer: { executionId: secondExecution.id, text: 'Something else', optionId: null },
          followup: null,
        });

        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) throw error;
    }
  });
  it('claims concurrent Story batches once per owner and media while preserving legacy comment defaults', async () => {
    const peer = postgres(databaseUrl!, { connect_timeout: 10, max: 1, prepare: false });
    const accounts = createPostgresAccountRepository(sql);
    const automations = createPostgresAutomationRepository(sql);
    const executions = createPostgresExecutionRepository(sql);
    const peerExecutions = createPostgresExecutionRepository(peer);
    const ownerIds: string[] = [];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000);
    const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 7).toString('base64'));
    const sharedStoryId = `shared-story-${randomUUID()}`;
    const sharedMessageId = `shared-message-${randomUUID()}`;
    try {
      for (let index = 0; index < 2; index += 1) {
        const account = await accounts.upsertConnectedAccount({
          accessTokenCiphertext: tokenProtector.encrypt('synthetic-token'),
          instagramUserId: `concurrent-story-owner-${randomUUID()}`,
          tokenExpiresAt: expiresAt,
          username: `concurrent_story_owner_${index}`,
        });
        ownerIds.push(account.id);
      }
      const rules = await Promise.all(
        [
          { accountId: ownerIds[0]!, mediaId: sharedStoryId },
          { accountId: ownerIds[1]!, mediaId: sharedStoryId },
          { accountId: ownerIds[0]!, mediaId: `another-story-${randomUUID()}` },
        ].map((owner, index) =>
          automations.saveAutomation({
            ...owner,
            enabled: true,
            triggerKind: 'story_reply',
            deliveryMode: 'private',
            triggerMode: 'all',
            triggerText: null,
            replyText: '',
            privateReplyText: `Story answer ${index}`,
          }),
        ),
      );
      const inputs = rules.map((rule) => ({
        automationId: rule.id,
        mediaId: rule.mediaId,
        triggerKind: 'story_reply' as const,
        commenterInstagramId: 'same-sender',
        commenterUsername: null,
        commentText: 'Question',
        instagramCommentId: sharedMessageId,
        deliveryChannel: 'private' as const,
        messageText: rule.privateReplyText!,
        replyWindowExpiresAt: expiresAt,
        leaseExpiresAt: new Date(now.getTime() + 120_000),
      }));
      const results = await Promise.allSettled([
        executions.claimExecutions(inputs.slice(0, 2)),
        peerExecutions.claimExecutions(inputs.slice(0, 2)),
      ]);
      const claims = results.flatMap((result) => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      });
      expect(claims).toHaveLength(2);
      const third = await executions.claimExecution(inputs[2]!);
      expect(third).not.toBeNull();
      claims.push(third!);
      expect(new Set(claims.map((claim) => claim.automationId)).size).toBe(3);
      for (const claim of claims) {
        const expected = inputs.find((input) => input.automationId === claim.automationId)!;
        expect(claim).toMatchObject({
          mediaId: expected.mediaId,
          messageText: expected.messageText,
          triggerKind: 'story_reply',
          replyWindowExpiresAt: expiresAt,
          instagramCommentId: sharedMessageId,
          deliveryChannel: 'private',
        });
      }
      await expect(executions.claimExecutions(inputs.slice(0, 2))).resolves.toEqual([]);
      const [legacyRule] = await sql<{ id: string; media_id: string }[]>`
        insert into app_private.automations
          (account_id, connection_id, media_id, trigger_mode, trigger_text, reply_text, delivery_mode, enabled)
        values (${ownerIds[0]!}, ${ownerIds[0]!}, ${`legacy-${randomUUID()}`}, 'all', null,
          'Legacy public answer', 'public', true)
        returning id, media_id
      `;
      const legacy = await automations.findByAccountAndMedia(ownerIds[0]!, legacyRule!.media_id);
      expect(legacy?.triggerKind).toBe('comment');
      const legacyClaim = await executions.claimExecution({
        automationId: legacy!.id,
        mediaId: legacy!.mediaId,
        commenterInstagramId: 'same-sender',
        commenterUsername: null,
        commentText: 'Comment',
        instagramCommentId: sharedMessageId,
        deliveryChannel: 'public',
        messageText: 'Legacy public answer',
        leaseExpiresAt: new Date(now.getTime() + 120_000),
      });
      expect(legacyClaim).toMatchObject({ triggerKind: 'comment', replyWindowExpiresAt: null });
      const persisted = await sql<{ count: number }[]>`
        select count(*)::int as count from app_private.executions e
        join app_private.automations a on a.id=e.automation_id
        where a.connection_id = any(${ownerIds}::uuid[])
      `;
      expect(persisted[0]?.count).toBe(4);
    } finally {
      await peer.end({ timeout: 5 });
      if (ownerIds.length) {
        await sql.begin(async (tx) => {
          await tx`delete from app_private.executions where automation_id in
            (select id from app_private.automations where connection_id = any(${ownerIds}::uuid[]))`;
          await tx`delete from app_private.automations where connection_id = any(${ownerIds}::uuid[])`;
          await tx`delete from app_private.instagram_accounts where id = any(${ownerIds}::uuid[])`;
          await tx`delete from app_private.social_connections where id = any(${ownerIds}::uuid[])`;
          await tx`delete from app_private.login_identities where user_id = any(${ownerIds}::uuid[])`;
          await tx`delete from app_private.users where id = any(${ownerIds}::uuid[])`;
        });
      }
    }
  });

  it('persists private Story rules and preserves the original reply window across retries and follow-ups', async () => {
    const tokenProtector = new AesGcmTokenProtector(Buffer.alloc(32, 9).toString('base64'));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const option = { id: randomUUID(), title: 'Details', followUpText: 'Original Story follow-up' };
    try {
      await sql.begin(async (tx) => {
        const accounts = createPostgresAccountRepository(tx);
        const automations = createPostgresAutomationRepository(tx);
        const executions = createPostgresExecutionRepository(tx);
        const conversations = createPostgresDmConversationRepository(tx);
        const account = await accounts.upsertConnectedAccount({
          accessTokenCiphertext: tokenProtector.encrypt('story-test-token'),
          instagramUserId: `story-${randomUUID()}`,
          tokenExpiresAt: expiresAt,
          username: 'story_owner',
        });
        const ruleInput = {
          accountId: account.id,
          triggerKind: 'story_reply' as const,
          deliveryMode: 'private' as const,
          enabled: true,
          mediaId: `story-${randomUUID()}`,
          privateReplyText: 'Original Story response',
          quickReplyOptions: [option],
          replyText: '',
          triggerMode: 'all' as const,
          triggerText: null,
        };
        const rule = await automations.saveAutomation(ruleInput);
        expect(rule.triggerKind).toBe('story_reply');
        expect(
          (await automations.findByAccountAndMedia(account.id, rule.mediaId))?.triggerKind,
        ).toBe('story_reply');
        await expect(
          tx.savepoint(async (sp) =>
            createPostgresAutomationRepository(sp).saveAutomation({
              ...ruleInput,
              deliveryMode: 'both',
              replyText: 'Invalid public Story reply',
            }),
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint_name: 'automations_story_private_only',
        });
        const claimInput = {
          automationId: rule.id,
          triggerKind: 'story_reply' as const,
          replyWindowExpiresAt: expiresAt,
          mediaId: rule.mediaId,
          commenterInstagramId: 'story-recipient',
          commenterUsername: null,
          commentText: 'Tell me more',
          deliveryChannel: 'private' as const,
          instagramCommentId: `story-message-${randomUUID()}`,
          leaseExpiresAt: new Date(now.getTime() + 120_000),
          messageText: rule.privateReplyText!,
          quickReplyOptions: [option],
        };
        const execution = await executions.claimExecution(claimInput);
        expect(execution).toMatchObject({
          triggerKind: 'story_reply',
          replyWindowExpiresAt: expiresAt,
        });
        if (!execution?.leaseId) throw new Error('Story reply execution was not claimed');
        await expect(executions.claimExecution(claimInput)).resolves.toBeNull();
        await expect(
          tx.savepoint(async (sp) =>
            createPostgresExecutionRepository(sp).claimExecution({
              ...claimInput,
              instagramCommentId: `invalid-story-${randomUUID()}`,
              quickReplyOptions: [],
              deliveryChannel: 'public',
            }),
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint_name: 'executions_story_private_only',
        });
        await executions.markRetryPending(
          execution.id,
          execution.leaseId,
          { errorCode: 'RATE_LIMITED', errorMessage: 'Retry later', failureKind: 'retryable' },
          now,
        );
        await automations.saveAutomation({
          ...ruleInput,
          enabled: false,
          privateReplyText: 'Changed response',
          quickReplyOptions: [{ ...option, followUpText: 'Changed follow-up' }],
        });
        const retry = (
          await executions.claimDueRetries(
            new Date(now.getTime() + 1000),
            new Date(now.getTime() + 120_000),
            50,
          )
        ).find((entry) => entry.execution.id === execution.id);
        expect(retry?.execution).toMatchObject({
          triggerKind: 'story_reply',
          replyWindowExpiresAt: expiresAt,
          messageText: 'Original Story response',
          quickReplyOptions: [option],
          attemptCount: 2,
        });
        if (!retry?.execution.leaseId) throw new Error('Story retry was not leased');
        await executions.markSucceeded(
          execution.id,
          retry.execution.leaseId,
          'story-reply-provider-id',
          'story-recipient',
        );
        const answer = await conversations.recordInboundAnswer({
          accountId: account.id,
          providerMessageId: `story-answer-${randomUUID()}`,
          senderIgsid: 'story-recipient',
          text: 'Details',
          quickReplyPayload: `qr:${execution.id}:${option.id}`,
          sentAt: new Date(Date.now() + 1000),
          receivedAt: new Date(),
        });
        expect(answer).toMatchObject({
          answer: { executionId: execution.id, optionId: option.id },
          followup: { messageText: 'Original Story follow-up' },
        });
        expect(
          (await executions.listRecentByAccountId(account.id, 50, rule.mediaId))[0],
        ).toMatchObject({ triggerKind: 'story_reply', replyWindowExpiresAt: expiresAt });
        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) throw error;
    }
  });
});
