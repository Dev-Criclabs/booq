# Wave 1 lane briefs

Status: draft by the Architect role, 30 Oct 2026. Source: `docs/architecture/build-plan.md` §5, the task lists in `specs/features/F0*/tasks.md`. Wave 0 (F01-T01 to T05) is on `architect/foundation`; the orchestrator merges it into `main` first (D128). A session does **one task per run**, tests first, then ticks the task and names the IDs in the commit.

## Rules for every lane

- Start each task from `main` (rebase). Push only your own branch. No pull request unless the user asks.
- Edit only the folders listed for your lane. Anything else is a request to the owner.
- Gate commands before any push (all must pass): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `node tools/check-table-classes.mjs`. Before closing a task that touches dates or money also run `pnpm test:zones` (UTC and Asia/Bangkok).
- New migration: take the next number in your feature block (F01 0001-0099, F02 0101-0199, F03 0201-0299). Never edit a merged file. Register every new table in `packages/db/src/registry/<feature>.ts` (class S, D, P or infra) and list it in the audited / test-table fragments when it applies.
- Database tests use `createTestDatabase()` from `packages/db/src/testing`; time comes from the clock (`setNow`, `advance`), never `Date.now()`.
- No user-facing text in code. New keys go in `locales/pending/<feature>.json`, both languages, named variables.
- Recommended default (D147): where a design question is not parked, account, credential, spending or irreversible, take the stated default, write it in the task note, keep going.

## Lane A: database core (Architect), `arch/f01-db`

- Tasks, in order: F01-T06, T10, T11, T09, T12, T15, T26, T27.
- May edit: `packages/db/**` (migrations 0002 to 0007, registry, testing), `tools/check-*.mjs`, `tests/` only for fixtures listed under QA's agreement, `specs/features/F01-*/tasks.md` (ticks).
- Tests: `pnpm test packages/db`, then the gate commands.
- First failing test (T06): in `packages/db/src/club.test.ts`, club A cannot see club B's `club_setting` row under `booq_app`, and a `location` row cannot point at another club's `resource` (composite key). Fails until `0002_club_setup.sql` exists.
- Recommended default: T06 gates lanes B, C, F and G, so it is done and pushed first (half a day).

## Lane B: auth and platform (BE-P), `be-p/f01-platform`

- Tasks: F01-T13 now (needs only T04), then T16, T17, T18, T19 after T06.
- May edit: `packages/auth/**`, `apps/platform/**`, `packages/contract/**` (own routes), `packages/db/migrations` only for T16 in block 0004 via the Architect.
- Tests: `pnpm test packages/auth`; for T16 `pnpm test packages/db`.
- First failing test (T13): `packages/auth/src/route.test.ts`: a route registered without a permission, feature or `public` declaration fails the build check; a route with `customer.contact.read` rejects an accountant-less role.
- Note: T16 is a migration. Recommended default: the Architect writes it (lane A, after T15) and BE-P builds the apps on it.

## Lane C: lifecycle (BE-P, second session), `be-p/f01-lifecycle`

- Tasks: F01-T20, T21, T22, T23, T24, T25, T28, T29, T27b.
- May edit: `packages/domain/club/**`, `apps/platform/**` (lifecycle screens), `apps/worker/**` tasks for T23 and T24.
- Starts when T06 and T10 are on `main`.
- Tests: `pnpm test packages/domain/club`.
- First failing test (T20): `club.status` cannot be updated directly by `booq_app`; `app.set_club_status('live')` from `draft` writes one audit entry and fails from `closed`.

## Lane D: import, export, worker (BE-P, third session), `be-p/f01-data`

- Tasks: F01-T34, T30, T31, T32, T33, T35.
- May edit: `apps/worker/**`, `packages/domain/import/**`, `packages/domain/export/**`.
- T34 starts at once (needs T04); T30 after T12.
- Tests: `pnpm test apps/worker packages/domain/import`.
- First failing test (T34): `apps/worker/src/task-wrapper.test.ts`: a task runs inside `withClubTx` for its club and a task without a club ID is refused.

## Lane E: F02 pure parts (BE-P), `be-p/f02`

- Tasks: F02-T03, T04, T08, T13. No database needed.
- May edit: `packages/auth/liff/**`, `packages/line/**`, `packages/domain/phone.ts`, `packages/domain/price-group.ts`.
- Tests: `pnpm test packages/auth packages/line packages/domain`; T13 also `pnpm test:zones` (age on a Bangkok date).
- First failing test (T03): a log capture with an `idToken`, `access_token` and `Authorization` header contains none of the values.

## Lane F: F03 data and rules (BE-B), `be-b/f03`

- Tasks: F03-T01 to T05, then T06 to T14. T03 and T05 start at once; T01 after F01-T06 and T26.
- May edit: `packages/domain/booking/**`, `packages/time/**` (booking rules only), F03 migrations 0201 to 0299 except T02 (Architect writes `occupancy`), `packages/db/src/registry/f03.ts`.
- Tests: `pnpm test packages/domain/booking packages/db`; `pnpm test:zones` always (D39, D42).
- First failing test (T03): `packages/domain/booking/time.test.ts`: 09:30 is refused, day 30 is inside the window and day 31 outside, a player cannot book an hour already started, staff can until the hour ends.

## Lane G: QA, `qa/f01`

- Tasks: F01-T07 (after T06), acceptance tests from the `test.todo` skeleton, F03-T27 later.
- May edit: `tests/**`. Does not edit product code.
- Tests: `pnpm test tests`.
- Open item for QA: `tests/acceptance/coverage.spec.ts` is red because the F01 requirements gained criteria IDs. Run `node --experimental-strip-types tests/acceptance/generate.ts` and commit.
- First failing test (T07): the tenant suite walks the registry and fails for any club table that lets club A read club B.

## Lane H: closing checks (DevOps and Architect)

- Task: F01-T36 after T13. May edit `.github/workflows/**`, `tools/lint/**`.
- Missing pieces are in `docs/ops/ci-strict-readiness.md`.
