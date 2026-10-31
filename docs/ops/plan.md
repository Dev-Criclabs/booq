# BOOQ operations plan (DevOps / SRE)

Status: **updated 30 Oct 2026 for the round 2 decisions** (`docs/decisions.md`: D3 to D7). Nothing here changes a product rule. Where a choice still needs a person, it is marked **Decision**. Hunter is the first real build: there is no existing Booq core, code or database to migrate. **D16: the 7 Dec test runs on production with Hunter in Testing status. Staging is for development and QA only.**

Sources: `CLAUDE.md`, PRD v1.2 (Quality and scope, Platform and LINE, LINE message costs), hand-off v1.2 (Architecture, PLAT, PDPA-01, PAY, LINE), `docs/DEVELOPMENT-PLAN.md`.

Related files: `docs/ops/secrets.md` (keys and rotation), `docs/ops/accounts.md` (what the user arranges), `docs/ops/runbooks.md`, `.github/workflows/ci.yml`, `infra/`.

Dates: test with mock bookings **7 Dec 2026**, public booking **29 Dec 2026**, soft launch 9 Jan 2027.

## 1. Fixed by the specs

| Rule | Source | What it means for ops |
|---|---|---|
| Next.js with LIFF SDK, Postgres (Supabase) with row level security by club ID, server jobs | Hand-off, Architecture (adopted 30 Oct) | One codebase, one database, every row carries a club ID |
| Daily backups | PDPA-01, PRD Quality | Section 4 |
| Club is controller, BOOQ is processor | PDPA-01 | BOOQ staff access to production data is limited (section 6) |
| BOOQ staff never see players, bookings, payments, slips, receipts, wallets, reports | PRD, Roles | No ops dashboard or log may expose them. Section 5 |
| All times Asia/Bangkok | PRD | Servers and CI stay UTC. App code converts. Jobs are scheduled with the zone stated |
| Court grid and class schedule load under 2 s on 4G inside LINE | PRD Performance | Region choice, section 3 |
| Test mode with mock bookings for 7 Dec (Hunter has no slips; slip checking is F16, not for Hunter) | PRD Quality, D16 | The test runs on **production** with Hunter in Testing status (section 2). Staging is for development and QA only |
| Each club has its own LINE OA, LIFF app, rich menu, and its own Beam merchant account | Hand-off | Credentials are per club. `secrets.md` |
| The club pays its own LINE plan and Beam fees | PRD Platform foundation | Not a BOOQ cost line |

## 2. Environments

| Env | Purpose | Where | Data | Deploys |
|---|---|---|---|---|
| **local** | Developer and Claude Code sessions | Developer machine, Supabase CLI local stack | Seed data only. Fake Beam, fake LINE | n/a |
| **preview** | One per branch or PR, to look at a change | Hosting provider preview URL | Shared **preview** database (see below) with seed data. Fake Beam, fake LINE | Automatic on each push |
| **staging** | Development and QA only (D16). Real LINE test OA, real Beam sandbox | Own hosting project and own Supabase project | Mock bookings and fake slips only. Never real players | Automatic from `main` |
| **production** | The 7 Dec test (Hunter in Testing status, D16) and Hunter from 29 Dec | Own hosting project and own Supabase project | Hunter's Testing data (flagged, purged at Go live, D4), then real | Manual approval, from a tag or from `main` |

