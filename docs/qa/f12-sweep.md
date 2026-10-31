# F12 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F12-coach-portal/requirements.md` (CPORT-01 to CPORT-07). The database side is built (tables `coach_attendance` and `coach_note`, the portal functions, the payout figures); the portal routes and the K1 to K6 screens are not on main.

**Result: 7 criteria. 5 traced to the database side (CPORT-03 to CPORT-07), 2 listed with a reason in `F12-gate.new.spec.ts` (CPORT-01 Today and CPORT-02 Schedule: the functions `app.coach_day` and `app.coach_schedule` exist, no test calls them, the screens are not built).**

- **F12-T09 access suite** (`F12-access.new.spec.ts`, 6 tests; kept in `tests/` because QA edits `tests/**` only): anon, authenticated, the platform role and the worker hold nothing on either table; the app role reads both and writes neither; both tables force row security; the portal functions run for the app role only and the helpers and guards for nobody; a new portal function must be listed. Mutation checked: a platform read grant, an app write grant, and a worker grant on `mark_attendance` each turn it red.
- **F12-T18 Playwright pass:** not possible yet: the K1 to K6 pages are not built (`apps/web/src/app` has no coach pages). When they land: the longest Thai string on K1 to K6 at 375 px (`tests/e2e/qa-admin.e2e.mjs` has the clipping audit to reuse) and the owner as a coach (own rows only).
