# BOOQ build plan (integration plan)

Status: **DRAFT for approval.** Drafted 30 Oct 2026 by the Architect role. This proposes how the sessions work together once the user says building starts. **No product code is written until then.** It follows `CLAUDE.md`, `docs/DEVELOPMENT-PLAN.md` (roles and the `<role>/<feature>` branch naming), `docs/architecture/foundation.md` (revision 8) and the approved task lists (F01: 38 tasks, F02: 26, F03: 28). Dates: end-to-end test with mock bookings 7 Dec 2026, public booking 29 Dec 2026.

## 1. What exists today

Six branches on the remote. The remote's default branch is `claude/serene-fermi-jgsm3t`; there is no `main`.

| Branch | Owner role | Holds | State |
|---|---|---|---|
| `claude/serene-fermi-jgsm3t` | Orchestrator | PRD, hand-off, `CLAUDE.md`, `docs/decisions.md` (D1 to D80), canvas gaps, development plan, the core digest, the base `locales/` files | Source of truth for rules |
| `spec/f01-f02-requirements` | Spec drafter | Requirements for F01, F02, F03, F04, F05, F11, F12 | Approved through F05 as of round 8 (F11 and F12 approved round 7) |
| `architect/foundation` | Architect | `foundation.md`, designs F01 to F05, tasks F01 to F03, this plan | F01 to F03 approved; F04 and F05 designs and F03 tasks awaiting approval |
| `devops/foundation` | DevOps | `.github/workflows/ci.yml`, `docs/ops/*` (plan, accounts, secrets, runbooks), `infra/` | Draft |
| `i18n/text-variables` | Content | `locales/en.json`, `th.json` with named variables, `copy-index.csv`, `tools/i18n/*` (audit, hard-coded text lint, tests) | Draft |
| `qa/test-strategy` | QA | `docs/qa/*`, `tests/fakes` (fake Beam, fake LINE, LIFF stub, clock), `tests/acceptance` (173 `test.todo`s from F01 and F02) | Skeleton |

**Merge test (30 Oct).** On a throwaway local branch, `architect/foundation` merged with the orchestrator, spec, DevOps, i18n and QA branches with **no conflicts**. The branches touch different folders, except that the i18n branch rewrites `locales/en.json` and `th.json`. That result will change as branches move on, so the merge below is done once, by one person, in the order of section 2.

## 2. What must be merged into one branch before code starts

**Recommendation.** Create `main` from the merged result and make it the default and protected branch (an action for the user or DevOps; it changes the repository settings, so it is not done here). Merge in this order, each as a merge commit so the history of every role stays readable:

1. `claude/serene-fermi-jgsm3t` (rules and decisions) is the base.
2. `i18n/text-variables` (the locale files change most; merge them before anyone adds keys).
3. `spec/f01-f02-requirements` (requirements).
4. `architect/foundation` (foundation, designs, tasks, this plan).
5. `devops/foundation` (CI, ops, infra).
6. `qa/test-strategy` (fakes and acceptance skeleton).

After the merge, the role branches stop receiving work; later spec changes go through short branches into `main` (CLAUDE.md rule 5: PRD, then hand-off, then feature specs). Nothing else needs to exist before F01-T01 can start, except the items in this checklist.

**Before building starts (gate).** The user says building starts, and:

| Item | Owner | Blocks |
|---|---|---|
| The merge above, `main` created and protected | User or DevOps | Everything |
| Toolchain choice written down: pnpm, Node LTS version, TypeScript strict, Vitest, Playwright (decision D30) | Architect, in F01-T01 | All code |
| CI updated for the monorepo: install, lint, types, tests, the hard-coded text lint (`tools/i18n/lint-hardcoded-text.mjs`), the locale check, the table-class check, a "generated types are current" check, and Supabase local stack for database tests | DevOps | F01-T02 onward |
| Supabase projects for staging and production, hosting projects, secrets store (`docs/ops/accounts.md`, `secrets.md`) | User with DevOps | Staging deploys |
| LINE test provider, Login channel, Official Account, LIFF app with Add friend option On (normal), test user: task F02-T00 (user ID parity) | DevOps with the user | F02 build |
| Beam Playground merchant, keys, HMAC key and the checks G1 to G13 in the F05 design | DevOps with the user | F05 build only |
| F04 and F05 designs approved; F06 onward requirements not yet drafted | User | Wave 2 build |
| Pay-tap limit value (D61) and the QR expiry margin (D80) | Security and the user | Go live, not the build |

## 3. Monorepo layout

From F01-T01 and FA §9, with the folders that already exist on the other branches. `*` marks a folder that already exists on another branch.

