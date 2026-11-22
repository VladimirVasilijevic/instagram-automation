# Local API load testing

For a bounded concurrent correctness simulation covering independent Instagram/Facebook rules and
duplicate normalized comments and Instagram Story replies with fake sends, run
`pnpm --filter @instagram-automation/api load-test:simulate` after migrating the isolated database.
See [the multi-automation notes](../doc/07-multiple-automations-and-reels.md). This simulation does
not establish Facebook Reel API support or production throughput.

This suite measures the real Hono routes and PostgreSQL repositories while replacing every Meta
adapter with a deterministic in-process fake. It must never target production, the production
database, a Vercel deployment, or the real Meta API.

## Safety boundary

Use a dedicated Supabase test project. The scripts require a separate `LOAD_TEST_DATABASE_URL`, an
explicit isolation confirmation, and a non-production runtime. They also reject a database endpoint
that matches `DATABASE_URL` or `DATABASE_MIGRATION_URL` in the shell or local `.env.local` file.
Confirm that the isolated project differs from any deployed database not listed locally.

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

## Multi-provider signed HTTP suite

The current multi-rule acceptance suite runs through a real loopback HTTP listener, Hono routes,
PostgreSQL repositories and deterministic Meta fakes. It uses Node's existing `fetch` and timers; k6
installation is not required for this suite. The k6 scripts above remain the older Instagram
comment-only benchmark and are not evidence for Facebook or Stories.

After checking the disposable database migration status and applying approved pending migrations:

```bash
pnpm --filter @instagram-automation/api load-test:db:status
pnpm --filter @instagram-automation/api load-test:db:migrate
pnpm --filter @instagram-automation/api load-test:http
LOAD_PROFILE=mixed pnpm --filter @instagram-automation/api load-test:http
LOAD_PROFILE=duplicate pnpm --filter @instagram-automation/api load-test:http
```

Each command creates four independent synthetic owners/connections (two per provider), starts the
listener on `127.0.0.1` with an ephemeral port, verifies exact results, closes the listener and
removes its exact fixture IDs even when a scenario fails. The suite does not use the legacy
generated configuration or require a separate server/setup/cleanup command. All workers and active
server handlers settle before deletion, and database clients close if cleanup fails. No provider
adapter that can call Meta is constructed. Authentication and media discovery use test-only injected
fakes; sessions, automation rules, executions, answers and follow-ups use real isolated persistence.

Preflight correctness checks exercise catalog pagination/category cursors; selected-owner rule
lists, exact reads and saves; foreign rule rejection; Story private-only saves; Facebook Reel/Story
rejection; webhook challenge/signature handling; unknown/disabled content; public/private/both
modes; two rules receiving a reused comment ID; repeated quick-reply answers and one follow-up;
deterministic slow, 429, permanent and timeout provider outcomes. Instagram Posts, Reels and Story
replies and Facebook Page Posts are included. Facebook Reel/Story product support is still
unavailable.

Measured arrivals are signed webhook deliveries only, alternating providers, content kinds, owners
and rules, with periodic multi-event batches. `smoke` schedules 15 arrivals at one per second.
`mixed` schedules 25 seconds each at 1, 5 and 10 arrivals/second (400 arrivals total). `duplicate`
schedules 10 seconds at one/second and 20 seconds at ten/second (210 repeated deliveries). At most
20 HTTP tasks run concurrently; excess arrivals are reported as dropped rather than queued. Late
starts over 100 ms, peak concurrency, completed inputs and request latency are recorded. The suite
waits for started requests to finish; preflight, drain and database work make wall time longer than
the arrival schedule. Requests have a 30-second timeout, and cleanup waits for server work too.

Correctness requires nonzero exact execution and fake dispatch counts, the right provider/owner,
media, channel, text and expected durable outcome, no duplicate provider dispatch, and exactly one
answer/follow-up per quick-reply conversation. Incorrect or missing work fails regardless of HTTP
200 responses. Dropped arrivals and unexpected HTTP statuses also fail the run. Provisional p95
under two seconds for normal webhook responses is reported separately: slow database connections can
fail this performance threshold while correctness passes. Do not interpret that result as a capacity
guarantee or weaken the threshold to make a run pass.

Reports are written to ignored `load-tests/.generated/http-smoke.json`, `http-mixed.json` and
`http-duplicate.json`; stdout includes the same metrics and exact fixture cleanup confirmation.
Preflight and measured HTTP timing are distinguished in the report; older captures may include
preflight latency and must be labelled accordingly. Reports include only synthetic fixture IDs and
aggregate results, never database passwords, live tokens or session cookies.

This suite measures local HTTP/application/isolated-database behavior with mocked Meta services. It
does not establish Meta permissions, real API schema compatibility, Vercel capacity, live OAuth or
production environment validity. The direct processor simulation remains a separate bounded
persistence check and does not replace signed HTTP testing.

### Observed isolated runs — 2026-11-22

These captures used the local API and the configured remote disposable database, with all Meta sends
mocked. Counts cover only admitted scheduled arrivals; exact execution/send verification
additionally includes the preflight failure matrix and six follow-ups. Injected provider failures
are expected execution outcomes, separate from unexpected HTTP failures.

| Profile         | Scheduled | Completed | Dropped | Exact executions | Mock send attempts | Correctness              | Performance |
| --------------- | --------: | --------: | ------: | ---------------: | -----------------: | ------------------------ | ----------- |
| Smoke           |        15 |        15 |       0 |               80 |                 86 | Passed                   | Passed      |
| Mixed           |       400 |       122 |     278 |              251 |                257 | Passed for admitted work | Failed      |
| Duplicate spike |       210 |        77 |     133 |               82 |                 88 | Passed for admitted work | Failed      |

All three runs had zero unexpected HTTP failures, six successful follow-ups and confirmed fixture
cleanup. The final smoke capture separates measured traffic from preflight: measured p95 was 1,277
ms for Instagram comments, 464 ms for Instagram Story replies and 1,370 ms for Facebook comments.
Duplicate-spike p95 was 15,267 ms, 14,789 ms and 13,220 ms respectively. The earlier mixed capture
combines preflight and load timing, so do not use its latency groups as a load-only estimate. Its
dropped-arrival counts still establish failure of the zero-drop threshold.

The 20-request concurrency cap was reached in both high-rate profiles. This identifies a limitation
of the tested local API/database setup; it does not establish the limiting component or production
capacity. Thresholds were retained. Capacity investigation and any application/database concurrency
changes require a separate implementation plan.
