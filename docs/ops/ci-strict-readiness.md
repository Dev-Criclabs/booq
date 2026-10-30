# What is missing before CI_STRICT can be turned on

From the Architect role, 30 Oct 2026. `CI_STRICT=true` makes every missing check an error (`.github/workflows/ci.yml`). Turn it on when all rows below are done; F01-T36 closes with it on.

| Needed by CI | State (30 Oct 2026) | Owner | Notes |
|---|---|---|---|
| `tools/check-table-classes.mjs` | Done (F01-T05) | Architect | |
| `tools/check-audit-triggers.mjs` | Done (F01-T11) | Architect | |
| `tools/check-migrations.mjs` | Done (F01-T36) | Architect | Names, feature blocks, and no edit of a migration that is on `origin/main` (`BASE_REF` overrides). In a PR job `origin/main` must be fetched (`fetch-depth: 0` or a fetch of `main`), or the never-edited rule is skipped with a notice |
| Script `test:db` | Done (F01-T36) | Architect | `vitest run packages/db packages/secrets tests/rls tests/concurrency`. It starts its own throwaway Postgres (needs the server binaries on the runner), so it does not use `DATABASE_URL` |
| Script `db:types` | Done (F01-T36) | Architect | Writes `packages/db/src/generated/schema.ts` from a database built from the migrations; the CI step regenerates it and fails on a diff |
| `packages/db/supabase/config.toml` | Added, **not run** (no Docker here) | Architect, DevOps to verify | Data API off. `migrations` is a symlink to `../migrations`. Postgres major version 17 is a choice: our tests ran on 16. If `supabase start` rejects a migration, DevOps tells the Architect (the likely suspects are role creation and `alter default privileges` on the hosted image) |
| `tests/rls/*.test.ts` (tenant and platform-blind suites) | Missing | QA | F01-T07. Most of the blind checks already live in `packages/db/src/*.test.ts` and run in `test:db` |
| `tests/concurrency/*.test.ts` | Missing | QA | F03-T27 |
| Postgres server binaries on the runner | To confirm | DevOps | The tests start a local server (`initdb`); `ubuntu-latest` has PostgreSQL client tools and may need `postgresql` installed |
| `pnpm test:zones` in CI | Not in `ci.yml` | DevOps | UTC and Asia/Bangkok |
| Lockfile in step with the workspace | OK | Architect | |