Rules:
- Staging and production are **separate Supabase projects** and separate hosting projects. No shared database, no shared keys.
- Preview environments do **not** get their own Supabase branch database at first. They share one `preview` Supabase project reset from seed data weekly. This is cheaper, and nothing real is in it. Per-branch databases can follow if migrations collide.
- Preview and local always use the fake Beam and fake LINE that QA builds. Only staging and production talk to the real LINE and Beam.
- Staging has its own LINE provider and test OA, LIFF app and Beam sandbox merchant (`accounts.md`). A test OA must never be the production OA.
- Environment settings that differ (URLs, keys, LIFF IDs) are listed in `infra/env/.env.example`. The values live in the hosting provider and are never committed.
- Club status (Draft, Testing, Live, Paused, PLAT-01) is a product feature and is separate from the environment. **Testing mode (D4):** test data is flagged, test bookings use their own non-legal receipt numbers, and the flagged data is purged at Go live so Hunter's real receipts start at 000001. See section 6a for what ops does around the purge.
- **Settled (D16):** the 7 Dec test runs on production with Hunter in Testing status. So the production Supabase project, hosting, backups, monitoring, alerts and on call must be ready by **4 Dec**, not 21 Dec. Hunter uses its **test Beam key set** (the Playground) while Testing and its **live set** after Go live; the live set is entered in the Go live window and checked by the smoke test (D32, D108, runbook 13). There is one LINE channel set per club and no test LINE configuration: test messages go through Hunter's real Official Account and count toward its monthly cap, so Hunter's real OA, LIFF app and a paid plan are needed **before 4 Dec** (D32). Staging stays for development and QA, with fake data only.
- Database migrations are applied by CI/CD in this order: preview, staging, production. A migration reaches production only after it ran on staging. Migrations are forward only. A rollback is a new migration, or a restore (section 4).

**Decision 1, hosting.** Supabase for Postgres is settled (D5). Still open for the Next.js host: **Vercel** (recommended, preview per branch is built in, paid team plan for a business product) or a container host in the same region. See `accounts.md`.

**Decision 2, who may approve a production deploy.** Proposed: the user, or a named person they pick. Branch protection on `main` needs the `CI result` check green and one reviewer (the Reviewer role).

## 3. Region

**Decided (D5): Supabase in Singapore (`ap-southeast-1`), with a data-processing agreement.** The Next.js functions run in the same region, so the court grid reads are one hop, which matters for the 2 second target. Supabase and Vercel do not have a Thailand region as far as I know; confirm on their region pages before creating projects.

**Risk R1: cross-border transfer under PDPA.** Personal data stored in Singapore is a transfer abroad. The club is the controller and BOOQ the processor.
- Record only: the PDPA question on storing data in Singapore has been deferred by the user, and the D5 hosting choice stands for now. Nothing in the schedule depends on an answer. The privacy notice and the processor contracts are the places it would show up.
- Sign the **data-processing agreements** with Supabase (and the hosting provider, error tracking and any other processor that sees personal data) before real player data goes in. Keep them in the password manager.
- **Fallback, if hosting ever has to change: self-hosted Postgres in Thailand.** What it would mean: a Thai data centre or cloud host, then BOOQ runs Postgres itself, with row level security as now but without Supabase's managed backups, auth and storage. We would need to replace those: own backup and PITR (for example pgBackRest or WAL-G), own storage, own auth for BOOQ staff, patching and on call. That is real extra work and cost. The application should avoid depending on Supabase-only features where a plain Postgres choice is as easy (the Architect decides). A move is easier before real data exists.
- Preview and staging hold fake data only. Production holds Hunter's Testing data from the 7 Dec test (the owner and named BOOQ testers, D4), flagged and purged at Go live.
- Where data is stored, and that deleted data stays in backups until they age out, goes into the privacy notice.

Performance checks to run on staging before 7 Dec: court grid and class schedule at p95 under 2 s from a Thai 4G phone inside the LINE browser (QA owns the test, DevOps provides the synthetic probe in section 5).

## 4. Backups and restore

PDPA-01 asks for daily backups. Backups hold real personal data, so they are in scope for the same access rules as the database.

