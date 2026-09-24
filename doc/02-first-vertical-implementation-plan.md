# First Vertical Slice — Implementation Plan

## Instagram Login → Select Post → `#Hello` → Public Reply → Activity

**Date:** 2026-09-01 **Status:** Ready to execute **Task system:** Simple checklist, no Beads

## Target outcome

The first vertical slice is complete when this works:

```text
Instagram Professional login
        ↓
show @username
        ↓
show latest 12 posts/reels
        ↓
select one post
        ↓
set public reply text
        ↓
enable automation
        ↓
someone comments exactly #Hello
        ↓
webhook received
        ↓
exact rule matched
        ↓
public reply sent
        ↓
activity shows SUCCESS
```

---

# Milestone 0 — Project foundation

## Goal

Create a clean monorepo that runs locally.

## Todo

- [x] Create GitHub repository
- [x] Initialize pnpm workspace
- [x] Add root `package.json`
- [x] Add `pnpm-workspace.yaml`
- [x] Create:

```text
apps/web
apps/api
packages/domain
packages/application
packages/ports
packages/infrastructure
packages/contracts
db/migrations
tests/unit
tests/integration
tests/fixtures
doc
```

- [x] Add TypeScript configuration
- [x] Add `.gitignore`
- [x] Add `.env.example`
- [x] Confirm real `.env` files are ignored
- [x] Add root scripts: `dev`, `build`, `test`, `typecheck`
- [x] Run `pnpm install`
- [x] Push first commit to GitHub

## Done when

```text
✓ pnpm install works
✓ repository pushes to GitHub
✓ workspace packages are recognized
✓ no secrets are committed
```

---

# Milestone 1 — Frontend + API + database connectivity

## Goal

Prove the basic infrastructure before Instagram:

```text
Browser → React → API → PostgreSQL
```

## Architecture

![Milestone 1 architecture](diagrams/milestone-1-architecture.svg)

Editable source: [`diagrams/milestone-1-architecture.puml`](diagrams/milestone-1-architecture.puml)

### Backend class relationships

![Milestone 1 backend class diagram](diagrams/milestone-1-class-diagram.svg)

Editable source:
[`diagrams/milestone-1-class-diagram.puml`](diagrams/milestone-1-class-diagram.puml)

### Running backend objects

![Milestone 1 backend object diagram](diagrams/milestone-1-object-diagram.svg)

Editable source:
[`diagrams/milestone-1-object-diagram.puml`](diagrams/milestone-1-object-diagram.puml)

### API call sequences

![Milestone 1 API call sequences](diagrams/milestone-1-call-sequence.svg)

Editable source:
[`diagrams/milestone-1-call-sequence.puml`](diagrams/milestone-1-call-sequence.puml)

### Frontend component relationships

![Milestone 1 frontend components](diagrams/milestone-1-frontend-components.svg)

Editable source:
[`diagrams/milestone-1-frontend-components.puml`](diagrams/milestone-1-frontend-components.puml)

### Frontend request sequence

![Milestone 1 frontend request sequence](diagrams/milestone-1-frontend-call-sequence.svg)

Editable source:
[`diagrams/milestone-1-frontend-call-sequence.puml`](diagrams/milestone-1-frontend-call-sequence.puml)

## Frontend

- [x] Create React + Vite app in `apps/web`
- [x] Add TypeScript
- [x] Add Tailwind through PostCSS
- [x] Create minimal mobile-first status page
- [x] Add validated backend health API client
- [x] Add portable same-origin `/api` routing with a development proxy

## Backend

- [x] Create Node.js API in `apps/api`
- [x] Add Hono
- [x] Add Zod
- [x] Add error middleware
- [x] Add `GET /api/health`

Expected:

```json
{ "status": "ok" }
```

## Database

- [x] Create Supabase project
- [x] Configure `DATABASE_URL`
- [x] Configure `DATABASE_MIGRATION_URL`
- [x] Add Postgres.js
- [x] Add PostgreSQL connection module
- [x] Add `GET /api/health/database`
- [x] Endpoint runs `select 1`

Expected:

```json
{ "status": "ok", "database": "connected" }
```

## Developer documentation

- [x] Add TSDoc comments to exported backend declarations
- [x] Add strict TypeDoc generation
- [x] Document exported frontend declarations
- [x] Generate an OpenAPI specification from Hono and Zod route definitions
- [x] Add same-origin Swagger UI with manual request execution
- [x] Add architecture, class, object, and call-sequence diagrams

