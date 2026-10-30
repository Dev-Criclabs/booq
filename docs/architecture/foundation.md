# BOOQ foundation architecture (proposal)

Status: **DRAFT for approval by a person. Nothing here is approved.** Author role: Architect / data. Branch `architect/foundation`. 30 Oct 2026.

This is the shared design every feature relies on. It is not a feature `design.md`. F01's `design.md` comes after F01's requirements are approved, and it will cite this file.

Sources: `CLAUDE.md`, `specs/product/prd-v1.2.md`, `specs/product/handoff-v1.2.md`, `docs/DEVELOPMENT-PLAN.md`, `docs/canvas-gaps.md`. Requirement IDs (BOOK-04, PAY-03, PKG-01, PLAT-04 ...) are the hand-off's.

How to read: each section ends with its open questions as `Q#`. All questions are collected in section 10 with who needs to answer and whether they block approval of this document. Where the spec is silent I say so and propose; I do not decide. Values the PRD marks TBD stay empty club settings.

The stack is the one adopted on 30 Oct: Next.js with the LIFF SDK, Postgres (Supabase) with row-level security (RLS) by club ID, server jobs.

## 0. Summary of recommendations

| # | Decision | Recommendation | Trade-off |
|---|---|---|---|
| D1 | Names (Store/Branch vs Club/Location) | Keep the core's physical table names; the code, docs and UI say `club` and `location` through one mapping layer (§1) | Cheap to adopt, but two vocabularies exist until the core is read (Q1, Q2) |
| D2 | Tenant key | `club_id` on every club table, with composite keys `(club_id, id)` and composite foreign keys, so a row can never point at another club's row | Slightly wider keys and FKs; removes a whole class of leaks |
| D3 | Database access | Browsers and LIFF never talk to the database. Only our server does, as restricted roles; Supabase's anon/authenticated roles get no grants | We write the API ourselves; no auto REST |
| D4 | Identity | Players, coaches, staff: our own session from a server-verified LIFF ID token. BOOQ staff: Supabase Auth with MFA (Q16) | Two identity systems, but they cannot be confused |
| D5 | No double booking | One `occupancy` table; one row claims the court and the coach; two exclusion constraints (`btree_gist`) (§3) | Needs `btree_gist`; the rest rule needs a row lock because a constraint cannot express it |
| D6 | Transactions | READ COMMITTED, explicit row locks in a fixed order, constraints as the final judge | Needs discipline on lock order; simpler than SERIALIZABLE retries |
| D7 | Ledgers | Append-only by grants and triggers; balances are derived by SUM; no stored editable number | Reads sum rows (tiny volume at club scale) |
| D8 | BOOQ staff blindness | Separate DB role with grants only on setup tables (default deny), separate Next.js app with only that role's credentials, aggregate-only usage counters (§4) | Two deployables; worth it because the platform app holds no credential that can read player data |
| D9 | Jobs | Graphile Worker on Postgres. Time rules live in query predicates (`hold_expires_at <= now()`); jobs only do side effects (§5) | One more process to run; avoids loss of correctness if a job is late |
| D10 | Beam | Gateway interface; raw-body HMAC check; event table for idempotency; late payment re-attempts the claim, else wallet (§6) | Exact Beam details unknown until docs are read (Q24) |
| D11 | Time | `timestamptz` for instants, `date`/`time` for wall-clock rules, one `time` package, Thai dates forced to the Gregorian year (§7) | Banned APIs need a lint |
| D12 | Audit | DB triggers write the diff via a SECURITY DEFINER writer; actor and reason come from transaction-local settings (§8) | Every audited table needs a trigger; CI checks the list |
| D13 | Repo | pnpm monorepo: `apps/web`, `apps/platform`, `apps/worker`, `packages/*` (§9) | More folders than one app; clean role ownership |
| D14 | Query layer | Plain SQL migrations (Supabase CLI) and Kysely with generated types | Less magic than an ORM; we write the SQL |

## 1. Mapping the Booq core to Club and Location

### 1.1 What the spec gives us

- Hand-off, Architecture: "Booq core naming differs: Notion says Store and Branch, this design says Club and Location. Keep the core's table names and map the labels in the UI."
- PRD, conflicts with the Notion core, settled 30 Oct: one plan (not Personal/Professional/Business); BOOQ staff never see customer data; booking length fixed at 60 minutes (the core allows 60 or 90).

I did not search the Notion workspace. The brief says the "Booq Product Reference" is not in the repo and to state what is needed instead of guessing, so this section is a mapping plus a checklist. It is provisional until Q1 is answered.

### 1.2 Proposed mapping

| Core (Notion) | This design | Notes |
|---|---|---|
| Store | Club | The tenant. Its id is the `club_id` on every row. |
| Branch | Location | A place with resources. Hunter has one, "Main location · Head office". |
| (unknown) | Resource | The hand-off says courts are general resources (sport, type, lights, max players). Need to see how the core models bookable things. |
| Plans table (Personal, Professional, Business) | One plan | Keep the table if it exists; seed one plan; `club.plan_trial_ends_at` and `club.billing_starts_at` are per club (PRD step 2). |
| Booking duration variants 60/90 | 60 only | Enforce in the database (CHECK in §3), not only in the UI. |
| Platform admin sees tenant data (if so) | Must not | See §4. If the core lets platform staff read customer data, that path is removed, not hidden. |

Two things that look alike and are different:

- The word **branch** is used twice in the spec. `Club.branch` is the **tax branch** printed on receipts ("head office", สำนักงานใหญ่). `Location.branch label` is a place label. The core's Branch maps to Location, not to the tax branch. Column names: `club.tax_branch`, `location.label`.
- The core's tenant column is probably `store_id`. If the physical column stays `store_id`, `packages/db` exposes it to the rest of the code as `clubId` (one alias in the query layer, one place in RLS helpers). The words in this document (`club_id`) are the logical name.

### 1.3 Recommendation, and what I need from the core

Decision rule (cannot choose without reading the core):

- If the core is already Postgres, has a tenant key on its tables and its own booking tables: extend it, keeping its table names (D1). Add the tables in §2 beside them.
- If the core has no tenant key, no RLS, or platform staff read tenant data: do not retrofit. Create the BOOQ schema as new tables with core-compatible names for Store/Branch and write an adapter for whatever must stay shared.

Needed from the Notion "Booq Product Reference" or from whoever owns the core (also Q1):

1. Entity list with physical table and column names, id types, and the tenant key.
2. How the tenant is enforced today: RLS, app-level filters, or nothing.
3. Auth model: who signs in how; staff and role tables; whether platform admins can read tenant data.
4. Booking and slot model: how double booking is prevented today; the 60/90 minute variants; resources.
5. Payments: the Beam integration as built. The spec says the core "confirms Beam as its gateway with PromptPay refunds". Our rule is wallet or credit only (CANCEL-02, PAY-05), so I need to know if refund code exists.
6. Plans, billing and the club status field, if present.
7. Migration tooling, DB host, ORM, job runner, audit log, if any.
8. Whether the core holds live data (migrate) or is a spec only (greenfield).

## 2. Data model

### 2.1 Conventions

- Every club table has `club_id uuid not null` and `unique (club_id, id)`. Foreign keys to other club tables are composite: `foreign key (club_id, customer_id) references app_user (club_id, id)`. A child can never reference another club's parent.
- Primary keys: `uuid default gen_random_uuid()`. Order by `created_at`, not by id. (UUIDv7 can come later; volumes are small.)
- Every secondary index on a club table starts with `club_id`. Exclusion and uniqueness on globally unique ids are the exception.
- Enumerations are `text` with a CHECK constraint, not Postgres enums, so changing a set is one migration without enum surgery. The types are generated into TypeScript.
- Money: `bigint` satang, columns end in `_satang`, one currency (THB), no floats anywhere. Prices and amounts `check (>= 0)`; ledger deltas are signed. Percentages are integer basis points. Rounding is a question (Q7).
- Instants are `timestamptz`. Wall-clock rules are `date` and `time` (§7).
- No hard delete of business records. Status columns and ledger compensation. PDPA deletion is anonymisation (Q27).
- Defaults live in templates (P5), as data written to the club at creation. There are no default values in code. A setting that is absent is unset (TBD), and the code treats unset as "no limit" or "feature off" only where the spec says so (BOOK-05).
- `created_at` and `updated_at` on every table; `updated_at` set by trigger.
- `is_test boolean` on bookings, orders, payments and receipts for clubs in Testing (Q9).

