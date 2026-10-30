# F01 Platform foundation · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 from the approved design (`design.md`, approved 30 Oct 2026). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `PLAT-04 audit trigger and append-only guards`. Each task is under a day. **FA** is `docs/architecture/foundation.md`, **D** is the design file. No task writes user-facing text in code; every new key goes in both locale files and is listed for the writers.

Roles: **Arch** Architect/data, **BE-P** back end platform and LINE, **DevOps**, **QA**, **Content**. A task names the role that does it; the Reviewer checks every PR.

## Prerequisites owned by other roles (not F01 tasks)

- DevOps: CI pipeline with lint, types, tests and the hard-coded-text check; the local Supabase stack in CI; preview environments (task F01-T01 depends on it only for CI wiring).
- Content: generates `locales/copy-index.csv` (D31) so key lookup by screen is possible before the screens are built.
- QA: the fake LINE (verify endpoint, webhook) and the fake Beam harness (FA §6.7).

## A. Repository, database and test foundation

- [ ] **F01-T01** Repo scaffold: pnpm workspace with `apps/web`, `apps/platform`, `apps/worker`, `packages/{db,auth,domain,payments,line,i18n,time,ui,testing}`, TypeScript, lint, Vitest. IDs: PLAT-05-AC5 (one codebase), CC-5. Role: Arch · Size: S
  Tests first: a smoke test per package runs; a lint rule file exists that fails on `service_role` and on importing `pg` outside `packages/db`.
- [ ] **F01-T02** Test harness: local Postgres, migration runner, per-test database reset, a controllable clock (`app.now()` in test databases only). IDs: PLAT-04-AC11, CC-6 (decision D30). Role: Arch · Deps T01 · Size: M
  Tests first: a test moves the clock and reads a Bangkok date at 23:59:59 and 00:00:01; the override is impossible without the test-only setting.
- [ ] **F01-T03** Migration 0001: extensions, schemas `app`/`platform`/`audit`, roles `booq_owner`/`booq_app`/`booq_worker`/`booq_platform`, no grants to `anon`/`authenticated`/`public`, per-role Bangkok time zone, helper functions `app.club_id()`, `app.user_id()`, `app.roles()`, `app.has_any_role()`. IDs: CC-1, CC-2, PDPA-01-AC1. Role: Arch · Deps T02 · Size: M
  Tests first: roles exist and none has `BYPASSRLS`; `anon` and `authenticated` cannot read any table; with no context the helpers return null.
- [ ] **F01-T04** `withClubTx` in `packages/db`: sets `app.club_id`, `app.user_id`, `app.roles`, `app.request_id` as transaction-local, retries on deadlock, exports no raw pool. IDs: CC-1, ROLE-AC6. Role: Arch · Deps T03 · Size: S
  Tests first: a query outside `withClubTx` returns zero rows; a context for club A never reads club B; a deadlock is retried once and succeeds.
- [ ] **F01-T05** Table class registry (`table-classes.ts`: S, D or P) and the CI check that fails any table not listed or missing `unique (club_id, id)` or `force row level security`. IDs: PLAT-02-AC1, PDPA-01-AC1. Role: Arch · Deps T03 · Size: S
  Tests first: add a fake unlisted table in a test migration; the check fails.
- [ ] **F01-T06** Migration 0002: `club`, `club_feature`, `club_setting`, `location`, `resource`, `opening_hours`, `club_pause`, `club_status_change` with composite keys, CHECKs, restrictive tenant policies. IDs: PLAT-01, PLAT-05, CC-1. Role: Arch · Deps T04, T05 · Size: M
  Tests first: slug unique and URL safe; status CHECK; opening hours `close` may be `24:00`; one open pause per club.
- [ ] **F01-T07** Tenant isolation suite: a generic test driven by the registry that, for every club table, proves club A cannot read, update, delete or insert for club B, composite foreign keys across clubs fail, and no context returns zero rows. IDs: CC-1, ROLE-AC6. Role: QA/Arch · Deps T06 · Size: M
  Tests first: the suite is the test; it runs red on a deliberately wrong policy.
- [ ] **F01-T08** Settings registry and routes: `settings-registry.ts` (types, validation, unset allowed), `GET /settings`, `PUT /settings/{key}`; hold time only 10/15/20; no 60-minute key can exist. IDs: PLAT-05 (settings), BOOK-03-AC3, PLAT-04-AC1. Role: BE-P · Deps T06, T13 · Size: M
  Tests first: `hold_minutes` 12 refused; unset TBD reads as unset; each write has an audit entry (needs T11).
