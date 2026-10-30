# Worker: configuration and schedules

Proposal, 30 Oct 2026, from the Orchestrator's request for `apps/worker` start-up config (no defaults in code). Checked against the repository (`apps/worker/src/*`, migration `0007_import_export.sql`, F03 design 6, FA 5.4) and the installed library (`graphile-worker` 0.18.0). Nothing here was run against a real Supabase project, because none exists yet.

## Variables

Each deployment has its own environment, so the worker's `DATABASE_URL` is the worker role's and no other app sees it (`secrets.md`).

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Connection for role `booq_worker` | Club data, through `withClubTx`. Both the transaction pooler and the session pooler work here; the worker holds no session state between transactions |
| `WORKER_QUEUE_URL` | Connection for the queue role, **direct or session mode, never transaction mode** | Graphile Worker uses LISTEN/NOTIFY. See "Connection" below |
| `WORKER_HOUSEKEEPING_CRON` | `*/5 * * * *` | See "Schedules" |
| `WORKER_IMPORT_SWEEP_CRON` | `*/15 * * * *` | See "Schedules" |
| `WORKER_HOLD_RELEASE_TICK_SECONDS` | `20` | Proposed name, for BE-P. Inside the 15 to 30 s that F03 design 6 and FA 5.4 allow |

## Schedules

**Cron times are UTC.** The library's cron code works with UTC date methods and has no time zone setting. Servers and CI stay in UTC (`plan.md` section 2), so write a Bangkok time as UTC minus 7 hours. None of the three schedules below is tied to a Bangkok clock time.

| Task | Schedule | Why |
|---|---|---|
| `housekeeping` | `*/5 * * * *` (every 5 minutes) | In `worker.ts` this task does **not** purge anything. It records queue lag and dead jobs into `platform.worker_heartbeat`, which feeds the P1 alert. FA 5.4 lists it as "daily", which would make a dead job visible up to 24 hours late. Five minutes is cheap (one aggregate query). If BE-P later adds purges of old idempotency keys and dead outbox rows to the same task, split them into a separate daily task, for example `30 20 * * *` (03:30 Bangkok) |
| `import sweep` (`app.sweep_import_staging()` per club) | `*/15 * * * *` (every 15 minutes) | Expired import staging holds players' names and phones. A sweep every 15 minutes bounds how long an expired file lingers, and costs one small update per club. Hourly would also be acceptable; the retention length itself is Security's open schedule (Q-07), not mine |
| `hold_release` tick | every **20 seconds** | A cron line cannot do this: the library's cron has a one-minute resolution. See below |

### The 20 second tick

Recommended: an **in-process timer** in the worker's `main.ts` that runs `runHoldRelease` every `WORKER_HOLD_RELEASE_TICK_SECONDS`, with an overlap guard (start the next wait only after the current tick ends, so a slow tick never runs twice at once in one process).

- Several worker processes are safe: `release_hold` is guarded by a status check under a row lock (FA 5.4), so two ticks releasing the same order do nothing the second time.
- Correctness never depends on the tick (BOOK-03-AC6): a late tick blocks nobody, because the claim releases expired holds in its way. The tick finishes the side effects, so the alert is about lag, not about correctness.
- Not recommended: a Graphile job that re-queues itself every 20 s. It works through `runAt` and `jobKey` with `jobKeyMode: 'replace'` (both exist in 0.18.0), but what happens to a key whose job is currently running is something the library docs leave to a test, and a chain that breaks once stops silently. If BE-P prefers jobs, add a one-minute cron line that enqueues the same task with `jobKeyMode: 'preserve_run_at'` as a safety net, and test the broken-chain case.
- Alert thresholds (mine, adjustable): lag over **90 seconds** for two readings is a warning; an expired hold still held after 5 minutes is a page (`plan.md` section 5).

## Connection

Facts from Supabase's connection documentation: transaction mode (port 6543) loses session state, which includes LISTEN/NOTIFY, so Graphile Worker cannot use it. The direct connection (port 5432) is IPv6 unless the project has the IPv4 add-on; the **session pooler** (port 5432 on the pooler host) is IPv4 and keeps session state. Sources: [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres), [Connection pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).

- `WORKER_QUEUE_URL`: the **session pooler** URL unless the worker's host has IPv6 (then direct). Decide when the hosting provider is chosen: many hosts are IPv4 only, and the IPv4 add-on costs extra.
- `DATABASE_URL` (club data) can use the transaction pooler like the web app, as long as every setting is transaction-local (`set_config(..., true)`, FA 4.3), which `withClubTx` already does.
- Connection count: the queue connection plus LISTEN holds a few connections per worker process (`concurrency` is 2 now). Check the plan's connection limit when the project exists.

## Schema creation (`graphile_worker`)

Confirmed in the library source: on start-up Graphile Worker runs its own migrations, and the first statement is `create schema if not exists graphile_worker` (`dist/migrate.js`). So the queue role must be able to create that schema, or the schema must already exist and the role must own it.

Recommendation, least privilege:
1. A **dedicated queue role** (call it `booq_queue`; the Architect names it), separate from `booq_worker`. It has **no grant on any table in `public`, `app` or `platform`**. It only owns the `graphile_worker` schema. The `housekeeping` task already reads `graphile_worker.jobs` through the queue connection.
2. Create the schema once in a migration run as `booq_owner`: `create schema graphile_worker authorization booq_queue`. Then the library's `create schema if not exists` is a no-op and the role needs **no `CREATE` privilege on the database**. The alternative, `grant create on database postgres to booq_queue`, also works but gives more than needed.
3. Payloads hold ids only (already the rule), so a read of the queue tables shows no personal data.

**Not confirmed:** whether every statement the library's migrations run is allowed for a non-superuser custom role on Supabase, and whether the `postgres` database name is the right one to grant on. That is the "DevOps spike: custom roles through the pooler, direct connection for the worker" in FA section 10, item 4. It runs the first time a staging project exists, and the result is written here.

## Monitoring (changed)

`apps/worker` writes heartbeats to the database table `platform.worker_heartbeat` (counts only: last start, last success, failures, lag, dead jobs). It does **not** push to an outside monitor. So the outbound `HEARTBEAT_URL_*` variables in `infra/env/.env.example` are removed. For the external alert path (`plan.md` section 5), an external uptime monitor needs something to call: a small **health route in `apps/platform`** that returns counts only (lag, dead jobs, seconds since last success per task) behind its own check. That route is BE-P's to build; this note is the request.

**Update:** the platform health service (`apps/platform/src/health`, migration 0045 `platform.worker_health`) is that route. It checks a shared token, **`HEALTH_TOKEN`**, which is required and has no default. It is set only in the `apps/platform` deployment, and the external monitor sends the same value on every poll. Treat it as a platform secret (`secrets.md`): hosting environment variable, never in the repo or the monitor's public config, and rotate both sides together if it leaks. The alert thresholds (lag over 90 seconds for two readings, an expired hold still held after 5 minutes) stay with the monitor, not in the app.
