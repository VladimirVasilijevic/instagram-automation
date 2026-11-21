import type { OAuthStateRepository } from '../security/oauth-state.js';
import type { PostgresQueryClient } from './postgres-repositories.js';

/** Creates PostgreSQL persistence for expiring, browser-bound, single-use OAuth attempts. */
export const createPostgresOAuthStateRepository = (
  sql: PostgresQueryClient,
): OAuthStateRepository => ({
  async createState(input): Promise<void> {
    await sql`delete from app_private.oauth_states where expires_at <= clock_timestamp()`;
    await sql`
      insert into app_private.oauth_states
        (state_hash, browser_binding_hash, expires_at, provider, intent, intended_user_id)
      values (
        ${input.stateHash}, ${input.browserBindingHash}, ${input.expiresAt},
        ${input.provider ?? 'instagram'}, ${input.intent ?? 'sign_in'},
        ${input.intendedUserId ?? null}
      )
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
  async consumeStateDetails(stateHash, browserBindingHash) {
    const rows = await sql<
      {
        provider: 'instagram' | 'facebook';
        intent: 'sign_in' | 'connect_page';
        intended_user_id: string | null;
      }[]
    >`
      delete from app_private.oauth_states
      where state_hash = ${stateHash}
        and browser_binding_hash = ${browserBindingHash}
        and expires_at > clock_timestamp()
      returning provider, intent, intended_user_id
    `;
    return rows[0]
      ? {
          provider: rows[0].provider,
          intent: rows[0].intent,
          intendedUserId: rows[0].intended_user_id,
        }
      : null;
  },
});
