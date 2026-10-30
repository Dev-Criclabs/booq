# BOOQ operations plan (DevOps / SRE)

Status: **updated 30 Oct 2026 for the round 2 decisions** (`docs/decisions.md`: D3 to D7). Nothing here changes a product rule. Where a choice still needs a person, it is marked **Decision**. Hunter is the first real build: there is no existing Booq core, code or database to migrate.

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
| Test mode with mock bookings and fake slips for 7 Dec | PRD Quality | Staging holds only fake data. Section 2 |
| Each club has its own LINE OA, LIFF app, rich menu, and its own Beam merchant account | Hand-off | Credentials are per club. `secrets.md` |
| The club pays its own LINE plan and Beam fees | PRD Platform foundation | Not a BOOQ cost line |

## 2. Environments

| Env | Purpose | Where | Data | Deploys |
|---|---|---|---|---|
| **local** | Developer and Claude Code sessions | Developer machine, Supabase CLI local stack | Seed data only. Fake Beam, fake LINE | n/a |
| **preview** | One per branch or PR, to look at a change | Hosting provider preview URL | Shared **preview** database (see below) with seed data. Fake Beam, fake LINE | Automatic on each push |
| **staging** | Engineering and QA rehearsals. Real LINE test OA, real Beam sandbox | Own hosting project and own Supabase project | Mock bookings and fake slips only. Never real players | Automatic from `main` |
| **production** | Hunter from 29 Dec | Own hosting project and own Supabase project | Real | Manual approval, from a tag or from `main` |

Rules:
- Staging and production are **separate Supabase projects** and separate hosting projects. No shared database, no shared keys.
- Preview environments do **not** get their own Supabase branch database at first. They share one `preview` Supabase project reset from seed data weekly. This is cheaper, and nothing real is in it. Per-branch databases can follow if migrations collide.
- Preview and local always use the fake Beam and fake LINE that QA builds. Only staging and production talk to the real LINE and Beam.
- Staging has its own LINE provider and test OA, LIFF app and Beam sandbox merchant (`accounts.md`). A test OA must never be the production OA.
- Environment settings that differ (URLs, keys, LIFF IDs) are listed in `infra/env/.env.example`. The values live in the hosting provider and are never committed.
- Club status (Draft, Testing, Live, Paused, PLAT-01) is a product feature and is separate from the environment. **Testing mode (D4):** test data is flagged, test bookings use their own non-legal receipt numbers, and the flagged data is purged at Go live so Hunter's real receipts start at 000001. See section 6a for what ops does around the purge.
- **Open, for the Orchestrator and the user:** does the 7 Dec test run on the *staging* environment, or on the *production* environment with Hunter in Testing mode? D4 reads as the second (the club itself is in Testing and is purged at Go live). My plan works for both: staging is always for engineering, and production runs Hunter in Testing mode from the day the project exists. If the 7 Dec test is on production, the production Supabase project, the production hosting and the monitoring must exist by **4 Dec**, not 21 Dec, and the Beam sandbox keys go into the club's Testing configuration, swapped for live keys at Go live. Until answered, I plan for production by 4 Dec.
- Database migrations are applied by CI/CD in this order: preview, staging, production. A migration reaches production only after it ran on staging. Migrations are forward only. A rollback is a new migration, or a restore (section 4).

**Decision 1, hosting.** Supabase for Postgres is settled (D5). Still open for the Next.js host: **Vercel** (recommended, preview per branch is built in, paid team plan for a business product) or a container host in the same region. See `accounts.md`.

**Decision 2, who may approve a production deploy.** Proposed: the user, or a named person they pick. Branch protection on `main` needs the `CI result` check green and one reviewer (the Reviewer role).

## 3. Region

**Decided (D5): Supabase in Singapore (`ap-southeast-1`), with a data-processing agreement.** The Next.js functions run in the same region, so the court grid reads are one hop, which matters for the 2 second target. Supabase and Vercel do not have a Thailand region as far as I know; confirm on their region pages before creating projects.

**Risk R1: cross-border transfer under PDPA.** Personal data stored in Singapore is a transfer abroad. The club is the controller and BOOQ the processor.
- **Action for the user:** a Thai lawyer must confirm the transfer is allowed and what the contracts and privacy notice must say. Not for DevOps to decide. The privacy notice text is due before 7 Dec, so the answer is needed in time.
- Sign the **data-processing agreements** with Supabase (and the hosting provider, error tracking and any other processor that sees personal data) before real player data goes in. Keep them in the password manager.
- **Fallback if the lawyer says no: self-hosted Postgres in Thailand.** What it would mean: a Thai data centre or cloud host, then BOOQ runs Postgres itself, with row level security as now but without Supabase's managed backups, auth and storage. We would need to replace those: own backup and PITR (for example pgBackRest or WAL-G), own storage, own auth for BOOQ staff, patching and 24/7 on call. That is real extra work and cost. Supabase self-hosting is possible, but it is a heavier thing to operate. The application should therefore avoid depending on Supabase-only features where a plain Postgres choice is as easy (the Architect decides, I will raise it). Decide by **13 Nov**, since after real data exists a move is much harder.
- Until the lawyer answers: **no real player data** in the Singapore projects. Preview and staging hold fake data only. If production is used for the 7 Dec test with Hunter in Testing mode, only the named testers' data goes in, and the testers are told where it is stored.
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
| **Before 7 Dec** (target week of 23 Nov), on staging | Restore the latest daily backup into a **new empty project**. Run the smoke checks in the runbook | Restore done in under 2 hours. Row counts match. Ledgers add up (credit and wallet balance equals sum of rows). Court and coach uniqueness rule still rejects a double booking |
| **Before 29 Dec** (target 21 Dec), on production | Restore the nightly dump, then a point in time restore if bought, into a scratch project, never over production | Same, and the time taken is written down as the real recovery time |
| Every quarter after | Repeat, rotate who runs it | Same |