- [ ] **F01-T09** Secrets: migration for `line_connection`, `payment_connection`, `club_secret` (two Beam sets, D32), envelope encryption module with a master key from the environment (D34), write-only grants, `secret_last4`, `app.read_secret()`. IDs: PLAT-02-AC8, PDPA-01-AC9, D27. Role: Arch · Deps T06 · Size: M
  Tests first: a written secret is ciphertext in the table and never in a log or response; `booq_platform` cannot `select` it; the support view shows only the last four.
- [ ] **F01-T10** Audit: migration 0005 (`audit_entry`, `audit.write`, `audit.note`, trigger function, append-only guards, `audit.registry`). IDs: PLAT-04-AC1, AC2, AC6, AC11. Role: Arch · Deps T06 · Size: M
  Tests first: one entry per audited change in the same transaction; a failing audit write rolls the change back; update and delete of `audit_entry` fail for every role including the owner; app roles cannot insert directly; times are Bangkok.
- [ ] **F01-T11** Audit context and the registry check: `withClubTx` and the platform transaction set actor, source, reason, session id; CI fails if an audited table lacks its trigger; staff ledger notes enforced by CHECK on a fixture table. IDs: PLAT-04-AC3, AC4, AC9. Role: Arch · Deps T10 · Size: S
  Tests first: a staff movement with no note is refused; a platform edit names the BOOQ staff member.

## B. People and roles

- [ ] **F01-T12** Migration 0003: `app_user` (base columns), `app_user_role`, `user_staff_note`, `user_consent`, `club_invite`, `club_tester`; constraint triggers (a user keeps one role; a live club keeps one active owner). IDs: ROLE-01, PDPA-01-AC2, AC6. Role: Arch · Deps T06 · Size: M
  Tests first: removing the last role is refused; removing the last owner of a live club is refused; staff notes are unreadable by the player.
- [ ] **F01-T13** Permission matrix in `packages/auth` and the `route()` wrapper (permission, feature, public); a build check that fails a route with no declaration. IDs: ROLE-01-AC2, ROLE-AC1 to AC4, PLAT-05-AC2. Role: BE-P · Deps T04 · Size: M
  Tests first: union of two roles; front desk refused revenue and prices; accountant refused any change; a route without a permission fails the build; a feature that is off returns refusal from the server.
- [ ] **F01-T14** Role and staff routes: `GET /staff`, invites, `PUT /staff/{id}/roles`, deactivate; owner only; audited. IDs: ROLE-01-AC1, AC5, AC6. Role: BE-P · Deps T12, T13, T11 · Size: M
  Tests first: coach plus player has one record and both surfaces; role change writes the old and new set; a BOOQ account never receives a club role.
- [ ] **F01-T15** Accountant column privacy: the view `app_user_names`, no accountant `select` on `app_user`, permission `customer.contact.read`. IDs: ROLE-AC2, decision D35. Role: Arch · Deps T12 · Size: S
  Tests first: as accountant, phone and date of birth never appear on any route; direct `select` fails.

## C. Platform schema and BOOQ staff

- [ ] **F01-T16** Migration 0004: the `platform` schema (staff, assignment, support session, P6 log, `club_usage_daily`, `config`, templates, `launch_check`, `export_request`) and `platform.bump_usage()`. IDs: PLAT-02-AC10, AC11, PLAT-04-AC5. Role: Arch · Deps T06 · Size: M
  Tests first: `bump_usage` refuses test activity; counts per club per day only; the platform role cannot count rows in D tables.
- [ ] **F01-T17** `apps/platform` sign in: Supabase Auth with email plus TOTP, mapping to `platform_staff`, deactivation ends sessions, sign-in and failure events to P6. IDs: ROLE-02-AC1 to AC5. Role: BE-P · Deps T16 · Size: M
  Tests first: no session without the second factor; deactivated staff session ends; a LINE-signed club session is refused by the platform app and the reverse; every attempt is in P6.
