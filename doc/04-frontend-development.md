# Frontend Development

## Current result

`apps/web` is a React and TypeScript application for the Milestone 1 infrastructure proof. It shows
independent API and database states, supports manual refresh, and links to the local Swagger UI.

The browser calls only same-origin paths:

```text
/api/health
/api/health/database
/api/docs
```

During local development, Vite proxies `/api` to `http://127.0.0.1:3000`. Production hosting must
route the same paths to the API. No backend URL or secret is compiled into browser code.

## Run locally

Install the locked dependencies from the repository root:

```bash
pnpm install
```

Make sure `.env.local` contains a valid `DATABASE_URL`, then start the frontend and backend:

```bash
pnpm dev
```

Open:

```text
http://localhost:5173
```

Expected page state:

| Card     | Expected state | What it proves                                     |
| -------- | -------------- | -------------------------------------------------- |
| API      | Connected      | React reached `GET /api/health` through the proxy  |
| Database | Connected      | The API ran `select 1` against Supabase PostgreSQL |

Select **Refresh status** to run both checks again. Select **Open API documentation** to open
Swagger UI at `http://localhost:5173/api/docs` through the same proxy.

## Manual HTTP checks

With `pnpm dev` running:

```bash
curl --fail --show-error http://localhost:5173/api/health
curl --fail --show-error http://localhost:5173/api/health/database
curl --fail --show-error --output /dev/null http://localhost:5173/api/docs
```

Expected JSON responses:

```json
{ "status": "ok" }
```

```json
{ "status": "ok", "database": "connected" }
```

If PostgreSQL is unavailable, the database request returns HTTP `503` and this sanitized body:

```json
{ "status": "error", "database": "unavailable" }
```

## Frontend commands

Run these from the repository root:

| Command                                                 | Purpose                              |
| ------------------------------------------------------- | ------------------------------------ |
| `pnpm --filter @instagram-automation/web dev`           | Start only the Vite development UI   |
| `pnpm --filter @instagram-automation/web test`          | Run frontend tests once              |
| `pnpm --filter @instagram-automation/web typecheck`     | Check TypeScript                     |
| `pnpm --filter @instagram-automation/web build`         | Create the production static bundle  |
| `pnpm --filter @instagram-automation/web preview`       | Preview the generated bundle locally |
| `pnpm --filter @instagram-automation/web run docs:code` | Generate frontend TypeDoc HTML       |

Repository-wide verification remains:

```bash
pnpm check
pnpm test
pnpm typecheck
pnpm build
pnpm docs:code
```

## Project structure

```text
apps/web/
├── index.html                 # Build-tool HTML entry
├── postcss.config.mjs         # Tailwind PostCSS integration
├── vite.config.ts             # Vite adapter and local API proxy
├── vitest.config.ts           # Browser-like test environment
├── typedoc.json               # Exported-code documentation rules
└── src/
    ├── App.tsx                # Status-page composition and refresh behavior
    ├── api/health.ts          # Standard fetch client and response validation
    ├── components/StatusCard.tsx
    ├── index.css              # Tailwind import and global defaults
    ├── main.tsx               # Browser mount point
    └── test/setup.ts          # Shared test cleanup and DOM matchers
```

## Vite replacement boundary

Vite is a development server and production bundler, not an application runtime dependency. Its
responsibilities are limited to:

- transforming the `index.html` and TypeScript/JSX entry points;
- running React Fast Refresh during local development;
- proxying local `/api` requests to port `3000`;
- producing static CSS, JavaScript, and HTML assets.

The React components and API client use standard React and browser APIs. Application source does not
use `import.meta.env`, `import.meta.glob`, or `import.meta.hot`. Tailwind uses PostCSS instead of
the Vite-specific Tailwind plugin.

To replace Vite later, provide an HTML entry, TypeScript/JSX transformation, CSS/PostCSS processing,
static asset output, and a local `/api` proxy or equivalent same-origin server. The expected changes
are confined primarily to package scripts and build configuration; the page, components, tests, and
API client should remain unchanged.

## Frontend tools

| Tool                      | Responsibility                                       |
| ------------------------- | ---------------------------------------------------- |
| React                     | Components and state                                 |
| TypeScript                | Static type checking                                 |
| Vite                      | Replaceable development/build adapter                |
| Tailwind CSS with PostCSS | Styling without a Vite-specific Tailwind integration |
| Vitest                    | Test runner                                          |
| Testing Library           | Tests based on user-visible behavior                 |
| jsdom                     | Browser-like test DOM                                |
| TSDoc and TypeDoc         | Exported-code comments and browsable documentation   |
| PlantUML                  | Architecture, component, object, and call diagrams   |
