# Row level security test plan

Proves two promises from `CLAUDE.md` and the hand-off:

1. **Club A can never read or write club B.** "Every query is scoped by club ID. Permissions are checked on the server." (Hand-off, Data model: "Every record carries a club ID, and nothing is shared between clubs.")
2. **BOOQ platform staff never see a club's players, bookings, payments, slips, receipts, wallets or reports.** (Hand-off, Roles; PRD, Platform admin access, settled 30 Oct 2026; PLAT-02; PDPA-01.)

Plus the role limits inside one club (Player, Coach, Front desk, Accountant, Owner) because the same mechanism enforces them.

Written 30 Oct 2026. The Architect has not written the RLS design yet (F01 `design.md`), so the mechanism names below are assumptions and are marked. Everything in sections 3 to 7 is mechanism independent: it is stated as "this identity runs this statement and must see or do this".

## 1. Why RLS needs its own plan

- A policy that is missing, or a table added later without one, silently leaks. Nothing fails visibly.
- Row level security protects only connections that run **as** a restricted database role. If the server connects with a privileged role (for example a Supabase service key) every policy is bypassed and only the server's own club scoping protects the data. So the plan tests both layers and says which one carries which promise.
- Two clubs use **one LINE provider** (hand-off, LINE integration: "under one provider"), so the same LINE user ID can legitimately exist at club A and club B as two separate accounts. A policy keyed on LINE user ID alone leaks; keyed on (club, LINE user ID) it does not.

## 2. Layers and what each proves

| Layer | How the request runs | Proves | Where it lives |
|---|---|---|---|
| L1 Database | A test opens a connection, switches to the restricted role and sets the identity claims (club, role, user) exactly as production does, then runs raw SQL | The policies themselves. This is the real proof of promise 1 and 2 | `tests/rls/` |
| L2 API | HTTP calls to each route with a real session for each identity | The server's own scoping and permission check, including routes that use a privileged connection | `tests/integration/roles` |
| L3 UI | Playwright signs in as each identity | Nav items and pages match the role; UI hiding is **not** proof (the server must also refuse) | `tests/e2e` |

**Assumptions to confirm with the Architect** (not in the spec): identity reaches Postgres as JWT claims (Supabase `auth.jwt()`) or as `SET LOCAL` settings; roles are `player`, `coach`, `frontdesk`, `accountant`, `owner`, `platform_admin`, `platform_specialist` or a claim on one login role; server jobs run as a dedicated role that is not the owner role. The helper `asIdentity({club, role, userId}, fn)` in `tests/rls/` hides this; only that helper changes.

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
| RLS-M10 | Secrets (Beam keys and webhook secrets, LINE channel secrets and tokens) are in columns or a vault that no client role can `SELECT`, including the Owner | A secret readable from the browser. Whether Platform admin may re read them: Q-29 |
| RLS-M11 | Ledger tables (credit, wallet) and receipts have no `UPDATE` or `DELETE` grant for any role except the narrow void path on receipts. Corrections are new rows | A balance can be edited (PKG-01 "never one editable number"). Assumption: append only. Confirm Q-30 |
| RLS-M12 | The audit tables allow `INSERT` and `SELECT` only | Audit can be changed. Assumption, Q-30 |

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
| RLS-A02 | Same, `SELECT` by the exact primary key of a club B row (direct object reference) | 0 rows at L1; at L2 a not found or forbidden response (which one: Q-29), never the data |
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

### 6.1 Table classification (to be confirmed, Q-29)

| Class | Tables (hand-off data model) | Platform staff |
|---|---|---|
| **Private** (never) | User (players), Customer package, Credit ledger, Wallet ledger, Booking, Waitlist entry, Order and payment, slips and slip checks, Receipt, Referral, Promo redemptions per customer, staff notes, reports and daily close, club audit entries, LINE message content, player consent records, data copy or delete requests | No `SELECT`, `INSERT`, `UPDATE`, `DELETE` on any column, through any table, view, function, export or log |
| **Setup** (support view) | Club (status, plan, payment option, feature switches), Location, Resource (courts), Opening hours, Price group, Court price rule, Package product, Coach tier, Add-on, Club settings, LINE connection status (not secrets), payment connection status (not secrets), Closure, Promo code definitions (not redemptions) | Read; write only while Draft or Testing, or Live with Allow BOOQ changes on and not expired. Look only otherwise |
| **Platform** | Platform staff accounts, assignments, P6 log, templates (P5), BOOQ plan | Per platform role |
| **Unclear** | Coach and staff profiles (people with names and pay models), Closures, Promo codes, mock data in Testing clubs, aggregated counts (P1 bookings in 30 days, LINE messages this month) | Needs a decision: Q-28, Q-29 |

### 6.2 Scenarios