Local documentation endpoints:

```text
http://localhost:3000/api/docs
http://localhost:3000/api/openapi.json
```

Generated TypeDoc sites:

```text
dist/docs/api-code/index.html
dist/docs/web-code/index.html
```

## Deployment

- [x] Add a Hono serverless entry point
- [x] Add same-origin Vercel routing for the web and API services
- [x] Create Vercel project
- [x] Connect GitHub repository
- [x] Configure production env variables
- [x] Deploy
- [x] Test `/api/health`
- [x] Test `/api/health/database`

Verified on 2026-09-21 at
[the production application](https://instagram-automation-henna-phi.vercel.app): `/`, `/api/health`,
`/api/health/database`, and `/api/openapi.json` returned HTTP 200. The frontend returned its HTML
application shell; database health reported `connected`. Vercel is connected to
`VladimirVasilijevic/instagram-automation` with `main` as the production branch. These HTTP checks
do not constitute a browser OAuth test or a database repository integration test.

## Done when

```text
✓ frontend works locally
✓ API works locally
✓ database works locally
✓ frontend served and API/database connectivity verified in production
```

---

# Milestone 2 — Database schema + security

## Goal

Create the persistence and security needed by the vertical slice.

## Migrations

- [x] `instagram_accounts`
  - `id`
  - `instagram_user_id UNIQUE`
  - `username`
  - `access_token_ciphertext`
  - `token_expires_at`
  - timestamps
- [x] `sessions`
  - `id`
  - `account_id`
  - `token_hash UNIQUE`
  - `expires_at`
  - `created_at`
- [x] `automations`
  - `id`
  - `account_id UNIQUE`
  - `media_id`
  - `trigger_text`
  - `reply_text`
  - `enabled`
  - timestamps
- [x] `executions`
  - `id`
  - `automation_id`
  - `instagram_comment_id UNIQUE`
  - `commenter_username`
  - `comment_text`
  - `status`
  - `error_code`
  - `error_message`
  - timestamps

## Ports/repositories

- [x] `AccountRepository`
- [x] `SessionRepository`
- [x] `AutomationRepository`
- [x] `ExecutionRepository`
- [x] PostgreSQL implementations for each

## Security

- [x] Add `TokenProtector` interface
- [x] Implement AES-256-GCM using Node `crypto`
- [x] Add `TOKEN_ENCRYPTION_KEY`
- [x] Create secure random session token
- [x] Store only session token hash in DB
- [x] Use HTTP-only cookie
- [x] Add session middleware
- [x] Add logout

## Done when

```text
✓ migrations apply cleanly
✓ repositories read/write data
✓ access-token encryption works
✓ session create/read/logout works
✓ raw Instagram tokens are not stored unencrypted
```

---

# Milestone 3 — Real Instagram login

## Goal

First real external checkpoint:

```text
Continue with Instagram → OAuth → @username
```

Local OAuth and UI implementation, production configuration and migration, deployment, and real
Instagram acceptance are complete. See the [login guide](05-instagram-login.md).

## Meta setup

- [x] Configure Meta App for Instagram Login (dashboard setup confirmed by user)
- [x] Request and grant permissions:
  - `instagram_business_basic`
  - `instagram_business_manage_comments`
- [x] Configure `META_APP_ID` locally and in production
- [x] Configure `META_APP_SECRET` locally and in production
- [x] Configure `META_API_VERSION` locally and in production
- [x] Configure `META_REDIRECT_URI` locally and in production
- [x] Verify test account is Business or Creator

## Backend OAuth

- [x] `GET /api/auth/instagram/start`
- [x] Generate/validate OAuth state
- [x] Redirect to Instagram authorization
- [x] `GET /api/auth/instagram/callback`
- [x] Exchange authorization code server-side
- [x] Fetch Instagram Professional account ID
- [x] Fetch username
- [x] Encrypt/store access token
- [x] Save account
- [x] Create app session
- [x] Set HTTP-only cookie
- [x] Redirect to `/app`

## API

- [x] `GET /api/me`
- [x] `POST /api/auth/logout` (backend reused from Milestone 2; frontend wired locally)

## Frontend

- [x] Connect screen
- [x] `Continue with Instagram`
- [x] Show `Connected as @username`
- [x] Logout button
- [x] Loading/error states

## Tests

- [x] OAuth state validation
- [x] unauthenticated `/api/me`
- [x] authenticated `/api/me`
- [x] session expiration
- [x] token encryption

## Done when

```text
✓ real Instagram login works in production
✓ correct @username appears after real login
✓ real browser session survives refresh
✓ real browser logout works
✓ automated tests verify tokens stay out of browser responses
```

---

# Milestone 4 — Load real media + save automation

## Goal

Let the owner select one real media item and save one automation.

## Instagram integration

- [x] Add `InstagramClient.listRecentMedia(...)`
- [x] Implement real Meta adapter
- [x] Limit to 12 media items
- [x] Normalize Meta response into internal media model

## API

- [x] `GET /api/media?limit=12`
- [x] Require authentication
- [x] Decrypt server-side Instagram token
- [x] Return app-owned Media DTOs
- [x] `GET /api/automation`
- [x] `PUT /api/automation`

Save input:

```json
{
  "mediaId": "178...",
  "replyText": "Hello! Thanks for commenting.",
  "enabled": true
}
```

Backend always stores:

```text
trigger_text = "#Hello"
```

## Frontend

- [x] Display latest 12 media items
- [x] Responsive mobile-first grid
- [x] Show thumbnail/media type/caption preview
- [x] Allow exactly one selection
- [x] Show read-only trigger `#Hello`
- [x] Editable reply textarea
- [x] Enabled toggle
- [x] Save button
- [x] Save success/error state
- [x] Reload persisted automation after refresh

## Validation

- [x] `mediaId` required
- [x] `replyText` required
- [x] trim reply text
- [x] reject empty reply
- [x] trigger cannot be changed via API

## Done when

```text
✓ latest 12 real media appear in production
✓ one media can be selected
✓ reply can be edited
✓ automation persists
✓ refresh restores configuration
```

Milestone 4 is complete. Comment webhook delivery is the next product checkpoint in Milestone 5.

---

# Milestone 5 — Webhook verification + comment subscription

## Goal

Make Meta send real comment events to the app.

## Environment

- [x] Add `META_WEBHOOK_VERIFY_TOKEN`

## API

- [x] `GET /api/webhooks/instagram` for verification
- [x] `POST /api/webhooks/instagram` for deliveries
- [x] Validate webhook payload and Meta SHA-256 signature
- [x] Log sanitized event metadata
- [x] Return successful acknowledgement

## Instagram integration

- [x] Add `InstagramClient.subscribeToComments(...)`
- [x] Implement subscription to `comments`
- [x] Make repeated subscription safe

## Normalize webhook

Convert raw Meta payload into:

```ts
type CommentEvent = {
  instagramAccountId: string;
  commentId: string;
  mediaId: string;
  username: string | null;
  text: string;
  receivedAt: Date;
};
```

- [x] Validate required fields
- [x] Add webhook test fixtures
- [x] Keep raw Meta structure out of application/domain layers

## Production

- [ ] Deploy webhook route
- [ ] Configure Meta callback URL
- [ ] Configure verification token
- [ ] Complete Meta verification
- [ ] Subscribe connected account to comments

## Manual test

- [ ] Comment on selected media from another Instagram account
- [ ] Confirm real webhook reaches backend

No automated reply required yet.

## Done when

```text
✓ webhook verification succeeds
✓ comments subscription succeeds
✓ real comment reaches backend
✓ event normalizes to CommentEvent
```

---

# Milestone 6 — Exact matching + idempotency + real public reply

## Goal

Turn the webhook into the automation.

## Domain rule

Implement:

```ts
commentText.trim() === '#Hello';
```

Tests:

- [ ] `#Hello` → match
- [ ] `#Hello` → match
- [ ] `#hello` → no
- [ ] `Hello` → no
- [ ] `#Hello!` → no
- [ ] `#Hello please` → no

## `ProcessComment` use case

- [x] Find account by Instagram ID
- [x] Find enabled automation for media ID
- [x] Stop if no automation
- [x] Exact-match text
- [x] Stop if not matched
- [x] Atomically claim execution
- [x] Stop if duplicate
- [x] Send public Instagram reply
- [x] Mark execution succeeded
- [x] Mark execution failed safely on error

## Idempotency

Use database constraint:

```text
executions.instagram_comment_id UNIQUE
```

Atomic insert concept:

```sql
insert into executions (...)
values (...)
on conflict (instagram_comment_id) do nothing
returning id;
```

- [x] Database uniqueness is authoritative
- [x] No in-memory-only duplicate protection

## Instagram reply adapter

- [x] Add `InstagramClient.replyToComment(...)`
- [x] Implement current Meta public reply call
- [x] Keep Meta HTTP details inside infrastructure adapter
- [x] Sanitize Meta errors

## Tests

- [x] unknown account → no reply
- [x] no automation → no reply
- [x] disabled automation → no reply
- [x] wrong media → no reply
- [x] wrong comment → no reply
- [x] correct comment → one reply
- [x] duplicate event → still one total reply
- [x] Meta failure → failed execution

## Done when

```text
✓ real #Hello receives configured public reply
✓ #hello does not
✓ #Hello please does not
✓ same comment cannot trigger twice
```

This is the core functional checkpoint.

---

# Milestone 7 — Activity UI + vertical slice completion

## Goal

Show automation results to the owner.

## API

- [x] `GET /api/executions?limit=50`
- [x] Require authentication
- [x] Return only current account's executions
- [x] Newest first
- [x] Return safe error information

## Frontend

Add Recent Activity:

```text
SUCCESS
@john
#Hello
Reply sent
10:42
```

- [x] loading state
- [x] empty state
- [x] success state
- [x] failure state
- [x] mobile layout
- [x] desktop layout

## Final acceptance test

### Login

- [ ] Open production app
- [ ] Login with Instagram
- [ ] Correct `@username` appears

### Configuration

- [ ] Latest media appears
- [ ] Select one media item
- [ ] Enter custom reply
- [ ] Enable automation
- [ ] Save

### Negative tests

- [ ] Comment `#hello` → no automated reply
- [ ] Comment `#Hello please` → no automated reply

### Positive test

- [ ] Comment `#Hello`
- [ ] Configured public reply appears

### Activity

- [ ] Execution appears as `succeeded`
- [ ] Correct username/comment/timestamp appears

### Duplicate test

- [ ] Replay same webhook fixture/comment ID
- [ ] No second reply is produced

## Done when

```text
✓ full real vertical flow works
✓ automated tests pass
✓ production deployment works
✓ mobile and desktop UI work
✓ secrets stay server-side
```

---

# Milestone summary

| Milestone | Result                                         |
| --------- | ---------------------------------------------- |
| M0        | Repository and monorepo exist                  |
| M1        | Frontend + API + Supabase work                 |
| M2        | DB schema, sessions and encryption work        |
| M3        | Real Instagram login shows `@username`         |
| M4        | Real media loads and automation saves          |
| M5        | Real comment webhook reaches backend           |
| M6        | `#Hello` produces real public reply            |
| M7        | Activity shows result; vertical slice complete |

---

# Recommended stop-and-test checkpoints

## Checkpoint A — after M1

```text
frontend → backend → database
```

Do not start Meta integration until this works.

## Checkpoint B — after M3

```text
real Instagram login → @username
```

Fix OAuth before continuing if this fails.

## Checkpoint C — after M4

```text
@username → 12 media → save automation
```

## Checkpoint D — after M5

```text
real Instagram comment → webhook received
```

Do not build reply logic until this works.

## Checkpoint E — after M6

```text
#Hello → public reply
```

## Checkpoint F — after M7

```text
#Hello → public reply → Activity SUCCESS
```

Vertical slice is complete.

---

# Do not add during this vertical slice

```text
private DMs
new follower automation
editable keyword
multiple keywords
multiple automations
multiple Instagram accounts
teams/workspaces
billing
Stripe
AI-generated replies
LLM runtime
analytics charts
queue
Redis
CRM
native mobile app
Supabase Auth
ORM
Beads
```

If one of these appears necessary, document why before expanding scope.

---

# Final definition of success

A real user can complete this without developer intervention:

```text
1. Login with Instagram
2. See their Professional account
3. Select one of their latest posts/reels
4. Write a public reply
5. Enable automation
6. Another user comments exactly #Hello
7. The configured public reply appears
8. The owner sees SUCCESS in Activity
```

After that, freeze v0.1 and decide the next vertical slice separately.
