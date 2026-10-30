# Tenant isolation suite (F01-T07)

`tenant-isolation.spec.ts` walks the table class registry (`packages/db/src/registry/`), so a new club table is covered the day it is registered. For every class S and D table it proves, on a real Postgres with every migration applied:

| Check | Meaning |
|---|---|
| Read | A club A context, in each of 7 role sets, never reads a club B row. Club B has a seeded row, so an empty result is a real result |
| No context | The application role with no club set reads no row |
| Write | A club A owner cannot update, delete or move a club B row, and cannot insert a row for club B (must fail with 42501) |
| Platform | The `booq_platform` role reads no row of a class D table |
| Policies | Every club table has a restrictive tenant policy on `app.club_id()` for the application role for all four commands, with a WITH CHECK |
| Foreign keys | Every foreign key between two club tables includes `club_id` on both sides |
| Grants | PUBLIC, `anon` and `authenticated` hold no privilege on a club table |
| Seeding | Every club table could be seeded for both clubs (no vacuous pass). A table the generic seeder cannot fill needs a fixture in `seed.ts` |

The suite drops CHECK constraints on the throwaway test database before seeding so generic values fit. They guard data validity, not tenancy.

**Mutation check.** `QA_MUTATE` breaks the database on purpose; the suite must go red:

```
QA_MUTATE=drop-policy:booking_tenant:public.booking pnpm vitest run tests/rls   # 2 failures
QA_MUTATE=open-policy:booking_tenant:public.booking pnpm vitest run tests/rls   # 2 failures
QA_MUTATE=grant-public:public.booking pnpm vitest run tests/rls                 # 1 failure
```

Not covered here (own suites): the 24 hour support window and BOOQ staff reading setup tables (class S) through the support view, secrets, views and `SECURITY DEFINER` functions, storage paths, and the role matrix over the API.
