import postgres from 'postgres';

import type { ProtectedToken } from '../security/token-protector.js';
import type {
  AccountRepository,
  Automation,
  AutomationRepository,
  AuthenticatedSession,
  ClaimExecutionInput,
  CreateSessionInput,
  Execution,
  ExecutionFailure,
  ExecutionRepository,
  ExecutionStatus,
  InstagramAccount,
  SaveAutomationInput,
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

interface AutomationRow {
  account_id: string;
  created_at: Date;
  enabled: boolean;
  id: string;
  media_id: string;
  reply_text: string;
  trigger_text: '#Hello';
  updated_at: Date;
}

interface ExecutionRow {
  automation_id: string;
  comment_text: string;
  commenter_username: string | null;
  created_at: Date;
  error_code: string | null;
  error_message: string | null;
  id: string;
  instagram_comment_id: string;
  status: ExecutionStatus;
  updated_at: Date;
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

const toAutomation = (row: AutomationRow): Automation => ({
  accountId: row.account_id,
  createdAt: row.created_at,
  enabled: row.enabled,
  id: row.id,
  mediaId: row.media_id,
  replyText: row.reply_text,
  triggerText: row.trigger_text,
  updatedAt: row.updated_at,
});

const toExecution = (row: ExecutionRow): Execution => ({
  automationId: row.automation_id,
  commentText: row.comment_text,
  commenterUsername: row.commenter_username,
  createdAt: row.created_at,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  id: row.id,
  instagramCommentId: row.instagram_comment_id,
  status: row.status,
  updatedAt: row.updated_at,
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

/** Creates PostgreSQL-backed automation configuration persistence operations. */
export const createPostgresAutomationRepository = (
  sql: PostgresQueryClient,
): AutomationRepository => ({
  async findByAccountId(accountId): Promise<Automation | null> {
    const rows = await sql<AutomationRow[]>`
      select id, account_id, media_id, trigger_text, reply_text, enabled, created_at, updated_at
      from app_private.automations
      where account_id = ${accountId}
      limit 1
    `;

    return rows[0] ? toAutomation(rows[0]) : null;
  },

  async findEnabledByAccountAndMedia(accountId, mediaId): Promise<Automation | null> {
    const rows = await sql<AutomationRow[]>`
      select id, account_id, media_id, trigger_text, reply_text, enabled, created_at, updated_at
      from app_private.automations
      where account_id = ${accountId}
        and media_id = ${mediaId}
        and enabled = true
      limit 1
    `;

    return rows[0] ? toAutomation(rows[0]) : null;
  },

  async saveAutomation(input: SaveAutomationInput): Promise<Automation> {
    const rows = await sql<AutomationRow[]>`
      insert into app_private.automations (account_id, media_id, trigger_text, reply_text, enabled)
      values (${input.accountId}, ${input.mediaId}, '#Hello', ${input.replyText}, ${input.enabled})
      on conflict (account_id) do update
      set
        media_id = excluded.media_id,
        trigger_text = '#Hello',
        reply_text = excluded.reply_text,
        enabled = excluded.enabled
      returning id, account_id, media_id, trigger_text, reply_text, enabled, created_at, updated_at
    `;
    const automation = rows[0];

    if (!automation) {
      throw new Error('Automation save returned no row');
    }

    return toAutomation(automation);
  },
});

/** Creates PostgreSQL-backed execution and recent-activity persistence operations. */
export const createPostgresExecutionRepository = (
  sql: PostgresQueryClient,
): ExecutionRepository => ({
  async claimExecution(input: ClaimExecutionInput): Promise<Execution | null> {
    const rows = await sql<ExecutionRow[]>`
      insert into app_private.executions (
        automation_id,
        instagram_comment_id,
        commenter_username,
        comment_text,
        status
      ) values (
        ${input.automationId},
        ${input.instagramCommentId},
        ${input.commenterUsername},
        ${input.commentText},
        'processing'
      )
      on conflict (instagram_comment_id) do nothing
      returning
        id,
        automation_id,
        instagram_comment_id,
        commenter_username,
        comment_text,
        status,
        error_code,
        error_message,
        created_at,
        updated_at
    `;

    return rows[0] ? toExecution(rows[0]) : null;
  },

  async listRecentByAccountId(accountId, limit): Promise<Execution[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new RangeError('Execution activity limit must be an integer from 1 through 50');
    }

    const rows = await sql<ExecutionRow[]>`
      select
        execution.id,
        execution.automation_id,
        execution.instagram_comment_id,
        execution.commenter_username,
        execution.comment_text,
        execution.status,
        execution.error_code,
        execution.error_message,
        execution.created_at,
        execution.updated_at
      from app_private.executions as execution
      inner join app_private.automations as automation on automation.id = execution.automation_id
      where automation.account_id = ${accountId}
      order by execution.created_at desc, execution.id desc
      limit ${limit}
    `;

    return rows.map(toExecution);
  },

  async markFailed(executionId, failure: ExecutionFailure): Promise<Execution | null> {
    if (failure.errorCode.trim() === '' || failure.errorMessage.trim() === '') {
      throw new TypeError('Execution failure code and message must be non-empty');
    }

    const rows = await sql<ExecutionRow[]>`
      update app_private.executions
      set
        status = 'failed',
        error_code = ${failure.errorCode},
        error_message = ${failure.errorMessage}
      where id = ${executionId}
        and status = 'processing'
      returning
        id,
        automation_id,
        instagram_comment_id,
        commenter_username,
        comment_text,
        status,
        error_code,
        error_message,
        created_at,
        updated_at
    `;

    return rows[0] ? toExecution(rows[0]) : null;
  },

  async markSucceeded(executionId): Promise<Execution | null> {
    const rows = await sql<ExecutionRow[]>`
      update app_private.executions
      set
        status = 'succeeded',
        error_code = null,
        error_message = null
      where id = ${executionId}
        and status = 'processing'
      returning
        id,
        automation_id,
        instagram_comment_id,
        commenter_username,
        comment_text,
        status,
        error_code,
        error_message,
        created_at,
        updated_at
    `;

    return rows[0] ? toExecution(rows[0]) : null;
  },
});