| Item | Plan |
|---|---|
| Database daily backup | Supabase daily backup on the **Pro plan** for staging and production (the Free plan has no backups). Check the plan page for the current retention (7 days at the time of writing) |
| Point in time recovery | **Proposed for production from 29 Dec.** It is a paid add-on. It gives recovery to the minute, which matters for payments, wallet and credit ledgers. Cost to be confirmed with Supabase. **Decision 4: yes or no** |
| Independent copy | A nightly `pg_dump` (custom format) pushed by a scheduled GitHub Action or a job to an object storage bucket **in a different account** from Supabase, encrypted at rest and with a 30 day lifecycle. This protects against losing the Supabase project or account. Needs the bucket (`accounts.md`). Not written yet because it needs credentials |
| Files (uploaded slips, receipts PDFs, club logos) | Slips only exist for slip clubs (not Hunter). Receipts and logos live in Supabase Storage. Storage is not covered by the database backup. The nightly job must also copy the bucket, or receipts are regenerated from data. **Open: ask the Architect which receipts are stored vs rendered on demand** |
| Retention | Daily 7 days (provider), nightly dump 30 days. Longer periods and the right to delete (PDPA) interact: deleted data stays in backups until they age out. The privacy notice should say so. Writing a deletion log so a restore can re-apply deletions is proposed (Architect) |
| Who can restore | Two named people only. Restores into production need the user's approval |
| Encryption | Provider encryption at rest. The independent copy is encrypted with a key kept in the password manager, not in the same bucket |

### Restore drill

A backup that has never been restored is not a backup.

| When | What | Pass |
|---|---|---|
| **Before 7 Dec** (target 30 Nov to 3 Dec), on **production** into a scratch project (D16) | Restore the latest daily backup into a **new empty project**. Run the smoke checks in the runbook | Restore done in under 2 hours. Row counts match. Ledgers add up (credit and wallet balance equals sum of rows). Court and coach uniqueness rule still rejects a double booking |
| **Before 29 Dec** (target 21 Dec), on production | Restore the nightly dump, then a point in time restore if bought, into a scratch project, never over production | Same, and the time taken is written down as the real recovery time |
| Every quarter after | Repeat, rotate who runs it | Same |

Targets (proposed, for the user to accept): **recovery point 24 hours** (1 hour with PITR), **recovery time 4 hours**. Steps are in `runbooks.md`, "Restore the database".

## 5. Monitoring and alerting

Worker configuration, schedules and the Supabase connection notes are in `docs/ops/worker.md`. Web settings, the client IP and rate limiting are in `docs/ops/web.md`.

Principle: monitoring sees **system health and counts, never personal data**. Logs must not hold names, phone numbers, LINE user IDs, slip images, or message text. Error tracking is set to strip request bodies. This keeps BOOQ staff on the right side of "never see a club's players, bookings, payments".

| Signal | How | Alert when | Severity |
|---|---|---|---|
| App uptime and sign-in path | External probe (every 1 min) on the health route and the LIFF entry URL | 2 failures in a row | Page |
| Court grid speed | Synthetic probe against a seeded test club on staging and a read-only health club in production | p95 over 2 s for 15 min | Warn |
| **Server job failures** (hold release, reminders, package expiry, waitlist offers, birthday and referral jobs) | The worker writes `platform.worker_heartbeat` (last success, failures, queue lag, dead jobs; counts only). An external monitor polls a counts-only health route in `apps/platform` (request to BE-P, `worker.md`). Hold release ticks every 20 s | A task fails, or has not succeeded within 2x its schedule; dead jobs above 0; hold-release lag over 90 s for two readings. **Hold release** is the sharpest: a late tick blocks nobody (the claim releases expired holds) but leaves side effects undone | Page for hold release and reminders, warn for the rest |
| Backlog of expired holds | Count of holds past their expiry time still marked held | More than 0 for 5 min | Page |
| **LINE Messaging API token expiry or revocation** | Daily check per club: call LINE `GET /v2/bot/info` with the club's token. Also on every send: a 401 or 403 raises the alert | Any non-200 from the info call, or a 401 on a send. Also at 7 days before expiry if the token type has an expiry. Matches **LINE-06** (P1 alerts when the token fails) | Page (reminders and confirmations stop) |
| LINE message quota | Daily call to LINE's message quota consumption endpoints per club | **70%** of the plan (alert) and **80%** (reminders stop), as decided in LINE-07 and D17. Booking and payment messages are never blocked. Test messages count (D32). The free plan stops at 300 messages, so any club on Free must be watched | Warn at 70%, page at 80%. The thresholds are platform settings, not DevOps's; DevOps only wires the alert |
| LINE send errors | Counter of non-2xx by status code, no content | Rate above 5% over 15 min | Warn |
| **Beam callback failures** | Counters from the callback route, by key set: verified, bad signature, wrong amount, unknown charge, late (PAY-03), processing error, valid signature on the inactive key set | Any processing error. Every bad signature shows in P1 and the app raises one alert per time window (D75); the app, not ops, owns that rule. A payment created more than 20 minutes ago with no callback (the 20 minutes is an ops default, not a product rule) | Page for processing errors, warn for the rest |
| Beam reconciliation | Nightly job compares paid orders with Beam's own report for the day, ties to the daily close (RCPT-03) | Mismatch | Page next morning |
| Database | Supabase metrics: CPU, connections, disk, slow queries, replication lag if any | Disk over 80%, connections over 80% | Warn |
| Backups | Job checks that yesterday's backup and the nightly dump exist and that the dump is not tiny | Missing | Page |
| Error rate | Error tracking (**Sentry** or provider logs) with personal data scrubbing on | New error class, or rate spike | Warn |
| CI and deploys | GitHub Actions status; deploy failures | Failure on `main` | Warn |
| Secret exposure | GitHub secret scanning with push protection enabled on the repo | Any hit | Page, then rotate (`secrets.md`) |

