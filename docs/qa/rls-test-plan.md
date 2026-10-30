# Row level security test plan

Proves two promises from `CLAUDE.md` and the hand-off:

1. **Club A can never read or write club B.** "Every query is scoped by club ID. Permissions are checked on the server." (Hand-off, Data model: "Every record carries a club ID, and nothing is shared between clubs.")
2. **BOOQ platform staff never see a club's players, bookings, payments, slips, receipts, wallets or reports.** (Hand-off, Roles; PRD, Platform admin access, settled 30 Oct 2026; PLAT-02; PDPA-01.)

Plus the role limits inside one club (Player, Coach, Front desk, Accountant, Owner) because the same mechanism enforces them.

Written 30 Oct 2026, updated for decisions D1 to D28. The Architect has not written the RLS design yet (F01 `design.md`), so the mechanism names below are assumptions and are marked. Everything in sections 3 to 7 is mechanism independent: it is stated as "this identity runs this statement and must see or do this".

## 1. Why RLS needs its own plan

- A policy that is missing, or a table added later without one, silently leaks. Nothing fails visibly.
- Row level security protects only connections that run **as** a restricted database role. If the server connects with a privileged role (for example a Supabase service key) every policy is bypassed and only the server's own club scoping protects the data. So the plan tests both layers and says which one carries which promise.
- Each club has **its own LINE provider** (D7), so one person normally has a different LINE user ID at each club. The key stays (club ID, LINE user ID). RLS-A11 still seeds the same ID value at both clubs, because a policy keyed on LINE user ID alone would leak, and a future shared provider must not break it.

## 2. Layers and what each proves

| Layer | How the request runs | Proves | Where it lives |
|---|---|---|---|
| L1 Database | A test opens a connection, switches to the restricted role and sets the identity claims (club, role, user) exactly as production does, then runs raw SQL | The policies themselves. This is the real proof of promise 1 and 2 | `tests/rls/` |
| L2 API | HTTP calls to each route with a real session for each identity | The server's own scoping and permission check, including routes that use a privileged connection | `tests/integration/roles` |
| L3 UI | Playwright signs in as each identity | Nav items and pages match the role; UI hiding is **not** proof (the server must also refuse) | `tests/e2e` |

**Assumptions to confirm with the Architect** (not in the spec): identity reaches Postgres as JWT claims (Supabase `auth.jwt()`) or as `SET LOCAL` settings; roles are `player`, `coach`, `frontdesk`, `accountant`, `owner`, `platform_admin`, `platform_specialist` or a claim on one login role. A club person holds a **set** of roles (D1, ROLE-01): the helper takes a list and the rule is the union. BOOQ staff are separate accounts with email plus a second factor and never hold a club role (D3, ROLE-02); server jobs run as a dedicated role that is not the owner role. The helper `asIdentity({club, role, userId}, fn)` in `tests/rls/` hides this; only that helper changes.

## 3. Meta tests (run on every migration, no data needed)

These catch the "new table with no policy" failure before any scenario does.

