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
  TokenRefreshRepository,
  UpsertConnectedAccountInput,
} from './repositories.js';

/** Postgres.js client accepted by repositories, including transaction-scoped clients used in tests. */
export type PostgresQueryClient = postgres.Sql | postgres.TransactionSql;

interface AccountRow {
  access_token_ciphertext: string;
  connection_status: 'active' | 'reconnect_required';
  created_at: Date;
  id: string;
  instagram_user_id: string;
  token_expires_at: Date;
  token_refresh_failure_code: string | null;
  token_refresh_last_succeeded_at: Date | null;
  token_refresh_next_attempt_at: Date | null;
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
  attempt_count: number;
  automation_id: string;
  comment_text: string;
  commenter_username: string | null;
  created_at: Date;
  dispatch_started_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  failure_kind: 'authentication' | 'permanent' | 'retryable' | 'uncertain' | null;
  id: string;
  instagram_comment_id: string;
  lease_expires_at: Date | null;
  lease_id: string | null;
  next_attempt_at: Date | null;
  provider_reply_id: string | null;
  status: ExecutionStatus;
  updated_at: Date;
}

interface ExecutionRetryRow extends ExecutionRow {
  account_id: string;
  access_token_ciphertext: string;
  reply_text: string;
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
  connectionStatus: row.connection_status,
  tokenExpiresAt: row.token_expires_at,
  tokenRefreshFailureCode: row.token_refresh_failure_code,
  tokenRefreshLastSucceededAt: row.token_refresh_last_succeeded_at,
  tokenRefreshNextAttemptAt: row.token_refresh_next_attempt_at,
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
  attemptCount: row.attempt_count,
  automationId: row.automation_id,
  commentText: row.comment_text,
  commenterUsername: row.commenter_username,
  createdAt: row.created_at,
  dispatchStartedAt: row.dispatch_started_at,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  failureKind: row.failure_kind,
  id: row.id,
  instagramCommentId: row.instagram_comment_id,
  leaseExpiresAt: row.lease_expires_at,
  leaseId: row.lease_id,
  nextAttemptAt: row.next_attempt_at,
  providerReplyId: row.provider_reply_id,
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
        connection_status,
        token_expires_at,
        token_refresh_last_succeeded_at,
        token_refresh_next_attempt_at,
        token_refresh_failure_code,
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
        token_expires_at = excluded.token_expires_at,
        connection_status = 'active',
        token_refresh_failure_code = null,
        token_refresh_next_attempt_at = null,
        token_refresh_lease_id = null,
        token_refresh_lease_until = null
      returning
        id,
        instagram_user_id,
        username,
        access_token_ciphertext,
        connection_status,
        token_expires_at,
        token_refresh_last_succeeded_at,
        token_refresh_next_attempt_at,
        token_refresh_failure_code,
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

/** Creates PostgreSQL-backed scheduled token lifecycle operations. */
export const createPostgresTokenRefreshRepository = (
  sql: PostgresQueryClient,
): TokenRefreshRepository => ({
  async claimExpiringAccounts(now, expiresBefore, leaseUntil, limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new RangeError('Token refresh batch limit must be from 1 through 50');
    const rows = await sql<(AccountRow & { token_refresh_lease_id: string })[]>`
      with candidates as (
        select id
        from app_private.instagram_accounts
        where connection_status = 'active'
          and token_expires_at > ${now}
          and token_expires_at <= ${expiresBefore}
          and (token_refresh_next_attempt_at is null or token_refresh_next_attempt_at <= ${now})
          and (token_refresh_lease_until is null or token_refresh_lease_until <= ${now})
        order by token_expires_at, id
        limit ${limit}
        for update skip locked
      )
      update app_private.instagram_accounts as account
      set
        token_refresh_lease_id = gen_random_uuid(),
        token_refresh_lease_until = ${leaseUntil}
      from candidates
      where account.id = candidates.id
      returning
        account.id,
        account.instagram_user_id,
        account.username,
        account.access_token_ciphertext,
        account.connection_status,
        account.token_expires_at,
        account.token_refresh_last_succeeded_at,
        account.token_refresh_next_attempt_at,
        account.token_refresh_failure_code,
        account.token_refresh_lease_id,
        account.created_at,
        account.updated_at
    `;
    return rows.map((row) => ({
      account: toInstagramAccount(row),
      leaseId: row.token_refresh_lease_id,
    }));
  },

  async completeTokenRefresh(accountId, leaseId, ciphertext, expiresAt, refreshedAt) {
    const rows = await sql<{ id: string }[]>`
      update app_private.instagram_accounts
      set
        access_token_ciphertext = ${ciphertext},
        token_expires_at = ${expiresAt},
        connection_status = 'active',
        token_refresh_last_succeeded_at = ${refreshedAt},
        token_refresh_next_attempt_at = null,
        token_refresh_failure_code = null,
        token_refresh_lease_id = null,
        token_refresh_lease_until = null
      where id = ${accountId} and token_refresh_lease_id = ${leaseId}
      returning id
    `;
    return rows.length === 1;
  },

  async failTokenRefresh(accountId, leaseId, failure) {
    const rows = await sql<{ id: string }[]>`
      update app_private.instagram_accounts
      set
        connection_status = ${failure.reconnectRequired ? 'reconnect_required' : 'active'},
        token_refresh_failure_code = ${failure.errorCode},
        token_refresh_next_attempt_at = ${failure.retryAt},
        token_refresh_lease_id = null,
        token_refresh_lease_until = null
      where id = ${accountId} and token_refresh_lease_id = ${leaseId}
      returning id
    `;
    return rows.length === 1;
  },

  async markExpiredAccountsReconnectRequired(now) {
    const rows = await sql<{ id: string }[]>`
      update app_private.instagram_accounts
      set
        connection_status = 'reconnect_required',
        token_refresh_failure_code = 'TOKEN_EXPIRED',
        token_refresh_next_attempt_at = null,
        token_refresh_lease_id = null,
        token_refresh_lease_until = null
      where connection_status = 'active' and token_expires_at <= ${now}
      returning id
    `;
    return rows.length;
  },

  async markAccountReconnectRequired(accountId, errorCode) {
    const rows = await sql<{ id: string }[]>`
      update app_private.instagram_accounts
      set connection_status = 'reconnect_required', token_refresh_failure_code = ${errorCode}
      where id = ${accountId}
      returning id
    `;
    return rows.length === 1;
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
        account.connection_status,
        account.token_expires_at,
        account.token_refresh_last_succeeded_at,
        account.token_refresh_next_attempt_at,
        account.token_refresh_failure_code,
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
        status,
        lease_id,
        lease_expires_at
      ) values (
        ${input.automationId},
        ${input.instagramCommentId},
        ${input.commenterUsername},
        ${input.commentText},
        'processing',
        gen_random_uuid(),
        ${input.leaseExpiresAt}
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
        attempt_count,
        next_attempt_at,
        lease_id,
        lease_expires_at,
        dispatch_started_at,
        provider_reply_id,
        failure_kind,
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
        execution.attempt_count,
        execution.next_attempt_at,
        execution.lease_id,
        execution.lease_expires_at,
        execution.dispatch_started_at,
        execution.provider_reply_id,
        execution.failure_kind,
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

  async claimDueRetries(now, leaseUntil, limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new RangeError('Execution retry batch limit must be from 1 through 50');
    const rows = await sql<ExecutionRetryRow[]>`
      with candidates as (
        select execution.id
        from app_private.executions as execution
        inner join app_private.automations as automation
          on automation.id = execution.automation_id
        inner join app_private.instagram_accounts as account
          on account.id = automation.account_id
        where account.connection_status = 'active'
          and execution.attempt_count < 3
          and (
            (
              execution.status = 'retry_pending'
              and execution.next_attempt_at <= ${now}
            )
            or (
              execution.status = 'processing'
              and execution.dispatch_started_at is null
              and execution.lease_expires_at <= ${now}
            )
          )
        order by coalesce(execution.next_attempt_at, execution.lease_expires_at), execution.id
        limit ${limit}
        for update of execution skip locked
      ), claimed as (
        update app_private.executions as execution
        set
          status = 'processing',
          attempt_count = execution.attempt_count + 1,
          next_attempt_at = null,
          lease_id = gen_random_uuid(),
          lease_expires_at = ${leaseUntil},
          dispatch_started_at = null,
          error_code = null,
          error_message = null,
          failure_kind = null
        from candidates
        where execution.id = candidates.id
        returning execution.*
      )
      select
        claimed.*,
        automation.account_id,
        automation.reply_text,
        account.access_token_ciphertext
      from claimed
      inner join app_private.automations as automation on automation.id = claimed.automation_id
      inner join app_private.instagram_accounts as account on account.id = automation.account_id
    `;
    return rows.map((row) => ({
      accountId: row.account_id,
      accessTokenCiphertext: row.access_token_ciphertext as ProtectedToken,
      execution: toExecution(row),
      replyText: row.reply_text,
    }));
  },

  async resolveStaleExecutions(now) {
    const rows = await sql<{ id: string }[]>`
      update app_private.executions
      set
        status = case when dispatch_started_at is not null then 'uncertain' else 'failed' end,
        failure_kind = case when dispatch_started_at is not null then 'uncertain' else 'permanent' end,
        error_code = case
          when dispatch_started_at is not null then 'DELIVERY_OUTCOME_UNKNOWN'
          else 'RETRY_ATTEMPTS_EXHAUSTED'
        end,
        error_message = case
          when dispatch_started_at is not null
            then 'Delivery requires manual review to prevent a duplicate reply.'
          else 'The public reply could not be sent after controlled recovery attempts.'
        end,
        lease_id = null,
        lease_expires_at = null
      where status = 'processing'
        and lease_expires_at <= ${now}
        and (dispatch_started_at is not null or attempt_count >= 3)
      returning id
    `;
    return rows.length;
  },

  async markDispatchStarted(executionId, leaseId, at) {
    const rows = await sql<{ id: string }[]>`
      update app_private.executions
      set dispatch_started_at = ${at}
      where id = ${executionId} and status = 'processing' and lease_id = ${leaseId}
      returning id
    `;
    return rows.length === 1;
  },

  async markFailed(executionId, leaseId, failure: ExecutionFailure): Promise<Execution | null> {
    if (failure.errorCode.trim() === '' || failure.errorMessage.trim() === '') {
      throw new TypeError('Execution failure code and message must be non-empty');
    }

    const rows = await sql<ExecutionRow[]>`
      update app_private.executions
      set
        status = 'failed',
        error_code = ${failure.errorCode},
        error_message = ${failure.errorMessage},
        failure_kind = ${failure.failureKind},
        next_attempt_at = null,
        lease_id = null,
        lease_expires_at = null
      where id = ${executionId}
        and status = 'processing'
        and lease_id = ${leaseId}
      returning
        id,
        automation_id,
        instagram_comment_id,
        commenter_username,
        comment_text,
        status,
        error_code,
        error_message,
        attempt_count,
        next_attempt_at,
        lease_id,
        lease_expires_at,
        dispatch_started_at,
        provider_reply_id,
        failure_kind,
        created_at,
        updated_at
    `;

    return rows[0] ? toExecution(rows[0]) : null;
  },

  async markRetryPending(executionId, leaseId, failure, retryAt) {
    if (failure.errorCode.trim() === '' || failure.errorMessage.trim() === '') {
      throw new TypeError('Execution failure code and message must be non-empty');
    }
    const rows = await sql<ExecutionRow[]>`
      update app_private.executions
      set
        status = 'retry_pending',
        error_code = ${failure.errorCode},
        error_message = ${failure.errorMessage},
        failure_kind = ${failure.failureKind},
        next_attempt_at = ${retryAt},
        lease_id = null,
        lease_expires_at = null,
        dispatch_started_at = null
      where id = ${executionId} and status = 'processing' and lease_id = ${leaseId}
      returning *
    `;
    return rows[0] ? toExecution(rows[0]) : null;
  },

  async markUncertain(executionId, leaseId, failure) {
    if (failure.errorCode.trim() === '' || failure.errorMessage.trim() === '') {
      throw new TypeError('Execution failure code and message must be non-empty');
    }
    const rows = await sql<ExecutionRow[]>`
      update app_private.executions
      set
        status = 'uncertain',
        error_code = ${failure.errorCode},
        error_message = ${failure.errorMessage},
        failure_kind = ${failure.failureKind},
        next_attempt_at = null,
        lease_id = null,
        lease_expires_at = null
      where id = ${executionId} and status = 'processing' and lease_id = ${leaseId}
      returning *
    `;
    return rows[0] ? toExecution(rows[0]) : null;
  },

  async markSucceeded(executionId, leaseId, providerReplyId): Promise<Execution | null> {
    if (providerReplyId.trim() === '') throw new TypeError('Provider reply ID must be non-empty');
    const rows = await sql<ExecutionRow[]>`
      update app_private.executions
      set
        status = 'succeeded',
        error_code = null,
        error_message = null,
        failure_kind = null,
        provider_reply_id = ${providerReplyId},
        next_attempt_at = null,
        lease_id = null,
        lease_expires_at = null
      where id = ${executionId}
        and status = 'processing'
        and lease_id = ${leaseId}
      returning
        id,
        automation_id,
        instagram_comment_id,
        commenter_username,
        comment_text,
        status,
        error_code,
        error_message,
        attempt_count,
        next_attempt_at,
        lease_id,
        lease_expires_at,
        dispatch_started_at,
        provider_reply_id,
        failure_kind,
        created_at,
        updated_at
    `;

    return rows[0] ? toExecution(rows[0]) : null;
  },
});