Targets (proposed, for the user to accept): **recovery point 24 hours** (1 hour with PITR), **recovery time 4 hours**. Steps are in `runbooks.md`, "Restore the database".

## 5. Monitoring and alerting

Principle: monitoring sees **system health and counts, never personal data**. Logs must not hold names, phone numbers, LINE user IDs, slip images, or message text. Error tracking is set to strip request bodies. This keeps BOOQ staff on the right side of "never see a club's players, bookings, payments".

| Signal | How | Alert when | Severity |
|---|---|---|---|
| App uptime and sign-in path | External probe (every 1 min) on the health route and the LIFF entry URL | 2 failures in a row | Page |
| Court grid speed | Synthetic probe against a seeded test club on staging and a read-only health club in production | p95 over 2 s for 15 min | Warn |
| **Server job failures** (hold expiry, reminders, package expiry, waitlist offers, birthday and referral jobs) | Each job writes a row to a `job_runs` heartbeat table and calls a heartbeat URL on success (dead man's switch). Job runner choice is the Architect's | A job fails, or has not reported within 2x its schedule. **Hold expiry** is the sharpest: a missed run leaves slots blocked | Page for hold expiry and reminders, warn for the rest |
| Backlog of expired holds | Count of holds past their expiry time still marked held | More than 0 for 5 min | Page |
| **LINE Messaging API token expiry or revocation** | Daily check per club: call LINE `GET /v2/bot/info` with the club's token. Also on every send: a 401 or 403 raises the alert | Any non-200 from the info call, or a 401 on a send. Also at 7 days before expiry if the token type has an expiry. Matches **LINE-06** (P1 alerts when the token fails) | Page (reminders and confirmations stop) |
| LINE message quota | Daily call to LINE's message quota consumption endpoints per club | 80% and 95% of the plan. Free plan stops at 300, so staging and any club on Free must be watched | Warn then page. **Open:** behaviour at the cap is an undecided product question (`docs/canvas-gaps.md` section C), DevOps only alerts |
| LINE send errors | Counter of non-2xx by status code, no content | Rate above 5% over 15 min | Warn |
| **Beam callback failures** | Counters from the callback route: verified, bad signature, wrong amount, unknown order, late (PAY-03), processing error | Any processing error; bad signature above a small baseline (possible attack or key rotated); a payment created more than 20 min ago still without a callback (reconciliation job) | Page for errors, warn for the others |
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
- The service role key never reaches a browser, a preview deployment, or an engineer laptop by default.
- Row level security by club ID is the Architect's and Security's work. DevOps adds a CI step for **RLS tests** once the Security role supplies them (placeholder in `ci.yml` is the `test` script).
- Data copy or delete on request (PDPA-01) is an application feature (F01 and the Security role). DevOps provides the runbook for the part that touches backups.
- Logs: 30 days, no personal data. Audit entries (PLAT-04) live in the database, not in logs.
- A personal data breach: runbook entry exists. Under Thailand's PDPA, the controller (the club) must notify the regulator within 72 hours of becoming aware, where there is a risk. BOOQ as processor tells the club without delay. The exact wording and timeline come from the club's adviser. Please check this with legal advice, I am not a lawyer.

### 6a. Testing mode and the purge at Go live (D4)

- The purge deletes only rows flagged as test data, for that club. It runs once, when the club moves to Live (P4), as a product feature (F01, F13, F15). DevOps's part:
  1. Take a **named backup** of the production database just before the purge (kept 30 days) so a wrong purge can be undone.
  2. The purge job logs counts per table, no personal data.
  3. After it runs, ops checks that real tables are unchanged, test flags are gone, and the club's receipt sequence next number is 000001 (RCPT-01). The checks are written with the Architect once the schema exists.
- Backups taken before the purge still hold test data until they age out. Test data is not personal data of real players, so this is acceptable; confirm with the lawyer if testers are real people with real LINE accounts (they are).
- BOOQ sees pass or fail only for testers' bookings (D4). Monitoring keeps to counts for the same reason.

### 6b. BOOQ staff sign in (D3)

- BOOQ staff are users of the platform console only. They sign in with email plus a second factor. They never sign in with LINE.
- Proposed build, for the Architect and Security to confirm: Supabase Auth email sign in with TOTP multi-factor, enforced on the server (a session without the second factor cannot reach any platform route). No self sign up: accounts are invited by a platform admin. Passwords are not shared. Recovery codes are stored in the password manager.
- Auth emails (invite, password reset, sign-in notices) need a proper email sender with SPF, DKIM and DMARC on the BOOQ domain, because the built-in provider email is limited and not meant for production. That is a new account on the list (`accounts.md`).
- Every BOOQ staff sign in, factor change and role change goes to the P6 log.
- The hosting, Supabase, GitHub and monitoring accounts of engineers also use a second factor.

## 7. CI/CD

`.github/workflows/ci.yml` (written now, passes on an empty repo):

| Job | Runs now | When code exists |
|---|---|---|
| Detect code | yes | tells the others whether `package.json` exists |
| Locale files | yes | JSON valid, en and th have the same keys (X keys are English only), same `{variables}`. Warns until `LOCALE_STRICT=true` |
| lint, typecheck, test, locale:audit, text:check | skipped | run as `npm|pnpm|yarn run <name>`. A missing script is a notice until `CI_STRICT=true`, then it fails |
| CI result | yes | one status to require in branch protection |

Script contract for the other roles: `lint`, `typecheck`, `test`, `locale:audit` and `text:check` in `package.json`. `locale:audit` and `text:check` are Content/i18n's (Development Plan, role 9). `test` must use fakes and no network. CI uses no secrets. Please turn on `CI_STRICT` when F01 lands.

Still to add when code exists, each needs a person's call so they are not in this first workflow: RLS tests against a CI Postgres, Playwright end to end run against a preview, dependency audit, build, migration dry run, deploy jobs.

Repository settings to apply by the user (cannot be done from a file): protect `main`, require the `CI result` check and a review, enable secret scanning and push protection, enable Dependabot alerts.

## 8. Schedule to 7 Dec and 29 Dec

| By | Item | Needs |
|---|---|---|
| 6 Nov | Accounts created (`accounts.md`), repo settings applied | User |
| 13 Nov | Supabase staging and preview projects, hosting project, preview deploy of the first Next.js skeleton. **Lawyer's answer on the cross-border transfer (R1) and the Singapore or self-hosted decision** | Accounts, the first code, the lawyer |
| 20 Nov | Secrets store wired for per club LINE and Beam values; LINE test OA, LIFF, Beam sandbox keys in staging | LINE and Beam accounts |
| 27 Nov | Monitoring and alerts live on staging; restore drill 1 done | Staging running |
| 4 Dec | Freeze for the test: backups confirmed, on call named, runbooks read | |
| **7 Dec** | End to end test with mock bookings | |
| 4 Dec if the 7 Dec test runs on production (section 2), else 21 Dec | Production project, monitoring, on call | Open question in section 2 |
| 21 Dec | Restore drill 2, PITR decision applied, go live checklist, named backup then test data purge (6a) | Beam production merchant for Hunter |
| **29 Dec** | Public booking | |

The Beam production merchant and a paid LINE OA plan for Hunter are the long poles. They are the club's and the user's to arrange, so please start them first.

## 9. Decisions and open items for the user

Settled: Supabase in Singapore with a data-processing agreement (D5), BOOQ staff auth (D3), one LINE provider per club (D7), one shared domain with the club in the URL (D6, domain supplied later).

Open:
1. **The user: a Thai lawyer confirms the PDPA cross-border transfer** (R1). If refused, switch to self-hosted Postgres in Thailand. Needed by 13 Nov.
2. **Where does the 7 Dec test run**: staging, or production with Hunter in Testing mode (section 2)?
3. Next.js host: Vercel (recommended) or other.
4. Production deploy approver.
5. Point in time recovery for production: yes or no, plus the cost.
6. On call people and hours.
7. The shared domain (the user supplies it later). Is the club in the path or in a subdomain? That affects the LIFF endpoint and certificates (section 10).
8. Receipts and logo storage: ask the Architect (backup of Storage).
9. Behaviour at the LINE message cap: product question, already open.

## 10. Domain and URLs (D6, D7)

- One shared BOOQ domain, with the club in the URL. The domain is **not known yet**, so it is a config value (`APP_DOMAIN`, `APP_BASE_URL`), never written into code or docs. Path form (`https://<domain>/<club>`) or subdomain form (`https://<club>.<domain>`) is the Architect's call; the path form needs only one certificate, the subdomain form needs a wildcard one.
- Each club has its own LINE provider and its own LIFF app (D7). LIFF endpoint URLs are set in each club's LIFF app in LINE Developers, so the club owner (who owns the LINE accounts) or a BOOQ person acting for them sets them to the club's URL. The Beam callback URL is also per club.
- Until the domain exists, staging uses the hosting provider's own address, which is enough for engineering. LINE needs a stable HTTPS address, so the real test OA should wait for the domain or use a stable staging subdomain on any domain the user already owns.
- Because the domain is the LIFF address, changing it later means editing every club's LIFF app. Decide it before Hunter's LINE side is set up.

DevOps will not invent any product rule. Anything the monitoring surfaces that looks like a rule question goes to the Orchestrator.