Alert routing: one on-call channel (LINE group or email for the user and DevOps person, with an SMS or phone alert for "Page"). **Decision 5: who is on call from 29 Dec** (hours of cover: the club opens 06:00 to 24:00, so a hold-expiry failure at 22:00 matters).

Alerts must be actionable: each one links to a runbook entry.

Status page: not for 7 Dec. Revisit after Hunter's soft launch.

## 6. Access and PDPA operations

- Production database access is **not** given to BOOQ platform staff. Platform admins use the platform console, which exposes setup only (PLAT-02). **BOOQ staff sign in with email plus a second factor, separate from LINE (D3).** Setup is in section 6b. Per D2, the console may show aggregate counts (bookings in the last 30 days per club) and the owner's contact details, never individual bookings, players, payments, slips, receipts, wallets or reports. Monitoring follows the same limit. Engineers get production read access only through a break-glass procedure: a ticket, a reason, a time limit, and a log. The procedure and every use are written down.
- **No anon or service role key in any app environment.** The Supabase Data API, GraphQL and Realtime are switched off on the staging and production projects, and apps connect only through their own database role (`secrets.md`). A request with the anon key to the REST path must fail; the check is on the launch checklist (Security SR-06).
- **Database owner access:** at most **two named people**, with hardware keys; the `booq_owner` password is not known to any person; migrations run through CI. **Hardware key or passkey** for the two or three people with production owner rights on GitHub, hosting and the database provider; a second factor for everyone else (Security OPS-4).
- **Break-glass** to read club data in an incident: ticket, reason, second approver, 4 hour limit, record kept outside the database, the club owner told (runbook 16; Security SR-21). Provider access logs are reviewed monthly by a named person.
- **Tamper evidence (by 21 Dec):** if the Architect builds the per-club hash chain on the audit table and ledgers (Security SR-21), a nightly job writes the latest hash per club to the backup bucket, and a restore verifies the chain.
- **Backup bucket:** its access list has two names; the age private key that decrypts dumps is held by two named people outside the bucket.
- **BOOQ people who are LINE admins of a club's Official Account, or have access to a club's Beam merchant, are listed per club** and removed after setup unless the club asks otherwise (Security R-13).
- Row level security by club ID is the Architect's and Security's work. DevOps adds a CI step for **RLS tests** once the Security role supplies them (placeholder in `ci.yml` is the `test` script).
- Data copy or delete on request (PDPA-01) is an application feature (F01 and the Security role). DevOps provides the runbook for the part that touches backups.
- Logs: 30 days, no personal data. Audit entries (PLAT-04) live in the database, not in logs.
- A personal data breach: runbook entry exists. Under Thailand's PDPA, the controller (the club) must notify the regulator within 72 hours of becoming aware, where there is a risk. BOOQ as processor tells the club without delay. The exact wording and timeline come from the club's adviser. Please check this with legal advice, I am not a lawyer.

