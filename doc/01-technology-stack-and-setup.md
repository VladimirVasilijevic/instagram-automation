# Technology Stack and Setup Guide

## Instagram Comment Automation MVP

**Last verified:** 2026-09-01  
**Repository:** <https://github.com/VladimirVasilijevic/instagram-automation>

This document explains which technologies are used, what each technology does,
how the local and cloud setup fits together, and how to verify the environment
before development.

---

# 1. Current project status

Infrastructure and development tools are ready. The application source code has
not been created yet.

Already configured:

- Node.js and pnpm;
- Git and a private GitHub repository;
- PostgreSQL command-line tools;
- a Supabase PostgreSQL project;
- working runtime and migration database connections;
- Vercel CLI and account access;
- local environment-file protection;
- local webhook and encryption secrets.

Not configured yet:

- the frontend and backend application skeletons;
- a specific backend framework;
- TypeScript configuration;
- database migrations and schema;
- an ORM or SQL query library;
- Vercel project linking and deployment;
- Meta App credentials, OAuth callback, and webhook callback.

These undecided items should be selected during the first coding phase rather
than being treated as already installed technologies.

---

# 2. Technology overview

| Technology | Current role | Status |
|---|---|---|
| Node.js 24 | JavaScript runtime for application code and tooling | Installed |
| npm | Included Node.js package manager and global CLI installer | Installed |
| pnpm 11 | Project package manager and planned monorepo workspace manager | Installed and pinned |
| Git | Local version control | Configured |
| GitHub | Private remote source repository | Configured and synchronized |
| PostgreSQL 18 client | Database connectivity and troubleshooting with `psql` | Installed |
| Supabase | Managed PostgreSQL provider | Project created and connected |
| Vercel | Planned public HTTPS hosting for frontend/API, OAuth, and webhooks | CLI installed; deployment pending |
| React | Planned frontend UI technology | Not scaffolded yet |
| Meta Instagram API | OAuth, comment webhooks, reading comments, and posting replies | Integration pending |
| curl | Manual HTTP health-check and webhook testing | Installed |
| OpenSSL | Secure local secret generation | Installed |

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

# 3. Planned system architecture

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

The React frontend will provide the user interface. It will call backend API
routes and must never contain privileged database credentials, the Meta App
Secret, Instagram access tokens, or the token-encryption key.

## Backend

The Node.js backend will be responsible for:

- health endpoints;
- database access;
- Instagram OAuth callbacks;
- webhook verification and comment events;
- encrypted Instagram access-token storage;
- matching automation rules;
- sending replies through the Meta API.

The backend framework has not been selected yet.

## Database

Supabase is used as a managed PostgreSQL provider only. Authentication and
business rules remain in the application backend.

Two database URLs are used because application traffic and migrations have
different connection requirements:

| Variable | Connection | Use |
|---|---|---|
| `DATABASE_URL` | Transaction pooler, port `6543` | Serverless application runtime on Vercel |
| `DATABASE_MIGRATION_URL` | Session pooler, port `5432` | Schema migrations and administrative SQL |

The direct database hostname uses IPv6 and was unreachable from the current
local network. The configured Supabase pooler supports IPv4, and both pooler
connections passed `select 1` tests.

## Vercel

Vercel will provide the public HTTPS URL required by Meta. After deployment,
the expected application endpoints are:

```text
https://<project>.vercel.app/api/health
https://<project>.vercel.app/api/health/database
https://<project>.vercel.app/api/auth/instagram/callback
https://<project>.vercel.app/api/webhooks/instagram
```

The Vercel project should be linked only after the application skeleton exists.

## Meta Instagram API

The planned Meta integration uses Instagram API with Instagram Login and
Business Login for Instagram.

The initial permissions are limited to:

```text
instagram_business_basic
instagram_business_manage_comments
```

A Business or Creator Instagram account is required for the real end-to-end
test. A normal personal account is not supported by this flow.

---

# 4. Repository structure

Current structure:

```text
instagram-automation/
├── .env.example
├── .gitignore
├── package.json
└── doc/
    ├── 00-pre-coding-setup-and-readiness.md
    └── 01-technology-stack-and-setup.md
```

The exact application/monorepo folder layout will be created during the first
coding phase. Do not assume folders such as `apps/web` or `apps/api` exist yet.

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
```

The project pins pnpm in `package.json`:

```json
"packageManager": "pnpm@11.25.0"
```

This helps all developers use the same package-manager version.

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

Always inspect `git status` before committing. Never add `.env.local` or any
other real secret file.

---

# 7. Local environment configuration

`.env.example` documents the required variable names and is safe to commit.

`.env.local` contains real local values and is ignored by Git. Create it on a
new development machine with:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Current variable responsibilities:

| Variable | Purpose | Required now? |
|---|---|---:|
| `NODE_ENV` | Runtime environment name | Yes |
| `APP_BASE_URL` | Local or deployed frontend base URL | Yes |
| `API_BASE_URL` | Local or deployed backend base URL | Yes |
| `DATABASE_URL` | Runtime transaction-pooler connection | Yes |
| `DATABASE_MIGRATION_URL` | Migration/session-pooler connection | Yes |
| `META_APP_ID` | Meta application identifier | Before Meta OAuth |
| `META_APP_SECRET` | Server-only Meta application secret | Before Meta OAuth |
| `META_API_VERSION` | Meta Graph API version | Yes |
| `META_REDIRECT_URI` | Exact deployed OAuth callback URL | Before Meta OAuth |
| `META_WEBHOOK_VERIFY_TOKEN` | Shared webhook verification value | Generated locally |
| `SESSION_COOKIE_NAME` | Application session-cookie name | Yes |
| `SESSION_TTL_SECONDS` | Session lifetime | Yes |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Instagram access tokens | Generated locally |

Never paste secret values into documentation, issues, commits, screenshots, or
chat logs.

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

The repository is linked to this project using the Supabase CLI. Temporary CLI
link metadata under `supabase/.temp/` is ignored by Git.

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

After the application skeleton exists, link it:

```bash
vercel link
```

Then configure production secrets in the Vercel dashboard. Do not commit
downloaded Vercel environment files. The `.vercel/` directory is ignored.

The first deployment should happen before Meta OAuth is configured. This gives
the project a stable public HTTPS URL for callbacks and webhooks.

---

# 10. How the completed setup works

## During local development

1. pnpm installs and runs the frontend/backend dependencies.
2. The application loads non-public configuration from `.env.local`.
3. Backend database calls use the Supabase transaction pooler.
4. Migration commands use the Supabase session pooler.
5. Git tracks source and example configuration but ignores real secrets.
6. GitHub stores the private source repository.

## During production

1. GitHub changes trigger or supply a Vercel deployment.
2. Vercel injects production environment variables into the backend.
3. Browser requests reach the frontend/API over HTTPS.
4. Backend requests reach Supabase using `DATABASE_URL`.
5. Meta redirects OAuth responses to the deployed callback route.
6. Meta sends comment events to the deployed webhook route.
7. The backend verifies the webhook, reads the automation rule, and sends an
   Instagram reply through the Meta API.

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

Expected result before coding:

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

The next coding phase should proceed in this order:

1. choose and document the frontend/backend framework and TypeScript setup;
2. create the pnpm workspace structure;
3. implement `GET /api/health`;
4. implement `GET /api/health/database` using `select 1`;
5. run both services locally;
6. link and deploy the skeleton to Vercel;
7. test both health endpoints in production;
8. configure the Meta App, OAuth callback, and comment webhook;
9. implement the first Instagram comment-to-reply vertical flow.

Do not start Meta OAuth work until the local and deployed health checks pass.
