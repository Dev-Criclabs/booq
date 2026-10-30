# What is missing before CI_STRICT can be turned on

From the Architect role, 30 Oct 2026. `CI_STRICT=true` makes every missing check an error (`.github/workflows/ci.yml`). Turn it on when all rows below are done; F01-T36 closes with it on.

| Needed by CI | State | Owner | Task |
|---|---|---|---|
| `tools/check-table-classes.mjs` | Exists (F01-T05) | Architect | done |
| `tools/check-audit-triggers.mjs` | Missing | Architect | F01-T11 |
| `tools/check-migrations.mjs` (duplicate, gap and out-of-order numbers, per-feature blocks) | Missing. `applyMigrations` already refuses these at run time; the script wraps the same loader without a database | Architect | F01-T36 (could land with T06) |
| `supabase/config.toml` (root or `packages/db`) | Missing. Our tests use a throwaway Postgres cluster, not the Supabase stack | DevOps with Architect | Recommended default: add a minimal `packages/db/supabase/config.toml` so the stack starts and replays the migrations |
| Script `test:db` in root `package.json` | Missing. Recommended default: `vitest run packages/db tests/rls tests/concurrency` | Architect | with first RLS suite |
| Script `db:types` | Missing. Needs a type generator choice (Supabase CLI `gen types` against the local stack) | Architect | F01-T36 |
| `tests/rls/*.test.ts` (tenant and platform-blind suites) | Missing | QA | F01-T07 |
| `tests/concurrency/*.test.ts` | Missing | QA | F03-T27 |
| Lockfile in step with workspace | OK after T05 commit (`vite-node` added) | Architect | done |
| Tests need `postgres` binaries on the runner | Check: the test cluster starts a local server; DevOps confirms `ubuntu-latest` has it or installs it | DevOps | before first CI run of `packages/db` |
| `pnpm test:zones` in CI (UTC and Asia/Bangkok) | Not in `ci.yml` | DevOps | add as a step |
| Red test `tests/acceptance/coverage.spec.ts` | Failing on the branch | QA | regenerate |