### 2.2 Table inventory and data class

Every table is classified **S** (setup: BOOQ staff may see it in the support view), **D** (club data: BOOQ staff never) or **P** (platform schema). Anything not listed as S is D. A CI check fails any migration that adds a table without a class (§4.5).

| Table | Class | Key and uniqueness | Notable indexes and notes |
|---|---|---|---|
| `club` | S | pk `id`; unique `slug`; status in draft/testing/live/paused; `payment_option` in beam/slip; legal name, tax id, `tax_branch`, registered address, `receipt_prefix`, `allow_booq_changes_until`, `paused_at`, `pause_reason`, owner contact (Q20) | RLS: `id = app.club_id()` |
| `club_feature` | S | pk `(club_id, feature_key)` | Switches per club (PLAT-05) |
| `club_setting` | S | pk `(club_id, key)`; `value jsonb` | Keys come from a typed registry in code: hold minutes, cancel window hours, max future court hours, booking window days, rest cap, waitlist claim minutes, no-offer-within hours, class-below-minimum alert, wallet expiry, VAT switch. Absent means unset |
| `location` | S | unique `(club_id, id)` | `(club_id, name)` |
| `resource` | S | unique `(club_id, id)`; fk location | sport, type, lights, max players, active |
| `opening_hours` | S | pk `(club_id, weekday)`; open `time`, close `time` (close may be `24:00`) | Spec keys hours by club; a second location would need `location_id` (C7) |
| `price_group`, `court_price_rule`, `coach_tier`, `coach_tier_price`, `package_product`, `add_on` | S | unique `(club_id, id)` | Price snapshots go into order lines, so later edits never change history |
| `line_connection`, `payment_connection` | S | pk `club_id` | Channel and LIFF ids, OA id; Beam merchant id and mode (sandbox/live). No secrets here |
| `club_secret` | S, write-only | pk `(club_id, kind)` | LINE tokens, Beam keys and webhook secrets, encrypted; platform role can INSERT/UPDATE but never SELECT (§4.4) |
| `app_user` | D | unique `(club_id, line_user_id)`; unique `(club_id, id)` | Player, coach, staff in one table. A person at two clubs has two rows. Index `(club_id, phone_normalized)` (not unique) for the self-referral check. Role: Q3 |
| `user_staff_note` | D, staff only | fk user | Split out of `app_user` so a player reading their own row can never receive staff notes (PDPA-01) |
| `user_consent` | D | `(club_id, user_id, notice_version, accepted_at)` | Append-only (PDPA-01) |
| `coach`, `coach_availability_rule`, `coach_leave` | D | `coach.id = app_user.id` or fk | Coach profile, pay model and leave contain staff personal data, so D |
| `booking` | D | unique `(club_id, id)` | `(club_id, customer_id, start_at desc)`; `(club_id, start_at)`; partial `(hold_expires_at) where status = 'awaiting_payment'` |
| `occupancy` | D | §3 | Two exclusion indexes (§3) |
| `class_template`, `class_session`, `waitlist_entry` | D | | `(club_id, subject_id, position)`; partial on `offer_expires_at` |
| `customer_package`, `package_extension` | D | | `(club_id, customer_id)`; partial `expires_at` for expiry sweeps |
| `credit_ledger` | D | §2.3 | `(club_id, package_id, created_at)` |
| `wallet_account`, `wallet_ledger` | D | §2.3 | `(club_id, customer_id, created_at)` |
| `orders`, `order_line`, `payment`, `payment_event` | D | §6 | `payment`: unique `(club_id, gateway, gateway_charge_id)`. `payment_event`: unique `(club_id, gateway, gateway_event_id)` |
| `payment_slip` (F16) | D, staff only | | Files in a private bucket, path starts with `club_id/`, signed URLs only |
| `promo_code`, `partner`, `promo_redemption`, `referral` | D | | One code per order: unique `(club_id, order_id)` on `promo_redemption` |
| `closure` | D | | Creates `occupancy` rows of kind `closure` |
| `receipt`, `receipt_counter` | D | unique `(club_id, number)` | Gap-free numbering (§2.4) |
| `audit_entry` | D | | §8 |
| `message_outbox` | D | unique `(club_id, dedupe_key)` | `(send_at) where status = 'pending'` |
| `idempotency_key` | D | pk `(club_id, key)` | Request hash and stored response; purge after 7 days |
| `data_request` | D | | PDPA copy or delete requests |
| `coach_payout` and adjustments | D | | Owner only |
| `platform.platform_staff`, `platform.staff_assignment`, `platform.support_session` | P | | BOOQ team accounts and who may open which club |
| `platform.audit_log` | P | | The P6 log (§8) |
| `platform.club_usage_daily` | P | pk `(club_id, day)` | Aggregate counts only: bookings created, LINE messages sent. No row ids |
| `platform.club_health` | P | pk `(club_id, check)` | LINE token ok/failed, last callback time |
| `platform.template`, `platform.template_item` | P | | P5 templates (Hunter defaults, Padel, Pickleball, Blank) |
| `platform.launch_check` | P | | P4 results; no tenant data |

### 2.3 Ledgers (PKG-01)

Credits and wallet are movements. There is no stored balance column that code can update.

```sql
create table credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null,
  package_id  uuid not null,
  change      integer not null,
  reason      text not null check (reason in ('reserve','return','use','forfeit','expire','adjust')),
  booking_id  uuid,
  staff_id    uuid,
  note        text,
  dedupe_key  text,                       -- e.g. 'use:{booking_id}'; a booking can be reserved, returned and reserved again (late payment)
  created_at  timestamptz not null default now(),
  foreign key (club_id, package_id) references customer_package (club_id, id),
  check (staff_id is null or (note is not null and length(btrim(note)) > 0)),   -- staff always give a reason
  check (reason <> 'adjust' or staff_id is not null),
  unique (club_id, dedupe_key)            -- nulls are distinct, so rows without a key are unaffected
);

create table wallet_ledger (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null,
  customer_id  uuid not null,
  change_satang bigint not null check (change_satang <> 0),
  reason       text not null,       -- the set is a question (Q5)
  booking_id   uuid,
  order_id     uuid,
  referral_id  uuid,
  staff_id     uuid,
  note         text,
  dedupe_key   text,                      -- e.g. 'late_payment:{payment_id}'; makes a repeated callback unable to credit twice
  created_at   timestamptz not null default now(),
  unique (club_id, dedupe_key),
  foreign key (club_id, customer_id) references app_user (club_id, id),
  check (staff_id is null or (note is not null and length(btrim(note)) > 0))
);
```

Append-only is enforced three ways, so it survives a bug:

1. `revoke update, delete, truncate` on both tables from every application role; the app roles hold `INSERT` and `SELECT` only.
2. A `BEFORE UPDATE OR DELETE` trigger that raises an exception, which also stops the table owner. RLS is `FORCE`d.
3. A CI test that tries `UPDATE` and `DELETE` as each role and expects failure.

Corrections are compensating rows (`adjust`, `return`). An undo of a no-show mark (CANCEL-04) is a new row, not an edit.

**Balances are derived.**

- Wallet balance = `SUM(change_satang)` for the customer.
- Credits left = `customer_package.credits_total + SUM(change)`.
- `credits_total` is written at purchase and made immutable by trigger. Expiry extension changes `expires_at` only through `extend_package()`, which also writes a `package_extension` row (reason, staff, days or pause id).
- Views `wallet_balance` and `package_balance` do the sum. A cached copy is not needed at club scale (Hunter is roughly 500 bookings a month). Add a trigger-maintained cache only if a measurement says so; it would still never be editable by the app.

