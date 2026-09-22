import type { OAuthStateRepository } from '../security/oauth-state.js';
import type { PostgresQueryClient } from './postgres-repositories.js';

/** Creates PostgreSQL persistence for expiring, browser-bound, single-use OAuth attempts. */
export const createPostgresOAuthStateRepository = (
  sql: PostgresQueryClient,
): OAuthStateRepository => ({
  async createState(input): Promise<void> {
    await sql`delete from app_private.oauth_states where expires_at <= clock_timestamp()`;
    await sql`
      insert into app_private.oauth_states (state_hash, browser_binding_hash, expires_at)
      values (${input.stateHash}, ${input.browserBindingHash}, ${input.expiresAt})
    `;
  },
  async consumeState(stateHash, browserBindingHash): Promise<boolean> {
    const rows = await sql<{ state_hash: string }[]>`
      delete from app_private.oauth_states
      where state_hash = ${stateHash}
        and browser_binding_hash = ${browserBindingHash}
        and expires_at > clock_timestamp()
      returning state_hash
    `;
    return rows.length === 1;
  },
});
