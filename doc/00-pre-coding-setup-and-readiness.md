# Pre-Coding Setup & Environment Readiness Checklist

## Instagram Comment Automation MVP

**Date:** 2026-09-01  
**Purpose:** Verify that the local machine, cloud accounts, credentials, and development tools are
ready before implementation starts.

This document is intentionally practical. Complete the checklist from top to bottom.

---

# 1. Readiness levels

There are two different definitions of "ready":

## Level A — Ready to start coding

You can start coding when you have:

- Node.js
- pnpm
- Git
- GitHub repository
- Supabase project
- Vercel account/CLI
- local environment file structure

You do **not** need the full Meta webhook configuration yet.

## Level B — Ready for real Instagram end-to-end testing

In addition to Level A, you need:

- Meta Developer account
- Meta App configured for Instagram Login
- Instagram Business or Creator test account
- Meta App ID and App Secret
- production/public HTTPS URL
- OAuth callback configured
- webhook callback configured
- Instagram permissions granted
- at least one real Instagram post/reel

---

# 2. Local machine requirements

## Required

### Node.js

Recommended baseline:

```text
Node.js 24 LTS
```

Check:

```bash
node --version
npm --version
```

Expected:

```text
node prints v24.x.x
npm prints a version
```

If Node is not installed, install the current Node.js LTS release.

---

### pnpm

We use pnpm for the monorepo.

Check:

```bash
pnpm --version
```

If missing, one option is:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

Verify again:

```bash
pnpm --version
```

---

### Git

Check:

```bash
git --version
```

Expected:

```text
git version ...
```

Also verify Git identity:

```bash
git config user.name
git config user.email
```

If empty, configure them before the first commit.

---

### curl

Useful for testing API endpoints and webhook verification.

Check:

```bash
curl --version
```

---

## Recommended

### Vercel CLI

Install:

```bash
npm install -g vercel
```

Login:

```bash
vercel login
```

Verify:

```bash
vercel --version
vercel whoami
```

`vercel whoami` should return the Vercel account you want to use.

---

### PostgreSQL CLI — optional

The project does not require `psql` for normal runtime operation, but it is useful for
troubleshooting and manually testing migrations.

Check:

```bash
psql --version
```

If unavailable, this is **not a blocker**.

Supabase's SQL editor can be used instead.

---

# 3. Development applications

## Lovable

Lovable is browser-based.

Required:

```text
Account available if we want to use it to generate/iterate on frontend UI.
```

It is not required to run the application.

Important:

```text
GitHub repository is the source of truth.
```

Do not allow the project architecture to depend on Lovable-specific hosting or backend behavior.

---

# 4. GitHub setup

Before implementation:

- [ ] GitHub account exists
- [ ] New repository created
- [ ] Repository is private initially
- [ ] Local Git repository is connected to GitHub
- [ ] First push works

Suggested repository name:

```text
instagram-automation
```

Verify:

```bash
git remote -v
```

Expected:

```text
origin  <your GitHub repository>
```

Test push:

```bash
git push
```

---

# 5. Supabase setup

Create one Supabase project.

For v0.1 we use Supabase only as a **PostgreSQL provider**.

We are **not** using:

- Supabase Auth
- direct privileged frontend database access
- Supabase-specific business logic

## Required values

From Supabase obtain:

```text
DATABASE_URL
DATABASE_MIGRATION_URL
```

### Runtime connection

For Vercel/serverless runtime use the **transaction pooler** connection string.

This is normally the connection using port:

```text
6543
```

Example shape:

```text
postgres://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:6543/postgres
```

Do not copy the example literally. Use the value from your own Supabase project.

### Migration connection

For migrations, use an appropriate direct/session connection depending on your network.

Store separately as:

```text
DATABASE_MIGRATION_URL
```

---

## Supabase connectivity test

Before application coding, at minimum verify:

- [ ] Supabase project opens
- [ ] SQL editor works
- [ ] database password is known/stored safely
- [ ] transaction pooler connection string is available
- [ ] migration/direct connection string is available

Actual programmatic connection can be tested immediately after the first backend skeleton is
created.

---

# 6. Vercel setup

Required before real Meta OAuth/webhook testing.

Before coding, only account + CLI login are necessary.

Checklist:

- [ ] Vercel account exists
- [ ] `vercel whoami` works
- [ ] GitHub account can be connected to Vercel
- [ ] repository can later be imported into Vercel

After the project skeleton exists:

```bash
vercel link
```

Then environment variables can be managed through the Vercel dashboard.

If needed locally:

```bash
vercel env pull
```

Do not commit the generated secret environment file.

---

# 7. Meta Developer setup

You already have a Meta Developer account.

Next, create/configure a Meta App for the Instagram API.

For this MVP use:

```text
Instagram API with Instagram Login
Business Login for Instagram
```

The target Instagram account must be:

```text
Business
or
Creator
```

A normal personal/consumer Instagram account is not supported by this integration.

