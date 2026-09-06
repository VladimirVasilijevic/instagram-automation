import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AesGcmTokenProtector } from '../security/aes-gcm-token-protector.js';
import { createSessionToken } from '../security/session-token.js';
import {
  createPostgresAccountRepository,
  createPostgresSessionRepository,
} from './postgres-repositories.js';

const integrationTestsEnabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === 'true';

if (integrationTestsEnabled) {
  process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env.local'));
}

const describeDatabase = integrationTestsEnabled ? describe : describe.skip;

describeDatabase('PostgreSQL account and session repositories', () => {
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
});
