# Local API load testing

This suite measures the real Hono routes and PostgreSQL repositories while replacing every Meta
adapter with a deterministic in-process fake. It must never target production, the production
database, a Vercel deployment, or the real Meta API.

## Safety boundary

Use a dedicated Supabase test project. The scripts require a separate `LOAD_TEST_DATABASE_URL`, an
explicit isolation confirmation, and a non-production runtime. They also reject a database endpoint
that matches `DATABASE_URL` or `DATABASE_MIGRATION_URL` when either is present.

Copy `load-tests/env.example` to `.env.load-test.local` and add only test-project credentials. The
transaction pooler belongs in `LOAD_TEST_DATABASE_URL`; the session pooler belongs in
`LOAD_TEST_DATABASE_MIGRATION_URL`. Never paste either credential into chat, a k6 script, or Git.

The setup command writes a mode-`0600` generated file under the ignored `load-tests/.generated/`
directory. It contains the synthetic browser session and fake webhook secret needed by k6.

## Prerequisites

- Node.js and pnpm versions already required by the repository.
- A dedicated, disposable Supabase project.
- [k6 installed locally](https://grafana.com/docs/k6/latest/set-up/install-k6/). The repository does
  not install k6 as an npm dependency.

## Prepare the isolated database

From the repository root:

```bash
pnpm --filter @instagram-automation/api load-test:db:status
pnpm --filter @instagram-automation/api load-test:db:migrate
pnpm --filter @instagram-automation/api load-test:setup
```

Migration is an external database mutation and should be run only after confirming both connection
strings belong to the disposable test project.

Start the test-only API in a separate terminal:

```bash
pnpm --filter @instagram-automation/api load-test:server
```

No route in this server can call Meta. Reply behavior comes from the synthetic comment ID:
`success`, `slow`, `rate-limit`, `permanent`, or `timeout`.

## Run profiles

Every profile uses an arrival-rate model. `smoke` sends 1 request/second, `average` sends 5
requests/second, `discovery` ramps through 1, 5, 10, and 25 requests/second, `spike` jumps from 1 to
25 requests/second, and `soak` sends 5 requests/second for 30 minutes.

The baseline script runs five routes independently, so its total request rate is five times the
selected per-route rate:

```bash
k6 run -e LOAD_PROFILE=smoke load-tests/k6/baseline.js
k6 run -e LOAD_PROFILE=discovery load-tests/k6/baseline.js
```

Run the critical signed-webhook path independently:

```bash
k6 run -e LOAD_PROFILE=smoke load-tests/k6/webhook.js
k6 run -e LOAD_PROFILE=discovery load-tests/k6/webhook.js
```

Use a fresh fixture run for each measured profile: stop the server, verify, clean up, run setup
again, and restart the server. Reusing one run can intentionally turn repeated iteration IDs into
duplicates and make later latency results misleading.

Concurrency and failure scenarios:

```bash
k6 run -e LOAD_PROFILE=spike -e LOAD_TEST_DUPLICATE=true load-tests/k6/webhook.js
k6 run -e LOAD_PROFILE=smoke -e LOAD_TEST_EVENTS_PER_REQUEST=10 load-tests/k6/webhook.js
k6 run -e LOAD_PROFILE=smoke -e LOAD_TEST_BEHAVIOR=slow load-tests/k6/webhook.js
k6 run -e LOAD_PROFILE=smoke -e LOAD_TEST_BEHAVIOR=rate-limit load-tests/k6/webhook.js
k6 run -e LOAD_PROFILE=smoke -e LOAD_TEST_BEHAVIOR=timeout load-tests/k6/webhook.js
k6 run -e LOAD_PROFILE=smoke -e LOAD_TEST_BEHAVIOR=permanent load-tests/k6/webhook.js
```

`success` and `slow` should persist `succeeded`; `rate-limit` should persist `retry_pending`;
`timeout` should persist `uncertain`; `permanent` should persist `failed`. All webhook deliveries
are still acknowledged because provider outcome is tracked in the execution record.

## Verify and clean up

Stop the load-test server before verification so no request is still in flight, then run:

```bash
pnpm --filter @instagram-automation/api load-test:verify
pnpm --filter @instagram-automation/api load-test:cleanup
```

Verification prints counts by channel and status and fails if it finds duplicate execution keys or
records still in `processing`. Cleanup resolves the exact generated account ID and removes its
executions, automation, sessions, and account in that order. It does not use a wildcard or delete
unrelated data.

## Interpreting results

Record the selected profile, test database region, API host, k6 summary, status counts, and server
log-count summary. The provisional thresholds require over 99% successful checks, less than 1% HTTP
failures, no dropped iterations, p95 under 250 ms for API health, 750 ms for database health, 1
second for authenticated reads, and 2 seconds for normal webhook processing. These are discovery
thresholds, not production SLOs.

The suite proves local API and isolated-database behavior only. It does not prove Vercel capacity,
Meta capacity, browser performance, or production readiness.