---

## Permissions required for v0.1

Only request:

```text
instagram_business_basic
instagram_business_manage_comments
```

Do not request yet:

```text
instagram_business_manage_messages
instagram_business_content_publish
instagram_business_manage_insights
```

---

## Meta values we need

Eventually collect:

```text
META_APP_ID
META_APP_SECRET
```

Do not commit either secret.

`META_APP_ID` is not considered highly secret by itself, but keep configuration centralized.

`META_APP_SECRET` must be server-only.

---

# 8. Instagram test account

Create or convert an Instagram account to:

```text
Business
or
Creator
```

This should be an account you control for development.

Before real testing:

- [ ] Professional account exists
- [ ] you can log into it
- [ ] at least one post/reel is published
- [ ] ideally a second Instagram account is available for testing comments

Why a second account helps:

```text
Test account A = business/creator being automated
Test account B = person commenting #Hello
```

This makes the acceptance test realistic.

---

# 9. Public URL requirement

Localhost is enough for normal frontend/backend development.

It is **not enough** for real Meta OAuth callbacks and webhook delivery.

For real Meta integration we need a public HTTPS URL.

Recommended:

```text
https://<project>.vercel.app
```

After first deployment we will know the final callback URLs.

Expected application URLs will look similar to:

```text
https://<project>.vercel.app/api/auth/instagram/callback

https://<project>.vercel.app/api/webhooks/instagram
```

Do not configure final Meta callback URLs until the deployed route structure exists.

---

# 10. Meta OAuth setup — required before login test

After the Vercel deployment exists:

Configure the Instagram Login redirect/callback URL to match:

```text
https://<project>.vercel.app/api/auth/instagram/callback
```

Application environment:

```text
META_REDIRECT_URI=https://<project>.vercel.app/api/auth/instagram/callback
```

They must match.

---

# 11. Meta webhook setup — required before comment test

After the webhook route exists and is deployed:

Configure:

```text
Callback URL:
https://<project>.vercel.app/api/webhooks/instagram
```

Create a random verification token.

Example variable name:

```text
META_WEBHOOK_VERIFY_TOKEN
```

Do not use a simple value such as:

```text
hello
1234
password
```

Generate a random token.

Example command:

```bash
openssl rand -hex 32
```

The same value is configured:

1. in the Meta webhook configuration;
2. in the application's server environment.

For the first slice subscribe only to:

```text
comments
```

---

# 12. Local environment file

Create:

```text
.env.example
```

Commit `.env.example`.

Do **not** commit:

```text
.env
.env.local
.env.production
```

Recommended `.env.example`:

```dotenv
NODE_ENV=development

APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:3000

DATABASE_URL=
DATABASE_MIGRATION_URL=

META_APP_ID=
META_APP_SECRET=
META_API_VERSION=v24.0
META_REDIRECT_URI=
META_WEBHOOK_VERIFY_TOKEN=

SESSION_COOKIE_NAME=igauto_session
SESSION_TTL_SECONDS=604800

TOKEN_ENCRYPTION_KEY=
```

---

# 13. Generate local security secrets

## Session/security encryption key

We need a key for encrypting Instagram access tokens.

Generate securely.

For example:

```bash
openssl rand -base64 32
```

Store as:

```text
TOKEN_ENCRYPTION_KEY
```

Do not commit it.

---

## Webhook verification token

Generate separately:

```bash
openssl rand -hex 32
```

Store as:

```text
META_WEBHOOK_VERIFY_TOKEN
```

Do not reuse the encryption key.

---

# 14. `.gitignore`

Before adding any real secret, verify `.gitignore` contains at least:

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
.vercel/
.DS_Store
coverage/
```

Test:

```bash
git status
```

Real `.env` files must not appear as untracked files intended for commit.

---

# 15. Tools required vs optional

| Tool / Service                 | Required before coding? | Required before real Instagram test? |
| ------------------------------ | ----------------------: | -----------------------------------: |
| Node.js                        |                     YES |                                  YES |
| npm                            |                     YES |                                  YES |
| pnpm                           |                     YES |                                  YES |
| Git                            |                     YES |                                  YES |
| GitHub                         |                     YES |                                  YES |
| Lovable                        |                      No |                                   No |
| Vercel CLI                     |             Recommended |                                  YES |
| Vercel project                 |                      No |                                  YES |
| Supabase project               |                     YES |                                  YES |
| `psql` CLI                     |                      No |                                   No |
| Meta Developer account         |     No for basic coding |                                  YES |
| Meta App                       |     No for basic coding |                                  YES |
| Instagram Professional account |     No for basic coding |                                  YES |
| Second Instagram account       |                      No |                          Recommended |
| Beads                          |                      NO |                                   NO |

---

# 16. Local tool preflight

Run:

```bash
echo "=== Node ==="
node --version

echo "=== npm ==="
npm --version

echo "=== pnpm ==="
pnpm --version