```
CLAUDE.md  *
locales/                 en.json th.json copy-index.csv ...      *  Content
specs/                   product/ features/F##-.../              *  Spec drafter, Architect
docs/                    decisions.md architecture/ ops/ qa/     *  per owner
.github/workflows/       ci.yml                                  *  DevOps
infra/                   env/ README.md                          *  DevOps
tools/                   i18n/ *  check-table-classes  check-audit-triggers  lint rules
tests/                   fakes/ * acceptance/ * support/ *        QA (root level, see below)
apps/
  web/                   Next.js: (player) (coach) (admin) route groups + /api     FE and BE
  platform/              Next.js: P1 to P6, only booq_platform credentials         BE-P and FE-platform
  worker/                Graphile Worker tasks                                      BE
packages/
  db/                    migrations, roles, RLS, claim and release functions, registries, withClubTx
  auth/                  LIFF verification, sessions, permission matrix, route()
  contract/   (new)      zod schemas, route table, typed error codes, generated client
  domain/                booking/ pricing/ ... one folder per feature
  payments/              gateway interface, Beam adapter
  line/                  Messaging client, outbox sender, Flex templates (text from locales)
  i18n/                  loader, t(), variables, formatters (Gregorian Thai dates, money)
  time/                  Bangkok helpers, clock
  ui/                    design system
  testing/               fixtures (not the fakes); the DB harness is in packages/db/src/testing because only packages/db may import the driver
```

**Three small changes to FA §9 for approval:**

1. **`packages/contract` (new).** Front-end sessions must not call anything outside the API contract (development plan, role 6). Zod schemas for every route's input, output and error codes live here; the front end builds against mock responses generated from them (MSW) until the real route exists. Trade-off: one more package and a rule that route changes start with a contract change; the gain is that front-end and back-end sessions can run at the same time without waiting.
2. **QA's `tests/` stays at the repository root** (acceptance, e2e, concurrency, rls suites and the fakes), because it already exists there and has no dependency on app code. `packages/testing` holds only in-repo helpers such as the database harness and fixtures. The FA §9 line that put fakes in `packages/testing` is replaced by this.
3. **Server time zone.** DevOps keeps servers and CI in UTC and the app converts through `packages/time`; FA §7 now says the zone does not matter by rule and the test suite runs under both UTC and Asia/Bangkok.

**Folder ownership (who may edit what).** A session edits only its own folders; a change elsewhere is a small PR to the owner.

| Folder | Owner |
|---|---|
| `packages/db` (migrations, functions, registries) | Architect, with BE-B for the booking functions and BE-C for the commerce functions (each in their own migration number block) |
| `packages/auth`, `apps/platform`, `packages/line`, `apps/worker` | BE-P |
| `packages/domain/booking` | BE-B |
| `packages/domain/pricing`, `packages/payments` | BE-C (commerce) |
| `packages/contract` | BE roles write, FE-P reviews |
| `apps/web` (screens) | FE-P (player), FE-A (admin and coach) |
| `packages/ui` | FE-D (design system) |
| `locales/`, `packages/i18n`, `tools/i18n` | Content |
| `tests/` | QA |
| CI, `infra/`, `docs/ops` | DevOps |

## 4. Branch and merge strategy