- **Outbound rules:** the worker (and, for probes of just-typed values, the console) must reach LINE's two hosts and **both** Beam hosts over HTTPS, including `playground.api.beamcheckout.com` on production while Hunter is Testing. The table is in `docs/ops/worker.md`, "Outbound access".

### 6a. Testing mode and the purge at Go live (D4)

- The purge deletes only rows flagged as test data, for that club. It runs once, when the club moves to Live (P4), as a product feature (F01, F13, F15). DevOps's part:
  1. Take a **named backup** of the production database just before the purge (kept 30 days) so a wrong purge can be undone.
  2. The purge job logs counts per table, no personal data.
  3. After it runs, ops checks that real tables are unchanged, test flags are gone, and the club's receipt sequence next number is 000001 (RCPT-01). The checks are written with the Architect once the schema exists.
- Backups taken before the purge still hold test data until they age out. Test data is not personal data of real players, so this is acceptable; the testers are real people with real LINE accounts, so the privacy notice and consent text must be final before 7 Dec (already a deadline).
- BOOQ sees pass or fail only for testers' bookings (D4). Monitoring keeps to counts for the same reason.

### 6b. BOOQ staff sign in (D3)

- BOOQ staff are users of the platform console only. They sign in with email plus a second factor. They never sign in with LINE.
- Proposed build, for the Architect and Security to confirm: Supabase Auth email sign in with TOTP multi-factor, enforced on the server (a session without the second factor cannot reach any platform route). No self sign up: accounts are invited by a platform admin. Passwords are not shared. Recovery codes are stored in the password manager.
- Auth emails (invite, password reset, sign-in notices) need a proper email sender with SPF, DKIM and DMARC on the BOOQ domain, because the built-in provider email is limited and not meant for production. That is a new account on the list (`accounts.md`).
- Every BOOQ staff sign in, factor change and role change goes to the P6 log.
- The hosting, Supabase, GitHub and monitoring accounts of engineers also use a second factor.

## 7. CI/CD

`.github/workflows/ci.yml`, adapted to the pnpm monorepo (build plan sections 2 and 4). Tested locally against the F01-T01 scaffold; it has not run on GitHub yet.

| Job | Runs now | What it runs |
|---|---|---|
| checks (matrix) | yes | `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` under TZ=UTC and under TZ=Asia/Bangkok, `tools/i18n/audit.mjs --no-csv` (locale check), `tools/i18n/lint-hardcoded-text.mjs apps packages`, the locale tool self tests |
| wording guard | yes, pull requests only | `tools/i18n/check-wording.mjs origin/<base>` (TEXT-04). The writers' refined files go in a pull request labelled `wording-update`, which skips it |
| repository rules | partly | lockfile drift (a warning until `CI_STRICT`), then `tools/check-table-classes.mjs`, `tools/check-audit-triggers.mjs`, `tools/check-migrations.mjs` (duplicate or out of order migration numbers) when each exists |
| database tests and generated types | when `supabase/config.toml` exists | Supabase local stack (`supabase start`, which applies every migration from scratch), `pnpm run test:db`, then `pnpm run db:types` and a check that nothing changed |
| CI result | yes | one status to require in branch protection |
| **Build** (separate file `.github/workflows/build.yml`) | yes | `next build` of `apps/web` (its own `build` script, which runs the deploy guard first) and `apps/platform`, on every push to `main` and to any branch, in parallel with the test jobs and not part of them. Added 31 Oct after `apps/web`'s build sat broken on `main` unnoticed. Require `build (apps/web)` and `build (apps/platform)` in branch protection too |

Contract with other roles: the three `tools/check-*.mjs` names, and the root scripts `test:db` and `db:types`, are my proposal; the Architect may rename them (F01-T05, T36), then CI is edited to match. A missing one is a notice until you set the repository variable `CI_STRICT=true`, then it fails. Turn `CI_STRICT` on when F01-T05 and F01-T36 have landed. CI uses no secrets. Tests use the fakes and no network.

Found while testing: `pnpm install --frozen-lockfile` rewrote `pnpm-lock.yaml` (it adds the workspace packages, 24 lines). The F01-T01 owner should commit the refreshed lockfile. CI warns about it now.