echo "=== Git ==="
git --version

echo "=== curl ==="
curl --version | head -n 1

echo "=== Vercel ==="
vercel --version

echo "=== Vercel account ==="
vercel whoami
```

Optional:

```bash
echo "=== PostgreSQL CLI ==="
psql --version
```

---

# 17. Expected preflight result

You are ready to start coding if all of these are true:

```text
[ ] node --version works
[ ] npm --version works
[ ] pnpm --version works
[ ] git --version works
[ ] GitHub repository exists
[ ] git push works
[ ] Supabase project exists
[ ] DATABASE_URL is obtainable
[ ] DATABASE_MIGRATION_URL is obtainable
[ ] Vercel account exists
[ ] vercel whoami works
[ ] .env.example exists
[ ] real secrets are excluded from Git
```

Meta does **not** need to be completely configured yet for this level.

---

# 18. Expected real-Instagram preflight result

You are ready for the first real Instagram test when all are true:

```text
[ ] all coding preflight items pass
[ ] Meta Developer account exists
[ ] Meta App exists
[ ] Instagram Login is configured
[ ] META_APP_ID is available
[ ] META_APP_SECRET is available
[ ] Instagram Business/Creator test account exists
[ ] the test account has at least one media item
[ ] app is deployed to a public HTTPS URL
[ ] OAuth callback route is deployed
[ ] Meta redirect URL matches META_REDIRECT_URI
[ ] webhook route is deployed
[ ] webhook verification succeeds
[ ] comments webhook subscription is configured
[ ] instagram_business_basic permission is granted
[ ] instagram_business_manage_comments permission is granted
[ ] TOKEN_ENCRYPTION_KEY is configured in production
[ ] DATABASE_URL is configured in production
```

---

# 19. What should NOT block us from starting

Do not delay coding because these are missing:

```text
Beads
billing
Stripe
custom domain
staging environment
AI API key
analytics
queue service
Redis
Supabase Auth
ORM
private DM permission
multiple Instagram accounts
team/workspace design
```

None is required for the first vertical flow.

---

# 20. First environment test after repository creation

As soon as the project skeleton is created, the first technical tests should be:

## Frontend

```bash
pnpm dev
```

Expected:

```text
React page opens locally.
```

## Backend

Create:

```text
GET /api/health
```

Expected response:

```json
{
  "status": "ok"
}
```

Test:

```bash
curl http://localhost:3000/api/health
```

## Database

Create:

```text
GET /api/health/database
```

The endpoint should perform:

```sql
select 1;
```

Expected response:

```json
{
  "status": "ok",
  "database": "connected"
}
```

This endpoint must not expose database URLs or credentials.

---

# 21. First production infrastructure test

Before implementing Instagram OAuth:

1. deploy the empty frontend/API application to Vercel;
2. configure `DATABASE_URL`;
3. call:

```text
https://<project>.vercel.app/api/health
```

4. call:

```text
https://<project>.vercel.app/api/health/database
```

Both must return success.

Only after that should we connect Meta OAuth.

This separates infrastructure problems from Instagram integration problems.

---

# 22. Recommended setup order

```text
1. Verify Node / pnpm / Git
2. Create GitHub repository
3. Create Supabase project
4. Copy DB connection strings securely
5. Verify Vercel login
6. Create local .env.example + .gitignore
7. Generate local security secrets
8. Start repository skeleton
9. Implement /api/health
10. Implement /api/health/database
11. Deploy skeleton to Vercel
12. Verify production health
13. Create/configure Meta App
14. Create Instagram Business/Creator test account
15. Configure OAuth callback
16. Test real Instagram login
17. Configure webhook
18. Test real #Hello flow
```

---

# 23. Final GO / NO-GO decision

## GO — start coding

If these work:

```text
Node
pnpm
Git/GitHub
Supabase project
Vercel login
```

Start coding.

## GO — start Meta integration

If these additionally work:

```text
public Vercel deployment
Meta App
Instagram Professional account
OAuth callback configuration
```

Implement/test Instagram login.

## GO — test automation

If these additionally work:

```text
real Instagram login
webhook verification
comments subscription
selected real media
```

Run the real:

```text
#Hello -> public reply -> Activity SUCCESS
```

---

# 24. Reference assumptions checked 2026-09-01

At the time this checklist was written:

- Node.js 24 is an active LTS release.
- Vercel CLI supports `vercel login`, `vercel whoami`, `vercel link`, and environment variable
  workflows.
- Supabase recommends its transaction pooler for temporary/serverless PostgreSQL clients.
- Supabase supports Postgres.js.
- Instagram API with Instagram Login uses Instagram Professional Business/Creator accounts.
- The relevant v0.1 Instagram Login permissions are:
  - `instagram_business_basic`
  - `instagram_business_manage_comments`
- Instagram Login uses the `graph.instagram.com` host.

Re-check Meta configuration details when implementing the real integration because Meta API setup
and versions can change.
