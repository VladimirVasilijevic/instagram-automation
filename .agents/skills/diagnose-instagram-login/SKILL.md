---
name: diagnose-instagram-login
description:
  Diagnose Instagram Login start, callback, token exchange, permission, account persistence, and
  application-session failures in this repository. Use for the existing Milestone 3 OAuth flow; do
  not use for future media, webhook, reply, or general database failures.
---

# Diagnose Instagram Login

Read `doc/05-instagram-login.md` first. It contains the current configuration, browser/server flow,
safe manual checks, and the boundary between local tests and real-provider acceptance.

Check local configuration before tracing the flow:

```bash
node .agents/skills/diagnose-instagram-login/scripts/check-config.ts
```

The checker reads `.env.local` without a network request, reports required variable names as present
or missing, applies the application's environment schema, and checks that the OAuth origins match.
It never prints configured values. Pass a repository-relative environment file path only when
checking a file other than `.env.local`.

Classify the failure before opening code:

1. Startup or immediate `login_error=configuration`: inspect `.env.example` and
   `apps/api/src/config/environment.ts`. Compare origins and callback paths without printing values.
2. Start/callback state or browser binding: inspect `apps/api/src/routes/instagram-auth.ts` and its
   adjacent test, then `apps/api/src/database/postgres-oauth-states.ts` if consumption failed.
3. Provider exchange, permissions, or profile parsing: inspect
   `apps/api/src/instagram/login-client.ts` and its adjacent test. Use the safe `stage`, `reason`,
   HTTP status, numeric Meta codes, field names, and type labels already emitted by the adapter.
4. Account or session failure after a successful profile response: inspect
   `apps/api/src/runtime.ts`, the database repositories, session middleware, and `/api/me` route.
5. Browser state after callback: inspect `apps/web/src/api/auth.ts` and
   `apps/web/src/pages/AccountPage.tsx` with their adjacent tests.

Run the focused automated checks while iterating:

```bash
pnpm --filter @instagram-automation/api exec vitest run \
  src/routes/instagram-auth.test.ts src/instagram/login-client.test.ts \
  src/config/environment.test.ts src/runtime.test.ts
pnpm --filter @instagram-automation/web exec vitest run \
  src/api/auth.test.ts src/pages/AccountPage.test.tsx
```

Never add authorization codes, access tokens, cookies, secrets, provider response bodies, or raw
provider messages to diagnostics. Preserve the existing no-retry behavior for the single-use code
exchange and the ten-second request deadline unless the task explicitly changes those requirements.

Real OAuth must start and finish on the same registered HTTPS origin. Localhost and production do
not share the browser-binding cookie. Use the release checklist in `doc/05-instagram-login.md` for a
real-provider test; unit tests cannot establish that Meta account eligibility and dashboard settings
are correct.
