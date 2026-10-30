# BOOQ tests

Owned by the QA role. Strategy: `docs/qa/test-strategy.md`. Requirement map: `docs/qa/traceability.md`.

| Folder | Holds | State on 30 Oct 2026 |
|---|---|---|
| `fakes/` | Fake Beam and fake LINE, a fake clock, a locale helper. No dependency on app code | Skeleton written, type checked, smoke tested. Design in `fakes/README.md` |
| `support/` | Helpers for concurrency tests (`parallel.ts`) | Skeleton |
| `unit/`, `integration/`, `concurrency/`, `rls/`, `e2e/` | The suites | Not created yet: they need approved requirements and the schema. Designs: `docs/qa/concurrency-tests.md`, `docs/qa/rls-test-plan.md` |

Type check the skeleton: `tsc -p tests/tsconfig.json` (needs `typescript` and `@types/node`; DevOps will add them to the repo toolchain).

Rules: tests come first from the acceptance criteria; they never assert literal user facing wording (use `fakes/locale.ts`); money is integer satang; times are Asia/Bangkok and come from the injectable clock.
