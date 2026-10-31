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
| `WORKER_OFFER_EXPIRY_TICK_SECONDS` | Whole seconds above 0. **No value proposed** (note from F08: 30 is the example in the architect's text) | F08 `offer_expiry`: expires waitlist offers past their time, passes them on, and ends entries whose class or court hour has started. A late tick blocks nobody: an offer's held booking also ends with its own hold |
| `WORKER_CLASS_BELOW_MIN_TICK_SECONDS` | Whole seconds above 0. **No value proposed** (note from F08: 60 is the example in the architect's text) | F08 `class_below_minimum`: queues the alert to front desk at the club's below_min_alert_minutes before the start. Inert for a club that has not set the minutes |
| `WORKER_CLASS_GENERATE_CRON` | 5 cron fields, UTC. **No value proposed** (note from F08: the daily run is meant just after Bangkok midnight; `5 17 * * *` is 00:05 Bangkok and is the architect's example) | F08 `class_generate`: five cron fields, UTC; 17:05 UTC is 00:05 in Bangkok, the daily run that fills the booking window with class sessions |
| `WORKER_RATE_LIMIT_SWEEP_CRON` | 5 cron fields, UTC. **No value proposed yet** | For the `rate_limit_sweep` task (BE-P), which removes the web sign-in limiter's old rows (`web.md`). Required, no default |
| `WORKER_RATE_LIMIT_KEEP_SECONDS` | Whole seconds above 0. **No value proposed yet** | How long limiter rows are kept before the sweep removes them. Required, no default. Keep it at least as long as the longest limiter window (`WEB_SIGNIN_RATE_WINDOW_SECONDS`), so a row is never removed while it still counts; the limiter rows hold a keyed hash of the IP, not the address |
| `WORKER_PAY_TAP_PRUNE_CRON` | 5 cron fields, UTC. **No value proposed yet** | For BE-B's task that prunes old rows of the pay-tap limit (F03 design 4.8, D61). Required, no default: the worker will not start without it |
| `LINE_API_BASE_URL` | https base of the LINE Messaging API. **No value proposed here** | For the LINE sender (F10). Set per environment so QA can point the sender at the fake LINE (`tests/fakes`); staging and production use LINE's real address. Required, no default |
| `LINE_PUSH_TIMEOUT_MS` | Whole milliseconds above 0. **No value proposed** | How long one push may take before it counts as a timeout and goes to the retry path. LINE's documents do not state a figure I could rely on, so F10 and Security choose it. Required, no default |
| `SECRETS_PRIVATE_KEY` | **Secret.** PEM, from the key pair created for this environment (`secrets.md`, "Key pair") | The worker decrypts the club's LINE token and Beam keys with it. Required, no default. Held by `apps/web` and `apps/worker` only |
| `WORKER_PACKAGE_EXPIRE_CRON` | 5 cron fields, UTC. **No value proposed** | For `package_expire` (F06-T13). Guidance from FA 5.4, not a value: every 5 minutes |
| `WORKER_WALLET_EXPIRE_CRON` | 5 cron fields, UTC. **No value proposed** | For `wallet_expire` (F06-T13). Guidance from FA 5.4, not a value: at least once a day. Cron is UTC, so a daily run at a Bangkok clock time is written seven hours earlier |
| `WORKER_SESSION_START_CRON` | 5 cron fields, UTC. **No value proposed** | For `session_start` (F06-T13). Guidance from FA 5.4, not a value: every minute (the smallest step cron allows) |
| `WORKER_CONSOLE_SWEEP_CRON` | 5 cron fields, UTC. **No value proposed yet** | For BE-P's sweep of the BOOQ console's (`apps/platform`) expired sessions. Required, no default |
| `WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS` | Whole seconds, **at least the console's absolute session limit**. That limit is 8 hours in code, so at least `28800`. **No value proposed yet** | The sweep must never remove a session that is still within its absolute life, so this setting is the floor under it. If the console limit is ever raised, raise this first. Matches Security's `boq_session_absolute_hours` = 8 (threat model section 6). Required, no default |

### Deploy environment checklist, `apps/worker`

Set in the worker's hosting environment (staging, production), all without defaults in code: `DATABASE_URL`, `WORKER_QUEUE_URL`, `WORKER_HOUSEKEEPING_CRON`, `WORKER_IMPORT_SWEEP_CRON`, `WORKER_HOLD_RELEASE_TICK_SECONDS`, `WORKER_RATE_LIMIT_SWEEP_CRON`, `WORKER_RATE_LIMIT_KEEP_SECONDS`, `WORKER_PAY_TAP_PRUNE_CRON`, `WORKER_PACKAGE_EXPIRE_CRON`, `WORKER_WALLET_EXPIRE_CRON`, `WORKER_SESSION_START_CRON`, `LINE_API_BASE_URL`, `LINE_PUSH_TIMEOUT_MS`, `SECRETS_PRIVATE_KEY`, `WORKER_CONSOLE_SWEEP_CRON`, `WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS`, `WORKER_OFFER_EXPIRY_TICK_SECONDS`, `WORKER_CLASS_BELOW_MIN_TICK_SECONDS`, `WORKER_CLASS_GENERATE_CRON`. A missing one means the worker will not start, which is the intent. (Checked against `apps/worker/src/config.ts` on `main`, 31 Oct: it reads the other sixteen. `LINE_API_BASE_URL`, `LINE_PUSH_TIMEOUT_MS` and `SECRETS_PRIVATE_KEY` are not read by the worker on `main` yet; F10 wiring will add them, and until then a missing one does not stop the worker.) All nineteen must be set on production by 4 Dec.

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