Still to add when they exist, each needs a person's call: Playwright end to end run against a preview, dependency audit, build, deploy jobs. The `supabase` CLI flags in the database job are from memory and must be checked the first time the job runs.

Repository settings to apply by the user (cannot be done from a file): protect `main`, require the `CI result`, `build (apps/web)` and `build (apps/platform)` checks and a review, enable secret scanning and push protection, enable Dependabot alerts.

## 8. Schedule to 7 Dec and 29 Dec

| By | Item | Needs |
|---|---|---|
| 6 Nov | Accounts created (`accounts.md`), repo settings applied (protect `main`, secret scanning, `CI_STRICT`) | User |
| 13 Nov | Supabase staging and preview projects, hosting project, preview deploy of the first Next.js skeleton | Accounts, the first code |
| 20 Nov | Secrets store wired for per club LINE and Beam values. **Production** Supabase and hosting projects created (D16). Staging test provider and test OA, and Beam Playground keys, in staging | LINE and Beam accounts |
| 27 Nov (target) | **S-1 real LIFF on a device** (section 11), once the hosted `apps/web` deploy and staging database exist. | You, DevOps |
| 27 Nov | **Hunter's real LINE provider, Official Account, LIFF app and a paid plan** in place, with the Playground key set in its Testing configuration (D32: test messages go through the real OA and count toward the cap). Monitoring and alerts live on **production** and staging | The club, the user |
| 30 Nov to 3 Dec | **Restore drill 1** on production into a scratch project. Production holds only seed and setup data by then, so this proves the procedure and the timing, not the final data | Production running |
| 4 Dec | **Production ready and frozen** for the test: Hunter in Testing status, backups confirmed, on call named, runbooks read, web sign-in rate limit set (`WEB_SIGNIN_RATE_*` with `WEB_RATE_LIMIT_KEY`, `LOCALES_DIR` for the receipt PDFs, `PLATFORM_BASE_URL` with the staff-invite settings, the `platform.config` values `console_enrolment_ttl_hours`, `staff_invite_ttl_hours`, `booq_support_line_url` (the user supplies it), `qr_expiry_margin_seconds`, `beam_reconcile_age_seconds`, `line_send_max_attempts`, `line_send_retry_seconds` and `pay_tap_limit_*` (`docs/ops/platform.md`, the table follows the console's settings page), and the worker's `WORKER_RATE_LIMIT_*`, `WORKER_PAY_TAP_PRUNE_CRON`, `WORKER_PACKAGE_EXPIRE_CRON`, `WORKER_WALLET_EXPIRE_CRON`, `WORKER_SESSION_START_CRON`, `WORKER_CLASS_GENERATE_CRON`, `WORKER_OFFER_EXPIRY_TICK_SECONDS`, `WORKER_CLASS_BELOW_MIN_TICK_SECONDS`, `WORKER_BEAM_RECONCILE_CRON`, `WORKER_PACKAGE_ORDER_EXPIRY_CRON` (pending main), the `platform.config` value `beam_reconcile_age_seconds` (reconcile is off while unset), `WORKER_LINE_USAGE_SYNC_CRON`, `WORKER_LINE_HEALTH_CRON` (pending main), `WORKER_OUTBOX_SENDER_TICK_SECONDS`, `LOCALES_DIR` for the worker, `LINE_API_BASE_URL`, `LINE_API_DATA_BASE_URL`, `LINE_PUSH_TIMEOUT_MS`, `PROVIDER_PROBE_TIMEOUT_MS` (platform probes), `WORKER_CONSOLE_*`, the club secrets key pair (`secrets.md`: `SECRETS_PUBLIC_KEY` in `apps/platform` and `apps/web`, `SECRETS_PRIVATE_KEY` in `apps/web` and `apps/worker` only; created and placed before the first club secret is written, D149); `docs/ops/web.md`, `docs/ops/worker.md`). No deploys to production except fixes the user approves | |
| **7 Dec** | End to end test with mock bookings on production | |
| 21 Dec | **Restore drill 2** after test data exists (nightly dump, and point-in-time if bought). Go live checklist, then the Go live order of steps (runbook 13): named backup, live key set entered, smoke test, Go live with purge | Beam production merchant for Hunter |
| **29 Dec** | Public booking | |

Hunter's own LINE Official Account (with a paid plan) is needed before the test, because test messages count. Its Beam production merchant is needed by Go live. Both are the club's and the user's to arrange, so please start them first.

## 9. Decisions and open items for the user

Settled: Supabase in Singapore with a data-processing agreement (D5), BOOQ staff auth (D3), one LINE provider per club (D7), one shared domain with the club in the URL (D6, domain supplied later), the 7 Dec test on production (D16).

Open:
1. Next.js host: Vercel (recommended) or other.
2. Production deploy approver.
3. Point in time recovery for production: yes or no, plus the cost.
4. On call people and hours.
5. The shared domain (the user supplies it later). Is the club in the path or in a subdomain? That affects the LIFF endpoint and certificates (section 10).
6. Receipts and logo storage: ask the Architect (backup of Storage).
7. **Open, blocked on the Supabase decision: the owner's club data export.** (a) storage bucket and provider (not picked here; Supabase Storage in the project is the natural default), (b) `EXPORT_LINK_SECONDS` (D177: it is the lifetime of one signed download link, signed on click, 10 minutes per Security; the file itself stays 24 hours per A-14 and is removed by the clean-up; no value in the environment file), (c) the queue credential or enqueue function and the worker task registration. Until chosen, `POST /exports` answers 503 `export_not_configured`. Detail in `web.md`.

(The LINE message cap behaviour, formerly item 7, is decided: LINE-07 and D17.)

## 10. Domain and URLs (D6, D7)

- One shared BOOQ domain, with the club in the URL. The domain is **not known yet**, so it is a config value (`APP_DOMAIN`, `APP_BASE_URL`), never written into code or docs. Path form (`https://<domain>/<club>`) or subdomain form (`https://<club>.<domain>`) is the Architect's call; the path form needs only one certificate, the subdomain form needs a wildcard one.
- Each club has its own LINE provider and its own LIFF app (D7). LIFF endpoint URLs are set in each club's LIFF app in LINE Developers, so the club owner (who owns the LINE accounts) or a BOOQ person acting for them sets them to the club's URL. The Beam callback URL is also per club.
- Until the domain exists, staging uses the hosting provider's own address, which is enough for engineering. LINE needs a stable HTTPS address, so the real test OA should wait for the domain or use a stable staging subdomain on any domain the user already owns.
- Because the domain is the LIFF address, changing it later means editing every club's LIFF app. Decide it before Hunter's LINE side is set up.

DevOps will not invent any product rule. Anything the monitoring surfaces that looks like a rule question goes to the Orchestrator.

## 11. Smoke tests on real services

### S-1: real LIFF on a device (C1 and C2 inside the LINE app)

Why: the unit and browser tests use a fake LIFF. Only a phone with the LINE app proves the real `@line/liff` (2.31.2) works: silent login, the ID token, the friend prompt, and the return path. Do it once the first hosted test deploy of `apps/web` exists, and again before 7 Dec if the sign-in code or the LIFF app changes.

**What happens:** on a phone, open `https://liff.line.me/2012300015-WIi1jtLB` in the LINE app (the BOOQ test provider's LIFF app; Login channel 2012300015; `accounts.md`). Expect C1 (welcome), silent sign in, then C2 (name, phone, consent), complete sign-up, land on the app, reload and still be signed in. Repeat on one iPhone and one Android phone, and once in an outside browser (the `liff.login` path). Note any prompt that exposes data. Result goes in the F02 design next to section 3.3.

**What it needs. Nothing here has been done; this is the list. No account was changed.**

| # | Need | Who | Status |
|---|---|---|---|
| 1 | **A hosted deploy of `apps/web`** at a stable HTTPS address: a hosting project with Root Directory `apps/web`, the repository's pnpm workspace installed, and the env below. The hosting provider's own address is enough; the BOOQ domain (D6) is not needed | You create the project (`accounts.md` row 4), DevOps wires it | Not started. The throwaway `booq-line-parity` project does not serve the app |
| 2 | **A database the deploy can use**: the Supabase staging project (`accounts.md` row 3) with the roles and every migration applied, including the sign-in ones, so `GET /api/c/{slug}/public/config` and sign-in work | You create the Supabase org and project, DevOps and the Architect apply migrations | Not started. This is the long pole |
| 3 | **A test club in that database**: a club with a slug, and its LINE connection set to Login channel `2012300015` and LIFF app `2012300015-WIi1jtLB` (the club's public config returns `liffId` from there). Set through the platform console or the Architect's approved seed. The club's status decides who may enter: Draft and Testing clubs answer 404 to everyone but invited testers, so the test person must be an invited tester | Architect or BE-P for the seed, a BOOQ person in the console | Not started |
| 4 | **The LIFF endpoint URL changed** in LINE Developers from the parity receiver (`https://booq-line-parity.vercel.app/c/parity/{token}`) to `https://{address}/c/{club-slug}`. HTTPS, no fragment; `liff.init()` works only on URLs equal to or below the endpoint. Scope `openid profile` and Add friend **On (normal)** (D38) stay. A LIFF app has one endpoint, so after this the parity receiver no longer works (it is finished) | You, in the LINE console | Waiting for #1 and the club slug |
| 5 | **Environment on the hosted web deploy** (`docs/ops/web.md` checklist): `DATABASE_URL` (role `booq_app`), `WEB_SESSION_SECONDS`, `WEB_MAX_BODY_BYTES`, `WEB_SIGNIN_RATE_LIMIT`, `WEB_SIGNIN_RATE_WINDOW_SECONDS`, `WEB_RATE_LIMIT_KEY`, `APP_BASE_URL`. And **`NEXT_PUBLIC_LIFF_FAKE` must not be set, or set to anything but `1`**. It is baked into the browser bundle at build time, so check the build log, not only the dashboard. The **deploy guard exists** (D162): `infra/checks/forbid-liff-fake.mjs` fails a hosted build (Vercel sets `VERCEL`, or `APP_ENV` is preview, staging or production) when the flag is anything but empty or `0`. Hosting build command: `node ../../infra/checks/forbid-liff-fake.mjs && next build`. It is tested in CI (`infra tests`). Still wanted from FE/BE: call it from the `apps/web` build script too, so a build run any other way is checked (that file is not mine to edit) | DevOps | Not started |
| 6 | **The test person**: the real LINE account used in F02-T00, who has the test Official Account as a friend, plus a second person or phone for the other platform | You | The first person exists |
| 7 | The LINE Login channel stays **published** (it is) and the Messaging API channel's webhook points at the app's real route (`/api/webhooks/line/{token}`) only if friend status is part of the test | You, later | Optional for S-1 |

**Order that gets there soonest:** #2 and #1 can start at once and in parallel (both need your accounts), then #3 (needs #2), then #5, then #4, then run S-1.

**S-2 (receipt PDF on the hosted deploy)** runs in the same session once an order can be paid in the test setup: see `docs/ops/web.md`, "Smoke test S-2". It proves `LOCALES_DIR` and the Sarabun font files are inside the deployed function.

**Pass:** C1 appears inside LINE with no extra login tap, C2 completes, the new player exists (flagged as test data because the club is Testing), the session survives a reload, the outside-browser path signs in with one tap, and nothing in the page URL or the logs holds an ID token.

## 12. Supabase spike items (once a Supabase project exists)

Collected here so none is lost. Each result is written into the document named.
1. Custom roles through the pooler, `btree_gist`, a direct or session connection for the worker, and that `graphile_worker` can be created by the queue role (`worker.md`).
2. Backups and the restore drill (section 4).
3. **Staff sign-in paths:** password grant and the second-factor challenge and verify in `apps/staff-invite/src/supabase-identity.ts` against a real project (`platform.md`, seven checks).
4. Forged `x-real-ip` and `x-forwarded-for` on the hosted web deploy (`web.md`).
5. Beam Playground checks G1 to G13 (`accounts.md`).
