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

## Definer functions and views (`definer-and-views.spec.ts`)

| Check | Meaning |
|---|---|
| Owner | Every `SECURITY DEFINER` function is owned by a role that is not a superuser and does not bypass row level security |
| search_path | Fixed, starts with `pg_catalog`, never names `public` |
| Execute | No definer function can be executed by PUBLIC, `anon` or `authenticated` |
| Club argument | A function the application role may execute takes no club id (the club comes from the context). Exceptions are listed with a reason and proven (`app.coach_flag_reason` answers null for another club) |
| Probe | Every definer function the application role may execute (111 on 31 Oct) is called ~150 times as a club A owner and as a guest, with the ids of club B's rows as arguments. Nothing of club B may come back and club B's rows may not change (fingerprint per table) |
| Views | Each view is security_invoker, filters by `app.club_id()`, or is built on a view that does; PUBLIC/anon/authenticated may select none; the platform role reads only views built on setup or platform tables; a club A context reads no club B row through any view, and no context reads nothing |

Mutation check: `QA_MUTATE_SQL="<statement>" pnpm vitest run tests/rls/definer` runs one statement first. Verified red for: an unfiltered view, a definer function that returns another club's rows, a definer function with no search_path, and a function granted to PUBLIC.

Limits: the probe fills only simple argument types (uuid, text, numbers, booleans, dates, json, arrays); functions with other argument types are counted as skipped. A function that refuses by role before it touches data passes without proving the role check; the role checks are in the lanes' own tests.

## Secrets (`secrets.spec.ts`)

Stored secrets are write-only (D27, D149, SR-03). On a scratch database with every CHECK in place: only an owner writes (front desk, player, guest and a context with no user are refused with 42501); a plaintext value, an unknown kind and a tail over four characters are refused; no role set of the application role can select the ciphertext (by name, `select *` or who wrote it), the worker and the platform role have no privilege on the table or column; the owner sees which secrets exist for their own club only; `app.read_secret` serves apps/web the Beam keys and the LINE channel secret and refuses the LINE token and login secret; `app.read_secret_worker` serves the worker every kind; neither role can run the other's reader or the internal one; a read returns the context club's secret only and fails with no club; reads are counted as a number; nothing from a secret reaches the club audit log or P6; BOOQ staff can write for a Draft club (and the application reads the same envelope back), cannot write a Live club without the owner window, and an unassigned specialist cannot see the club.

Mutation check (`QA_MUTATE_SQL`): verified red for granting select on the ciphertext column, letting the web reader serve the login secret, granting the internal reader, dropping the envelope constraint and granting the platform role select.

Not covered here (own suites): the 24 hour support window and BOOQ staff reading setup tables (class S) through the support view, and storage paths (no object storage exists yet). The role matrix over the API is in `tests/api/`.
