import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import {
  EXECUTION_STATUS,
  type DeliveryChannel,
  type DeliveryMode,
  type ExecutionStatus,
  type SocialProvider,
  type TriggerMode,
} from '@instagram-automation/contracts';
import { RECOVERY_KIND, type RecoveryKind } from '../automation/recovery.js';
import type { ProtectedToken } from '../security/token-protector.js';
import type {
  AccountRepository,
  Automation,
  AutomationRepository,
  AuthenticatedSession,
  ClaimExecutionInput,
  CreateSessionInput,
  DmConversationRepository,
  DmFollowup,
  DmFollowupClaim,
  DmFollowupStatus,
  Execution,
  ExecutionFailure,
  ExecutionRepository,
  InstagramAccount,
  InboundDmAnswer,
  MaintenanceCounts,
  MaintenanceHealth,
  MaintenanceHealthRepository,
  SaveAutomationInput,
  QuickReplyOption,
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
  account_id: string | null;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  id: string;
}

interface AutomationRow {
  connection_id: string;
  created_at: Date;
  delivery_mode: DeliveryMode;
  enabled: boolean;
  id: string;
  media_id: string;
  private_reply_text: string | null;
  quick_reply_options: QuickReplyOption[];
  reply_text: string;
  trigger_mode: TriggerMode;
  trigger_text: string | null;
  updated_at: Date;
}

interface ExecutionRow {
  attempt_count: number;
  automation_id: string;
  media_id: string | null;
  comment_text: string;
  commenter_instagram_id: string | null;
  commenter_username: string | null;
  created_at: Date;
  dispatch_started_at: Date | null;
  delivery_channel: DeliveryChannel;
  error_code: string | null;
  error_message: string | null;
  failure_kind: RecoveryKind | null;
  id: string;
  instagram_comment_id: string;
  lease_expires_at: Date | null;
  lease_id: string | null;
  message_text: string;
  next_attempt_at: Date | null;
  provider_reply_id: string | null;
  quick_reply_options: QuickReplyOption[];
  recipient_igsid: string | null;
  status: ExecutionStatus;
  updated_at: Date;
}

interface InboundDmAnswerRow {
  id: string;
  connection_id: string;
  execution_id: string | null;
  provider_message_id: string;
  sender_igsid: string;
  option_id: string | null;
  text: string | null;
  sent_at: Date;
  received_at: Date;
}

interface InboundDmAnswerActivityRow extends InboundDmAnswerRow {
  choice_title: string | null;
  commenter_username: string | null;
  media_id: string | null;
}

interface DmFollowupRow {
  id: string;
  connection_id: string;
  answer_id: string;
  recipient_igsid: string;
  message_text: string;
  expires_at: Date;
  status: DmFollowupStatus;
  attempt_count: number;
  next_attempt_at: Date | null;
  lease_id: string | null;
  lease_expires_at: Date | null;
  dispatch_started_at: Date | null;
  provider_reply_id: string | null;
  failure_kind: RecoveryKind | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DmFollowupClaimRow extends DmFollowupRow {
  access_token_ciphertext: string;
  provider: SocialProvider;
  external_account_id: string;
}

interface ExecutionRetryRow extends ExecutionRow {
  connection_id: string;
  access_token_ciphertext: string;
  provider: SocialProvider;
  external_account_id: string;
}

interface MaintenanceHealthRow {
  checked_at: Date;
  expired_token_count: number;
  last_failed_at: Date | null;
  last_failure_code: string | null;
  last_succeeded_at: Date | null;
  reconnect_required_count: number;
  reply_failed_count: number;
  reply_retry_pending_count: number;
  reply_succeeded_count: number;
  reply_uncertain_count: number;
  stale_execution_count: number;
  token_refresh_failed_count: number;
  token_refreshed_count: number;
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
  userId: row.user_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  id: row.id,
});

const toAutomation = (row: AutomationRow): Automation => ({
  accountId: row.connection_id,
  createdAt: row.created_at,
  deliveryMode: row.delivery_mode,
  enabled: row.enabled,
  id: row.id,
  mediaId: row.media_id,
  privateReplyText: row.private_reply_text,
  quickReplyOptions: row.quick_reply_options,
  replyText: row.reply_text,
  triggerMode: row.trigger_mode,
  triggerText: row.trigger_text,
  updatedAt: row.updated_at,
});

const toExecution = (row: ExecutionRow): Execution => ({
  attemptCount: row.attempt_count,
  automationId: row.automation_id,
  mediaId: row.media_id,
  commentText: row.comment_text,
  commenterInstagramId: row.commenter_instagram_id,
  commenterUsername: row.commenter_username,
  createdAt: row.created_at,
  dispatchStartedAt: row.dispatch_started_at,
  deliveryChannel: row.delivery_channel,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  failureKind: row.failure_kind,
  id: row.id,
  instagramCommentId: row.instagram_comment_id,
  leaseExpiresAt: row.lease_expires_at,
  leaseId: row.lease_id,
  messageText: row.message_text,
  nextAttemptAt: row.next_attempt_at,
  providerReplyId: row.provider_reply_id,
  quickReplyOptions: row.quick_reply_options,
  recipientIgsid: row.recipient_igsid,
  status: row.status,
  updatedAt: row.updated_at,
});

const toInboundDmAnswer = (row: InboundDmAnswerRow): InboundDmAnswer => ({
  id: row.id,
  accountId: row.connection_id,
  executionId: row.execution_id,
  providerMessageId: row.provider_message_id,
  senderIgsid: row.sender_igsid,
  optionId: row.option_id,
  text: row.text,
  sentAt: row.sent_at,
  receivedAt: row.received_at,
});

