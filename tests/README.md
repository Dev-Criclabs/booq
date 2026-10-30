# BOOQ tests

Owned by the QA role. Strategy: `docs/qa/test-strategy.md`. Requirement map: `docs/qa/traceability.md`.

| Folder | Holds | State on 30 Oct 2026 |
|---|---|---|
| `fakes/` | Fake Beam and fake LINE, a fake clock, a locale helper. No dependency on app code | Type checked, self tested in `fakes/fakes.spec.ts` (23 tests). Design in `fakes/README.md` |
| `support/` | Helpers for concurrency tests (`parallel.ts`) | Skeleton |
| `acceptance/` | One `test.todo` per approved acceptance criterion (521 from F01 to F06, F10, F11, F12), generated from `specs/features/*/requirements.md`, plus `coverage.spec.ts` that fails when a criterion has none (D126). Summary: `docs/qa/acceptance-coverage.md` | Generated |
| `unit/`, `integration/`, `concurrency/`, `rls/`, `e2e/` | The suites | Not created yet: they need approved requirements and the schema. Designs: `docs/qa/concurrency-tests.md`, `docs/qa/rls-test-plan.md` |

Run: `pnpm vitest run tests` (the root `vitest.config.ts` includes `tests/**/*.spec.ts`). Type check: `cd tests && ../node_modules/.bin/tsc -p tsconfig.json`. Regenerate the acceptance skeletons after a requirements change: `node --experimental-strip-types tests/acceptance/generate.ts`.

Rules: tests come first from the acceptance criteria; they never assert literal user facing wording (use `fakes/locale.ts`); money is integer satang; times are Asia/Bangkok and come from the injectable clock.
