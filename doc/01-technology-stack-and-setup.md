# Technology Stack and Setup Guide

## Instagram Comment Automation MVP

**Last verified:** 2026-09-22 (local login implementation; production connectivity checked
2026-09-21)

**Repository:** <https://github.com/VladimirVasilijevic/instagram-automation>

This document explains which technologies are used, what each technology does, how the local and
cloud setup fits together, and how to verify the environment before development.

---

# 1. Current project status

The Milestone 1 frontend, backend, and database connectivity proof work locally and are deployed to
[the production application](https://instagram-automation-henna-phi.vercel.app). On 2026-09-21, the
frontend, API health, database health, and OpenAPI endpoints all returned HTTP 200. The database
health response reported `connected`. Vercel is linked to this GitHub repository's `main` branch.

Milestone 2 persistence and security are implemented. Milestone 3 OAuth, the account API,
connect/account UI, production configuration, migration, deployment, and real login acceptance are
complete. See the [Instagram login guide](05-instagram-login.md) for the implementation record.

Already configured:

- Node.js and pnpm;
- Git and a private GitHub repository;
- PostgreSQL command-line tools;
- a Supabase PostgreSQL project;
- working runtime and migration database connections;
- versioned, checksummed SQL migrations with transactional execution;
- a private PostgreSQL application schema with row-level security and restricted API roles;
- PostgreSQL account and session repositories sharing the API database connection;
- Vercel CLI, connected project, and production/preview runtime variables;
- local environment-file protection;
- local webhook and encryption secrets;
- automated formatting, linting, pre-commit checks, and CI validation;
- a TypeScript Hono API with process and database health endpoints;
- a React and TypeScript status page with an isolated Vite build adapter;
- a same-origin frontend API client and local `/api` development proxy;
- a Vercel Hono entry point and same-origin frontend/API service routing;
- Tailwind CSS through the build-tool-neutral PostCSS integration;
- Postgres.js runtime connectivity to Supabase;
- automated frontend and API tests and TypeScript builds;
- TSDoc/TypeDoc code documentation;
- OpenAPI generation and same-origin Swagger UI;
- PlantUML architecture, class, object, and sequence diagrams.

Milestones 3 and 4 are complete. Milestone 5 webhook integration is next.

Webhook integration follows in Milestone 5.

---

# 2. Technology overview

| Technology            | Current role                                                     | Status                            |
| --------------------- | ---------------------------------------------------------------- | --------------------------------- |
| Node.js 24            | JavaScript runtime for application code and tooling              | Installed                         |
| npm                   | Included Node.js package manager and global CLI installer        | Installed                         |
| pnpm 11               | Project package manager and planned monorepo workspace manager   | Installed and pinned              |
| Git                   | Local version control                                            | Configured                        |
| GitHub                | Private remote source repository                                 | Configured and synchronized       |
| PostgreSQL 18 client  | Database connectivity and troubleshooting with `psql`            | Installed                         |
| Supabase              | Managed PostgreSQL provider                                      | Project created and connected     |
| Vercel                | Public HTTPS hosting for frontend/API, OAuth, and webhooks       | Production health verified        |
| React                 | Component-based frontend user interface                          | Status page deployed              |
| Vite                  | Replaceable frontend development/build adapter                   | Configured for `apps/web`         |
| Tailwind CSS          | Utility-first frontend styling through PostCSS                   | Configured for `apps/web`         |
| Hono                  | TypeScript HTTP routing and middleware                           | Backend deployed                  |
| Zod                   | Runtime environment and HTTP schema validation                   | Configured in API                 |
| Postgres.js           | Runtime PostgreSQL client                                        | Connected and health-tested       |
| Vitest                | Automated frontend and API tests                                 | Configured; tests passing         |
| Testing Library       | User-visible React component behavior tests                      | Configured; tests passing         |
| TSDoc                 | Standard comments for exported TypeScript declarations           | Required for app exports          |
| TypeDoc               | Generated HTML documentation from TypeScript and TSDoc           | Configured for web and API        |
| OpenAPI               | Machine-readable HTTP API contract                               | Generated by the Hono application |
| Swagger UI            | Browser-based API explorer and manual request runner             | Available at `/api/docs`          |
| PlantUML              | Editable architecture and behavior diagrams                      | Installed and used                |
| Meta Instagram API    | OAuth, comment webhooks, reading comments, and posting replies   | Integration pending               |
| curl                  | Manual HTTP health-check and webhook testing                     | Installed                         |
| OpenSSL               | Secure local secret generation                                   | Installed                         |
| Prettier              | Consistent formatting for code, configuration, and documentation | Configured                        |
| ESLint                | JavaScript and TypeScript correctness and quality rules          | Configured                        |
| EditorConfig          | Shared basic editor behavior                                     | Configured                        |
| Husky and lint-staged | Checks staged files before each commit                           | Configured                        |
| GitHub Actions        | Runs repository-wide formatting and lint checks remotely         | Configured                        |

## Technologies intentionally not required

The first MVP does not currently require:

- Supabase Auth;
- Redis or another queue service;
- Stripe or billing;
- an AI API;
- a custom domain;
- a staging environment;
- analytics;
- Instagram direct-message permissions.

---

# 3. System architecture

The application will have these logical parts:

```text
Browser
  |
  | HTTPS
  v
React frontend
  |
  | Internal API requests
  v
Node.js backend/API
  |                |
  | SQL/TLS        | HTTPS/OAuth/Webhooks
  v                v
Supabase         Meta Instagram API
PostgreSQL
```

## Frontend

The React frontend provides the user interface. It calls backend routes with standard `fetch` and
same-origin `/api/...` paths. During development, Vite proxies those paths to the local Hono API.
The application source does not use Vite environment variables, module-glob APIs, or hot-module
APIs, so Vite can be replaced without rewriting the React components or API client.

The frontend must never contain privileged database credentials, the Meta App Secret, Instagram
access tokens, or the token-encryption key.

## Backend

The Node.js backend will be responsible for:

- health endpoints;
- database access;
- Instagram OAuth callbacks;
- webhook verification and comment events;
- encrypted Instagram access-token storage;
- matching automation rules;
- sending replies through the Meta API.

The backend uses Hono with OpenAPI-aware route definitions. Zod schemas describe HTTP contracts, and
Postgres.js provides runtime database access. Swagger UI is available through the same-origin API
route in local and deployed environments for inspecting and manually running documented endpoints.

## Database

Supabase is used as a managed PostgreSQL provider only. Authentication and business rules remain in
the application backend.

Two database URLs are used because application traffic and migrations have different connection
requirements:

| Variable                 | Connection                      | Use                                      |
| ------------------------ | ------------------------------- | ---------------------------------------- |
| `DATABASE_URL`           | Transaction pooler, port `6543` | Serverless application runtime on Vercel |
| `DATABASE_MIGRATION_URL` | Session pooler, port `5432`     | Schema migrations and administrative SQL |

The direct database hostname uses IPv6 and was unreachable from the current local network. The
configured Supabase pooler supports IPv4, and both pooler connections passed `select 1` tests.

### Database migrations

Versioned SQL files live under `db/migrations/`. Check migration state and apply pending migrations
from the repository root:

```bash
pnpm db:migrate:status
pnpm db:migrate
```

The migration runner uses `DATABASE_MIGRATION_URL`, calculates a SHA-256 checksum for each SQL file,
and records applied files in `app_private.schema_migrations`. It rejects changed, missing, or
out-of-order migration history. Pending files run in a single transaction under a PostgreSQL
advisory lock, so a failed migration rolls back its schema changes and ledger entry together.

Applied migrations are immutable. Correct an applied schema with a new migration instead of editing
an existing SQL file. The runner supports transactional migrations only; do not add operations such
as `CREATE INDEX CONCURRENTLY` without first extending the runner deliberately.

Application data is stored in the private `app_private` schema, which must not be added to the
Supabase Data API's exposed schemas. Supabase API roles have no schema or table privileges, and
row-level security is enabled without browser policies. Backend and migration SQL must always use
fully qualified names such as `app_private.sessions`; this also avoids confusion with Supabase's
separate `auth.sessions` table.

### Application persistence

The API database wrapper constructs account, session, automation, and execution repositories from
the same Postgres.js client used for health checks. Repository contracts are separate from their
PostgreSQL adapters, while remaining inside `apps/api` until another runtime consumer justifies
activating shared workspace packages.

Account persistence accepts only the opaque protected-token type returned by AES-GCM encryption.
Session persistence accepts only the opaque SHA-256 hash returned by session-token generation. An
active-session lookup also requires `expires_at > now()` in PostgreSQL, so an expired credential
cannot authenticate even if its row has not been cleaned up.

Automation persistence allows one configuration per account and always writes the first vertical
slice's fixed `#Hello` trigger itself. Enabled lookups require both the owning account and selected
media identifier. Execution persistence atomically claims an Instagram comment with
`ON CONFLICT DO NOTHING`, permits only `processing` to terminal state transitions, and exposes
recent activity through an account ownership join. Activity limits must be integers from 1 through
50, and failure values must already be non-empty and sanitized before they reach the repository.

### Application sessions

The API accepts only the generated 32-byte Base64URL session-token format from the configured
cookie. Required-session middleware hashes a valid credential before querying PostgreSQL, attaches
the active session and account to Hono's typed request context, and returns a generic `401` for a
missing, malformed, unknown, or expired credential. Invalid stored credentials are cleared from the
browser. Public health routes do not run this middleware or query session storage.

Session cookies are HTTP-only, use `SameSite=Lax` and `Path=/`, and share the configured server-side
session lifetime. The `Secure` attribute is enabled in production and disabled for local HTTP
development. The logout endpoint is `POST /api/auth/logout`; it hashes and revokes a valid token,
then expires the cookie. Missing, malformed, and already-revoked credentials are successful
idempotent logouts. A storage failure returns a sanitized `503` without clearing the cookie so the
server-side revocation can be retried.

Normal unit tests skip external database access. Run the explicitly enabled rollback-only repository
integration test with:

```bash
pnpm --filter @instagram-automation/api test:integration
```

The integration test loads the ignored local environment, performs its assertions through the
configured runtime database connection, deliberately aborts each transaction, and confirms that no
test account, session, automation, or execution remains.

## Vercel

Vercel provides the public HTTPS URL required by Meta. The root `vercel.json` defines a web service
for `apps/web`, an API service for `apps/api`, and routes same-origin `/api` requests to the Hono
service. All other requests reach the Vite application. The production base URL is
`https://instagram-automation-henna-phi.vercel.app`.

HTTP checks on 2026-09-21 returned:

| Path                   | Result                                                |
| ---------------------- | ----------------------------------------------------- |
| `/`                    | HTTP 200, Instagram Automation HTML application shell |
| `/api/health`          | HTTP 200, `{"status":"ok"}`                           |
| `/api/health/database` | HTTP 200, `{"database":"connected","status":"ok"}`    |
| `/api/openapi.json`    | HTTP 200, health and logout routes documented         |

The OAuth callback is implemented locally and awaits deployment:

```text
/api/auth/instagram/callback
```

The webhook route remains planned for Milestone 5:

```text
/api/webhooks/instagram
```

The Hono serverless entry point is `apps/api/src/index.ts`. It creates one application and database
client per function instance without opening a local listener or installing process signal handlers.
The existing `apps/api/src/server.ts` uses the same runtime factory for normal local development.

The API service uses `"buildCommand": "pnpm build:vercel"`. These API package commands have
different purposes:

| Command             | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `pnpm typecheck`    | Validate TypeScript without generating JavaScript files                 |
| `pnpm build`        | Generate JavaScript in `apps/api/dist` for standalone Node.js execution |
| `pnpm build:vercel` | Run `pnpm typecheck` as our build step before Vercel compiles the API   |

`build:vercel` names the deployment-specific step; Vercel's Hono adapter performs the compilation
and packaging after that command succeeds:

```text
pnpm build:vercel → pnpm typecheck → Vercel compiles src/index.ts → deployed Hono application
```

Generating `apps/api/dist` during the API service build previously caused the adapter to select the
wrong generated file instead of the configured `src/index.ts` entry point. The `build:vercel`
command avoids that conflict while still rejecting TypeScript errors. It does not skip compilation;
it leaves compilation to Vercel.

To run this step from the repository root:

```bash
pnpm --filter @instagram-automation/api build:vercel
```

The web service continues to use `pnpm build` because Vite generates the frontend HTML, JavaScript,
and CSS assets that Vercel serves.

## Meta Instagram API

The planned Meta integration uses Instagram API with Instagram Login and Business Login for
Instagram.

The initial permissions are limited to:

```text
instagram_business_basic
instagram_business_manage_comments
```

A Business or Creator Instagram account is required for the real end-to-end test. A normal personal
account is not supported by this flow.

---

# 4. Repository structure

Current high-level structure:

```text
instagram-automation/
├── apps/
│   ├── api/                 # Hono backend, migration CLI, tests, OpenAPI and TypeDoc configuration
│   └── web/                 # React UI, API client, tests, Vite and TypeDoc configuration
├── packages/                # Domain/application/ports/infrastructure/contracts workspaces
├── db/migrations/           # Immutable, ordered SQL migrations
├── tests/
├── doc/
│   └── diagrams/            # PlantUML sources and rendered SVG diagrams
├── .env.example
├── package.json
└── pnpm-workspace.yaml
```

---

# 5. Installed tool versions

Versions verified during setup:

```text
Node.js:        24.20.0
npm:            11.19.0
pnpm:           11.25.0
Corepack:       0.35.0
Git:            2.55.0
curl:           8.18.0
OpenSSL:        3.5.5
psql:           18.6
GitHub CLI:     2.46.0
Vercel CLI:     59.10.0
Supabase CLI:   2.116.0
TypeScript:     6.0.3
React:          19.2.8
Vite:           8.2.2
Tailwind CSS:   4.3.3
Hono:           4.13.5
Zod:            4.5.4
Postgres.js:    3.4.9
Vitest:         4.1.11
TypeDoc:        0.28.20
PlantUML:       1.2020.02
Graphviz:       14.1.2
Prettier:       3.9.6
ESLint:         10.9.1
Husky:          9.1.7
lint-staged:    17.4.1
```

The project pins pnpm in `package.json`:

```json
"packageManager": "pnpm@11.25.0"
```

This helps all developers use the same package-manager version.

`pnpm-workspace.yaml` explicitly sets `virtualStoreType: project`, keeping the virtual store at
`node_modules/.pnpm` as described in the
[pnpm settings reference](https://pnpm.io/settings/node-modules#virtualstoretype). With pnpm
11.25.0, leaving this setting unset caused the dependency preflight to report
`The value of the enableGlobalVirtualStore setting has changed` against the existing installation.
That triggered an unnecessary install before scripts, which failed under restricted cache access or
without a terminal to confirm replacing `node_modules`. Selecting the existing layout resolves the
mismatch while retaining dependency verification and the pinned dependency versions.

---

# 6. Git and GitHub setup

The repository is private:

```text
https://github.com/VladimirVasilijevic/instagram-automation
```

The local branch is `main` and tracks `origin/main`.

Verify:

```bash
git status --short --branch
git remote -v
gh auth status
gh repo view
```

Normal change workflow:

```bash
git status
git add <files>
git commit -m "describe the change"
git push
```

Always inspect `git status` before committing. Never add `.env.local` or any other real secret file.

---

# 7. Local environment configuration

`.env.example` documents the required variable names and is safe to commit.

`.env.local` contains real local values and is ignored by Git. Create it on a new development
machine with:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Current variable responsibilities:

| Variable                    | Purpose                                 |      Required now? |
| --------------------------- | --------------------------------------- | -----------------: |
| `NODE_ENV`                  | Runtime environment name                |                Yes |
| `APP_BASE_URL`              | Public frontend origin for redirects    |                Yes |
| `API_BASE_URL`              | Reserved backend base URL               |                 No |
| `API_PORT`                  | Local backend listening port            |         Local only |
| `DATABASE_URL`              | Runtime transaction-pooler connection   |                Yes |
| `DATABASE_MIGRATION_URL`    | Migration/session-pooler connection     | Local/CI migration |
| `META_APP_ID`               | Instagram Login application identifier  |                Yes |
| `META_APP_SECRET`           | Server-only Instagram Login secret      |                Yes |
| `META_API_VERSION`          | Meta Graph API version                  |                Yes |
| `META_REDIRECT_URI`         | Exact registered OAuth callback URL     |                Yes |
| `META_WEBHOOK_VERIFY_TOKEN` | Shared webhook verification value       |  Generated locally |
| `SESSION_COOKIE_NAME`       | Application session-cookie name         |                Yes |
| `SESSION_TTL_SECONDS`       | Session lifetime, at most one year      |                Yes |
| `TOKEN_ENCRYPTION_KEY`      | Encrypts stored Instagram access tokens |  Generated locally |

Never paste secret values into documentation, issues, commits, screenshots, or chat logs.

Verify that Git ignores the local file:

```bash
git check-ignore -v .env.local
git status --short
```

Expected: `.env.local` is reported as ignored and does not appear in Git status.

---

# 8. Supabase setup

Configured project:

```text
Name:      instagram-automation
Reference: mjamavntiutdizyugrnj
Region:    Central EU (eu-central-1)
Status:    ACTIVE_HEALTHY
```

Dashboard:

```text
https://supabase.com/dashboard/project/mjamavntiutdizyugrnj
```

The repository is linked to this project using the Supabase CLI. Temporary CLI link metadata under
`supabase/.temp/` is ignored by Git.

Verify project access:

```bash
pnpm dlx supabase@latest projects list
```

## Test the configured database connections

Load the local environment and run a read-only query:

```bash
set -a
. ./.env.local
set +a

psql "$DATABASE_URL" --no-psqlrc --command='select 1;'
psql "$DATABASE_MIGRATION_URL" --no-psqlrc --command='select 1;'
```

Both commands should return `1`.

Do not print either database URL because it contains the database password.

---

# 9. Vercel setup

Verify the CLI:

```bash
vercel --version
vercel whoami
```

Create one Vercel project from the repository root. In the Vercel import screen, set **Root
Directory** to the repository root (`.`), not `apps/api` or `apps/web`. Vercel reads `vercel.json`
and builds both services.

Configure these environment variables for **Production** and **Preview**:

Each environment needs its own matching frontend origin and registered callback. A preview cannot
finish login using a production callback because the browser binding cookie belongs to the origin
where login started. Use the stable production domain for the first real login test.

| Variable               | Value source                                                    | Vercel type |
| ---------------------- | --------------------------------------------------------------- | ----------- |
| `NODE_ENV`             | `production`                                                    | Config      |
| `DATABASE_URL`         | Supabase transaction pooler URL on port `6543`                  | Sensitive   |
| `SESSION_COOKIE_NAME`  | The value already used in `.env.local`                          | Config      |
| `SESSION_TTL_SECONDS`  | The value already used in `.env.local`                          | Config      |
| `TOKEN_ENCRYPTION_KEY` | The existing server-only Base64 encryption secret               | Sensitive   |
| `APP_BASE_URL`         | Public HTTPS frontend origin                                    | Config      |
| `META_APP_ID`          | Instagram App ID from Instagram Login settings                  | Config      |
| `META_APP_SECRET`      | Instagram App Secret from Instagram Login settings              | Sensitive   |
| `META_API_VERSION`     | `v24.0`, retained from the existing configuration               | Config      |
| `META_REDIRECT_URI`    | Exact registered same-origin `/api/auth/instagram/callback` URL | Config      |

Do not add `DATABASE_MIGRATION_URL` to the deployed runtime and do not expose any of these values to
the Vite frontend. Do not commit downloaded Vercel environment files. The `.vercel/` directory is
ignored.

Sensitive variables remain available to the server at runtime, but Vercel does not allow their
values to be read back from the dashboard or CLI.

Verify the deployed application before Meta OAuth is configured. The stable public HTTPS URL is
required for callbacks and webhooks.

---

# 10. How the completed setup works

## During local development

1. pnpm installs and runs the frontend/backend dependencies.
2. Vite serves the React app on port `5173` and proxies same-origin `/api` paths to port `3000`.
3. The backend loads non-public configuration from `.env.local`.
4. Backend database calls use the Supabase transaction pooler.
5. Migration commands use the Supabase session pooler.
6. Git tracks source and example configuration but ignores real secrets.
7. GitHub stores the private source repository.

## During production

1. GitHub changes trigger or supply a Vercel deployment.
2. Vercel injects production environment variables into the backend.
3. Browser requests reach the frontend/API over HTTPS.
4. Backend requests reach Supabase using `DATABASE_URL`.
5. Meta redirects OAuth responses to the deployed callback route.
6. Meta sends comment events to the deployed webhook route.
7. The backend verifies the webhook, reads the automation rule, and sends an Instagram reply through
   the Meta API.

---

# 11. Manual readiness verification

Run from the repository root:

```bash
node --version
npm --version
pnpm --version
git --version
curl --version | head -n 1
openssl version
psql --version
gh --version
vercel --version
pnpm dlx supabase@latest --version
```

Verify GitHub and repository synchronization:

```bash
gh auth status
gh repo view
git status --short --branch
```

Verify the database using the commands from section 8.

Start and verify the complete local Milestone 1 path:

```bash
pnpm dev
```

Then open `http://localhost:5173` and confirm that the API and database cards show **Connected**.
The page's API documentation link should open Swagger UI through the same-origin API route. Detailed
frontend commands and manual checks are in
[`04-frontend-development.md`](04-frontend-development.md).

Expected readiness result:

```text
local tools available
GitHub repository private and synchronized
Supabase project ACTIVE_HEALTHY
runtime database query succeeds
migration database query succeeds
.env.local ignored by Git
```

---

# 12. Next implementation steps

The Milestone 1 production connectivity checks pass, and Milestones 3–4 real Instagram login, media
selection, and automation configuration are complete. Continue with the
[milestone plan](02-first-vertical-implementation-plan.md):

1. implement comment webhook verification and subscription in Milestone 5;
2. implement public replies and activity in Milestones 6–7.

---

# 13. Automated code style

The repository uses one shared style system so local development, agent changes, commits, and GitHub
validation apply the same rules.

## Style rules

The approved defaults are:

```text
Indentation:       2 spaces
Line endings:      LF
Maximum width:     100 characters
JavaScript quotes: single
Semicolons:        required
Trailing commas:   enabled
Final newline:     required
Markdown:          formatted and wrapped
```

The configuration files are:

| File                                 | Responsibility                                                    |
| ------------------------------------ | ----------------------------------------------------------------- |
| `.editorconfig`                      | Editor-independent indentation, line ending, and whitespace rules |
| `.prettierrc.json`                   | Automatic formatting decisions                                    |
| `.prettierignore`                    | Generated files and dependencies excluded from formatting         |
| `eslint.config.mjs`                  | JavaScript and TypeScript correctness rules                       |
| `lint-staged.config.mjs`             | Commands applied to staged files                                  |
| `.husky/pre-commit`                  | Runs lint-staged before Git creates a commit                      |
| `.github/workflows/code-quality.yml` | Enforces all checks on GitHub pushes and pull requests            |

## Commands

Format every supported file:

```bash
pnpm format
```

Check formatting without changing files:

```bash
pnpm format:check
```

Run ESLint:

```bash
pnpm lint
```

Run the complete non-mutating validation:

```bash
pnpm check
```

Apply automatic formatting and lint fixes:

```bash
pnpm check:fix
```

Always run `pnpm check` after `pnpm check:fix` to confirm the repository is clean.

## Pre-commit automation

The `prepare` package script installs the Husky Git hook after dependencies are installed. When a
commit is attempted, lint-staged formats and lints only the staged files. If a check cannot be fixed
automatically, the commit is stopped.

Do not bypass the hook with:

```text
git commit --no-verify
```

Fix the reported issue and commit again.

## GitHub enforcement

GitHub Actions installs dependencies from the locked dependency graph and runs:

```bash
pnpm check
```

The workflow runs for pushes and pull requests. A failed formatting or linting check must be fixed
before the change is considered ready.

## Editor integration

Editors should enable format-on-save with Prettier as the default formatter for supported files.
Editor integration is a convenience; repository scripts and CI remain the source of truth.

When adding a new language or generated directory, update the approved style configuration in the
same change. Do not add separate formatting rules inside an individual application unless the
repository-wide configuration cannot express the requirement.

Code comments, generated TypeDoc HTML, OpenAPI, Swagger UI, and PlantUML workflows are documented in
[`03-code-and-api-documentation.md`](03-code-and-api-documentation.md).