| ID | Check | Fails when |
|---|---|---|
| RLS-M01 | Every table in the app schema has row level security **enabled and forced** | A new table ships without it |
| RLS-M02 | Every table with a `club_id` column has at least one policy that references the caller's club | A policy exists but ignores the club |
| RLS-M03 | Every table without `club_id` is on an explicit allow list (platform staff, platform audit log P6, templates, locale or reference data). The allow list is reviewed by Security | Someone adds a shared table |
| RLS-M04 | `anon` and `public` have no grant on tenant tables, views or functions | Default grants left on |
| RLS-M05 | Views over tenant tables are `security_invoker` (or equivalent), so they apply the caller's policies | A view runs with its owner's rights and leaks |
| RLS-M06 | Every `SECURITY DEFINER` function is on a reviewed allow list and sets a fixed search path | A function bypasses RLS silently |
| RLS-M07 | Every foreign key between tenant tables includes `club_id` (composite key), so a row in club A cannot point at a row of club B | Cross club reference possible |
| RLS-M08 | Every storage bucket path starts with the club ID and has a policy (slips, receipt PDFs, logos, coach photos) | Files readable across clubs |
| RLS-M09 | Real time channels apply RLS (a subscription by a club A player receives no event from club B, and none with another player's identity) | Live updates leak |
| RLS-M10 | Secrets (Beam keys and webhook keys, LINE channel secrets and tokens) are in columns or a vault that no client role can `SELECT`, including the Owner and Platform admin; only the last 4 characters are exposed (D27) | A secret readable from the browser |
| RLS-M11 | Ledger tables (credit, wallet) and receipts have no `UPDATE` or `DELETE` grant for any role except the narrow void path on receipts. Corrections are new rows | A balance can be edited (PKG-01 "never one editable number"). Append only, decided D28 |
| RLS-M12 | The audit tables allow `INSERT` and `SELECT` only | Audit can be changed (D28) |

## 4. Fixture for the scenario tests

Two full clubs seeded **through the application path** where possible, and directly where not:

| | Club A (Hunter fixture) | Club B (second club) |
|---|---|---|
| Players | PA1, PA2 (Adult), SA1 (Student) | PB1 |
| **Shared LINE user** | `LINE-SHARED`, present as player PA3 | `LINE-SHARED`, present as player PB2 |
| Staff | OA owner, FA front desk, AC accountant | OB owner |
| Coaches | CA1, CA2 | CB1 |
| Rows | Every tenant table has at least one row (the seed is generated from the table list, RLS-M01 style, so a new table forces a new seed row) | Same |
| Distinct values | Same promo code text `WELCOME` exists in both; same phone number exists in both; a booking at the same court name and hour in both | |
| Platform | `platform_admin` PL1, `platform_specialist` SP1 assigned to club A only, SP2 assigned to club B only | |

The platform test also runs once with club A in each status: **Draft, Testing, Live, Paused**, and once with the "Allow BOOQ to make changes" switch on (valid) and expired (stored `allow_until` in the past; the test sets the stored timestamp instead of moving the clock because the database clock is not the app's fake clock).

**Non vacuity rule.** Every denial test is paired with a control read by an identity that *is* allowed (for example OA owner), proving the row exists. A denial that can't be told from an empty table is not a pass.

## 5. Promise 1: club A can never read or write club B

Identities from club A (every role) and anonymous, against club B data. Each row is run at L1, L2 and where listed L3.

| ID | Scenario | Expected |
|---|---|---|
| RLS-A01 | For **every** tenant table, each club A identity runs `SELECT *` | 0 rows from club B, ever. Generated test over the table list |
| RLS-A02 | Same, `SELECT` by the exact primary key of a club B row (direct object reference) | 0 rows at L1; at L2 **404 not found** (D27, CC-1), never the data and never a 403 that confirms the record exists |
| RLS-A03 | `INSERT` a row with `club_id = B` | Refused (policy `WITH CHECK`) |
| RLS-A04 | `INSERT` a row for club A that references a club B parent (booking to a club B court, order to a club B customer) | Refused by the composite foreign key |
| RLS-A05 | `UPDATE` a club A row setting `club_id = B` | Refused |
| RLS-A06 | `UPDATE` or `DELETE` a club B row by key | 0 rows affected |
| RLS-A07 | L2: send club B's club ID in the path, query string, JSON body and a header on every route | The request is scoped by the session's club, not by the request value. The forged value is ignored or refused |
| RLS-A08 | L2: replay a club A session cookie or token on club B's host name or LIFF app | No access to club B (club resolved from the session and host together; open item: web address per club) |
| RLS-A09 | Tamper a token's club claim without re signing, and use an expired token | Rejected |
| RLS-A10 | Unique value probes: club A tries to create a player with a phone number, promo code or LINE user that exists only in club B | Succeeds (uniqueness is per club). No error message that reveals the value exists at club B |
| RLS-A11 | Shared LINE user: `LINE-SHARED` signs in to club A | Sees only account PA3 with its own credits and wallet. Signing in at club B gives PB2 and different data. A club A session cannot open PB2's bookings or receipts |
| RLS-A12 | Beam callback for a club B charge but signed with club A's webhook secret (each club is its own Beam merchant) | Rejected as a bad signature. Nothing changes in club B. (Needs per club secrets: confirm design) |
| RLS-A13 | LINE push for a club B player sends with club B's token (fake LINE records the token per push) | Never with club A's token. Club A's job run does not push to club B users |
| RLS-A14 | CSV exports (A5 customers, A13 reports, A14 receipts) and the player data copy | Contain only the caller's club. The data copy contains only the caller's own rows |
| RLS-A15 | Jobs (hold expiry, reminders, expiries, waitlist) run for both clubs | Each action touches only rows of its own club; a job error in club B does not stop or alter club A |
| RLS-A16 | Storage: club A identity requests a club B slip, receipt PDF or logo by path | Denied. Signed URLs expire and are bound to one object |
| RLS-A17 | Realtime: club A player subscribes to schedule changes | Receives events for club A resources only; never customer names |
| RLS-A18 | Reports and views: club A owner opens reports | Totals equal club A rows only; a club B booking changes nothing in club A's numbers |
| RLS-A19 | Club B is Paused or Draft | Club A is unaffected |
| RLS-A20 | Anonymous (browser, guest, no session) | Reads only what a guest may browse (courts, schedule states, classes, coaches, packages for the club in the URL). Reads no other table. Writes nothing |

## 6. Promise 2: BOOQ platform staff cannot read player, booking or payment data

Identities: `platform_admin` PL1, `platform_specialist` SP1 (assigned to A), SP2 (not assigned to A).

### 6.1 Table classification (decided: D2, D14, D27)

| Class | Tables (hand-off data model) | Platform staff |
|---|---|---|
| **Private** (never) | User (players), Customer package, Credit ledger, Wallet ledger, Booking, Waitlist entry, Order and payment, slips and slip checks, Receipt, Referral, Promo redemptions per customer, staff notes, reports and daily close, club audit entries, LINE message content, player consent records, data copy or delete requests, **staff, coaches, closures and promo codes** (D27 excludes them from the support view) | No `SELECT`, `INSERT`, `UPDATE`, `DELETE` on any column, through any table, view, function, export or log |
| **Setup** (support view, D27) | Courts and hours (Resource, Location, Opening hours), products and pricing including add-ons (Price group, Court price rule, Package product, Coach tier price rows, Add-on), LINE connection, payment connections, club settings | Read. Write while Draft or Testing, or Live or Paused with Allow BOOQ to make changes on and not expired. Look only otherwise (Paused behaves as Live) |
| **Aggregates and owner contact** (D2) | Counts for P1 and P3 only (for example bookings in the last 30 days) and the owner's contact details from P2 step 1 | Numbers only, no rows behind them, no drill down. Test data is not counted (PLAT-07-AC7) |
| **Platform** | Platform staff accounts (email plus second factor), assignments, P6 log, templates (P5), BOOQ plan | Per platform role |
| **Secrets** | Beam keys and webhook keys, LINE channel tokens and secrets | Write only for everyone, last 4 characters shown (D27) |

### 6.2 Scenarios

| ID | Scenario | Expected |
|---|---|---|
| RLS-P01 | For **every Private table**, PL1 and SP1 run `SELECT *`, `SELECT count(*)`, `SELECT` with a filter, and `EXISTS` | Permission denied or zero rows; and the control read as OA owner returns the seeded rows (non vacuity). Row counts must not even be inferable |
| RLS-P02 | Same for write statements on Private tables | Refused |
| RLS-P03 | Support view API (`/platform/clubs/{id}/support`) | Response contains only Setup class fields. A schema assertion lists allowed fields; any other field fails. Contains no player name, phone, booking, payment or receipt |
| RLS-P04 | Walk every other platform route (P1 to P6, exports, search, logs) with a **PII scan**: seeded players carry unique marker strings (`PII-NAME-A1`, a distinctive phone, LINE ID, slip text); fixtures search all responses and logs for them | Marker found anywhere in platform responses = severity 1 |
| RLS-P05 | P1 and P3 aggregates (bookings in the last 30 days, LINE messages this month, alerts) and owner contact details | Allowed (D2). Served from a view that returns numbers only, with no drill down route; equals the true count of real (non test) rows; no other count exists (PLAT-02-AC10/AC11) |
| RLS-P06 | Club status vs edit rights: Draft and Testing | PL1 and SP1 (assigned) can edit Setup tables; SP2 (not assigned) cannot see or edit |
| RLS-P07 | Club status Live, switch off | Setup tables look only for everyone on the platform side |
| RLS-P08 | Live, "Allow BOOQ to make changes" on | Edits allowed; each change logged with the BOOQ staff name in P6 **and** in the club's own audit log; after `allow_until` passes, edits refused again (stored timestamp set in the past) |
| RLS-P09 | Paused | Behaves as Live: look only unless Allow BOOQ to make changes is on (D27, PLAT-02-AC7) |
| RLS-P10 | Onboarding specialist | Can take assigned clubs Draft, Testing, Live (D15); cannot pause or resume (platform admin only); no delete club action exists for anyone (D14) |
| RLS-P11 | Pause | Only PL1 can pause, with a reason; the action writes P6; no player data read by the pause code path (check the query log of the request) |
| RLS-P12 | P6 log content | Contains staff, time, club, action, setup record and old/new values of **Setup** fields only. No row from a Private table appears (log column scan with markers) |
| RLS-P13 | Club audit entries (A17) | Platform staff cannot read them. The owner sees the entries about BOOQ visits (PLAT-02-AC6, PLAT-02 Meets) |
| RLS-P14 | Platform staff session against the player or admin API of a club | Denied. A BOOQ account never gets a club role (ROLE-01-AC6, ROLE-02-AC2). A LINE sign in cannot open the platform console (ROLE-02-AC3). Deactivated BOOQ staff are refused and open sessions end (ROLE-02-AC4) |
| RLS-P15 | Export club data (P3) | The owner downloads it; BOOQ staff can only start it and never receive the file or any row (D14). There is no delete club action for anyone (D14) |
| RLS-P16 | Mock data in a Testing club | Test mode results (P4) show pass or fail per check only (D4, PLAT-07-AC6). Same PII scan. Test rows carry the server set flag |
| RLS-P17 | Secrets | Write only for everyone including the Owner, last 4 characters shown (D27, RLS-M10). `Test connection` runs on the server and returns only pass or fail with a reason |
| RLS-P18 | Support access tokens | A token issued to platform staff for a visit cannot be used on a player route; it expires |

## 7. Role limits inside one club (same mechanism)

Hand-off Roles table. Each row is run at L1 where the table is directly granted, and always at L2.

| ID | Role | Must be able to | Must not (tested) |
|---|---|---|---|
| RLS-R01 | Player | Read and write own profile; own bookings; own credits, wallet, receipts, referrals; browse schedule states | Read another player's row, booking, receipt, wallet or credits; read staff notes or slips (even their own); see who holds or booked a slot (the schedule shows state only) |
| RLS-R02 | Coach | Own schedule, availability, leave, attendance, session notes, own earnings; roster of own sessions | Other coaches' schedules; customer payments; club revenue; players not in own sessions |
| RLS-R03 | Front desk | Bookings, walk ins, cash with reason code, customers | Revenue reports; coach pay; change prices, rules or staff; void a receipt |
| RLS-R04 | Accountant | Read and export reports and receipts | Any write to bookings, prices or balances; customer contact details beyond what reports need (still open, Q-29f) |
| RLS-R05 | Owner (and any person with several roles, ROLE-01-AC2) | Everything in club A, rights are the union of roles | Anything in club B (RLS-A01 to A06 run as Owner too) |
| RLS-R06 | Role change | A user whose role is removed loses access on the **next request**, not at token expiry | Cached tokens keep working after deactivation (A17 deactivate) |
| RLS-R07 | Route matrix | Every API route × every role (including anonymous and platform roles) has an allow or deny row in one table; a route with no row fails the build | Hidden UI but open API |

## 8. Running it

- `tests/rls/` is built by QA once the Architect's schema exists. Until then the files are stubs that list the scenario IDs above as `test.todo`.
- Runs on every PR that touches a migration or a policy, and nightly. The meta tests (section 3) run on every commit.
- A policy change in a PR must show the matrix diff (which identity gained or lost access) in the description. Security reviews it.
- Severity: any finding in sections 5 or 6 is severity 1 and blocks the PR.
- The PII scan markers are reused in the E2E logs scan, so a leak through logging or error reporting is caught as well.

## 9. Traceability

| Requirement | Tests |
|---|---|
| PLAT-02 | RLS-P01 to P09, P12, P15 to P17 |
| PLAT-04 | RLS-P08, P12, P13 (audit visibility), with `integration/audit` |
| PLAT-06, D14 | RLS-A14, RLS-P15 |
| ROLE-01, ROLE-02 | RLS-R05, RLS-P14 |
| PLAT-07 | RLS-P16, RLS-P05 |
| PDPA-01 | RLS-R01, RLS-A14, RLS-A16, RLS-M08 (slips and staff notes staff only); data copy RLS-A14 |
| Roles table (hand-off) | RLS-R01 to R07 |
| CLAUDE.md "Every query is scoped by club ID" | RLS-M01 to M07, RLS-A01 to A20 |
| CLAUDE.md "BOOQ platform staff never see..." | RLS-P01 to P18 |
| LINE integration "one provider, same LINE user ID" | RLS-A11, RLS-A13 |