| ID | Scenario | Expected |
|---|---|---|
| RLS-P01 | For **every Private table**, PL1 and SP1 run `SELECT *`, `SELECT count(*)`, `SELECT` with a filter, and `EXISTS` | Permission denied or zero rows; and the control read as OA owner returns the seeded rows (non vacuity). Row counts must not even be inferable |
| RLS-P02 | Same for write statements on Private tables | Refused |
| RLS-P03 | Support view API (`/platform/clubs/{id}/support`) | Response contains only Setup class fields. A schema assertion lists allowed fields; any other field fails. Contains no player name, phone, booking, payment or receipt |
| RLS-P04 | Walk every other platform route (P1 to P6, exports, search, logs) with a **PII scan**: seeded players carry unique marker strings (`PII-NAME-A1`, a distinctive phone, LINE ID, slip text); fixtures search all responses and logs for them | Marker found anywhere in platform responses = severity 1 |
| RLS-P05 | P1 Clubs aggregates (bookings in the last 30 days, LINE messages this month, alerts) | Only if the product owner allows counts (Q-28). If allowed: served from a view that returns numbers only, with no drill down route, and equals the true count |
| RLS-P06 | Club status vs edit rights: Draft and Testing | PL1 and SP1 (assigned) can edit Setup tables; SP2 (not assigned) cannot see or edit |
| RLS-P07 | Club status Live, switch off | Setup tables look only for everyone on the platform side |
| RLS-P08 | Live, "Allow BOOQ to make changes" on | Edits allowed; each change logged with the BOOQ staff name in P6 **and** in the club's own audit log; after `allow_until` passes, edits refused again (stored timestamp set in the past) |
| RLS-P09 | Paused | Behaviour of support edits while paused is not specified (Q-29). Test pinned once answered |
| RLS-P10 | Onboarding specialist | Can act on assigned clubs only; cannot pause a club; cannot delete a club (both refused on the server) |
| RLS-P11 | Pause | Only PL1 can pause, with a reason; the action writes P6; no player data read by the pause code path (check the query log of the request) |
| RLS-P12 | P6 log content | Contains staff, time, club, action, setup record and old/new values of **Setup** fields only. No row from a Private table appears (log column scan with markers) |
| RLS-P13 | Club audit entries (A17) | Platform staff cannot read them. They can see that their own visits were recorded only if the design says so (Q-30) |
| RLS-P14 | Platform staff session against the player or admin API of a club | Denied. Platform logins have no player, staff or coach role in any club unless granted like any user |
| RLS-P15 | Export club data (P3 in the hand-off) | Needs a decision: it is a platform page, yet "BOOQ never sees player data" (Q-28). Until answered the test asserts only that an export is available to the club owner, and that a platform staff request cannot return Private data |
| RLS-P16 | Mock data in a Testing club | Test mode results (P4) show pass or fail of checks, not booking rows. Same PII scan |
| RLS-P17 | Secrets | Platform staff can write but not read back Beam and LINE secrets (RLS-M10), and `Test connection` runs on the server and returns only pass or fail with a reason |
| RLS-P18 | Support access tokens | A token issued to platform staff for a visit cannot be used on a player route; it expires |

## 7. Role limits inside one club (same mechanism)

Hand-off Roles table. Each row is run at L1 where the table is directly granted, and always at L2.

| ID | Role | Must be able to | Must not (tested) |
|---|---|---|---|
| RLS-R01 | Player | Read and write own profile; own bookings; own credits, wallet, receipts, referrals; browse schedule states | Read another player's row, booking, receipt, wallet or credits; read staff notes or slips (even their own); see who holds or booked a slot (the schedule shows state only) |
| RLS-R02 | Coach | Own schedule, availability, leave, attendance, session notes, own earnings; roster of own sessions | Other coaches' schedules; customer payments; club revenue; players not in own sessions |
| RLS-R03 | Front desk | Bookings, walk ins, cash with reason code, customers | Revenue reports; coach pay; change prices, rules or staff; void a receipt |
| RLS-R04 | Accountant | Read and export reports and receipts | Any write to bookings, prices or balances; any customer contact detail beyond what reports need (confirm, Q-29) |
| RLS-R05 | Owner | Everything in club A | Anything in club B (RLS-A01 to A06 run as Owner too) |
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
| PLAT-06 | RLS-A14, RLS-P15 |
| PDPA-01 | RLS-R01, RLS-A14, RLS-A16, RLS-M08 (slips and staff notes staff only); data copy RLS-A14 |
| Roles table (hand-off) | RLS-R01 to R07 |
| CLAUDE.md "Every query is scoped by club ID" | RLS-M01 to M07, RLS-A01 to A20 |
| CLAUDE.md "BOOQ platform staff never see..." | RLS-P01 to P18 |
| LINE integration "one provider, same LINE user ID" | RLS-A11, RLS-A13 |
