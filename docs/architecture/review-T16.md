# Review of F01-T16 (`0004_platform.sql`, branch `be-p/f01-platform`, d237507)

Reviewer: Architect role, 30 Oct 2026. Against SR-02, SR-03, SR-06, D27, F01 design 3.2 and 6.3, FA 4.4 and 8.2.

## Verdict: approve. Merge it. (It has been merged.)

The ten class P tables are the ones the design lists, with the right keys and CHECKs; nothing is granted to `booq_platform`, `booq_app`, `booq_worker` or the public roles, so the default is no access and T18 writes the grants and policies in one place. The two foreign keys 0002 left open are closed. P6 `audit_log` is append-only (row and truncate guards). `app.bump_usage` is a definer function with a fixed search path, takes no club argument, fails with no club context, and cannot be run by `booq_platform`. `platform.test.ts` has 19 tests covering this. I read the migration and the test titles; I did not run the branch, and it has not been tried with 0006 (test mode) merged in. CI on `main` after the merge is the check for that.

## Checked against the reviews

| Item | Result |
|---|---|
| SR-02 (BOOQ staff cannot change status or the change window) | Nothing here grants `booq_platform` any write on `club`. The column grants and the 24-hour CHECK are in 0002 and T18/T20. Nothing in 0004 widens them. OK |
| SR-03 (secrets) | No secret, key or token column in any platform table (tested). `club_secret` is T09. OK |
| SR-06 (no Data API, `anon`/`authenticated`) | `revoke all ... from public` on every table and the definer function; the existing "no privilege on any object" test in `roles.test.ts` sees the new schema objects and passes. OK. Residual, not for this task: the test database has no Supabase default privileges, so DevOps must run the same test against the real local Supabase stack (CI `db` job) |
| D27 (support view is setup only) | `launch_check` stores pass, fail or pending only; `support_session` and `export_request` hold no club content. OK |
| D2 (counts only) | `club_usage_daily` is `(club, day, metric, value)` with two metrics; tested to have no column that names a person or a booking. OK |
| SR-07 (definer functions) | `bump_usage` takes the club from `app.club_id()`, fixed `search_path = pg_catalog`, every object schema-qualified, `execute` revoked from public and granted to `booq_app` and `booq_worker` only. OK |

## The six defaults

1. **`app.bump_usage(metric, by)` in the `app` schema, no club argument.** Confirmed. Correct place (the app roles have no usage on `platform`).
2. **Returns false when the club is not Live or Paused.** Confirmed (test activity is not counted, FA 2.6, D33).
3. **Policy `club_owner_role_read` on `club` for `booq_owner`, own club only.** Confirmed, and it can stay beside mine. My 0006 (on `main`) has a wider `club_definer_read ... using (true)`; permissive policies are ORed, so the wide one decides. *Update (Architect, after thinking it through):* I am **keeping the wide one and not adding a migration to drop it.** The trigger `app.set_is_test()` reads the club status for the row's own club under `booq_owner`; with only the narrow policy it would find no club whenever the context is missing (a job, a fixture, a migration) and would silently set `is_test = false`, which is the dangerous direction (a test row that survives Go live). `booq_owner` is NOLOGIN and runs only our own definer functions, which take the club from the context (SR-07). Nothing for platform lane 1 to change.
4. **`export_request.status` = requested, running, done, failed.** Confirmed. T31 may add columns (link, row counts) in its own migration.
5. **No grants or RLS for `booq_platform` yet (T18).** Confirmed. T18 must also say whether the class P tables get `enable row level security` as a second layer. Recommended default: yes, enabled with explicit policies for `booq_platform`, so a future wrong grant still returns no rows.
6. **One word change to `harness.ts`: `app.test_clock` granted to `booq_owner`.** Confirmed, needed because `bump_usage` runs as `booq_owner` and `app.now()` reads the table in test databases. The merged line (the version that also lists `booq_audit` and `booq_anonymiser`) is the right one. Test-only; production `app.now()` is plain `now()`.

## Notes, none blocking

- **Migration number.** 0004 now lands after 0005 and 0006. A fresh database applies all three in order, which is the only case that exists today. Any developer database that already applied 0005 or 0006 without 0004 will be refused by `applyMigrations` (out of order) and must be recreated. Nobody runs production yet.
- **Unbounded `by`.** `bump_usage` accepts any `by >= 1`. It is only callable through server code, so this is fine; if the counts ever feed billing, give the callers a cap or make the callers pass 1.
- **`audit_log.target_id` is `text`, `detail` is free jsonb.** The writer functions in T17 must be the only way in and must reject player data keys. Add that test in T17.
- **`platform_staff.email`** is personal data of BOOQ staff. It is class P and visible only to the platform; fine. Include it in the data map for the PDPA record.