**No overspend under concurrency.** Spending takes a row lock first. `wallet_account (club_id, customer_id)` is a row that exists only as a lock anchor (no balance on it). The spend path is: `SELECT ... FOR UPDATE` on the anchor, read the SUM, check `SUM + delta >= 0`, insert the ledger row. Credits do the same on `customer_package`. A deferred constraint trigger checks `balance >= 0` as a backstop. Test: two parallel spends of the same last ฿100, exactly one succeeds.

**Reserve then reverse.** Credits are reserved when the player taps Pay (spec: "reserved at booking") and returned if the hold releases. I propose the wallet follows the same pattern (Q6): value applied at Pay time is written as a ledger row tied to the order and reversed by a compensating row if the hold expires. Otherwise two checkouts in two tabs could spend the same wallet balance.

Open points on the spec text: what `use` and `forfeit` do to the sum (Q4), and the wallet reason list (Q5).

### 2.4 Receipts (RCPT-01)

Native sequences leave gaps when a transaction rolls back. RCPT-01 says "unbroken sequence, never reused". So:

```sql
create table receipt_counter (
  club_id uuid not null,
  series  text not null,            -- e.g. '2027' (Bangkok year of issue); see Q8
  last_no integer not null,
  primary key (club_id, series)
);
-- inside the transaction that issues the receipt:
-- insert ... on conflict (club_id, series) do update set last_no = receipt_counter.last_no + 1 returning last_no;
```

The increment and the receipt insert share a transaction, so a rollback undoes both and no number is skipped. The row lock serialises issuance per club. This lock is taken **last** in any transaction (lock order, §3.4). Void changes `receipt.status` and adds a reason; the row and number stay. Format `{prefix}-{year}-{000001}` comes from `club.receipt_prefix` (HTC for Hunter). Testing-mode receipts must not consume real numbers (Q9). Whether the counter resets each year, and which payments get a receipt, are questions (Q8).

### 2.5 Orders and payments

`orders` holds the frozen result of pricing: `order_line` rows snapshot item, unit price, discount and add-on prices in satang; `amount_due_satang` is computed on the server at Pay time and never recomputed afterwards. The Beam callback compares against this frozen number (§6). `payment` has `method` (beam, slip, cash, credit), `status` (pending, succeeded, expired, failed), `gateway`, `gateway_charge_id`, `amount_satang`, `outcome` (applied, wallet_late, wallet_duplicate, mismatch) and `is_test`. Cash needs a `reason_code` (PAY-06).

## 3. No double booking (BOOK-04, PAY-02, COACH-01)

### 3.1 The rule

The spec: "Court and coach are reserved in one transaction with a uniqueness rule, including during the payment hold. A solo class reserves both or neither."

Recommendation: one table, `occupancy`, is the only thing that claims a court or a coach. A claim is one row. Two **exclusion constraints** make overlap impossible. One row with both `resource_id` and `coach_id` is one `INSERT`, so it passes both constraints or neither: a solo class cannot reserve only the court or only the coach, even if someone writes SQL by hand.

Alternative considered: one row per resource-hour with `unique (resource_id, slot_start)` and the same for coaches. It needs no extension and is easy to explain, but a 3-hour booking is three rows plus three coach rows, and "both or neither" depends on one transaction wrapping all of them. I recommend the range form. The cost is the `btree_gist` extension (available on Supabase; confirm in the DevOps spike).

```sql
create extension if not exists btree_gist;

create table occupancy (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null,
  kind             text not null check (kind in ('court_booking','solo_class','group_class','closure')),
  resource_id      uuid,
  coach_id         uuid,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  state            text not null check (state in ('held','confirmed')),
  hold_expires_at  timestamptz,
  booking_id       uuid,
  class_session_id uuid,
  closure_id       uuid,
  created_at       timestamptz not null default now(),
  foreign key (club_id, resource_id) references resource (club_id, id),
  foreign key (club_id, coach_id)    references coach (club_id, id),

  check (end_at > start_at),
  check (num_nonnulls(booking_id, class_session_id, closure_id) = 1),
  check ((state = 'held') = (hold_expires_at is not null)),
  check (resource_id is not null or coach_id is not null),
  check (kind <> 'solo_class' or (resource_id is not null and coach_id is not null)),
  check (kind <> 'group_class' or (resource_id is not null and coach_id is not null)),
  check (kind <> 'court_booking' or coach_id is null),
  check (kind <> 'closure' or (resource_id is not null and coach_id is null)),
  -- 60 minutes on the hour (BOOK-01). Closures may be any range.
  check (kind = 'closure' or (
      end_at - start_at = (extract(epoch from (end_at - start_at))::int / 3600) * interval '1 hour'
      and date_trunc('hour', start_at at time zone 'Asia/Bangkok') = start_at at time zone 'Asia/Bangkok')),
  check (kind not in ('solo_class','group_class') or end_at - start_at = interval '1 hour'),

  constraint occupancy_no_overlap_resource
    exclude using gist (resource_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (resource_id is not null),
  constraint occupancy_no_overlap_coach
    exclude using gist (coach_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (coach_id is not null)
);
```

Notes:

- Ranges are half-open `[)`, so 18:00-19:00 and 19:00-20:00 do not collide.
- A row exists only while the claim is live (held or confirmed). Cancelling, releasing, or finishing deletes the `occupancy` row; the `booking` row keeps the business history and status. So the constraint never has to know about "expired" or "cancelled".
- Court bookings can be multi-hour (BOOK, "one or more consecutive hours"): one row, a range of N hours.
- A group class session claims its court and its coach too (`kind = group_class`). Seat holders do not claim the court; seats are counted (§3.6).
- A court booking that becomes a solo class after the fact ("Add a coach" on C12) is an `UPDATE occupancy SET coach_id = ..., kind = 'solo_class'`. The coach constraint is re-checked by the database in that single statement.
- Moving a booking in A1 is an `UPDATE` of the range. The database re-checks both constraints, so "moving checks conflicts" (spec) is guaranteed, not just coded. The rest rule and availability are checked by the same function first (§3.3).
- A closure over existing bookings must first cancel them (with credit back and a LINE message, F09) and then insert. The insert fails, correctly, while a booking still holds the court.
- Hold-time data is on the `occupancy` row (for contention) and also on `booking.hold_expires_at` (for the job and display). Only the claim function writes either, in one transaction.

### 3.2 Holds without relying on a job

Exclusion constraints cannot use `now()`, so an expired hold would still block until something deletes it. The design makes correctness independent of the job:

1. `claim_occupancy()` first releases any **expired** holds that overlap the requested range (via the same `release_hold()` function the job uses), then inserts.
2. Availability reads ignore held rows whose `hold_expires_at <= now()`.
3. The hold-expiry job (§5) only does the side effects that must happen anyway: set booking status `released`, reverse reserved credit/wallet, send the LINE "booking released" message, trigger the waitlist.

If the job is an hour late, nobody is blocked and nobody double books.

### 3.3 The claim function

One function, `claim_occupancy(...)`, is the only writer of `occupancy` (tables are not writable directly by the app roles; the function is `SECURITY INVOKER` so RLS still applies). Behaviour, in order:

1. Validate: club exists and is not paused (PLAT-03); resource and coach belong to the club; range is on the hour in whole hours; inside opening hours (Bangkok); not in the past; not beyond the booking window (BOOK-01).
2. If a coach is involved, `SELECT ... FROM coach WHERE id = $1 AND club_id = $2 FOR UPDATE`. This serialises every decision about that coach, which the rest rule needs.
3. Release overlapping expired holds (§3.2).
4. Coach rules (COACH-01): working that hour (availability rule or open one-off), no approved leave, and the **rest rule**: merge the new range with the coach's adjacent busy hours (confirmed and live holds, all kinds, no override), and refuse if the run exceeds the cap (setting, default 6 from the template). A constraint cannot express a rolling run length, hence the lock in step 2. What counts as "in a row" is Q14.
5. `INSERT` the row. On `23P01` (exclusion violation) raise a typed error `slot_unavailable` carrying which constraint fired (`resource` or `coach`), so the UI can say "court taken" or "coach no longer available" using locale keys.