- [ ] **F01-T18** Platform grants and the blind suite: `booq_platform` privileges only on S tables and `platform`; policies for admin, assigned specialist, status window; the suite proving every D table is denied. IDs: PLAT-02-AC1 to AC9, PDPA-01-AC1. Role: Arch · Deps T05, T16 · Size: M
  Tests first: `select/insert/update/delete` on every D table fails; `club_secret` select fails; a specialist on an unassigned club gets 404; Paused is look only.
- [ ] **F01-T19** Support view routes and the owner's window: `GET/PUT /clubs/{id}/support/setup`, `support_session`, owner `PUT /support-window`, club and P6 audit notes. IDs: PLAT-02-AC2 to AC7, AC9. Role: BE-P · Deps T18, T11 · Size: M
  Tests first: Draft edit saves; Live look only; window opens 24 hours and closes by itself when the clock moves; early off closes at once; the visit is logged with the staff name.

## D. Club lifecycle

- [ ] **F01-T20** `app.set_club_status` and the transition table; `club.status` writable only through it. IDs: PLAT-01-AC1 to AC4, AC7, AC10. Role: Arch · Deps T06, T10 · Size: M
  Tests first: every allowed and refused transition; backward moves refused; a status change records who, when, old, new, reason.
- [ ] **F01-T21** Platform status routes with role and assignment checks. IDs: PLAT-01-AC8, ROLE-AC5. Role: BE-P · Deps T17, T20 · Size: S
  Tests first: specialist cannot pause or resume; specialist on an unassigned club gets 404; admin can do all.
- [ ] **F01-T22** Pause and resume: `pause_club`, `resume_club`, `app.pause_handlers` registry, `club_paused` refusal for new holds, owner message through an outbox interface (stub until F10). IDs: PLAT-03-AC1 to AC11. Role: BE-P · Deps T20 · Size: M
  Tests first: no reason refused; new booking refused by API; existing booking and reminders unaffected; resume runs handlers once; banner state readable.
- [ ] **F01-T23** Club creation and setup: `POST /clubs`, setup sections 1 to 5, connection tests behind interfaces (LINE, Beam), owner invite creation. IDs: PLAT-01-AC1, AC2, AC9, PLAT-05-AC12. Role: BE-P · Deps T17, T09, T12 · Size: M
  Tests first: a new club is Draft and stays Draft; move to Testing refused until steps 1 to 8 are done, with what is missing and who owes it.

## E. Templates and feature switches

- [ ] **F01-T24** Templates: seed Tennis and Blank, `app.apply_template` with a handler registry for tables owned by later features; Padel and Pickleball marked to build. IDs: PLAT-05-AC7 to AC15. Role: Arch · Deps T08, T16 · Size: M
  Tests first: Tennis settings equal the PRD values (hold 15, claim 30, no offers within 2, rest cap 6, group 4 to 6, court 50000 satang); Blank copies nothing; TBD values are empty; a later template edit leaves existing clubs unchanged. (Products and prices are copied by handlers that F04 and F06 register.)
- [ ] **F01-T25** Feature switches: keys from design A-1, `app.has_feature`, switch changes audited. IDs: PLAT-05-AC1 to AC6. Role: BE-P · Deps T13 · Size: S
  Tests first: a switch set on one club changes that club only; a route for an off feature is refused by the server.

## F. Test mode

- [ ] **F01-T26** Migration 0006: `app.test_tables` registry, the `is_test` trigger, the CI check that every table with `is_test` is registered. IDs: PLAT-07-AC1. Role: Arch · Deps T06 · Size: S
  Tests first: rows made while Testing carry the flag and it cannot be updated off; Live rows do not.
- [ ] **F01-T27** `go_live_purge`: delete only `is_test` rows of one club in registry order, with the fenced exception to the append-only guards, one non-test audit entry with row counts and a P6 entry. IDs: PLAT-07-AC3, AC4, AC8, PLAT-01-AC6. Role: Arch · Deps T10, T26 · Size: M
  Tests first: purge removes only test rows of that club; a non-test ledger row is still undeletable inside the purge; a failed purge rolls everything back; a club that never tested purges nothing.
- [ ] **F01-T27b** `app.go_live` and `launch_check`, including the Beam key-swap check (decision D32): the Go live transaction runs the checks, then the purge, then sets Live. IDs: PLAT-01-AC3 to AC5, PLAT-07-AC4, decision D32. Role: Arch · Deps T20, T27 · Size: M
  Tests first: a failed check refuses Live whatever the screen shows; a failed purge keeps Testing; after Go live the first real receipt number is 000001 (F13 asserts it too); the key swap check fails while the test key set is still active.