const toDmFollowup = (row: DmFollowupRow): DmFollowup => ({
  id: row.id,
  accountId: row.connection_id,
  answerId: row.answer_id,
  recipientIgsid: row.recipient_igsid,
  messageText: row.message_text,
  expiresAt: row.expires_at,
  status: row.status,
  attemptCount: row.attempt_count,
  nextAttemptAt: row.next_attempt_at,
  leaseId: row.lease_id,
  leaseExpiresAt: row.lease_expires_at,
  dispatchStartedAt: row.dispatch_started_at,
  providerReplyId: row.provider_reply_id,
  failureKind: row.failure_kind,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toDmFollowupClaim = (row: DmFollowupClaimRow): DmFollowupClaim => ({
  followup: toDmFollowup(row),
  accessTokenCiphertext: row.access_token_ciphertext as ProtectedToken,
  provider: row.provider,
  connectionId: row.connection_id,
  externalAccountId: row.external_account_id,
  instagramUserId: row.external_account_id,
});

const toMaintenanceHealth = (row: MaintenanceHealthRow): MaintenanceHealth => ({
  checkedAt: row.checked_at,
  expiredTokenCount: row.expired_token_count,
  lastFailedAt: row.last_failed_at,
  lastFailureCode: row.last_failure_code,
  lastSucceededAt: row.last_succeeded_at,
  reconnectRequiredCount: row.reconnect_required_count,
  replyFailedCount: row.reply_failed_count,
  replyRetryPendingCount: row.reply_retry_pending_count,
  replySucceededCount: row.reply_succeeded_count,
  replyUncertainCount: row.reply_uncertain_count,
  staleExecutionCount: row.stale_execution_count,
  tokenRefreshFailedCount: row.token_refresh_failed_count,
  tokenRefreshedCount: row.token_refreshed_count,
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
    const upsert = async (tx: PostgresQueryClient): Promise<InstagramAccount> => {
      await tx`
        select pg_advisory_xact_lock(hashtextextended(${`instagram:${input.instagramUserId}`}, 0))
      `;
      const existing = await tx<{ id: string; user_id: string }[]>`
        select id, user_id from app_private.social_connections
        where provider = 'instagram' and external_account_id = ${input.instagramUserId}
        for update
      `;
      let connectionId = existing[0]?.id;
      let userId = existing[0]?.user_id;
      if (!connectionId || !userId) {
        const legacy = await tx<{ id: string }[]>`
          select id from app_private.instagram_accounts
          where instagram_user_id = ${input.instagramUserId}
        `;
        connectionId = legacy[0]?.id ?? randomUUID();
        userId = connectionId;
        await tx`
          insert into app_private.users (id) values (${userId}) on conflict (id) do nothing
        `;
        await tx`
          insert into app_private.social_connections
            (id, user_id, provider, external_account_id, display_name)
          values (${connectionId}, ${userId}, 'instagram', ${input.instagramUserId}, ${input.username})
        `;
      } else {
        await tx`
          update app_private.social_connections
          set display_name = ${input.username}, connection_status = 'active',
            connection_failure_code = null
          where id = ${connectionId}
        `;
      }
      const identities = await tx<{ id: string }[]>`
        insert into app_private.login_identities
          (user_id, provider, external_user_id, display_name)
        values (${userId}, 'instagram', ${input.instagramUserId}, ${input.username})
        on conflict (provider, external_user_id) do update
          set display_name = excluded.display_name
          where login_identities.user_id = excluded.user_id
        returning id
      `;
      if (!identities[0]) throw new Error('Instagram identity owner mismatch');
      const rows = await tx<AccountRow[]>`
        insert into app_private.instagram_accounts (
          id, instagram_user_id, username, access_token_ciphertext, token_expires_at
        ) values (
          ${connectionId}, ${input.instagramUserId}, ${input.username},
          ${input.accessTokenCiphertext}, ${input.tokenExpiresAt}
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
        returning id, instagram_user_id, username, access_token_ciphertext,
          connection_status, token_expires_at, token_refresh_last_succeeded_at,
          token_refresh_next_attempt_at, token_refresh_failure_code, created_at, updated_at
      `;
      const account = rows[0];
      if (!account || account.id !== connectionId) {
        throw new Error('Instagram account and social connection differ');
      }
      return toInstagramAccount(account);
    };
    const connection = sql as postgres.Sql;
    return typeof connection.begin === 'function' ? connection.begin(upsert) : upsert(sql);
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

/** Creates PostgreSQL-backed durable maintenance heartbeat persistence. */
export const createPostgresMaintenanceHealthRepository = (
  sql: PostgresQueryClient,
): MaintenanceHealthRepository => ({
  async getHealth() {
    const rows = await sql<MaintenanceHealthRow[]>`
      select
        clock_timestamp() as checked_at,
        last_succeeded_at,
        last_failed_at,
        last_failure_code,
        expired_token_count,
        reconnect_required_count,
        reply_failed_count,
        reply_retry_pending_count,
        reply_succeeded_count,
        reply_uncertain_count,
        stale_execution_count,
        token_refresh_failed_count,
        token_refreshed_count
      from app_private.maintenance_health
      where singleton = true
    `;
    return rows[0] ? toMaintenanceHealth(rows[0]) : null;
  },

  async recordFailure(errorCode) {
    if (errorCode.trim() === '') throw new TypeError('Maintenance failure code must be non-empty');
    await sql`
      insert into app_private.maintenance_health (
        singleton,
        last_failed_at,
        last_failure_code
      ) values (true, clock_timestamp(), ${errorCode})
      on conflict (singleton) do update set
        last_failed_at = excluded.last_failed_at,
        last_failure_code = excluded.last_failure_code
    `;
  },

  async recordSuccess(counts: MaintenanceCounts) {
    await sql`
      insert into app_private.maintenance_health (
        singleton,
        last_succeeded_at,
        expired_token_count,
        reconnect_required_count,
        reply_failed_count,
        reply_retry_pending_count,
        reply_succeeded_count,
        reply_uncertain_count,
        stale_execution_count,
        token_refresh_failed_count,
        token_refreshed_count
      ) values (
        true,
        clock_timestamp(),
        ${counts.expiredTokenCount},
        ${counts.reconnectRequiredCount},
        ${counts.replyFailedCount},
        ${counts.replyRetryPendingCount},
        ${counts.replySucceededCount},
        ${counts.replyUncertainCount},
        ${counts.staleExecutionCount},
        ${counts.tokenRefreshFailedCount},
        ${counts.tokenRefreshedCount}
      )
      on conflict (singleton) do update set
        last_succeeded_at = excluded.last_succeeded_at,
        expired_token_count = excluded.expired_token_count,
        reconnect_required_count = excluded.reconnect_required_count,
        reply_failed_count = excluded.reply_failed_count,
        reply_retry_pending_count = excluded.reply_retry_pending_count,
        reply_succeeded_count = excluded.reply_succeeded_count,
        reply_uncertain_count = excluded.reply_uncertain_count,
        stale_execution_count = excluded.stale_execution_count,
        token_refresh_failed_count = excluded.token_refresh_failed_count,
        token_refreshed_count = excluded.token_refreshed_count
    `;
  },
});

/** Creates PostgreSQL-backed application session persistence operations. */
export const createPostgresSessionRepository = (sql: PostgresQueryClient): SessionRepository => ({
  async createSession(input: CreateSessionInput): Promise<Session> {
    const users = input.userId
      ? [{ id: input.userId }]
      : await sql<{ id: string }[]>`
          select user_id as id from app_private.social_connections
          where id = ${input.accountId ?? null}
          limit 1
        `;
    const userId = users[0]?.id;
    if (!userId) throw new Error('Session requires an existing user');
    const rows = await sql<SessionRow[]>`
      insert into app_private.sessions (user_id, account_id, token_hash, expires_at)
      values (${userId}, ${input.accountId ?? null}, ${input.tokenHash}, ${input.expiresAt})
      returning id, user_id, account_id, expires_at, created_at
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
    const rows = await sql<(SessionRow & { user_created_at: Date })[]>`
      select
        session.id, session.user_id, session.account_id,
        session.expires_at, session.created_at,
        app_user.created_at as user_created_at
      from app_private.sessions as session
      inner join app_private.users as app_user on app_user.id = session.user_id
      where session.token_hash = ${tokenHash}
        and session.expires_at > now()
      limit 1
    `;
    const row = rows[0];

    if (!row) {
      return null;
    }

    const connections = await sql<
      {
        id: string;
        user_id: string;
        provider: 'instagram' | 'facebook';
        external_account_id: string;
        display_name: string;
        connection_status: 'active' | 'reconnect_required';
      }[]
    >`
      select id, user_id, provider, external_account_id, display_name, connection_status
      from app_private.social_connections
      where user_id = ${row.user_id}
      order by case when id = ${row.account_id} then 0 else 1 end, created_at, id
      limit 1
    `;
    const selected = connections[0];
    const accountRows =
      selected?.provider === 'instagram'
        ? await sql<AccountRow[]>`
          select id, instagram_user_id, username, access_token_ciphertext,
            connection_status, token_expires_at, token_refresh_last_succeeded_at,
            token_refresh_next_attempt_at, token_refresh_failure_code, created_at, updated_at
          from app_private.instagram_accounts where id = ${selected.id}
          limit 1
        `
        : [];
    return {
      user: { id: row.user_id, createdAt: row.user_created_at },
      session: toSession(row),
      connection: selected
        ? {
            id: selected.id,
            userId: selected.user_id,
            provider: selected.provider,
            externalAccountId: selected.external_account_id,
            displayName: selected.display_name,
            connectionStatus: selected.connection_status,
          }
        : null,
      account: accountRows[0] ? toInstagramAccount(accountRows[0]) : null,
    };
  },
});

/** Creates PostgreSQL-backed automation configuration persistence operations. */
export const createPostgresAutomationRepository = (
  sql: PostgresQueryClient,
): AutomationRepository => ({
  async findByAccountId(accountId): Promise<Automation | null> {
    const rows = await sql<AutomationRow[]>`
      select id, connection_id, media_id, trigger_mode, trigger_text, delivery_mode, reply_text,
        private_reply_text, quick_reply_options, enabled, created_at, updated_at
      from app_private.automations
      where connection_id = ${accountId}
      limit 1
    `;

    return rows[0] ? toAutomation(rows[0]) : null;
  },

  async findEnabledByAccountAndMedia(accountId, mediaId): Promise<Automation | null> {
    const rows = await sql<AutomationRow[]>`
      select id, connection_id, media_id, trigger_mode, trigger_text, delivery_mode, reply_text,
        private_reply_text, quick_reply_options, enabled, created_at, updated_at
      from app_private.automations
      where connection_id = ${accountId}
        and media_id = ${mediaId}
        and enabled = true
      limit 1
    `;

    return rows[0] ? toAutomation(rows[0]) : null;
  },

  async saveAutomation(input: SaveAutomationInput): Promise<Automation> {
    const rows = await sql<AutomationRow[]>`
      insert into app_private.automations (
        account_id, connection_id, media_id, trigger_mode, trigger_text, delivery_mode, reply_text,
        private_reply_text, quick_reply_options, enabled
      ) values (
        (select id from app_private.instagram_accounts where id = ${input.accountId}),
        ${input.accountId}, ${input.mediaId}, ${input.triggerMode}, ${input.triggerText},
        ${input.deliveryMode}, ${input.replyText}, ${input.privateReplyText},
        ${sql.json(input.quickReplyOptions ?? [])}, ${input.enabled}
      )
      on conflict (connection_id) do update
      set
        media_id = excluded.media_id,
        trigger_mode = excluded.trigger_mode,
        trigger_text = excluded.trigger_text,
        delivery_mode = excluded.delivery_mode,
        reply_text = excluded.reply_text,
        private_reply_text = excluded.private_reply_text,
        quick_reply_options = excluded.quick_reply_options,
        enabled = excluded.enabled
      returning id, connection_id, media_id, trigger_mode, trigger_text, delivery_mode, reply_text,
        private_reply_text, quick_reply_options, enabled, created_at, updated_at
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
  async claimExecutions(inputs): Promise<Execution[]> {
    if (inputs.length < 1 || inputs.length > 2) {
      throw new RangeError('Execution claim must contain one or two delivery channels');
    }
    const payload = inputs.map((input) => ({
      automation_id: input.automationId,
      media_id: input.mediaId,
      comment_text: input.commentText,
      commenter_instagram_id: input.commenterInstagramId,
      commenter_username: input.commenterUsername,
      delivery_channel: input.deliveryChannel,
      instagram_comment_id: input.instagramCommentId,
      lease_expires_at: input.leaseExpiresAt.toISOString(),
      message_text: input.messageText,
      quick_reply_options: input.quickReplyOptions ?? [],
    }));
    const rows = await sql<ExecutionRow[]>`
      insert into app_private.executions (
        automation_id,
        media_id,
        instagram_comment_id,
        delivery_channel,
        message_text,
        quick_reply_options,
        commenter_instagram_id,
        commenter_username,
        comment_text,
        status,
        lease_id,
        lease_expires_at
      )
      select
        requested.automation_id,
        requested.media_id,
        requested.instagram_comment_id,
        requested.delivery_channel,
        requested.message_text,
        requested.quick_reply_options,
        requested.commenter_instagram_id,
        requested.commenter_username,
        requested.comment_text,
        ${EXECUTION_STATUS.PROCESSING},
        gen_random_uuid(),
        requested.lease_expires_at
      from jsonb_to_recordset(${sql.json(payload)}::jsonb) as requested(
        automation_id uuid,
        media_id text,
        instagram_comment_id text,
        delivery_channel text,
        message_text text,
        quick_reply_options jsonb,
        commenter_instagram_id text,
        commenter_username text,
        comment_text text,
        lease_expires_at timestamptz
      )
      on conflict (automation_id, instagram_comment_id, delivery_channel) do nothing
      returning *
    `;
    return rows.map(toExecution);
  },

  async claimExecution(input: ClaimExecutionInput): Promise<Execution | null> {
    const rows = await sql<ExecutionRow[]>`
      insert into app_private.executions (
        automation_id,
        media_id,
        instagram_comment_id,
        delivery_channel,
        message_text,
        quick_reply_options,
        commenter_instagram_id,
        commenter_username,
        comment_text,
        status,
        lease_id,
        lease_expires_at
      ) values (
        ${input.automationId},
        ${input.mediaId},
        ${input.instagramCommentId},
        ${input.deliveryChannel},
        ${input.messageText},
        ${sql.json(input.quickReplyOptions ?? [])},
        ${input.commenterInstagramId},
        ${input.commenterUsername},
        ${input.commentText},
        ${EXECUTION_STATUS.PROCESSING},
        gen_random_uuid(),
        ${input.leaseExpiresAt}
      )
      on conflict (automation_id, instagram_comment_id, delivery_channel) do nothing
      returning *
    `;

    return rows[0] ? toExecution(rows[0]) : null;
  },

  async listRecentByAccountId(accountId, limit, mediaId): Promise<Execution[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new RangeError('Execution activity limit must be an integer from 1 through 50');
    }

    const rows = await sql<ExecutionRow[]>`
      with recent_comments as (
        select execution.instagram_comment_id, max(execution.created_at) as created_at
        from app_private.executions as execution
        inner join app_private.automations as automation on automation.id = execution.automation_id
        where automation.connection_id = ${accountId}
          and (${mediaId ?? null}::text is null or execution.media_id = ${mediaId ?? null})
        group by execution.instagram_comment_id
        order by created_at desc, execution.instagram_comment_id desc
        limit ${limit}
      )
      select
        execution.*
      from app_private.executions as execution
      inner join app_private.automations as automation on automation.id = execution.automation_id
      inner join recent_comments on recent_comments.instagram_comment_id = execution.instagram_comment_id
      where automation.connection_id = ${accountId}
        and (${mediaId ?? null}::text is null or execution.media_id = ${mediaId ?? null})
      order by recent_comments.created_at desc, execution.instagram_comment_id desc,
        execution.delivery_channel desc
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
        inner join app_private.social_connections as connection
          on connection.id = automation.connection_id
        left join app_private.instagram_accounts as instagram
          on instagram.id = connection.id and connection.provider = 'instagram'
        left join app_private.facebook_pages as page
          on page.connection_id = connection.id and connection.provider = 'facebook'
        where (
            (connection.provider = 'instagram' and instagram.connection_status = 'active')
            or (connection.provider = 'facebook' and connection.connection_status = 'active'
              and page.connection_id is not null)
          )
          and execution.attempt_count < 3
          and (
            (
              execution.status = ${EXECUTION_STATUS.RETRY_PENDING}
              and execution.next_attempt_at <= ${now}
            )
            or (
              execution.status = ${EXECUTION_STATUS.PROCESSING}
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
          status = ${EXECUTION_STATUS.PROCESSING},
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
        connection.id as connection_id,
        connection.provider,
        connection.external_account_id,
        coalesce(instagram.access_token_ciphertext, page.access_token_ciphertext)
          as access_token_ciphertext
      from claimed
      inner join app_private.automations as automation on automation.id = claimed.automation_id
      inner join app_private.social_connections as connection
        on connection.id = automation.connection_id
      left join app_private.instagram_accounts as instagram
        on instagram.id = connection.id and connection.provider = 'instagram'
      left join app_private.facebook_pages as page
        on page.connection_id = connection.id and connection.provider = 'facebook'
    `;
    return rows.map((row) => ({
      accountId: row.connection_id,
      connectionId: row.connection_id,
      provider: row.provider,
      externalAccountId: row.external_account_id,
      accessTokenCiphertext: row.access_token_ciphertext as ProtectedToken,
      execution: toExecution(row),
      instagramUserId: row.external_account_id,
    }));
  },

  async resolveStaleExecutions(now) {
    const rows = await sql<{ id: string }[]>`
      update app_private.executions
      set
        status = case
          when dispatch_started_at is not null then ${EXECUTION_STATUS.UNCERTAIN}
          else ${EXECUTION_STATUS.FAILED}
        end,
        failure_kind = case
          when dispatch_started_at is not null then ${RECOVERY_KIND.UNCERTAIN}
          else ${RECOVERY_KIND.PERMANENT}
        end,
        error_code = case
          when dispatch_started_at is not null then 'DELIVERY_OUTCOME_UNKNOWN'
          else 'RETRY_ATTEMPTS_EXHAUSTED'
        end,
        error_message = case
          when dispatch_started_at is not null
            then 'Delivery requires manual review to prevent a duplicate reply.'
          else 'The reply could not be sent after controlled recovery attempts.'
        end,
        lease_id = null,
        lease_expires_at = null
      where status = ${EXECUTION_STATUS.PROCESSING}
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
      where id = ${executionId} and status = ${EXECUTION_STATUS.PROCESSING}
        and lease_id = ${leaseId}
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
        status = ${EXECUTION_STATUS.FAILED},
        error_code = ${failure.errorCode},
        error_message = ${failure.errorMessage},
        failure_kind = ${failure.failureKind},
        next_attempt_at = null,
        lease_id = null,
        lease_expires_at = null
      where id = ${executionId}
        and status = ${EXECUTION_STATUS.PROCESSING}
        and lease_id = ${leaseId}
      returning *
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
        status = ${EXECUTION_STATUS.RETRY_PENDING},
        error_code = ${failure.errorCode},
        error_message = ${failure.errorMessage},
        failure_kind = ${failure.failureKind},
        next_attempt_at = ${retryAt},
        lease_id = null,
        lease_expires_at = null,
        dispatch_started_at = null
      where id = ${executionId} and status = ${EXECUTION_STATUS.PROCESSING}
        and lease_id = ${leaseId}
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
        status = ${EXECUTION_STATUS.UNCERTAIN},
        error_code = ${failure.errorCode},
        error_message = ${failure.errorMessage},
        failure_kind = ${failure.failureKind},
        next_attempt_at = null,
        lease_id = null,
        lease_expires_at = null
      where id = ${executionId} and status = ${EXECUTION_STATUS.PROCESSING}
        and lease_id = ${leaseId}
      returning *
    `;
    return rows[0] ? toExecution(rows[0]) : null;
  },

  async markSucceeded(
    executionId,
    leaseId,
    providerReplyId,
    recipientIgsid,
  ): Promise<Execution | null> {
    if (providerReplyId.trim() === '') throw new TypeError('Provider reply ID must be non-empty');
    const rows = await sql<ExecutionRow[]>`
      update app_private.executions
      set
        status = ${EXECUTION_STATUS.SUCCEEDED},
        error_code = null,
        error_message = null,
        failure_kind = null,
        provider_reply_id = ${providerReplyId},
        recipient_igsid = ${recipientIgsid ?? null},
        next_attempt_at = null,
        lease_id = null,
        lease_expires_at = null
      where id = ${executionId}
        and status = ${EXECUTION_STATUS.PROCESSING}
        and lease_id = ${leaseId}
      returning *
    `;

    return rows[0] ? toExecution(rows[0]) : null;
  },
});

/** Creates durable persistence for incoming Instagram answers and their one-step branch messages. */
export const createPostgresDmConversationRepository = (
  sql: PostgresQueryClient,
): DmConversationRepository => ({
  async recordInboundAnswer(input) {
    const alreadyRecorded = await sql<InboundDmAnswerRow[]>`
      select * from app_private.inbound_dm_answers
      where connection_id = ${input.accountId}
        and provider_message_id = ${input.providerMessageId}
      limit 1
    `;
    if (alreadyRecorded[0]) {
      const followups = await sql<DmFollowupRow[]>`
        select * from app_private.dm_followups where answer_id = ${alreadyRecorded[0].id} limit 1
      `;
      return {
        answer: toInboundDmAnswer(alreadyRecorded[0]),
        followup: followups[0] ? toDmFollowup(followups[0]) : null,
        duplicate: true,
      };
    }
    const pendingPrompts = await sql<{ id: string }[]>`
      select execution.id
      from app_private.executions as execution
      inner join app_private.automations as automation on automation.id = execution.automation_id
      where automation.connection_id = ${input.accountId}
        and execution.delivery_channel = 'private'
        and execution.status = ${EXECUTION_STATUS.SUCCEEDED}
        and execution.recipient_igsid = ${input.senderIgsid}
        and execution.quick_reply_options <> '[]'::jsonb
        and (
          ${input.quickReplyPayload}::text is not null
          or (
            ${input.text}::text is not null
            and ${input.sentAt} >= coalesce(execution.dispatch_started_at, execution.updated_at)
            and ${input.sentAt} <
              coalesce(execution.dispatch_started_at, execution.updated_at) + interval '24 hours'
          )
        )
        and not exists (
          select 1 from app_private.inbound_dm_answers as answer
          where answer.execution_id = execution.id
        )
      limit 1
    `;
    if (pendingPrompts.length === 0) return null;
    const match = input.quickReplyPayload?.match(
      /^qr:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    );
    const executionId = match?.[1] ?? null;
    const optionId = match?.[2] ?? null;
    const rows = await sql<InboundDmAnswerRow[]>`
      with possible as (
        select execution.id, execution.quick_reply_options,
          count(*) over () as match_count
        from app_private.executions as execution
        inner join app_private.automations as automation on automation.id = execution.automation_id
        where automation.connection_id = ${input.accountId}
          and execution.delivery_channel = 'private'
          and execution.status = ${EXECUTION_STATUS.SUCCEEDED}
          and execution.recipient_igsid = ${input.senderIgsid}
          and execution.quick_reply_options <> '[]'::jsonb
          and not exists (
            select 1 from app_private.inbound_dm_answers as answer
            where answer.execution_id = execution.id
          )
          and (
            (
              ${executionId}::uuid is not null
              and execution.id = ${executionId}::uuid
              and exists (
                select 1 from jsonb_array_elements(execution.quick_reply_options) as option_value
                where option_value->>'id' = ${optionId}
              )
            )
            or (
              ${input.quickReplyPayload}::text is null
              and ${input.text}::text is not null
              and ${input.sentAt} >= coalesce(execution.dispatch_started_at, execution.updated_at)
              and ${input.sentAt} <
                coalesce(execution.dispatch_started_at, execution.updated_at) + interval '24 hours'
            )
          )
      ), selected as (
        select id from possible where match_count = 1
      ), inserted as (
        insert into app_private.inbound_dm_answers (
          account_id, connection_id, execution_id, provider_message_id, sender_igsid,
          option_id, text, sent_at, received_at
        ) values (
          (select id from app_private.instagram_accounts where id = ${input.accountId}),
          ${input.accountId},
          (select id from selected),
          ${input.providerMessageId},
          ${input.senderIgsid},
          case when (select id from selected) is not null then ${optionId}::uuid else null end,
          ${input.text},
          ${input.sentAt},
          ${input.receivedAt}
        )
        on conflict do nothing
        returning *
      ), queued as (
        insert into app_private.dm_followups (
          account_id, connection_id, answer_id, recipient_igsid, message_text, expires_at
        )
        select answer.account_id, answer.connection_id, answer.id, answer.sender_igsid,
          option_value->>'followUpText', answer.sent_at + interval '24 hours'
        from inserted as answer
        inner join app_private.executions as execution on execution.id = answer.execution_id
        cross join lateral jsonb_array_elements(execution.quick_reply_options) as option_value
        where answer.option_id is not null
          and option_value->>'id' = answer.option_id::text
        on conflict (answer_id) do nothing
        returning id
      )
      select * from inserted
    `;
    let answer = rows[0];
    let duplicate = false;
    if (!answer) {
      const existing = await sql<InboundDmAnswerRow[]>`
        select * from app_private.inbound_dm_answers
        where connection_id = ${input.accountId}
          and provider_message_id = ${input.providerMessageId}
        limit 1
      `;
      answer = existing[0];
      duplicate = answer !== undefined;
    }
    if (!answer) {
      const unmatched = await sql<InboundDmAnswerRow[]>`
        insert into app_private.inbound_dm_answers (
          account_id, connection_id, provider_message_id, sender_igsid, text, sent_at, received_at
        ) values (
          (select id from app_private.instagram_accounts where id = ${input.accountId}),
          ${input.accountId}, ${input.providerMessageId}, ${input.senderIgsid},
          ${input.text}, ${input.sentAt}, ${input.receivedAt}
        )
        on conflict (connection_id, provider_message_id) do nothing
        returning *
      `;
      answer = unmatched[0];
    }
    if (!answer) {
      const existing = await sql<InboundDmAnswerRow[]>`
        select * from app_private.inbound_dm_answers
        where connection_id = ${input.accountId}
          and provider_message_id = ${input.providerMessageId}
        limit 1
      `;
      answer = existing[0];
      duplicate = true;
    }
    if (!answer) throw new Error('Inbound DM answer was not persisted');
    const followupRows = await sql<DmFollowupRow[]>`
      select * from app_private.dm_followups where answer_id = ${answer.id} limit 1
    `;
    return {
      answer: toInboundDmAnswer(answer),
      followup: followupRows[0] ? toDmFollowup(followupRows[0]) : null,
      duplicate,
    };
  },

  async claimFollowup(id, now, leaseUntil) {
    const rows = await sql<DmFollowupClaimRow[]>`
      with candidate as (
        select followup.id
        from app_private.dm_followups as followup
        inner join app_private.social_connections as connection
          on connection.id = followup.connection_id
        left join app_private.instagram_accounts as instagram
          on instagram.id = connection.id and connection.provider = 'instagram'
        left join app_private.facebook_pages as page
          on page.connection_id = connection.id and connection.provider = 'facebook'
        where followup.id = ${id}
          and followup.status = 'pending'
          and followup.expires_at > ${leaseUntil}
          and (
            (connection.provider = 'instagram' and instagram.connection_status = 'active')
            or (connection.provider = 'facebook' and connection.connection_status = 'active'
              and page.connection_id is not null)
          )
        for update of followup skip locked
      ), claimed as (
        update app_private.dm_followups as followup
        set status = ${EXECUTION_STATUS.PROCESSING},
          attempt_count = followup.attempt_count + 1,
          lease_id = gen_random_uuid(), lease_expires_at = ${leaseUntil},
          dispatch_started_at = null
        from candidate
        where followup.id = candidate.id
        returning followup.*
      )
      select claimed.*, connection.provider, connection.external_account_id,
        coalesce(instagram.access_token_ciphertext, page.access_token_ciphertext)
          as access_token_ciphertext
      from claimed
      inner join app_private.social_connections as connection on connection.id = claimed.connection_id
      left join app_private.instagram_accounts as instagram
        on instagram.id = connection.id and connection.provider = 'instagram'
      left join app_private.facebook_pages as page
        on page.connection_id = connection.id and connection.provider = 'facebook'
    `;
    return rows[0] ? toDmFollowupClaim(rows[0]) : null;
  },

  async claimDueFollowups(now, leaseUntil, limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new RangeError('Follow-up batch limit must be from 1 through 50');
    const rows = await sql<DmFollowupClaimRow[]>`
      with candidates as (
        select followup.id
        from app_private.dm_followups as followup
        inner join app_private.social_connections as connection
          on connection.id = followup.connection_id
        left join app_private.instagram_accounts as instagram
          on instagram.id = connection.id and connection.provider = 'instagram'
        left join app_private.facebook_pages as page
          on page.connection_id = connection.id and connection.provider = 'facebook'
        where (
            (connection.provider = 'instagram' and instagram.connection_status = 'active')
            or (connection.provider = 'facebook' and connection.connection_status = 'active'
              and page.connection_id is not null)
          )
          and followup.expires_at > ${leaseUntil}
          and followup.attempt_count < 3
          and (
            followup.status = 'pending'
            or (
              followup.status = ${EXECUTION_STATUS.RETRY_PENDING}
              and followup.next_attempt_at <= ${now}
            )
            or (
              followup.status = ${EXECUTION_STATUS.PROCESSING}
              and followup.dispatch_started_at is null
              and followup.lease_expires_at <= ${now}
            )
          )
        order by coalesce(followup.next_attempt_at, followup.lease_expires_at, followup.created_at), followup.id
        limit ${limit}
        for update of followup skip locked
      ), claimed as (
        update app_private.dm_followups as followup
        set status = ${EXECUTION_STATUS.PROCESSING},
          attempt_count = followup.attempt_count + 1,
          next_attempt_at = null,
          lease_id = gen_random_uuid(), lease_expires_at = ${leaseUntil},
          dispatch_started_at = null,
          error_code = null, error_message = null, failure_kind = null
        from candidates
        where followup.id = candidates.id
        returning followup.*
      )
      select claimed.*, connection.provider, connection.external_account_id,
        coalesce(instagram.access_token_ciphertext, page.access_token_ciphertext)
          as access_token_ciphertext
      from claimed
      inner join app_private.social_connections as connection on connection.id = claimed.connection_id
      left join app_private.instagram_accounts as instagram
        on instagram.id = connection.id and connection.provider = 'instagram'
      left join app_private.facebook_pages as page
        on page.connection_id = connection.id and connection.provider = 'facebook'
    `;
    return rows.map(toDmFollowupClaim);
  },

  async resolveStaleFollowups(now) {
    const rows = await sql<{ id: string }[]>`
      update app_private.dm_followups
      set status = case
            when dispatch_started_at is not null then ${EXECUTION_STATUS.UNCERTAIN}
            else ${EXECUTION_STATUS.FAILED}
          end,
          failure_kind = case
            when dispatch_started_at is not null then ${RECOVERY_KIND.UNCERTAIN}
            else ${RECOVERY_KIND.PERMANENT}
          end,
          error_code = case
            when dispatch_started_at is not null then 'DELIVERY_OUTCOME_UNKNOWN'
            else 'FOLLOWUP_WINDOW_EXPIRED'
          end,
          error_message = case
            when dispatch_started_at is not null
              then 'Delivery requires manual review to prevent a duplicate message.'
            else 'The messaging window expired before the follow-up could be sent.'
          end,
          next_attempt_at = null, lease_id = null, lease_expires_at = null
      where (
        status in ('pending', ${EXECUTION_STATUS.RETRY_PENDING}) and expires_at <= ${now}
      ) or (
        status = ${EXECUTION_STATUS.PROCESSING}
        and lease_expires_at <= ${now}
        and (dispatch_started_at is not null or attempt_count >= 3 or expires_at <= ${now})
      )
      returning id
    `;
    return rows.length;
  },

  async markFollowupDispatchStarted(id, leaseId, at) {
    const rows = await sql<{ id: string }[]>`
      update app_private.dm_followups
      set dispatch_started_at = ${at}
      where id = ${id} and status = ${EXECUTION_STATUS.PROCESSING}
        and lease_id = ${leaseId} and expires_at > ${at}
      returning id
    `;
    return rows.length === 1;
  },

  async markFollowupSucceeded(id, leaseId, providerReplyId) {
    if (providerReplyId.trim() === '') throw new TypeError('Provider reply ID must be non-empty');
    const rows = await sql<DmFollowupRow[]>`
      update app_private.dm_followups
      set status = ${EXECUTION_STATUS.SUCCEEDED},
        provider_reply_id = ${providerReplyId},
        error_code = null, error_message = null, failure_kind = null,
        next_attempt_at = null, lease_id = null, lease_expires_at = null
      where id = ${id} and status = ${EXECUTION_STATUS.PROCESSING} and lease_id = ${leaseId}
      returning *
    `;
    return rows[0] ? toDmFollowup(rows[0]) : null;
  },

  async markFollowupRetryPending(id, leaseId, failure, retryAt) {
    if (failure.errorCode.trim() === '' || failure.errorMessage.trim() === '')
      throw new TypeError('Follow-up failure code and message must be non-empty');
    const rows = await sql<DmFollowupRow[]>`
      update app_private.dm_followups
      set status = case
          when ${retryAt}::timestamptz < expires_at and attempt_count < 3
            then ${EXECUTION_STATUS.RETRY_PENDING}
          else ${EXECUTION_STATUS.FAILED}
        end,
        error_code = case
          when ${retryAt}::timestamptz < expires_at and attempt_count < 3
            then ${failure.errorCode}
          else 'FOLLOWUP_WINDOW_EXPIRED'
        end,
        error_message = case
          when ${retryAt}::timestamptz < expires_at and attempt_count < 3
            then ${failure.errorMessage}
          else 'The messaging window expired before a safe retry.'
        end,
        failure_kind = case
          when ${retryAt}::timestamptz < expires_at and attempt_count < 3
            then ${failure.failureKind}
          else ${RECOVERY_KIND.PERMANENT}
        end,
        next_attempt_at = case
          when ${retryAt}::timestamptz < expires_at and attempt_count < 3
            then ${retryAt}
          else null
        end,
        lease_id = null, lease_expires_at = null, dispatch_started_at = null
      where id = ${id} and status = ${EXECUTION_STATUS.PROCESSING} and lease_id = ${leaseId}
      returning *
    `;
    return rows[0] ? toDmFollowup(rows[0]) : null;
  },

  async markFollowupFailed(id, leaseId, failure) {
    if (failure.errorCode.trim() === '' || failure.errorMessage.trim() === '')
      throw new TypeError('Follow-up failure code and message must be non-empty');
    const rows = await sql<DmFollowupRow[]>`
      update app_private.dm_followups
      set status = ${EXECUTION_STATUS.FAILED},
        error_code = ${failure.errorCode}, error_message = ${failure.errorMessage},
        failure_kind = ${failure.failureKind}, next_attempt_at = null,
        lease_id = null, lease_expires_at = null
      where id = ${id} and status = ${EXECUTION_STATUS.PROCESSING} and lease_id = ${leaseId}
      returning *
    `;
    return rows[0] ? toDmFollowup(rows[0]) : null;
  },

  async markFollowupUncertain(id, leaseId, failure) {
    if (failure.errorCode.trim() === '' || failure.errorMessage.trim() === '')
      throw new TypeError('Follow-up failure code and message must be non-empty');
    const rows = await sql<DmFollowupRow[]>`
      update app_private.dm_followups
      set status = ${EXECUTION_STATUS.UNCERTAIN},
        error_code = ${failure.errorCode}, error_message = ${failure.errorMessage},
        failure_kind = ${failure.failureKind}, next_attempt_at = null,
        lease_id = null, lease_expires_at = null
      where id = ${id} and status = ${EXECUTION_STATUS.PROCESSING} and lease_id = ${leaseId}
      returning *
    `;
    return rows[0] ? toDmFollowup(rows[0]) : null;
  },

  async listRecentAnswersByAccountId(accountId, limit, mediaId) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new RangeError('Answer activity limit must be from 1 through 50');
    const answers = await sql<InboundDmAnswerActivityRow[]>`
      select answer.*, execution.commenter_username, execution.media_id,
        (
          select option_value->>'title'
          from jsonb_array_elements(execution.quick_reply_options) as option_value
          where option_value->>'id' = answer.option_id::text
          limit 1
        ) as choice_title
      from app_private.inbound_dm_answers as answer
      left join app_private.executions as execution on execution.id = answer.execution_id
      where answer.connection_id = ${accountId}
        and (${mediaId ?? null}::text is null or execution.media_id = ${mediaId ?? null})
      order by answer.received_at desc, answer.id desc
      limit ${limit}
    `;
    if (answers.length === 0) return [];
    const followups = await sql<DmFollowupRow[]>`
      select * from app_private.dm_followups
      where answer_id in ${sql(answers.map((answer) => answer.id))}
    `;
    const byAnswer = new Map(followups.map((followup) => [followup.answer_id, followup]));
    return answers.map((answer) => ({
      answer: toInboundDmAnswer(answer),
      followup: byAnswer.has(answer.id) ? toDmFollowup(byAnswer.get(answer.id)!) : null,
      choiceTitle: answer.choice_title,
      commenterUsername: answer.commenter_username,
      mediaId: answer.media_id,
    }));
  },
});
