# Code and API Documentation

## Purpose

The codebase has complementary forms of executable documentation:

```text
TSDoc comments → TypeDoc HTML
Zod route schemas → OpenAPI JSON → Swagger UI
```

PlantUML sources under `doc/diagrams/` document higher-level structure and request flow.

## Exported TypeScript declarations

Every exported application function, component, interface, type, variable, property, and interface
method must have a `/** ... */` TSDoc comment. Document behavior, parameters, return values, and
meaningful failure conditions. Do not repeat the implementation or include secrets and real
credentials.

Example:

```ts
/**
 * Creates a serverless-friendly PostgreSQL connection wrapper.
 *
 * @param connectionString - Server-only PostgreSQL transaction-pooler URL.
 * @returns Database operations used by the API process.
 */
export const createDatabase = (connectionString: string): Database => {
  // Implementation
};
```

Generate and validate the code documentation from the repository root:

```bash
pnpm docs:code
```

TypeDoc writes the generated HTML sites to:

```text
dist/docs/api-code/index.html
dist/docs/web-code/index.html
```

`dist/` is ignored because the HTML is generated output. The source comments and the TypeDoc
configuration in `apps/api/typedoc.json` and `apps/web/typedoc.json` are committed and remain
authoritative. TypeDoc treats missing required comments, invalid links, and warnings as failures.

## Interactive HTTP API documentation

Start the backend locally:

```bash
pnpm --filter @instagram-automation/api dev
```

Open Swagger UI:

```text
http://localhost:3000/api/docs
```

Swagger UI shows each documented method, path, response status, JSON schema, and example. Expand an
endpoint, select **Try it out**, and then select **Execute** to send a real request to the local
API.

The machine-readable OpenAPI document is available at:

```text
http://localhost:3000/api/openapi.json
```

Current documented operations:

| Method | Path                   | Input | Responses                     |
| ------ | ---------------------- | ----- | ----------------------------- |
| GET    | `/api/health`          | None  | `200`, `500`                  |
| GET    | `/api/health/database` | None  | `200`, `500`, sanitized `503` |

Unknown routes return the global JSON `404` envelope. Unexpected route errors return the global
sanitized JSON `500` envelope.

Documentation routes are enabled in development and test environments. The Node server disables them
automatically when `NODE_ENV=production` until a production access policy is approved.

## Adding or changing an endpoint

When adding a route:

1. Define request and response Zod schemas.
2. Define the route with `createRoute(...)`, including summary, description, tags, and every
   expected status code.
3. Register it with `OpenAPIHono.openapi(...)`.
4. Add tests for runtime responses and the generated OpenAPI path.
5. Add TSDoc to any new exported declarations.
6. Run all documentation and repository checks.

```bash
pnpm docs:code
pnpm check
pnpm test
pnpm typecheck
pnpm build
```

## Tool responsibilities

| Tool                | Responsibility                                                   |
| ------------------- | ---------------------------------------------------------------- |
| TSDoc               | Standard format for exported TypeScript comments                 |
| TypeDoc             | Validates comments and generates browsable code documentation    |
| Vitest              | Runs automated frontend and API tests                            |
| Testing Library     | Verifies user-visible React behavior and accessibility semantics |
| Zod                 | Defines runtime-safe request and response schemas                |
| `@hono/zod-openapi` | Converts Hono route definitions and Zod schemas into OpenAPI     |
| OpenAPI             | Machine-readable contract for HTTP operations                    |
| `@hono/swagger-ui`  | Interactive browser UI for inspecting and executing API requests |
| PlantUML            | Editable architecture, class, object, and sequence diagrams      |
