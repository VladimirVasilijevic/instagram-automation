# Instagram Login — Milestone 3

## Current status

OAuth start/callback, encrypted account persistence, application sessions, `/api/me`, and the
connect/account UI are implemented. On 2026-09-22, the five required login settings were added to
Vercel Production, with `META_APP_SECRET` stored as a Secret, and `0002_oauth_states.sql` was
applied to the existing production Supabase database. Real Instagram login is not verified yet.

Automated route tests use an injected Instagram client and in-memory repository doubles. Adapter
tests validate requests and responses against the documented Meta shapes using mocked HTTP. Live
PostgreSQL integration verification remains pending because there is no separate test database.

## Configuration

Use **Instagram App ID** and **Instagram App Secret** from **API setup with Instagram login**. The
existing `META_APP_ID` and `META_APP_SECRET` names refer to those Instagram-specific values. The
account must be eligible for Instagram Login and have the required tester/app access.

The API now requires `APP_BASE_URL`, `META_APP_ID`, `META_APP_SECRET`, `META_API_VERSION`, and
`META_REDIRECT_URI`, in addition to the existing database, encryption, and session settings.
Configure these values before releasing the new runtime; missing configuration prevents startup.

For production:

```dotenv
APP_BASE_URL=https://instagram-automation-henna-phi.vercel.app
META_REDIRECT_URI=https://instagram-automation-henna-phi.vercel.app/api/auth/instagram/callback
META_API_VERSION=v24.0
```

The public privacy policy is available at
`https://instagram-automation-henna-phi.vercel.app/privacy`. Enter that URL in Meta App settings
when completing the Publish requirements. It is a public page and does not require an Instagram
session.

Keep secrets in `.env.local` and the Vercel server environment. No `VITE_` variable is needed. Do
not copy production URLs over the local frontend origin merely to make validation pass. Production
requires HTTPS, matching origins, and the exact callback path without a query or fragment. Meta's
registered redirect must match the configured URI, including trailing-slash behavior.

The configured `v24.0` is retained. On 2026-09-22, Meta's
[version table](https://developers.facebook.com/docs/graph-api/changelog/versions/) listed it as
supported until February 18, 2028. The adapter uses it for the profile request; token exchanges use
the unversioned endpoints specified by the
[Business Login guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/).

## Browser and server flow

1. `/` and `/app` load `/api/me`. An absent or expired application session displays the connect
   screen.
2. **Continue with Instagram** navigates to `/api/auth/instagram/start` on the same origin.
3. The server creates two independent random values: OAuth state and a browser binding credential.
   Only their SHA-256 digests and a ten-minute expiry are stored in `app_private.oauth_states`.
4. State goes to Instagram's authorization URL. The independent binding stays in a short-lived,
   HTTP-only, SameSite=Lax cookie, with Secure enabled in production.
5. On callback, the server atomically deletes a matching, unexpired state row. A second callback
   cannot reuse it, even on another Vercel instance. Missing, mismatched, duplicated, or expired
   state is rejected before any provider exchange. The binding cookie is cleared on completion.
6. The server exchanges the code for a short-lived token, verifies the requested permission grants,
   exchanges it for a long-lived token, and reads `user_id,username` from the versioned `/me`
   endpoint. HTTP requests have ten-second deadlines and do not follow redirects. There are no
   automatic retries of the single-use code exchange.
7. The professional account's `user_id` is persisted as `instagram_user_id`. The app-scoped `id` is
   not substituted; Meta documents the professional ID as the one used in account webhook events.
   Numeric IDs are preserved without JavaScript floating-point rounding.
8. The long-lived token is encrypted using the existing AES-GCM protector. Its expiry comes from
   Meta's `expires_in`, not a hard-coded lifetime.
9. A previous presented session is revoked, a fresh session credential is generated, and only its
   hash is persisted. The browser receives an HTTP-only session cookie and redirects to `/app`.
10. `/api/me` returns only account ID, Instagram ID, and username. Logout revokes the session and
    expires the cookie. A failed logout remains visible and can be retried.

The requested scopes are `instagram_business_basic` and `instagram_business_manage_comments`. The UI
shows application-owned error messages for cancellation, invalid state, missing permissions,
configuration mismatch, and temporary failures. Raw provider descriptions and credentials are never
included in those responses or application logs. Authentication responses are not cacheable.

The original infrastructure page remains at `/status`. The existing Milestone 1 diagrams describe
that infrastructure and do not yet depict this OAuth flow.

## Local verification

```bash
pnpm check
pnpm test
pnpm typecheck
pnpm build
pnpm docs:code
pnpm --filter @instagram-automation/api build:vercel
git diff --check
```

For local HTTP inspection, start `pnpm dev` and open `http://localhost:5173`. An anonymous
`GET /api/me` should return `401`. The connect button and `/status` can be inspected without writing
OAuth state when the local frontend origin and configured production callback differ: login start
redirects back with `login_error=configuration`.

For real OAuth, start and finish on the same registered public origin. Starting on localhost and
returning to production loses the browser binding cookie. A separate development HTTPS origin needs
its own registered callback and matching environment values. Use the stable production domain for
the first released login test; preview domains need separate matching configuration.

## PostgreSQL integration verification — pending

Migration `0002_oauth_states.sql` adds the private state table, expiry index, row-level security,
and API-role restrictions. It does not alter the existing tables or the first migration. Expired
state rows are removed when a new login attempt is created.

After a dedicated non-production database is available, apply both repository migrations to it. Set
`TEST_DATABASE_URL` securely in the local shell and run:

```bash
pnpm --filter @instagram-automation/api test:integration:oauth
```

This opt-in suite uses two independent PostgreSQL connections to check expiry, browser binding, and
a single successful consumer under concurrent callbacks. It cleans up its own state rows. It does
not load `.env.local` or fall back to `DATABASE_URL`. Its create operation removes expired state
rows, so the database must be dedicated to testing.

The existing `test:integration` command still loads `.env.local`; do not run that suite against the
shared production database during this work. Both integration files remain skipped by `pnpm test`.

## Release and real-login acceptance — complete

1. Review the implementation and approve the production configuration/migration work.
2. Set the five Meta/frontend variables in Vercel alongside the existing runtime variables. Use the
   Instagram-specific credentials; do not expose the migration connection URL to the runtime.
3. Check migration status and apply the reviewed migration through the migration connection:

   ```bash
   pnpm db:migrate:status
   pnpm db:migrate
   ```

   These commands use the database configured in `.env.local`. Confirm that target before execution.

4. Approve the code commit/push and deployment. The Git-linked `main` branch can trigger deployment
   immediately, so production configuration and the schema should be ready first.
5. Verify `/api/health`, `/api/health/database`, and anonymous `/api/me` on the deployed origin.
6. Open the production root and click **Continue with Instagram**. Sign in as the eligible test
   account and grant profile/comment access. Confirm the correct `@username` at `/app`.
7. Refresh `/app` and confirm the same account. Inspect `/api/me` to confirm it contains only the
   three identity fields. The application session cookie should be HTTP-only, Secure, and
   SameSite=Lax.
8. Log out, refresh, and confirm the connect screen and `401` from `/api/me`.
9. Cancel a new Instagram authorization and verify the safe cancellation message. Reopening a used
   callback must not create another session; begin a fresh login instead.

Milestones 3 and 4 are complete. Comment webhooks, automated replies, periodic token refresh, and
public app review are later work.