- [ ] **F01-T28** Testers: `club_tester`, tester and BOOQ-tester invites, the status gate function for F02, P6 logging. IDs: PLAT-07-AC5, AC6, PLAT-01-AC5. Role: BE-P · Deps T12, T17 · Size: M
  Tests first: non-testers get not found on Draft and Testing clubs; a BOOQ tester signs in as an ordinary player, never with the BOOQ credential.
- [ ] **F01-T29** Test exclusion helper `notTest()`, the lint, and a CI harness that seeds test rows in each report module. IDs: PLAT-07-AC7, decision D33. Role: Arch/QA · Deps T26 · Size: S
  Tests first: a report that reads an `is_test` table without the helper fails the lint; seeded test rows return zero.

## G. Import, export and data requests

- [ ] **F01-T30** Migration 0007 and the CSV validator for players: parse to staging, per-row error codes, all or nothing. IDs: PLAT-06-AC1, AC2, AC5, AC9, AC10, AC18. Role: BE-P · Deps T12 · Size: M
  Tests first: one bad row saves nothing; a club id column is ignored; amounts read as THB into satang; raw file not kept.
- [ ] **F01-T31** Import routes (owner only), confirm in one transaction, `import_handlers` registry for packages and balances (registered by F06), audit entries, staging clean-up job. IDs: PLAT-06-AC3, AC4, AC6, AC7, AC8. Role: BE-P · Deps T30 · Size: M
  Tests first: non-owner and BOOQ refused; imported players have no LINE id and match on phone at first sign-in (F02); duplicate phones flagged.
- [ ] **F01-T32** Export: `export_request`, worker task in the club context, ZIP of CSVs, storage interface, owner signed link, BOOQ start-only, audit. IDs: PLAT-06-AC11 to AC17. Role: BE-P · Deps T34 · Size: M
  Tests first: only that club's rows; BOOQ cannot fetch the file or link; link expires; no delete-club route exists.
- [ ] **F01-T33** Data requests and `app.anonymise_user`: player copy and delete requests, staff handling routes, audit. IDs: PDPA-01-AC3 to AC7. Role: BE-P · Deps T12, T10 · Size: M
  Tests first: request stored and audited; copy has no staff notes; deletion anonymises, keeps receipts, redacts audit JSON, refuses with a future confirmed booking.

## H. Worker, counts and checks

- [ ] **F01-T34** `apps/worker` bootstrap (Graphile Worker, direct connection, club-context task wrapper), heartbeat and housekeeping task. IDs: FA §5 (supports PLAT-03-AC6, PLAT-06). Role: BE-P · Deps T04 · Size: M
  Tests first: a task runs in the right club context; a crashed task retries once; heartbeat is recorded.
- [ ] **F01-T35** Aggregate counts for P1 and P3 from `club_usage_daily`, nothing finer. IDs: PLAT-02-AC10, AC11. Role: BE-P · Deps T16, T18 · Size: S
  Tests first: counts only; no list behind a count; test activity excluded.
- [ ] **F01-T36** CI static checks wired: no `service_role`, no raw `pg`, routes declare permissions, hard-coded text lint hook, definer-function list review. IDs: CC-5, CC-2. Role: DevOps/Arch · Deps T01, T13 · Size: S
  Tests first: each check fails on a planted violation.
- [ ] **F01-T37** Acceptance sweep: run the AC-to-test table in `design.md` section 14, close gaps, record results against the requirement IDs. IDs: all F01. Role: QA · Deps all · Size: M
  Tests first: n/a (this task is the sweep); done when every AC has a passing test or a filed bug naming its ID.

## Follow-ups owned by later features (listed so nothing is lost)

F04 and F06 register their template handlers (T24) and F06 registers the package and balance import handlers (T31) and the pause expiry handler (T22). F03 supplies the check that refuses opening hours or court changes under existing bookings (decision D50), which `PUT /hours` and `PUT /resources/{id}` call. F10 supplies the outbox behind the owner pause message (T22).

## Order and size

Do A first (T01 to T11), then B and C in parallel, then D, E, F, then G and H. About 38 tasks; roughly two engineers for two to three weeks if they run in parallel after T11.
