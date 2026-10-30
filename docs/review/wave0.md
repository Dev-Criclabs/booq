# Wave 0 review

Reviewer, 30 Oct 2026. Reviewed on `origin/main` (head 218bac0) against `docs/review/checklist.md`. Scope: the commits that put code on `main`:

| Commit | Task | Lane |
|---|---|---|
| 4d83b20 | F01-T01 repo scaffold: pnpm workspace, strict TypeScript, Vitest, banned-pattern lint | Architect |
| 99144db | F01-T02 test harness: throwaway Postgres, migration runner, controllable clock | Architect |
| 252b1ec | F01-T03 migration 0001: roles, schemas, extensions, request-context helpers | Architect |
| 70ad018 | F01-T01 follow-up: root Vitest runs `tests/**/*.spec.ts`, typecheck covers `tests/` (QA request) | Architect |
| 08faf79 | CI adapted to the pnpm monorepo, ops docs | DevOps |

The tests were read, not run: the Reviewer has no Postgres or CI result for these commits in this session. **Verdict below is on the text and tests as written; CI must be green before merge.**

## Verdict

**No blocks.** F01-T01 to T03 are in lane, name their IDs, tick their tasks in the same commit, use a real Postgres for the database tests, and contain no user-facing text, money or business dates. Five should-fix items and four notes follow.

## Checklist walk

| Section | Result |
|---|---|
| 0 Gate and scope | Pass. F01 requirements, design and tasks are approved; D81 approves the build plan and the start of building. One task per commit; each ticks its own task in `tasks.md` in the same commit |
| 1 IDs | Pass. Messages start with IDs (`CC-1 CC-2 PDPA-01 F01-T03 ...`). CC-1 to CC-6 are defined in the F01 requirements. T03 names PDPA-01-AC1 in the task text; the commit says PDPA-01 |
| 2 Tests first | **Cannot verify** (see W0-1). Tests cover each stated test of T02 and T03: roles without BYPASSRLS, Asia/Bangkok per role, `anon` and `authenticated` locked out including for a table created later, helpers returning null and an empty set without context, 23:59:59 and 00:00:01 Bangkok, no override table in a production database, two runners at once. Real Postgres, no mocks |
| 3 Club scope | N/A for T01 to T03 (no club tables yet). The context helpers fail closed (`null`, empty set), which is what CC-1 needs from T04 |
| 4 Permissions | N/A. T03 grants: `platform` schema to `booq_platform` and `booq_worker` only; `audit` to nobody; `app` to the three application roles; `public` revoked from PUBLIC. Matches the F01 design |
| 5 No double booking | N/A. `btree_gist` is installed for F03 |
| 6 Time and money | Pass. `packages/time` names `Asia/Bangkok` and a Gregorian calendar explicitly, so the server zone does not matter; `test:zones` runs the suite under UTC and Asia/Bangkok. No money code yet |
| 7 Ledgers | N/A |
| 8 Payments | N/A |
| 9 Text | Pass. No user-facing strings. The hard-coded text lint and `check-wording` run in CI by direct call |
| 10 Audit | N/A. The `audit` schema exists with no grants; the writer comes in migration 0005 (T10) |
| 11 PDPA | N/A |
| 12 Open questions | Pass. Nothing decides D10 or the hosting question |
| 13 Lane | Pass with notes W0-3 and W0-4 |
| 14 Removed features | Pass. Nothing found |

## Findings

### W0-1 | should fix | Tests-first cannot be checked
Each task landed as one commit holding tests and code. Checklist 2.1 asks for the failing run or a test commit before the code. Fix: the commit body or PR note states the red run (which tests failed before the implementation). The Reviewer will ask for it on every later task and will not guess.

### W0-2 | should fix | The T02 commit changed the approved build plan
Commit 99144db edits `docs/architecture/build-plan.md` so the database harness lives in `packages/db/src/testing` instead of `packages/testing`, with the reason "only packages/db may import the driver". The reason is sound (the lint bans the driver elsewhere), but D81 approved the plan with `packages/testing` holding the harness, and the change was made by the author in the same commit. Fix: the Orchestrator records the move (one line in `docs/decisions.md` or a note on D81), and `docs/review/lanes.md` is updated: `packages/db/src/testing/**` is Architect, `packages/testing/**` holds fixtures only (done in this branch).

### W0-3 | should fix | Lint is narrower than the checklist assumes
`tools/lint/banned-patterns.mjs` scans `apps` and `packages` only, matches `from 'pg'`, `require('pg')` and `import('pg')` but not a bare `import 'pg'`, and does not scan `tools/` or `tests/`. That matches the T01 test text, but a test or tool file that imports the driver, or uses `service_role`, passes unnoticed, and F01-T36 later lists "no raw pg" as a CI check. Fix: extend the scan to `tools` and `tests` (with the harness file allowed), add the bare-import form, and add a test for each.

### W0-4 | should fix | CI rules are still advisory
`.github/workflows/ci.yml` treats a missing check script as a notice unless the repository variable `CI_STRICT=true`. Today the "repository rules" job (table classes, audit triggers, migration numbers) and the "database tests and generated types" job find nothing to run and pass. Fix: DevOps sets `CI_STRICT=true` as soon as F01-T05 lands (the table-class check) and the Reviewer will treat a PR merged with strict off as unreviewed on those checks. Closed by the commit: the script-name mismatch the first review found (OPS-8), because CI now calls the i18n tools directly.

### W0-5 | should fix | Two clocks
`packages/time` has a JavaScript `Clock` (`ControllableClock`) and the database has `app.now()` with its own test override. Both are test-only and both are tested, but nothing ties them together, so a test can move one and not the other. Fix: the first task that reads time in application code (F03-T03) states which clock it uses, and a test moves both together. Until then, any `new Date()` or `now()` outside these two places is a Block under checklist 6.4.

### W0-6 | note | Session settings can be set by any SQL the role can run
`app.club_id()`, `app.user_id()` and `app.roles()` read `current_setting`. A role that can run arbitrary SQL can `set_config('app.club_id', ..., false)` for itself. The design relies on `withClubTx` being the only door (T04) and on the lint. Not a defect of T03; it is the reason W0-3 matters. The Reviewer will check at T04 that no code path passes user input into a query unparametrised and that `withClubTx` sets the values transaction-locally.

### W0-7 | note | Public schema creation
Migration 0001 grants `create` on `public` to `booq_owner` and to the migrating user, and its test checks that the three application roles cannot create there. Fine. Record that the migrating user keeps `create` on `public` in production.

### W0-8 | note | Test cluster setup depends on the machine
`cluster.ts` finds Postgres under `/usr/lib/postgresql`, runs it as the `postgres` OS user when root, and sets `BOOQ_TEST_DB_ERROR` when it cannot start, so database tests fail with a reason instead of being skipped. Good. CI and the sandbox must have Postgres 15 or later; DevOps should state that in `docs/ops`.

### W0-9 | note | New folder not in the lane table
`tools/test/global-setup.ts` is new. Added to `docs/review/lanes.md` as Architect.

## Decisions D100 to D128 and the earlier findings

See the status table in `docs/review/spec-consistency.md`. Of the seven blocking findings, five are decided (D100 to D103, D126, D127) and need their text applied in specs, QA files and the ops runbook; none of those text changes is on `main` yet, so QA-1, QA-3 and OPS-1 stay open as work items.