- **Trunk-based on `main`.** One task is one run (CLAUDE.md) and one pull request. A session works on `<role>/<feature>` (the plan's naming), for example `be-p/f01` or `fe-p/f02`, and starts every task by rebasing on `main`. No branch lives longer than a day of work.
- **Pull request rules.** CI green (lint, types, tests, hard-coded text, locale check, table classes, audit triggers, generated types current); the Reviewer role checks the requirement IDs and canvas board and blocks on: decided TBDs, wrong lane, missing tests, hard-coded text, missing audit entry, missing club scope. The commit message starts with the IDs (`BOOK-04 exclusion constraints on occupancy`); the PR ticks its task in `tasks.md`. Squash merge.
- **Migrations.** One number block per feature, enforced by `tools/check-migrations.mjs` (a number in a gap belongs to no feature and fails CI): F01 0001 to 0099, F02 0101 to 0199, F03 0201 to 0299, F04 0301 to 0399, F05 0401 to 0499, F06 0501 to 0599, F10 0601 to 0699, F13 0701 to 0799, F07 0801 to 0899, F08 0901 to 0999, F09 1001 to 1099, F11 1101 to 1199 and F12 1201 to 1299 (none expected, reserved), F14 1401 to 1499, F15 1501 to 1599, F16 1601 to 1699 (not for the Hunter launch). Numbers are four digits and compare as strings, so 1001 sorts after 0999. The blocks are not in dependency order (F10's outbox is 06xx but F06 at 05xx enqueues into it): a function may call one defined in a later block because plpgsql resolves names at call time, but a table, view or foreign key may not reference a later block, so such a need goes through a port registry (like `app.payment_ports`) or the table moves to the earlier feature. A migration written after a task in an earlier block (an F01 fix after F05, for example) takes the next free number in its own feature's block. **Late files are applied (architecture decision, 30 Oct).** Blocks interleave over time (F03 02xx and F04 03xx get new files after F07's 0801 is applied on staging or production), so `migrate.ts` applies a file numbered below the highest applied one, once, in number order within a run, with its checksum recorded; it reports such files as `outOfOrder`. A file that was already applied and then changed is still refused. Two guards keep order from changing the result: every migration states only dependencies on lower or equal numbers of its own feature and on earlier features' blocks, and CI refuses a new file that redefines a function or view that a higher numbered file already on `main` defines (`checkLateRedefinitions`), because on a database that has the higher file the late one would overwrite it. A fix to such an object goes in a number above the higher file. A merged migration is never edited; a fix is a new migration. CI fails on a duplicate, a name that is not `NNNN_lower_case.sql`, or a number outside every block. Generated database types are regenerated by CI and never merged by hand.
  **D159 exceptions (a number outside the feature's own block).** A migration that redefines a shared object takes a number above every earlier definition, wherever that lies. Each exception is named here with its reason; the block check accepts any number inside some block, so the list is the record, not a switch. (1) F03-T30 `offer_ended`: 0411, above F05's 0403 and the Architect's 0410, which define the objects it replaces. (2) F04-T22a `class_seat` line kind: 0516, above F06-T03b (0504), which also redefines the `order_line` kind CHECK (adding `wallet_credit`); the final CHECK lists every kind; it is built after F06-T03b. The Architect's 0314 draft was dropped for that reason. (3) F05-T04c `club_health` Beam checks: 0699, above F10's 0604, which defines `platform.club_health` and its `check_key` CHECK that 0699 widens with `beam_keys` and `beam_charge`; numbered 0699 to stay clear of F10's next files (orchestrator, 30 Oct). (4) F05-T08c `club_health` webhook check: 0799, above 0699, which last defined the `check_key` CHECK and `app.report_payment_health`; 0799 adds `beam_webhook` (reasons `bad_signature`, `unknown_charge`); reserved at the top of F13's block (orchestrator, 31 Oct). (5) F08-T07 `f08_cancel` registration: 1090, in F09's block, because F09's `app.cancel_handlers` is created by 1003 and F08's 0909 sorts before it; 0909 holds the handler functions and the release registration, 1090 holds the one registration line (Architect, 30 Oct). (6) F10 `app.coach_message_hook`: 0899, above F07's 0805, the only migration that defines the hook (0807, 0810 and F08's 0907 call it); it replaces the no op so the hook enqueues leave_decision, coach_changed, session_change, cancellation_result, waitlist_ended and class_session_changed, and redefines F10's own `app.message_facts` (0611); the top of the F07 block, reserved for F10 (orchestrator, 30 Oct).
- **Shared registries are append-only fragments.** `table-classes`, `audited-tables`, `test_tables`, `definer-functions`, the settings registry and the permission matrix would collide if every feature edited one file. Instead each is a folder with one file per feature (for example `packages/db/registry/f03.ts`) collected by an index. F01-T05 builds the registries this way; this is the main protection against merge conflicts between parallel sessions.
- **Locale keys.** Only the Content role edits wording. A feature session adds its proposed keys (decision D51) to `locales/pending/<feature>.json` in both languages with named variables; the Content role merges them into `en.json` and `th.json` with numbers and sends them to the writers. This avoids two sessions taking the same key number. If `tools/i18n` already allocates numbers, use that instead.
- **Front end and back end.** Contract first: a back-end task that adds a route also adds its schema to `packages/contract` in the same PR; a front-end task starts when the schema is on `main` and runs against mocks until the route lands. A change to a merged schema is its own PR, reviewed by both. Screens are built from the hi-fi boards named in each design.
- **Reverting.** A bad merge is reverted as a whole PR on `main`; no force pushes to `main`.

## 5. Order and parallelism

Task numbers are those in the approved `tasks.md` files (F01 T01 to T37 with T27b, F02 T00 to T25, F03 T01 to T28).

### Wave 0: one session, strictly in order (about 4 to 5 working days)

F01-T01 scaffold → T02 test harness and clock → T03 migration 0001 (roles) → T04 `withClubTx` → T05 table-class registry (as fragments). **Merge each to `main` before the next starts, and merge all of Wave 0 before any parallel lane opens.** In parallel with Wave 0, and not touching code: DevOps adapts CI for the monorepo, Content lands the locale tools, QA wires `tests/` to Vitest, and the user and DevOps do F02-T00 (LINE test account). Wave 0 is the critical path, so it is done by one session.

### Wave 1: lanes open (after Wave 0 is on `main`)

F01-T06 (club setup migration) is the gate for most lanes: one session does it first (about half a day), then the lanes below start.

| Lane | Role and branch | Tasks, in order | Starts when |
|---|---|---|---|
| A: database core | Arch, `arch/f01-db` | F01-T06, T10, T11, T09, T12, T15, T26, T27 | T06 first; then in order |
| B: auth and platform | BE-P, `be-p/f01-platform` | F01-T13 (needs only T04), then T16, T17, T18, T19 | T13 at once; T16 after T06 |
| C: lifecycle | BE-P (second session), `be-p/f01-lifecycle` | F01-T20, T21, T22, T23, T24, T25, T28, T29, T27b | T20 after T06 and T10 |
| D: import, export, worker | BE-P (third session), `be-p/f01-data` | F01-T34 (worker), T30, T31, T32, T33, T35 | T34 after T04; T30 after T12 |
| E: F02 pure parts | BE-P, `be-p/f02` | F02-T03, T04, T08, T13 (no database needed) | At once in Wave 1 |
| F: F03 data and rules | BE-B, `be-b/f03` | F03-T01, T02, T03, T04, T05, then T06 to T14 | T01 after F01-T06; T03 and T05 can start at once |
| G: QA | QA, `qa/f01` | F01-T07 (tenant suite), acceptance tests for F01 and F02, F03-T27 later | T07 after T06; the rest from the `test.todo` skeleton |
| H: closing checks | DevOps and Arch | F01-T36 (static checks wiring) | After T13 |

**Dependencies that decide the order.** F01-T10 (audit) needs T06; T11 needs T10; T12 needs T06; T14 needs T12, T13 and T11; T17 needs T16; T18 needs T05 and T16; T20 needs T06 and T10; T27 needs T10 and T26; T27b needs T20 and T27; T28 needs T12 and T17.

### Wave 2: F02 database and sign-in; F03 claim; then the front end

| Lane | Tasks | Starts when |
|---|---|---|
| F02 data and session | F02-T01, T02 (after F01-T12, T34), T05 (after F01-T28), T06, T07, T09, T10, T11, T12, T14, T15, T16, T17 | After the F01 tasks they depend on are on `main` (see the F02 file header) |
| F03 claim, release, routes | F03-T06 to T22 | T06 after T02; T10 after F01-T10; T22 after F01-T13 |
| FE-P | F02-T18 to T23, F03-T24, T25 | Each when its route's schema is in `packages/contract` and F02-T07 is merged; they run against the LIFF stub and mocks before that |
| Sweeps | F01-T37, F02-T25, F03-T28 | After their lanes |

### Wave 3: F04 and F05 (when their designs are approved and their tasks written)

BE-C starts F04 on `be-c/f04` after F03-T08 and F01-T24 are on `main`; F05 after F04's Pay route and F03-T13, T14. F06 onward is not yet specified.

### How many sessions at once

Four back-end sessions plus one front end is the most that the shared folders support without constant rebasing: Arch (lane A), BE-P ×2 (lanes B/C and D/E, taking turns), BE-B (lane F), and QA. A fifth migration writer adds conflicts in `packages/db`; migrations stay with Arch and BE-B only until F04 starts (then BE-C, in its own number block).

### Schedule reality

Counting only the approved lists: 38 + 26 + 28 = 92 tasks of under a day each, plus F04 and F05 not yet tasked and F06 to F16 not yet specified. With four to five lanes the F01 to F03 work is roughly four weeks of calendar time after Wave 0, which already reaches the 7 Dec test start without F04 to F07. This is an estimate, not a promise; the Orchestrator should re-cut the waves with the user (development plan section 2). The smallest chain that makes a mock booking possible on 7 Dec is: Wave 0, F01 lanes A to C (roles, club, status, test mode), F02 sign-in, F03 claim and C4, F04 pricing and Pay, F05 Beam, F10 confirmation message, F13 receipt.

## 6. Conflict hot spots and the rule for each

| Hot spot | Rule |
|---|---|
| `packages/db/migrations` | Number block per feature; never edit a merged file; CI checks order |
| Registries (table classes, audited tables, test tables, definer functions, settings, permissions) | One fragment file per feature, collected by an index |
| `locales/*.json` | Content role only; features use `locales/pending/<feature>.json` |
| `packages/contract` | Schema changes are their own PR, reviewed by FE and BE |
| Generated database types | Never merged by hand; CI regenerates |
| `tasks.md` ticks | Only the PR that does the task ticks it |
| `docs/decisions.md` and the PRD | Orchestrator only; designs cite decisions, never edit them |
| `tests/fakes` | QA only; other sessions request changes |

## 7. For approval

1. Create `main` from the ordered merge in section 2, make it the default and protect it (user or DevOps).
2. Add `packages/contract`, keep QA's root `tests/`, and accept the time zone wording (section 3).
3. Registries as fragments and `locales/pending/` for new keys (section 4).
4. The wave and lane plan, with Wave 0 done by one session (section 5).
5. Building does not start until the user says so.