Typed errors the API returns are codes with parameters, for example `slot_unavailable`, `coach_unavailable`, `rest_rule`, `outside_hours`, `outside_window`, `club_paused`. The client maps codes to locale keys; no error text is written in code (TEXT-01).

### 3.4 Transactions and lock order

Isolation is READ COMMITTED. Correctness comes from constraints plus row locks taken in a fixed order, which every feature design must follow:

1. coach row (`FOR UPDATE`)
2. `wallet_account` and `customer_package` rows, ascending id
3. `booking` and `class_session` rows, ascending id
4. `receipt_counter` row, last

`withClubTx` (§4) retries a transaction automatically on `40P01` (deadlock) and `40001`, up to three times, so every handler must be safe to run twice. Do not make HTTP calls (Beam, LINE) while holding locks. Call out after commit, or before the transaction starts.

### 3.5 Double tap and the player's own hold

Tapping Pay twice must not fail with "slot taken" because of the player's own first hold. Mutating booking and payment endpoints take an `Idempotency-Key` header; `idempotency_key` stores the request hash and the response. Within the key, the second request returns the first response. Without a key, the claim function returns the caller's existing live hold for the same slot and customer.

### 3.6 Group class seats and waitlist offers

- A seat is a `booking` of type class seat that does not touch `occupancy`. Capacity is checked under `SELECT ... FOR UPDATE` on the `class_session` row: count of seats that are confirmed or held (hold not expired) or under a live offer must be below `max_players`. Alternative: pre-created seat numbers with `unique (session_id, seat_no)`, structural but heavier. The choice belongs to F08's design.
- A waitlist **offer** is a hold. A court-slot offer is an `occupancy` row in state `held` for the offered player until `offer_expires_at`; a class offer is a held seat. Nobody can take the slot during the offer window.
- Generating sessions from templates uses the same claim. A conflict with an existing booking or closure produces a "needs attention" session instead of an overbooking. Which side wins is Q13.

### 3.7 Concurrency tests (BOOK-04)

These run against a real Postgres (the Supabase local stack), not a mock. Each test opens separate connections and releases them together with a barrier, repeats 200 times and asserts every time.

| # | Scenario | Pass condition |
|---|---|---|
| T1 | Two parallel requests, same court, same hour | Exactly one succeeds, one gets `slot_unavailable`; exactly one `occupancy` row |
| T2 | 20 parallel requests, same slot | Exactly one success |
| T3 | Overlapping multi-hour ranges (18:00-20:00 and 19:00-21:00) | Exactly one success |
| T4 | Back-to-back ranges (18:00-19:00 and 19:00-20:00) | Both succeed |
| T5 | Solo class A (court 1 + coach X) vs solo class B (court 2 + coach X) | Exactly one success, and the loser leaves **no** row for court 2 (both or neither) |
| T6 | Solo class vs court-only booking of the same court | Exactly one success |
| T7 | Two parallel requests that would give coach X the 6th and 7th consecutive hour | The coach ends with at most 6 hours in a row |
| T8 | Held slot, hold expired but job has not run, new request | New request succeeds; old booking ends `released` with credits returned |
| T9 | Hold still live | New request fails |
| T10 | Beam callback for booking B1 at the same instant the expiry job releases B1 | Exactly one path wins; credits and wallet are consistent; no double refund |
| T11 | Last seat of a group class, two parallel requests | Exactly one |
| T12 | Same `Idempotency-Key` sent twice in parallel | One booking, same response twice |
| T13 | Direct SQL `INSERT` into `occupancy` that overlaps (bypassing the app) | Rejected by the exclusion constraint |
| T14 | Two parallel spends of the last wallet balance or last credit | Exactly one succeeds, balance never negative |
| T15 | A deadlock-prone pair (callback and claim on the same coach and booking) | Both complete, no error reaches the user (automatic retry) |

## 4. Club-ID scoping, RLS, roles and BOOQ staff blindness

### 4.1 Access path

Per D3 and the hand-off ("the core API owns every rule; the surfaces only show and collect"):

- LIFF pages, the admin console and the coach portal call our Next.js server. Nothing in a browser holds a database credential.
- `anon` and `authenticated` (Supabase REST roles) have **no grants** on the `public` schema. Data schemas are not exposed through the Supabase REST API. The `service_role` key is not used anywhere in the request path (a lint bans the string).
- The server connects as one of three custom DB roles:

| Role | Used by | Can |
|---|---|---|
| `booq_app` | `apps/web` | Read/write club tables under RLS, club context required. No DDL, no `BYPASSRLS` |
| `booq_worker` | `apps/worker` | Same tables, still under RLS: each job runs with the job's club context. A separate dispatcher reads only the job queue |
| `booq_platform` | `apps/platform` | Only the S-class tables and the `platform` schema (§4.4) |

Migrations run as `booq_owner`; tables are owned by it and have `FORCE ROW LEVEL SECURITY`, so even the owner is subject to policies. Supabase pooler note: use `set_config(..., true)` inside each transaction (transaction-local), never session-level settings, because pooled connections are shared. Whether custom roles work through the pooler on the chosen plan is a DevOps spike item (Q23).

### 4.2 Request context

Every request resolves a context `{ clubId, userId, role }` from the server session. The club is **never** read from a URL, header, or body parameter sent by the client.

