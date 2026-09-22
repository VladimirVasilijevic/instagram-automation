---
name: develop-vertical-slice
description:
  Implement a milestone feature across this repository's Hono API, PostgreSQL persistence, and React
  UI. Use for product work in the documented Instagram automation vertical slice; do not use for
  isolated tooling, documentation-only, or deployment-only changes.
---

# Develop a Vertical Slice

Start with the target milestone in `doc/02-first-vertical-implementation-plan.md`. Read only the
feature-specific guide when one exists. `doc/01-technology-stack-and-setup.md` describes current
state, so use it to distinguish implemented components from planned ones.

Follow the existing composition path instead of scanning the repository:

- HTTP contracts and handlers: `apps/api/src/routes/`, registered in `apps/api/src/app.ts`.
- Runtime adapters and configuration: `apps/api/src/runtime.ts` and `apps/api/src/config/`.
- Meta HTTP behavior: `apps/api/src/instagram/`.
- Persistence contracts and adapters: `apps/api/src/database/`; immutable SQL migrations are in
  `db/migrations/`.
- Browser API calls and screens: `apps/web/src/api/` and `apps/web/src/pages/`, composed by
  `apps/web/src/App.tsx`.

Put tests beside the changed implementation, matching the current route, adapter, repository, and
component test patterns. Keep raw Meta payloads inside the Meta adapter or webhook boundary. Keep
credentials, protected tokens, and session hashes out of browser DTOs and logs. Use same-origin
`/api` URLs in browser code.

The workspace packages under `packages/` are placeholders. Keep contracts inside `apps/api` until
another runtime consumer makes a shared package useful.

Update only documentation whose current behavior or milestone status changed. For an HTTP endpoint,
also check `doc/03-code-and-api-documentation.md` and preserve the OpenAPI route pattern.

Preserve the Vercel API service boundary in `vercel.json`: its build command must typecheck the
source entrypoint. A build that emits `apps/api/dist` during Vercel packaging can make Vercel select
the wrong handler.

Use `$verify-change` for iterative and final validation.
