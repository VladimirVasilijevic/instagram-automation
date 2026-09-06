import postgres from 'postgres';

import type { ProtectedToken } from '../security/token-protector.js';
import type {
  AccountRepository,
  AuthenticatedSession,
  CreateSessionInput,
  InstagramAccount,
  Session,
  SessionRepository,
  UpsertConnectedAccountInput,
} from './repositories.js';

/** Postgres.js client accepted by repositories, including transaction-scoped clients used in tests. */
export type PostgresQueryClient = postgres.Sql | postgres.TransactionSql;

interface AccountRow {
  access_token_ciphertext: string;
  created_at: Date;
  id: string;
  instagram_user_id: string;
  token_expires_at: Date;
  updated_at: Date;
  username: string;
}

interface SessionRow {
  account_id: string;
  created_at: Date;
  expires_at: Date;
  id: string;
}

interface AuthenticatedSessionRow extends AccountRow {
  session_account_id: string;
  session_created_at: Date;
  session_expires_at: Date;
  session_id: string;
}

const toInstagramAccount = (row: AccountRow): InstagramAccount => ({
  accessTokenCiphertext: row.access_token_ciphertext as ProtectedToken,
  createdAt: row.created_at,
  id: row.id,
  instagramUserId: row.instagram_user_id,
  tokenExpiresAt: row.token_expires_at,
  updatedAt: row.updated_at,
  username: row.username,
});

const toSession = (row: SessionRow): Session => ({
  accountId: row.account_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  id: row.id,
});

/** Creates PostgreSQL-backed Instagram account persistence operations. */
export const createPostgresAccountRepository = (sql: PostgresQueryClient): AccountRepository => ({
  async findByInstagramUserId(instagramUserId): Promise<InstagramAccount | null> {
    const rows = await sql<AccountRow[]>`
      select
        id,
        instagram_user_id,
        username,
        access_token_ciphertext,
        token_expires_at,
        created_at,
        updated_at
      from app_private.instagram_accounts
      where instagram_user_id = ${instagramUserId}
      limit 1
    `;

    return rows[0] ? toInstagramAccount(rows[0]) : null;
  },

  async upsertConnectedAccount(input: UpsertConnectedAccountInput): Promise<InstagramAccount> {
    const rows = await sql<AccountRow[]>`
      insert into app_private.instagram_accounts (
        instagram_user_id,
        username,
        access_token_ciphertext,
        token_expires_at
      ) values (
        ${input.instagramUserId},
        ${input.username},
        ${input.accessTokenCiphertext},
        ${input.tokenExpiresAt}
      )
      on conflict (instagram_user_id) do update
      set
        username = excluded.username,
        access_token_ciphertext = excluded.access_token_ciphertext,
        token_expires_at = excluded.token_expires_at
      returning
        id,
        instagram_user_id,
        username,
        access_token_ciphertext,
        token_expires_at,
        created_at,
        updated_at
    `;
    const account = rows[0];

    if (!account) {
      throw new Error('Account upsert returned no row');
    }

    return toInstagramAccount(account);
  },
});

/** Creates PostgreSQL-backed application session persistence operations. */
export const createPostgresSessionRepository = (sql: PostgresQueryClient): SessionRepository => ({
  async createSession(input: CreateSessionInput): Promise<Session> {
    const rows = await sql<SessionRow[]>`
      insert into app_private.sessions (account_id, token_hash, expires_at)
      values (${input.accountId}, ${input.tokenHash}, ${input.expiresAt})
      returning id, account_id, expires_at, created_at
    `;
    const session = rows[0];

    if (!session) {
      throw new Error('Session insert returned no row');
    }

    return toSession(session);
  },

  async deleteByTokenHash(tokenHash): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
      delete from app_private.sessions
      where token_hash = ${tokenHash}
      returning id
    `;

    return rows.length > 0;
  },

  async findActiveByTokenHash(tokenHash): Promise<AuthenticatedSession | null> {
    const rows = await sql<AuthenticatedSessionRow[]>`
      select
        account.id,
        account.instagram_user_id,
        account.username,
        account.access_token_ciphertext,
        account.token_expires_at,
        account.created_at,
        account.updated_at,
        session.id as session_id,
        session.account_id as session_account_id,
        session.expires_at as session_expires_at,
        session.created_at as session_created_at
      from app_private.sessions as session
      inner join app_private.instagram_accounts as account on account.id = session.account_id
      where session.token_hash = ${tokenHash}
        and session.expires_at > now()
      limit 1
    `;
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      account: toInstagramAccount(row),
      session: toSession({
        account_id: row.session_account_id,
        created_at: row.session_created_at,
        expires_at: row.session_expires_at,
        id: row.session_id,
      }),
    };
  },
});
