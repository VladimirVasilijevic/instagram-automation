import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import type { SocialProvider } from '@instagram-automation/contracts';

import type { ProtectedToken } from '../security/token-protector.js';
import {
  ConnectionLimitError,
  IdentityOwnershipError,
  type CompleteSignInInput,
  type ConnectFacebookPageInput,
  type FacebookPageConnection,
  type IdentityRepository,
  type InstagramSignInResult,
  type PendingFacebookPage,
  type SocialConnection,
  type SocialConnectionRepository,
  type User,
} from './identity-repositories.js';
import type { InstagramAccount } from './repositories.js';

interface UserRow {
  id: string;
  created_at: Date;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  provider: SocialProvider;
  external_account_id: string;
  display_name: string;
  connection_status: 'active' | 'reconnect_required';
}

interface InstagramAccountRow {
  id: string;
  instagram_user_id: string;
  username: string;
  access_token_ciphertext: string;
  token_expires_at: Date;
  connection_status: 'active' | 'reconnect_required';
  token_refresh_failure_code: string | null;
  token_refresh_last_succeeded_at: Date | null;
  token_refresh_next_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const toUser = (row: UserRow): User => ({ id: row.id, createdAt: row.created_at });

const toConnection = (row: ConnectionRow): SocialConnection => ({
  id: row.id,
  userId: row.user_id,
  provider: row.provider,
  externalAccountId: row.external_account_id,
  displayName: row.display_name,
  connectionStatus: row.connection_status,
});

const toInstagramAccount = (row: InstagramAccountRow): InstagramAccount => ({
  id: row.id,
  instagramUserId: row.instagram_user_id,
  username: row.username,
  accessTokenCiphertext: row.access_token_ciphertext as ProtectedToken,
  tokenExpiresAt: row.token_expires_at,
  connectionStatus: row.connection_status,
  tokenRefreshFailureCode: row.token_refresh_failure_code,
  tokenRefreshLastSucceededAt: row.token_refresh_last_succeeded_at,
  tokenRefreshNextAttemptAt: row.token_refresh_next_attempt_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const resolveUser = async (
  tx: postgres.TransactionSql,
  input: CompleteSignInInput,
): Promise<User> => {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`${input.provider}:${input.externalUserId}`}, 0))`;
  const identities = await tx<{ user_id: string }[]>`
    select user_id from app_private.login_identities
    where provider = ${input.provider} and external_user_id = ${input.externalUserId}
    for update
  `;
  const existingUserId = identities[0]?.user_id;
  if (existingUserId) {
    if (input.intendedUserId && input.intendedUserId !== existingUserId) {
      throw new IdentityOwnershipError();
    }
    await tx`
      update app_private.login_identities set display_name = ${input.displayName}
      where provider = ${input.provider} and external_user_id = ${input.externalUserId}
    `;
    const users = await tx<UserRow[]>`
      select id, created_at from app_private.users where id = ${existingUserId}
    `;
    return toUser(users[0]!);
  }

  let user: User;
  if (input.intendedUserId) {
    const users = await tx<UserRow[]>`
      select id, created_at from app_private.users where id = ${input.intendedUserId} for update
    `;
    if (!users[0]) throw new IdentityOwnershipError();
    user = toUser(users[0]);
  } else {
    const users = await tx<UserRow[]>`
      insert into app_private.users default values returning id, created_at
    `;
    user = toUser(users[0]!);
  }
  await tx`
    insert into app_private.login_identities
      (user_id, provider, external_user_id, display_name)
    values (${user.id}, ${input.provider}, ${input.externalUserId}, ${input.displayName})
  `;
  return user;
};

/** Creates atomic PostgreSQL operations for application login identities. */
export const createPostgresIdentityRepository = (sql: postgres.Sql): IdentityRepository => ({
  completeSignIn: (input) => sql.begin((tx) => resolveUser(tx, input)),

  completeInstagramLogin: (input): Promise<InstagramSignInResult> =>
    sql.begin(async (tx) => {
      const user = await resolveUser(tx, {
        provider: 'instagram',
        externalUserId: input.instagramUserId,
        displayName: input.username,
        intendedUserId: input.intendedUserId,
      });
      await tx`select id from app_private.users where id = ${user.id} for update`;
      const existing = await tx<ConnectionRow[]>`
        select id, user_id, provider, external_account_id, display_name, connection_status
        from app_private.social_connections
        where provider = 'instagram' and external_account_id = ${input.instagramUserId}
        for update
      `;
      let connection: SocialConnection;
      if (existing[0]) {
        if (existing[0].user_id !== user.id) throw new IdentityOwnershipError();
        const updated = await tx<ConnectionRow[]>`
          update app_private.social_connections
          set display_name = ${input.username}, connection_status = 'active'
          where id = ${existing[0].id}
          returning id, user_id, provider, external_account_id, display_name, connection_status
        `;
        connection = toConnection(updated[0]!);
      } else {
        const other = await tx<{ id: string }[]>`
          select id from app_private.social_connections where user_id = ${user.id} limit 1
        `;
        if (other[0]) throw new ConnectionLimitError();
        const legacy = await tx<{ id: string }[]>`
          select id from app_private.instagram_accounts
          where instagram_user_id = ${input.instagramUserId}
        `;
        const inserted = await tx<ConnectionRow[]>`
          insert into app_private.social_connections
            (id, user_id, provider, external_account_id, display_name)
          values (
            ${legacy[0]?.id ?? randomUUID()}, ${user.id}, 'instagram',
            ${input.instagramUserId}, ${input.username}
          )
          returning id, user_id, provider, external_account_id, display_name, connection_status
        `;
        connection = toConnection(inserted[0]!);
      }

      const accounts = await tx<InstagramAccountRow[]>`
        insert into app_private.instagram_accounts
          (id, instagram_user_id, username, access_token_ciphertext, token_expires_at)
        values (
          ${connection.id}, ${input.instagramUserId}, ${input.username},
          ${input.accessTokenCiphertext}, ${input.tokenExpiresAt}
        )
        on conflict (instagram_user_id) do update set
          username = excluded.username,
          access_token_ciphertext = excluded.access_token_ciphertext,
          token_expires_at = excluded.token_expires_at,
          connection_status = 'active',
          token_refresh_failure_code = null,
          token_refresh_next_attempt_at = null,
          token_refresh_lease_id = null,
          token_refresh_lease_until = null
        returning id, instagram_user_id, username, access_token_ciphertext,
          token_expires_at, connection_status, token_refresh_failure_code,
          token_refresh_last_succeeded_at, token_refresh_next_attempt_at,
          created_at, updated_at
      `;
      return { user, connection, account: toInstagramAccount(accounts[0]!) };
    }),
});

const connectFacebookPageTx = async (
  tx: postgres.TransactionSql,
  input: ConnectFacebookPageInput,
): Promise<SocialConnection> => {
  const users = await tx<UserRow[]>`
    select id, created_at from app_private.users where id = ${input.userId} for update
  `;
  if (!users[0]) throw new IdentityOwnershipError();
  await tx`select pg_advisory_xact_lock(hashtextextended(${`facebook-page:${input.pageId}`}, 0))`;
  const existing = await tx<ConnectionRow[]>`
    select id, user_id, provider, external_account_id, display_name, connection_status
    from app_private.social_connections
    where provider = 'facebook' and external_account_id = ${input.pageId}
    for update
  `;
  let connection: SocialConnection;
  if (existing[0]) {
    if (existing[0].user_id !== input.userId) throw new IdentityOwnershipError();
    const updated = await tx<ConnectionRow[]>`
      update app_private.social_connections
      set display_name = ${input.pageName}, connection_status = 'active',
        connection_failure_code = null
      where id = ${existing[0].id}
      returning id, user_id, provider, external_account_id, display_name, connection_status
    `;
    connection = toConnection(updated[0]!);
  } else {
    const other = await tx<{ id: string }[]>`
      select id from app_private.social_connections where user_id = ${input.userId} limit 1
    `;
    if (other[0]) throw new ConnectionLimitError();
    const inserted = await tx<ConnectionRow[]>`
      insert into app_private.social_connections
        (user_id, provider, external_account_id, display_name)
      values (${input.userId}, 'facebook', ${input.pageId}, ${input.pageName})
      returning id, user_id, provider, external_account_id, display_name, connection_status
    `;
    connection = toConnection(inserted[0]!);
  }
  await tx`
    insert into app_private.facebook_pages (connection_id, access_token_ciphertext)
    values (${connection.id}, ${input.accessTokenCiphertext})
    on conflict (connection_id) do update set
      access_token_ciphertext = excluded.access_token_ciphertext
  `;
  return connection;
};

/** Creates PostgreSQL operations for social connections and encrypted Page credentials. */
export const createPostgresSocialConnectionRepository = (
  sql: postgres.Sql,
): SocialConnectionRepository => ({
  connectFacebookPage: (input) => sql.begin((tx) => connectFacebookPageTx(tx, input)),

  async createPendingPageSelection(input) {
    if (input.pages.length < 1 || input.pages.length > 1000) {
      throw new RangeError('Page selection must contain one to 1000 Pages');
    }
    await sql`
      delete from app_private.pending_page_selections
      where expires_at <= clock_timestamp()
    `;
    const selectionId = randomUUID();
    await sql`
      insert into app_private.pending_page_selections (id, user_id, pages, expires_at)
      values (
        ${selectionId}, ${input.userId}, ${sql.json(
          input.pages.map((page) => ({
            id: page.id,
            name: page.name,
            accessTokenCiphertext: page.accessTokenCiphertext,
          })),
        )},
        ${new Date(Date.now() + 10 * 60 * 1000)}
      )
    `;
    return {
      selectionId,
      pages: input.pages.map(({ id, name }) => ({ id, name })),
    };
  },

  async getPendingPageSelection(input) {
    const rows = await sql<{ pages: PendingFacebookPage[] }[]>`
      select pages from app_private.pending_page_selections
      where id = ${input.selectionId} and user_id = ${input.userId}
        and expires_at > clock_timestamp()
      limit 1
    `;
    return rows[0]
      ? {
          selectionId: input.selectionId,
          pages: rows[0].pages.map(({ id, name }) => ({ id, name })),
        }
      : null;
  },

  consumeSelectedPage: (input) =>
    sql.begin(async (tx) => {
      const rows = await tx<{ pages: PendingFacebookPage[] }[]>`
        select pages from app_private.pending_page_selections
        where id = ${input.selectionId} and user_id = ${input.userId}
          and expires_at > clock_timestamp()
        for update
      `;
      const page = rows[0]?.pages.find(({ id }) => id === input.pageId);
      if (!page) return null;
      const connection = await connectFacebookPageTx(tx, {
        userId: input.userId,
        pageId: page.id,
        pageName: page.name,
        accessTokenCiphertext: page.accessTokenCiphertext,
      });
      await tx`delete from app_private.pending_page_selections where id = ${input.selectionId}`;
      return connection;
    }),

  async findFirstByUserId(userId): Promise<SocialConnection | null> {
    const rows = await sql<ConnectionRow[]>`
      select id, user_id, provider, external_account_id, display_name, connection_status
      from app_private.social_connections where user_id = ${userId}
      order by created_at, id limit 1
    `;
    return rows[0] ? toConnection(rows[0]) : null;
  },

  async findFacebookPageByPageId(pageId): Promise<FacebookPageConnection | null> {
    const rows = await sql<(ConnectionRow & { access_token_ciphertext: string })[]>`
      select connection.id, connection.user_id, connection.provider,
        connection.external_account_id, connection.display_name,
        connection.connection_status, page.access_token_ciphertext
      from app_private.social_connections as connection
      inner join app_private.facebook_pages as page on page.connection_id = connection.id
      where connection.provider = 'facebook' and connection.external_account_id = ${pageId}
      limit 1
    `;
    return rows[0]
      ? {
          ...toConnection(rows[0]),
          accessTokenCiphertext: rows[0].access_token_ciphertext as ProtectedToken,
        }
      : null;
  },

  async markReconnectRequired(connectionId, errorCode): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
      update app_private.social_connections
      set connection_status = 'reconnect_required',
        connection_failure_code = ${errorCode ?? null}
      where id = ${connectionId} and provider = 'facebook'
      returning id
    `;
    return rows.length > 0;
  },
});