- Player, coach, staff: the LIFF ID token (or the browser LINE login) is verified server-side with LINE (audience = that club's LINE Login channel id). The channel id maps to the club (`line_connection`). We then create our own signed httpOnly session carrying `clubId`, `userId`, `role`. Because the channel id picks the club, a token issued for club A's channel cannot open club B. How the admin console is addressed (one URL per club or one shared URL) is Q18; the design works with either, as the club still comes from the verified token or session, not the URL.
- BOOQ staff: separate session, separate app (§4.4).

The server wrapper:

```ts
// packages/db
withClubTx(ctx, async (tx) => { /* all queries here */ })
//  begin;
//  select set_config('app.club_id',  $ctx.clubId, true),
//         set_config('app.user_id',  $ctx.userId, true),
//         set_config('app.role',     $ctx.role,   true),
//         set_config('app.request_id', $reqId,    true);
//  ... queries ...
//  commit;
```

Repository functions accept only a `Tx` produced by `withClubTx`. The raw pool is not exported from `packages/db`, and a lint forbids importing `pg` anywhere else. If the context is missing, `app.club_id()` is NULL and `club_id = NULL` is never true, so queries return zero rows (fail closed, tested).

### 4.3 RLS patterns

Helpers:

```sql
create schema app;
create function app.club_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.club_id', true), '')::uuid $$;
create function app.user_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create function app.role() returns text language sql stable as
  $$ select nullif(current_setting('app.role', true), '') $$;
```

Pattern for every club table: a **restrictive** tenant policy (always ANDed, so nobody can loosen it by adding a permissive policy later) plus permissive policies that say who in the club:

```sql
alter table booking enable row level security;
alter table booking force  row level security;

create policy booking_tenant on booking as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());

create policy booking_staff   on booking for all    to booq_app
  using (app.role() in ('owner','front_desk')) with check (app.role() in ('owner','front_desk'));
create policy booking_finance on booking for select to booq_app using (app.role() = 'accountant');
create policy booking_player  on booking for select to booq_app using (customer_id = app.user_id());
create policy booking_coach   on booking for select to booq_app using (coach_id = app.user_id());
```

Two layers, on purpose:

- **RLS** guarantees club isolation and "own rows only" for players and coaches. It catches a missing `where club_id = ...`.
- **Server `authorize()`** is the authoritative action check (can this role cancel, adjust a wallet, change a price). It reads one permission matrix in code, `packages/auth`, derived from the hand-off roles table, and every route is wrapped as `route({ permission: 'booking.cancel' }, handler)`. A route without a declared permission fails the build.

What RLS cannot do, stated plainly:

- It does not stop arbitrary SQL. A session setting can be changed by anyone who can run SQL as `booq_app`. So queries are parameterised (the query layer builds all SQL, no string concatenation, a lint checks), and `booq_app` cannot run DDL.
- "Front desk cannot see revenue or coach pay": front desk must read individual payments and orders to take cash, so a row policy cannot hide totals. We enforce it on the server (no aggregate endpoints for that role, report routes require owner or accountant) and mark it for Security review (Q19). Coach pay tables have no policy for front desk at all.

Per-role table access summary (RLS shape; the server adds action checks on top):

| Table group | Player | Coach | Front desk | Accountant | Owner |
|---|---|---|---|---|---|
| Own profile, own bookings/credits/wallet/receipts | own rows | - | - | - | - |
| Bookings, occupancy, closures | own | own sessions | read/write | read | read/write |
| Customers (`app_user`, notes) | self (no notes) | roster of own sessions | read/write | read | read/write |
| Orders, payments, receipts | own | - | read; cash create | read | read/write |
| Ledgers | own, read | - | read; adjust with reason | read | read; adjust with reason |
| Coach pay, payouts | - | own | none | read | read/write |
| Prices, packages, promos, settings, staff | read active | - | read | read | read/write |
| Audit entries | - | - | - | - | read |
| Staff notes, slips | - | - | read/write | - | read/write |

### 4.4 How BOOQ staff are structurally blocked (PLAT roles, PDPA-01)

The spec: BOOQ staff never see "players, bookings, payments, slips, receipts, wallets or reports", and the support view is setup only. RLS alone is a row filter that a bad policy can open. So this is layered, with the strongest layers being absence of privilege and absence of credential:

1. **Separate identity.** BOOQ staff are not rows in `app_user`. They live in `platform.platform_staff`, authenticated by Supabase Auth with MFA (Q16). They have no `club_id`.
2. **Separate database role with default-deny grants.** `booq_platform` is granted SELECT/INSERT/UPDATE only on the **S** tables in §2.2 (and the `platform` schema). On every **D** table it has no privilege at all, so a query fails with `permission denied`, even if a policy were wrong. New tables are D by default.
3. **Separate application and credentials.** `apps/platform` is its own Next.js deployment. Its environment has only the `booq_platform` connection string. It does not hold `booq_app` or `booq_worker` credentials and cannot be made to read player data by a coding mistake in a route.
4. **RLS on the S tables for the platform role**, from the support session: a staff member may touch club X only if they are a platform admin, or an onboarding specialist assigned to X. Writes are allowed only when `club.status in ('draft','testing')` or `club.allow_booq_changes_until > now()` (PLAT-02). Look-only otherwise.
5. **No "log in as".** The support view is a fixed set of routes with fixed projections over S tables. There is no code path that mints a club-user session for BOOQ staff.
6. **Secrets are write-only.** LINE tokens, Beam keys and webhook secrets sit in `club_secret`. `booq_platform` can `INSERT/UPDATE` them but not `SELECT`. "Test connection" runs server-side and returns pass/fail only.
7. **Aggregates, not rows, for P1.** P1 shows "bookings in the last 30 days" and "LINE messages used this month". These come from `platform.club_usage_daily` (counts only), incremented by the single `platform.bump_usage()` SECURITY DEFINER function with a fixed search path. The platform role cannot count rows in `booking`. Whether even a count of bookings is acceptable is Q15.
8. **Tests prove it** (§4.5).

Support-access modes (PLAT-02): Draft/Testing = edit; Live = look only; the owner's "Allow BOOQ to make changes" sets `club.allow_booq_changes_until = now() + 24h` and the policy lets writes through until then. It expires by itself (no job needed; it is a time predicate).

Platform audit of this access is in §8.

### 4.5 Proving it in CI

- **Classification check.** A registry `packages/db/table-classes.ts` lists every table as S, D, or P. CI fails if a table exists that is not in the registry, or if an S table has a column named in a "personal data" deny list.
- **Platform-blind test.** Connect as `booq_platform`; for every D table assert `SELECT`, `INSERT`, `UPDATE`, `DELETE` all fail with `permission denied`; for `club_secret` assert `SELECT` fails.
- **Tenant isolation test.** For every table with a `club_id`, create rows for clubs A and B; as club A (each role) assert reads, updates and deletes touch only A; an insert with B's `club_id` fails; no context returns zero rows; a composite FK to B's parent fails.
- **Append-only test.** `UPDATE` and `DELETE` on both ledgers and on `audit_entry` fail for every role including the owner.
- **No-secrets test.** No column in S tables other than `club_secret` is named like a key, token or secret.
- **Static checks.** No `service_role`; no import of `pg` outside `packages/db`; no raw SQL string concatenation; every route has `permission`.

## 5. Job runner (BOOK-03, LINE-05, PKG-03, CLASS-02)

### 5.1 Principle

**Time rules live in query predicates; jobs only perform side effects.** A hold is expired because `hold_expires_at <= now()` in the query that asks, not because a job ran. A package is expired because `expires_at <= now()`. That is why a late or crashed job never causes a double booking or an expired credit being used.

Everything else is at-least-once, so every handler is idempotent (a unique dedupe key or a guarded `UPDATE ... WHERE status = ...`).

### 5.2 Runner

Recommendation: **Graphile Worker** in `apps/worker`, backed by the same Postgres. It claims jobs with `FOR UPDATE SKIP LOCKED`, retries with backoff, has cron built in and is TypeScript. Workers can scale to several processes safely. It needs a direct (non-transaction-pooled) connection for `LISTEN/NOTIFY`. Job payloads contain ids only, never names or phone numbers.

Alternatives: `pg_boss` (same idea); `pg_cron` calling SQL functions (good for pure database sweeps such as hold release, but LINE and Beam need application code); a host cron (Vercel Cron) hitting routes (minimum one minute, serverless time limits, and no retry state). I recommend the worker because LINE and Beam calls need retries and the hold sweep wants a 15 to 30 second tick. The cost is one always-on process to host and monitor.

Each club-scoped task opens `withClubTx` for that club, so jobs obey RLS and cannot cross clubs.

### 5.3 Message outbox

All LINE pushes go through `message_outbox` (transactional outbox). The business transaction inserts the outbox row; a sender task delivers it.

- Columns: `club_id`, `user_id`, `template_key`, `params jsonb`, `dedupe_key`, `send_at`, `status` (pending, sent, void, failed), `attempts`, `last_error`.
- `unique (club_id, dedupe_key)` makes enqueue idempotent. Example: `reminder_24h:{booking_id}:{start_at}`.
- The sender resolves the player's language at send time, builds the text from `locales/*` (text and Flex cards both), and calls LINE with an `X-Line-Retry-Key` (a stable UUID per outbox row) so a retry after a timeout cannot double-send.
- Preconditions are evaluated at send time: a cancelled or moved booking voids pending reminders; a package with no credits left skips the expiry reminder.
- A sent message increments `platform.club_usage_daily` (LINE-06). A token failure writes `platform.club_health`. The behaviour at a club's monthly cap is undecided (C3); the sender counts and reports but does not invent a cap rule.
- Messages for events the spec lists but has no message for (for example "your late payment went to your wallet", §6.5) need new locale keys; they are flagged to the writers, not written in code.

### 5.4 Jobs

| Job | Created / scheduled | Source of truth | Side effects | Idempotency | Cadence |
|---|---|---|---|---|---|
| `hold_release` | Sweep | `booking.status = 'awaiting_payment' and hold_expires_at <= now()` | Lock booking; if still awaiting, set `released`; delete `occupancy`; reverse credit/wallet reserve; outbox "booking released"; enqueue `waitlist_advance` | Status guard under row lock; ledger `dedupe_key` | every 15 to 30 s; also lazily inside `claim_occupancy` |
| `reminder` 24 h and 2 h | Outbox rows created when the booking confirms or moves | `send_at = start - 24h / - 2h` | LINE push | `dedupe_key` | sender every 30 s |
| `package_expiry_reminder` 14 d and 3 d | Outbox rows created at purchase, extension and pause | `expires_at - 14d / - 3d` | LINE push | key includes `expires_at`, so an extension makes a new key and voids the old | sender |
| `package_expire` | Sweep | `customer_package.expires_at <= now()` with credits left | Write `expire` ledger row for the remainder | unique `(package_id, 'expire')` | every 5 min |
| `waitlist_advance` | Enqueued **in the same transaction** that frees a slot or seat | Waitlist order | If more than the no-offer hours (setting) remain: place the offer hold (§3.6), set `offer_expires_at`, outbox "waitlist spot open" | Advisory lock per subject; guarded status | event driven |
| `offer_expiry` | Sweep | `offer_expires_at <= now()` | Release the offer hold, mark entry passed, advance to next | Status guard | every 30 s |
| `session_start` | Sweep | Confirmed bookings whose `start_at <= now()` | Credit `reserve` becomes `use` | ledger `dedupe_key` | every minute |
| `session_end` | Sweep | Confirmed bookings whose `end_at <= now()` | Mark played (derived status); evaluate referral reward after the friend's first paid booking is played (PROMO-02) | unique `referral` reward key | every minute |
| `beam_reconcile` | Sweep | `payment.status = 'pending'` older than the hold, newer than 24 h | Ask Beam for charge status; feed the same processing function as the callback (§6) | Same as callback | every 5 min |
| `class_below_minimum` | Per session at `start - alert_time` | Session count `< min` | Outbox to front desk | `(session_id, 'below_min')` | Inert while the alert time setting is unset |
| `birthday_discount_message` | Monthly | `date_of_birth` month = Bangkok current month | Outbox "birthday discount" | `(user_id, year)` | 1st of month (time of day: Q22) |
| `housekeeping` | Daily | Old `idempotency_key`, dead outbox rows | Purge | n/a | daily |

Not a job: pause (PLAT-03) is one transaction that shifts every package `expires_at` by the pause length through `extend_package()` (with a `package_extension` row each), and rewrites pending expiry-reminder outbox rows.

Rules for reminders created late: a booking made less than 24 h before start gets no 24 h reminder, and less than 2 h gets no 2 h reminder. The spec is silent; this is the least surprising, and it is Q21.

### 5.5 Monitoring and test time

- A heartbeat row per task type; P1 health alerts when hold-release lag passes a threshold or a task has dead jobs. Payload is counts, not data.
- Time is injectable: application code reads `clock.now()` and SQL reads `app.now()` (which is `now()` in production). In test databases only, `app.now()` honours a setting so tests can say "it is now 11:59 on the hold". This is how the timing acceptance tests (BOOK-03, CANCEL-01, PKG-03) run without sleeping. The override is impossible in production because the setting that enables it is absent from production roles.

## 6. Beam callback handling (PAY-02, PAY-03, PAY-07)

Exact Beam details are unknown to me and are not guessed here: signature scheme and header names, event ids, amount unit, whether the QR expiry can be set, whether charges can be retrieved, retry policy, sandbox behaviour, per-merchant webhook secrets (Q24). The design is written against a `PaymentGateway` interface in `packages/payments` so these facts fill in adapter code, not the flow:

```ts
interface PaymentGateway {
  createQr(input: { clubId; paymentId; amountSatang; expiresAt; reference }): Promise<{ chargeId; qrPayload; expiresAt }>;
  verifyWebhook(input: { rawBody: Buffer; headers: Headers; secrets: Secret[] }): VerifiedEvent | Rejected;
  getCharge(input: { clubId; chargeId }): Promise<ChargeStatus>;    // for reconciliation
  // No refund method exists. Value never goes back as cash (CANCEL-02, PAY-05); a lint fails if one is added.
}
```

### 6.1 Creating the charge

1. Server prices the order and runs `claim_occupancy` with the hold. Transaction 1 commits: `booking` (awaiting payment), `occupancy` (held), `orders`, `order_line`, `payment` (pending, `amount_satang` frozen), credit/wallet reserve rows.
2. Outside any transaction, call `createQr` for the exact frozen amount with `paymentId` as the merchant reference and an expiry no later than the hold end.
3. Transaction 2 stores `gateway_charge_id` and the QR payload.
4. If Beam fails, run `release_hold()` and return an error code. If the process dies between steps, the hold expires by itself.

Nothing left to pay (PAY-07) skips Beam: one transaction confirms the booking immediately. A package bought alone (PAY-04) creates no hold; the order itself expires with the QR (15 minutes, setting).

### 6.2 Receiving the callback

`POST /api/webhooks/beam/{webhookToken}`. The token is a long random value per club, so we know which club's secret to use before verifying anything. The token only selects the club; it authenticates nothing.

1. Read the **raw body bytes**. Do not parse first.
2. Load that club's webhook secret(s) (current and previous, to allow rotation). Verify the signature over the raw bytes with a constant-time comparison. Check the timestamp window if Beam provides one. **Bad signature: respond 401 and change nothing.** Log a security event with no body content.
3. Parse. Find `payment` by `gateway_charge_id` **and** `club_id` from the token (a valid event for club A can never touch club B).
4. Insert into `payment_event (club_id, gateway, gateway_event_id, ...)` with `ON CONFLICT DO NOTHING`. If it already exists: respond 200 and stop (duplicate delivery).
5. Compare event amount and currency to `payment.amount_satang` and THB. **Mismatch: record the event with outcome `mismatch`, change no booking, order or ledger, raise a club health alert, respond 200** (a retry would not help). Money that really arrived is then handled by staff through the wallet with a written reason (Q26).
6. If the event is not a success status, record and stop.
7. Run `applyPayment()` in the same transaction as the event insert. A crash rolls back both and Beam's retry reprocesses. Respond 200 after commit.

"Changes nothing" in PAY-02's acceptance check is read as: no booking, order, payment status or ledger change. The immutable event row is written because it is the evidence. Say if you want it otherwise (Q26).

Optional hardening, decided after reading Beam's docs: after signature verification, re-fetch the charge with `getCharge` and trust that instead of the body.

### 6.3 `applyPayment()`

Lock order per §3.4: coach, then booking. Guard every state change with `UPDATE ... WHERE status = 'pending'` and check the row count, so two events for one charge can never apply twice.

| Case | Booking | Money |
|---|---|---|
| Paid while the hold is live | `confirmed`; `occupancy.state = confirmed`, hold cleared; payment `succeeded`; receipt issued; outbox "booking confirmed" | none |
| Paid after the hold ended, slot still open (PAY-03) | Re-attempt the original claim (court and coach together, §3.3) plus re-reserving the credits and wallet the order used. All succeed: `confirmed` as above | none |
| Paid after the hold ended, slot gone (PAY-03) | Stays `released` | `amount_satang` goes to the wallet (reason `late_payment`), outbox message, payment outcome `wallet_late` |
| Paid after the hold ended, slot open but credits/wallet/promo cannot be re-applied | Stays `released` | Wallet, same as above |
| A second success for an order already paid (customer paid the QR twice) | unchanged | Second amount to wallet (`wallet_duplicate`) |
| Success for a cancelled order | unchanged | Wallet |
| Package-only order, success after the QR expired | Not specified | Q25 |

The "re-attempt the claim" step is the same function and the same constraints as a fresh booking, so a late payment can never double book. The hold-release job and the callback both lock the booking row first, so whichever commits first wins and the other sees the new status (test T10).

A wallet credit is never a cash refund; it is the rule the spec already gives for a payment that cannot be honoured (PAY-03, CANCEL-02).

### 6.4 Safety net and sandbox

- `beam_reconcile` (§5.4) covers a callback that never arrives.
- `payment_connection.mode` is `sandbox` or `live`. A Testing club uses sandbox; P4's go-live check requires live mode.
- Fake Beam for QA: valid, bad signature, wrong amount, late, duplicate, out of order, unknown charge, and Beam down at create time.

### 6.5 Needs a message

The wallet fallback is a player-visible event that no LINE-05 message covers. It needs a new locale key pair in both files, listed for the writers (CLAUDE.md, TEXT-04). I have not added one.

## 7. Time (Asia/Bangkok)

Thailand uses UTC+7 all year, no daylight saving, so wall time and instants map one to one. The risk is not DST. It is a server that runs in UTC, and JavaScript defaults that quietly use the server's zone or the Buddhist calendar.

| What | Type and rule |
|---|---|
| An instant (booking start/end, hold expiry, ledger time, audit time) | `timestamptz`. The database stores the instant; role-level `timezone` is set to `Asia/Bangkok` so SQL shows Bangkok time. No `timestamp without time zone` for instants |
| A weekly rule (opening hours, availability, class template weekday and time) | `smallint` weekday plus `time`; close may be `24:00` (Postgres `time` accepts `24:00:00`) |
| A calendar date (date of birth, closure day, report day, expiry date) | `date` in Bangkok |
| Which day a booking belongs to | The Bangkok date of `start_at`. Index and group on `(start_at at time zone 'Asia/Bangkok')::date` (immutable because the zone is a literal) |
| Cancel window | `start_at - now() >= interval '12 hours'` (setting). Instants, no zone issue |
| Booking window "N days ahead" | Last bookable Bangkok date = today + N. Whether day N itself is allowed is Q11 |
| Age and student price | Computed from `date_of_birth` and the Bangkok date. Pricing on the 18th birthday follows the spec |
| Package validity | Purchase date plus calendar months (31 Jan + 1 month = end of Feb, the Postgres rule). A purchase on 5 Jan with 3 months expires 5 Apr, which is the canvas B5 point. Whether the expiry date is usable through the end of that day is Q10 |
| Daily close, reports, coach month | Bangkok calendar day / month |
| Receipt year | Bangkok year of `issued_at` |

Code rules:

- One package, `packages/time`, wraps a zone library (Luxon, or the Temporal polyfill) with `bangkokNow()`, `atBangkok(date, time)`, `bangkokDateOf(instant)`, `addMonths()`. The rest of the code uses only these.
- Lint bans `new Date()` formatting, `getHours/getDay/...`, `toLocaleString` without an explicit zone, and `Date.now()` arithmetic outside `packages/time`.
- **Thai date formatting forces the Gregorian year.** `Intl.DateTimeFormat('th-TH')` defaults to the Buddhist calendar and prints 2569. The formatter in `packages/i18n` always passes `calendar: 'gregory'` (`th-TH-u-ca-gregory`), so dates read "29 ธันวาคม 2026" (CLAUDE.md). A unit test asserts 2026 in Thai output.
- Servers and CI run with `TZ=Asia/Bangkok`, and a test also runs with `TZ=UTC` to catch accidental dependence on the server zone. The time-sensitive edge cases: 23:00-24:00 slots, the booking made at 00:30 Bangkok (still the previous UTC day), the week boundary for the schedule.

## 8. Audit entries (PLAT-04) and the P6 platform log

### 8.1 Club audit entry

"Every change to a booking, balance, price or setting writes an audit entry; every platform action also writes to P6."

```sql
create table audit_entry (
  id                    uuid primary key default gen_random_uuid(),
  club_id               uuid not null,
  occurred_at           timestamptz not null default now(),
  actor_type            text not null check (actor_type in ('club_user','platform_staff','system')),
  actor_user_id         uuid,           -- club_user
  actor_platform_staff_id uuid,         -- platform_staff (never a FK into club data)
  actor_label           text not null,  -- name at the time ("BOOQ staff: ..." or the staff name), so renames or deletions don't rewrite history
  support_session_id    uuid,
  source                text not null check (source in ('player_app','admin','coach_portal','platform','job','webhook')),
  action                text not null,  -- insert/update/delete or a verb like booking.moved
  record_type           text not null,
  record_id             uuid not null,
  old_value             jsonb,          -- changed columns only
  new_value             jsonb,
  reason                text,
  request_id            text,
  check ((actor_type = 'club_user') = (actor_user_id is not null)),
  check ((actor_type = 'platform_staff') = (actor_platform_staff_id is not null))
);
create index on audit_entry (club_id, record_type, record_id, occurred_at desc);
create index on audit_entry (club_id, occurred_at desc);
create index on audit_entry (club_id, actor_type, actor_user_id, occurred_at desc);
```

Mechanism, recommended: **database triggers** on every audited table call one `SECURITY DEFINER` writer function. The actor, source, reason and request id come from the transaction-local settings that `withClubTx` already sets (`app.actor_*`, `app.reason`). Why triggers: nothing escapes, including a migration script or a future route that forgot. Why DEFINER: `booq_app` and `booq_platform` have **no INSERT on `audit_entry`**, so no code can forge an entry; only the trigger function (owned by a dedicated role with insert-only rights) can write. A second function `audit.note()` records non-row events, such as a support session opening.

- Trade-off against writing audit rows in application code: triggers cannot know a business reason unless the server sets it. So routes that need one (price change, wallet adjust, closure, no-show mark, extension) pass `reason` into `withClubTx`, and the ledger CHECKs already require a note for staff movements.
- `old_value` and `new_value` hold changed columns only, to keep personal data out where possible. Secret columns (`club_secret`) are never audited.
- Append-only like the ledgers (revoke, trigger, test).
- **Registry.** `packages/db/audited-tables.ts` lists audited tables; a CI check fails if one lacks its trigger. The list: `club`, `club_setting`, `club_feature`, `location`, `resource`, `opening_hours`, all price tables and `package_product`, `add_on`, `promo_code`, `app_user` (role and tags), `coach` (tier, price override, pay model), `booking`, `occupancy` via booking, `class_template`, `class_session`, `closure`, `customer_package`, `package_extension`, `credit_ledger`, `wallet_ledger`, `orders`, `payment` (cash with reason code), `receipt` (void). The registry is reviewed per feature design.
- System actors: jobs (hold release, expiry) are changes to bookings and balances, so they write entries with `actor_type = 'system'` and the job name as label.
- Read access: Owner only (A17). Whether anyone else reads it is Q28.

### 8.2 P6 platform log

P6 shows "BOOQ staff accounts and every platform action". It lives in `platform.audit_log`: `occurred_at`, `staff_id`, `staff_name_at_time`, `action`, `club_id`, `target_type`, `target_id`, `detail jsonb`, `reason`, `support_session_id`.

- It holds **setup-level facts only** (club created, status changed, pause with reason, LINE connection tested, support session opened or closed, setup record changed). `detail` for a setup change stores the changed setup columns. It never contains player, booking or payment data, because the platform role cannot read any.
- Written in the same transaction as the action by a function in the `platform` schema.
- A platform action on a club also writes the **club's own** `audit_entry` (actor_type `platform_staff`, the staff name and the `support_session_id`), as the PRD requires ("every visit and change is logged in P6 and in the club's own staff audit log"). The trigger does this automatically when `booq_platform` edits an S table, since the role context sets `app.actor_platform_staff_id`. Opening and closing a support session call `audit.note()`.
- BOOQ staff account changes (create, role change, deactivate) go to `platform.audit_log`. I propose sign-in and failed sign-in events too (security); the spec does not list them (Q28).
- The pause action (only a platform admin, with a reason) writes P6, the club audit entry and an outbox LINE message to the owner (PLAT-03).

## 9. Repository layout

Consistent with `CLAUDE.md` and the hand-off's repo layout (`CLAUDE.md`, `locales/`, `specs/`). Additions are `docs/`, `apps/`, `packages/`, `tools/`.

```
CLAUDE.md
locales/                     en.json  th.json  copy-index.csv           (Content/i18n)
specs/
  product/                   prd-v1.2.md  handoff-v1.2.md
  features/F01-platform-foundation/  requirements.md design.md tasks.md ...
docs/
  DEVELOPMENT-PLAN.md  canvas-gaps.md
  architecture/              foundation.md  (this file)  + later ADRs
apps/
  web/                       Next.js: player, coach and club admin surfaces + /api (route groups (player) (coach) (admin))
  platform/                  Next.js: P1 to P6. Environment holds only booq_platform credentials
  worker/                    Graphile Worker tasks (jobs in section 5)
packages/
  db/                        migrations (SQL), roles and grants, RLS, claim_occupancy, table-classes.ts, audited-tables.ts, withClubTx, generated types
  auth/                      LIFF token verification, sessions, permission matrix, route()
  domain/                    one folder per feature: booking/ commerce/ classes/ ...
  payments/                  PaymentGateway interface, beam adapter, fake-beam
  line/                      Messaging client, Flex templates (text from locales), outbox sender
  i18n/                      locale loader, t(), variable substitution, formatters (Gregorian Thai dates)
  time/                      Bangkok helpers, clock
  ui/                        design system tokens and shared components
  testing/                   fixtures, fakes, concurrency harness
tools/                       lint-hardcoded-text, check-table-classes, check-audit-triggers
.github/workflows/           CI: lint, types, tests, hard-coded-text check, RLS and platform-blind suites
```

Recommendations and trade-offs:

- **One repo, pnpm workspaces.** One codebase as the hand-off says. `apps/platform` is separate from `apps/web` on purpose (§4.4): it is the strongest structural block for BOOQ staff. Cost: two deployments plus the worker. The alternative, one app with route groups, is simpler to ship but one process then holds credentials for both roles, so the block depends on code review instead of on what the process can do.
- **SQL-first migrations with the Supabase CLI** (`packages/db/migrations`, also run in CI against the local stack) and **Kysely** with generated types. An ORM such as Prisma fits RLS-by-setting and exclusion constraints poorly. The tool choice follows the core if the core already has one (§1.3 item 7).
- **Ownership** matches the roles in the development plan: Architect owns `packages/db`, `tools`, `docs/architecture`; booking and commerce back-end own folders under `packages/domain` and `packages/payments`; platform/LINE owns `packages/line`, `apps/platform` API and `apps/worker` tasks for messages; Content owns `locales`, `packages/i18n` and the hard-coded-text lint; DevOps owns CI and deployment files.
- **API conventions that every feature uses:** errors are typed codes with parameters, never text (TEXT-01); mutating routes take `Idempotency-Key`; every route declares a permission; money in responses is integer satang; timestamps are ISO 8601 with `+07:00`; no club id in request bodies.

## 10. Questions

"Blocks" = must be answered before this document can be approved (A), before the named feature design (F), or can wait (-). Owners are suggestions.

| Q | Question | Why it matters | Blocks | Owner |
|---|---|---|---|---|
| Q1 | The core's details in §1.3: table and column names, tenant key, auth, booking model, Beam code, migration tooling, whether it holds live data | The mapping and migration plan are provisional until read | A | User / core owner |
| Q2 | Keep `store`/`branch` as physical names, or rename to `club`/`location` now? | The hand-off says keep; renaming is cheap before the first migration and expensive after | A | User |
| Q3 | Can one person hold more than one role in a club (a coach who also books as a player, an owner who also coaches)? The spec has one `role` | Decides `app_user.role` single value versus a role set, and RLS | A | Product |
| Q4 | Credit ledger: do `use` and `forfeit` rows carry change 0 (marking the disposition of a reserve) while `reserve` is -1 and `return` +1? | Defines "balance equals the sum of rows" (PKG-01) | F06 | Product |
| Q5 | Wallet ledger reasons: the spec lists none. Proposed: refund, late_payment, duplicate_payment, referral_reward, spend, return, adjust, expire (only if wallet expiry is set) | Reports and the customer history screen | F06 | Product |
| Q6 | Is wallet value applied at Pay reserved by a ledger row and reversed if the hold ends (like credits)? | Prevents spending one balance twice | F04/F06 | Product |
| Q7 | Rounding for percentage discounts and for VAT, to the satang | Money must be exact | F04 | Product / accountant |
| Q8 | Receipts: does the number restart each year (HTC-2027-000001)? Is a receipt issued when a payment is covered by credit or wallet only, and for a late payment that goes to the wallet? | Counter design, RCPT-01 | F13 | Product / accountant |
| Q9 | Testing-mode data: flagged `is_test`, separate non-legal receipt series, purged on go-live? | Real receipt numbers must start clean | F15 | Product |
| Q10 | Package expiry: usable through the whole expiry date (end of day Bangkok)? | PKG-02 gives a date only | F06 | Product |
| Q11 | Booking window: is today+30 itself bookable, and is the window by date or by 30×24 hours? | BOOK-01 acceptance test | F03 | Product |
| Q12 | Multi-hour court selection with a coach: is the solo class only one of the hours, or all? Solo classes are fixed at 60 minutes | The `occupancy` kind check | F03/F07 | Product |
| Q13 | Class template session versus an existing booking or closure at the same time: which wins? | Session generation | F08 | Product |
| Q14 | Rest rule: "6 hours in a row" means consecutive back-to-back hours with any gap resetting the run? | The count in `claim_occupancy` | F07 | Product |
| Q15 | P1 shows bookings in the last 30 days per club. Is an aggregate count acceptable under "BOOQ never sees bookings"? | §4.4 item 7 | A | User |
| Q16 | BOOQ staff sign-in: Supabase Auth with email and MFA (recommended), or LINE? | Identity separation | A | User |
| Q17 | One LINE provider for all clubs or one per club? | LINE user ids repeat across clubs in one provider; our key is `(club_id, line_user_id)` either way | F02 | User / DevOps |
| Q18 | Admin and coach portal address: one address per club, or one shared (C7)? | Where the club is chosen before sign-in | F02 | User |
| Q19 | Front desk "cannot see revenue" is enforced by the server because RLS cannot hide totals. Acceptable? | Security review | A | Security |
| Q20 | Owner contact details (name, phone, LINE, email, PRD step 1) are in `club`, visible to BOOQ staff. Confirm this is not "customer data" | S/D classification | A | User |
| Q21 | Bookings made inside the reminder window: skip the reminder (proposed)? | LINE-05 | F10 | Product |
| Q22 | Birthday message: what time of day on the 1st? | Job schedule | F14 | Product |
| Q23 | Hosting region and Supabase plan: Supabase has no Thai region (nearest is Singapore), so cross-border transfer under PDPA, custom roles and `btree_gist` through the pooler, daily backups and per-club export | PDPA, D8 | A | DevOps / Security |
| Q24 | Beam facts: signature scheme and headers, event id, amount unit, QR expiry control, charge retrieval, retry policy, sandbox, per-club webhook secret, IP list, API shape | §6 adapter | F05 | DevOps / Beam |
| Q25 | Late payment rules beyond the slot (PAY-03 says "slot still open"): also require the coach, credits, wallet and promo to be re-appliable, else wallet (proposed)? And a package-only order paid after its QR expired? | §6.3 | F05 | Product |
| Q26 | Wrong-amount payment that really arrived: staff credit the wallet with a reason (proposed). And is writing an event row OK under "changes nothing"? | §6.2 | F05 | Product |
| Q27 | PDPA delete request versus receipts and audit that must be kept: retention periods and anonymisation of personal fields | Schema for erasure | F01 | Security / legal |
| Q28 | Who may read the audit log (owner only per A17)? Log BOOQ staff sign-ins? | §8 | F01 | Product |

Also still open from `docs/canvas-gaps.md` and not repeated here: C1 (date of birth correction versus held student packages, needed before F06), C2, C3, C4/C5, C7 (branches and web address per club).

## 11. What happens next

1. A person reviews this file. Questions marked A need answers before approval.
2. After the F01 requirements are approved, `specs/features/F01-platform-foundation/design.md` is drafted from this document: migrations for the S tables, roles and RLS, audit, the table registries.
3. The claim function, ledgers and receipts counter get their own design sections in the F03, F06 and F13 designs, each citing the section here and adding a test list.
4. DevOps spike (small): custom roles through the Supabase pooler, `btree_gist`, a direct connection for the worker, a region decision (Q23).
5. No code is written until the relevant requirements and design are approved (CLAUDE.md, rule 5).
