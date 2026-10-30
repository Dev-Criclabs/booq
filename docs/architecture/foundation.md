# BOOQ foundation architecture (proposal)

Status: **DRAFT, revision 6, for approval by a person. Nothing here is approved.** Author role: Architect / data. Branch `architect/foundation`. 30 Oct 2026.

Revision 2 applies the decisions in `docs/decisions.md` (decisions D1 to D15 and round 2b). Those numbers are the decisions log's. This document's own recommendations are numbered R1 to R16 to avoid a clash. Revision 6 applies D37 (a late payment that goes to the wallet gets its own receipt, so a receipt can exist without a booking or package item: §2.4, §2.3, §6.6). Revision 5 applies decisions D32 to D36 (two Beam key sets per club, test data excluded everywhere, encryption layers, what the Accountant sees, the wrong-amount callback answer). Revision 4 applies decisions D18 to D31 (round 4), records what Beam's and LINE's public documentation say and do not say (§6.1, §6.2, §5.6), and fixes two assumptions the documentation disproved (a push to a non-friend is not rejected, §5.3; Beam sends no event id, §6.5). Revision 3 added the LINE message cap (LINE-07, decision D17) to sections 2.2, 4.4, 5.3 and 5.4 and the tests in 5.6, and notes decision D16 (the 7 Dec test runs on production) in section 2.6. Answered questions are listed in section 10.1 and removed from review; the open ones carry a recommendation in section 10.2 so they can be approved in bulk.

This is the shared design every feature relies on. It is not a feature `design.md`. F01's `design.md` comes after F01's requirements are approved, and it will cite this file.

Sources: `CLAUDE.md`, `specs/product/prd-v1.2.md`, `specs/product/handoff-v1.2.md`, `docs/DEVELOPMENT-PLAN.md`, `docs/canvas-gaps.md`. Requirement IDs (BOOK-04, PAY-03, PKG-01, PLAT-04 ...) are the hand-off's.

How to read: each section ends with its open questions as `Q#`. All questions are collected in section 10 with who needs to answer and whether they block approval of this document. Where the spec is silent I say so and propose; I do not decide. Values the PRD marks TBD stay empty club settings.

The stack is the one adopted on 30 Oct: Next.js with the LIFF SDK, Postgres (Supabase) with row-level security (RLS) by club ID, server jobs.

## 0. Summary of recommendations

| # | Decision | Recommendation | Trade-off |
|---|---|---|---|
| R1 | Names | Tables are named `club` and `location` from the first migration. There is no existing Booq core (decisions round 2b), so there is no Store/Branch mapping (§1) | None; the earlier mapping text is removed |
| R2 | Tenant key | `club_id` on every club table, with composite keys `(club_id, id)` and composite foreign keys, so a row can never point at another club's row | Slightly wider keys and FKs; removes a whole class of leaks |
| R3 | Database access | Browsers and LIFF never talk to the database. Only our server does, as restricted roles; Supabase's anon/authenticated roles get no grants | We write the API ourselves; no auto REST |
| R4 | Identity | Players, coaches, staff: our own session from a server-verified LIFF ID token, one LINE provider per club. BOOQ staff: email plus a second factor, separate from LINE (Supabase Auth with TOTP is the recommended implementation) | Two identity systems that cannot be confused. If Postgres is self-hosted in Thailand (hosting risk, §4.1), the BOOQ staff login library is swapped |
| R5 | No double booking | One `occupancy` table; one row claims the court and the coach; two exclusion constraints (`btree_gist`) (§3) | Needs `btree_gist`; the rest rule needs a row lock because a constraint cannot express it |
| R6 | Transactions | READ COMMITTED, explicit row locks in a fixed order, constraints as the final judge | Needs discipline on lock order; simpler than SERIALIZABLE retries |
| R7 | Ledgers | Append-only by grants and triggers; balances are derived by SUM; no stored editable number | Reads sum rows (tiny volume at club scale) |
| R8 | BOOQ staff blindness | Separate DB role with grants only on setup tables (default deny), separate Next.js app with only that role's credentials, aggregate-only usage counters (§4) | Two deployables; worth it because the platform app holds no credential that can read player data |
| R9 | Jobs | Graphile Worker on Postgres. Time rules live in query predicates (`hold_expires_at <= now()`); jobs only do side effects (§5) | One more process to run; avoids loss of correctness if a job is late |
| R10 | Beam | Gateway interface; raw-body HMAC check; event table for idempotency; late payment re-attempts the claim, else wallet (§6, with what the docs do not say in §6.2) | Beam sends no event id and no timestamp, so every webhook is confirmed by a charge lookup (§6.5) |
| R11 | Time | `timestamptz` for instants, `date`/`time` for wall-clock rules, one `time` package, Thai dates forced to the Gregorian year (§7) | Banned APIs need a lint |
| R12 | Audit | DB triggers write the diff via a SECURITY DEFINER writer; actor and reason come from transaction-local settings (§8) | Every audited table needs a trigger; CI checks the list |
| R13 | Repo | pnpm monorepo: `apps/web`, `apps/platform`, `apps/worker`, `packages/*` (§9) | More folders than one app; clean role ownership |
| R14 | Query layer | Plain SQL migrations (Supabase CLI) and Kysely with generated types | Less magic than an ORM; we write the SQL |
| R15 | Roles | A person holds a set of roles (`app_user_role`); permissions are the union (§2.2, §4.3) | Slightly more complex policies than one role column |
| R16 | Test mode | Rows written while a club is Testing are flagged by trigger, use a non-legal receipt series, and are purged by one guarded function at Go live (§2.6) | The purge is the one deliberate exception to append-only, so it is tightly fenced and tested |

## 1. Naming and the Booq core

### 1.1 Decision

Decisions round 2b: there is **no existing Booq core**. Hunter is the first real build and no code or database exists. The Notion "Booq Product Reference" is no longer the source of truth; the PRD, the hand-off and `CLAUDE.md` are. So:

- Tables are named `club` and `location` from the first migration, and the tenant column is `club_id` everywhere. There is no Store/Branch mapping and no alias layer.
- The hand-off sentence "Keep the core's table names and map the labels in the UI" is superseded. It should be removed from the hand-off by whoever owns it (rule changes start in the PRD, then the hand-off).
- `docs/core/booq-product-reference-digest.md` is background only. It gives product terms and no table names, tenant column, migration tooling or Beam code, so nothing in this design depends on it.
- The points where the Notion core differed from the PRD are all settled in the log: one plan, 60-minute bookings, late payment to the wallet, no cash refunds, hold of 10/15/20 minutes (default 15), LINE sign-in for club users and email plus a second factor for BOOQ staff, no check-in, receipts numbered per club, LINE user ID as the player key. This design follows them.

### 1.2 Two meanings of "branch"

The spec uses the word twice. `club.tax_branch` is the **tax branch** printed on receipts ("head office", สำนักงานใหญ่). `location.label` is a place label ("Main location · Head office"). They are different columns and must not be merged.

### 1.3 What greenfield changes

- We choose the tooling (Supabase CLI migrations, Kysely, §9) and there is no old data to migrate. The only inbound data is the owner's CSV import (§4.6).
- One plan: `club.plan_trial_ends_at` and `club.billing_starts_at` are per club; the plan itself is not editable per club.
- 60-minute bookings are enforced by a CHECK in the database (§3), not only in the UI.

## 2. Data model

### 2.1 Conventions

- Every club table has `club_id uuid not null` and `unique (club_id, id)`. Foreign keys to other club tables are composite: `foreign key (club_id, customer_id) references app_user (club_id, id)`. A child can never reference another club's parent.
- Primary keys: `uuid default gen_random_uuid()`. Order by `created_at`, not by id. (UUIDv7 can come later; volumes are small.)
- Every secondary index on a club table starts with `club_id`. Exclusion and uniqueness on globally unique ids are the exception.
- Enumerations are `text` with a CHECK constraint, not Postgres enums, so changing a set is one migration without enum surgery. The types are generated into TypeScript.
- Money: `bigint` satang, columns end in `_satang`, one currency (THB), no floats anywhere. Prices and amounts `check (>= 0)`; ledger deltas are signed. Percentages are integer basis points. Rounding is half up to the satang (decision D23).
- Instants are `timestamptz`. Wall-clock rules are `date` and `time` (§7).
- No hard delete of business records. Status columns and ledger compensation. PDPA deletion is anonymisation (adopted, section 10.1).
- Defaults live in templates (P5), as data written to the club at creation. The Tennis template carries the PRD defaults (decision D8): hold 15 minutes with choices 10/15/20, waitlist claim 30 minutes, no offers within 2 hours, rest cap 6, group classes 4 to 6 players. The Blank template starts empty. There are no default values in code. A setting that is absent is unset (TBD), and the code treats unset as "no limit" or "feature off" only where the spec says so (BOOK-05).
- `created_at` and `updated_at` on every table; `updated_at` set by trigger.
- Test data (decision D4): every table that Testing can write has `is_test boolean not null`, set by a trigger from the club's status at insert time, so code cannot forget it. See §2.6.

### 2.2 Table inventory and data class

Every table is classified **S** (setup: BOOQ staff may see it in the support view), **D** (club data: BOOQ staff never) or **P** (platform schema). Anything not listed as S is D. A CI check fails any migration that adds a table without a class (§4.5).

| Table | Class | Key and uniqueness | Notable indexes and notes |
|---|---|---|---|
| `club` | S | pk `id`; unique `slug`; status in draft/testing/live/paused; `payment_option` in beam/slip; legal name, tax id, `tax_branch`, registered address, `receipt_prefix`, `allow_booq_changes_until`, `paused_at`, `pause_reason`, owner contact, visible to BOOQ staff (decision D2) | RLS: `id = app.club_id()` |
| `club_feature` | S | pk `(club_id, feature_key)` | Switches per club (PLAT-05) |
| `club_setting` | S | pk `(club_id, key)`; `value jsonb` | Keys come from a typed registry in code: hold minutes, cancel window hours, max future court hours, booking window days, rest cap, waitlist claim minutes, no-offer-within hours, class-below-minimum alert, wallet expiry, VAT switch. Absent means unset |
| `location` | S | unique `(club_id, id)` | `(club_id, name)` |
| `resource` | S | unique `(club_id, id)`; fk location | sport, type, lights, max players, active |
| `opening_hours` | S | pk `(club_id, weekday)`; open `time`, close `time` (close may be `24:00`) | Spec keys hours by club; a second location would need `location_id` (C7) |
| `price_group`, `court_price_rule`, `coach_tier`, `coach_tier_price`, `package_product`, `add_on` | S | unique `(club_id, id)` | Price snapshots go into order lines, so later edits never change history |
| `line_connection`, `payment_connection` | S | pk `club_id` | Channel and LIFF ids, OA id, `line_plan_kind` (`free` or `paid`) and `plan_message_limit` (nullable), both set in P2 step 4 because LINE's API does not return the plan, and `secret_last4` for masked display (D27); Beam merchant ids for both key sets (test and live), whichever set is active follows the club status (decision D32). No secrets here |
| `club_secret` | S, write-only | pk `(club_id, kind)` | LINE tokens and the Beam secrets, in **two sets** for Beam: `beam_api_key_test`, `beam_hmac_key_test`, `beam_api_key_live`, `beam_hmac_key_live`, each with its own webhook token hash (decision D32). Stored with app-level encryption (decision D34): a data key per row, wrapped by a master key held outside the database, with `key_id` for rotation. Platform role can INSERT/UPDATE but never SELECT (§4.4) |
| `app_user` | D | unique `(club_id, line_user_id)`; unique `(club_id, id)` | Player, coach, staff in one table. A person at two clubs has two rows. Phone is typed, never verified by code in v1 (decision D11), stored normalised; index `(club_id, phone_normalized)` is not unique, and clubs with duplicate phones are flagged for referral abuse by a query, not a stored flag. Date of birth may be null: no date of birth means Adult prices (D12) |
| `app_user_role` | D | pk `(club_id, user_id, role)`; role in player/coach/front_desk/accountant/owner | Roles are a set (decision D1): a coach can also play, an owner can also coach. Permissions are the union of the roles. At least one role per active user |
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
| `platform.club_line_usage` | P | pk `(club_id, month)`; `month` is a `date` (first day) | Used, limit, state, source, synced_at. Counts only, no message content (§5.6). Read by `booq_platform` and, through RLS `club_id = app.club_id()`, by `booq_app` for the club admin banner |
| `platform.config` | P | pk `key` | Platform-wide values such as the LINE cap thresholds 70, 80 and 100. Seeded as data, changed only by a platform admin, every change in P6 |
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
  reason      text not null check (reason in ('reserve','return','use','forfeit','expire','adjust','import')),  -- 'import' per decision D13
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
  reason       text not null,       -- set listed in section 10.1 (Q5)
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

**Reserve then reverse.** Credits are reserved when the player taps Pay (spec: "reserved at booking") and returned if the hold releases. The wallet follows the same pattern (adopted, section 10.1): value applied at Pay time is written as a ledger row tied to the order and reversed by a compensating row if the hold expires. Otherwise two checkouts in two tabs could spend the same wallet balance.

The sign rules for `use` and `forfeit` and the wallet reason list are settled in section 10.1 (Q4, Q5).

### 2.4 Receipts (RCPT-01)

Native sequences leave gaps when a transaction rolls back. RCPT-01 says "unbroken sequence, never reused". So:

```sql
create table receipt_counter (
  club_id uuid not null,
  series  text not null,            -- e.g. '2027' (Bangkok year of issue); see section 10.1 (Q8)
  last_no integer not null,
  primary key (club_id, series)
);
-- inside the transaction that issues the receipt:
-- insert ... on conflict (club_id, series) do update set last_no = receipt_counter.last_no + 1 returning last_no;
```

The increment and the receipt insert share a transaction, so a rollback undoes both and no number is skipped. The row lock serialises issuance per club. This lock is taken **last** in any transaction (lock order, §3.4). Void changes `receipt.status` and adds a reason; the row and number stay. Format `{prefix}-{year}-{000001}` comes from `club.receipt_prefix` (HTC for Hunter). Numbers are per club (decisions round 2b). Testing-mode receipts use a separate non-legal series, are flagged `is_test` and are purged at Go live, so Hunter's first real receipt is 000001 (decision D4, §2.6). A test receipt's PDF must be visibly marked as a test, which needs a new locale key for the writers. One real series per club per Bangkok year, and a receipt for money received (decision D25), are settled in section 10.1 (Q8).

**A receipt without a booking or package item (decision D37).** A late payment that goes to the wallet gets its own receipt for the money received. To keep the receipt attached to an order, as the data model has it, that case creates an order of kind `wallet_credit` with one line of kind `wallet_credit` for the amount, a `payment` row for the Beam charge (outcome `wallet_late`), the wallet ledger row (reason `late_payment`, `order_id` and `payment_id` set, `dedupe_key` `late_payment:{payment_id}`), and the receipt, all in one transaction, so a repeated callback can create none of them twice. The receipt is therefore numbered in the normal series and has no booking and no package behind it. The line description is a locale key (a new key for the writers, since no existing key describes it). The same pattern is recommended for a duplicate payment and a payment on a cancelled order (reasons `duplicate_payment`; adopted, not itemised in the log).

Two points for F13's design and the accountant: a `receipt.kind` column (`sale`, `wallet_credit`) so reports can tell them apart, and the rule that **money received by method is totalled from `payment`, never by adding up receipts**, because a later booking paid from that wallet balance is itself a confirmed order and gets a receipt, so adding the two would count the money twice. What the receipt shows for a wallet credit (items text, VAT treatment) is for F13 and the accountant to confirm.

### 2.5 Orders and payments

`orders` holds the frozen result of pricing: `order_line` rows snapshot item, unit price, discount and add-on prices in satang; `amount_due_satang` is computed on the server at Pay time and never recomputed afterwards. The Beam callback compares against this frozen number (§6). `payment` has `method` (beam, slip, cash, credit), `status` (pending, succeeded, expired, failed), `gateway`, `gateway_charge_id`, `amount_satang`, `outcome` (applied, wallet_late, wallet_duplicate, mismatch) and `is_test`. Cash needs a `reason_code` (PAY-06).

### 2.6 Test mode data and the Go live purge (decision D4)

- While a club is Testing, the testers are the owner and named BOOQ testers. A BOOQ tester acts through an ordinary club account in the player app, invited for the purpose, never through the platform console, and the invitation is logged in P6. BOOQ sees pass or fail only (`platform.launch_check`), never the test bookings.
- A `BEFORE INSERT` trigger sets `is_test = (club.status = 'testing')` on: `app_user` (tester player accounts, Q29), `booking`, `occupancy`, `orders`, `order_line`, `payment`, `payment_event`, `customer_package`, `package_extension`, `credit_ledger`, `wallet_account`, `wallet_ledger`, `receipt`, `audit_entry`, `message_outbox`, `waitlist_entry`, `referral`, `promo_redemption`, `idempotency_key`.
- The 7 Dec test runs on **production** with Hunter in Testing (decision D16); staging is for development and QA only. So the trigger-set `is_test` flag and the guarded purge are not optional extras, and test LINE messages are real pushes that count against the club's quota (§5.6).
- Testing uses the club's **test** Beam key set (Beam's Playground) and Live uses the **live** set; the active set is derived from the club status, never typed (decision D32). A test receipt takes its number from the `test` series in `receipt_counter`; a CHECK ties `is_test` to that series, so a test row can never take a real number and a real row can never take a test one.
- **Test data is excluded everywhere** (decision D33): reports, the daily close, receipt lists and platform counts never include `is_test` rows. Mechanism: every reporting and listing repository function takes its rows through one helper that adds `is_test = false`, a lint forbids reading `is_test` tables in report modules any other way, and a CI test seeds test rows in each report and requires zero. Test rows show only in test-mode views, available to the owner and testers while the club is Testing. `platform.bump_usage()` refuses test activity, so platform counts exclude it too.
- Test LINE messages go through the club's real Official Account and count toward its monthly cap (decision D32, §5.6).
- `go_live_purge(club_id)` is a `SECURITY DEFINER` function owned by a dedicated role. It runs only as part of the Go live transition (P4 checks passed), only while the status is `testing`, and deletes `is_test` rows in dependency order in one transaction. The append-only triggers on the ledgers and `audit_entry` allow a `DELETE` only when the purge function has set a transaction-local flag and the row is `is_test`. It writes one non-test audit entry with row counts per table, and one P6 entry.
- CI tests: the purge removes only `is_test` rows; it refuses to run when the status is not `testing`; real rows survive; a non-test ledger row still cannot be deleted, even inside the purge; a club that never tested purges nothing; after the purge the first real receipt is number 000001.

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
4. Coach rules (COACH-01): working that hour (availability rule or open one-off), no approved leave, and the **rest rule**: merge the new range with the coach's adjacent busy hours (confirmed and live holds, all kinds, no override), and refuse if the run exceeds the cap (setting, default 6 from the template). A constraint cannot express a rolling run length, hence the lock in step 2. "In a row" is decided (D19): back-to-back hours only, a free hour in between resets the count, unpaid held hours count, and a group class counts until it is cancelled.
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

Per R3 and the hand-off ("the core API owns every rule; the surfaces only show and collect"):

- LIFF pages, the admin console and the coach portal call our Next.js server. Nothing in a browser holds a database credential.
- `anon` and `authenticated` (Supabase REST roles) have **no grants** on the `public` schema. Data schemas are not exposed through the Supabase REST API. The `service_role` key is not used anywhere in the request path (a lint bans the string).
- The server connects as one of three custom DB roles:

| Role | Used by | Can |
|---|---|---|
| `booq_app` | `apps/web` | Read/write club tables under RLS, club context required. No DDL, no `BYPASSRLS` |
| `booq_worker` | `apps/worker` | Same tables, still under RLS: each job runs with the job's club context. A separate dispatcher reads only the job queue |
| `booq_platform` | `apps/platform` | Only the S-class tables and the `platform` schema (§4.4) |

Migrations run as `booq_owner`; tables are owned by it and have `FORCE ROW LEVEL SECURITY`, so even the owner is subject to policies. Supabase pooler note: use `set_config(..., true)` inside each transaction (transaction-local), never session-level settings, because pooled connections are shared. Whether custom roles work through the pooler on the chosen plan is a DevOps spike item (§11).

**Hosting risk (decision D5).** The decision is Supabase in Singapore (the nearest region) with a data-processing agreement. The legal check of the cross-border transfer is deferred by the user (D5 update). If the transfer is ever refused, the alternative is Postgres self-hosted in Thailand. The design keeps that swap bounded by relying on plain Postgres (version 15 or later with `btree_gist`, custom roles, RLS) plus only three Supabase services: Auth for BOOQ staff (swap for an auth library with TOTP), Storage for slips, receipts and exports (swap for an S3-compatible store behind a small `storage` interface), and the pooler (self-hosted PgBouncer follows the same transaction-local rules). It uses no PostgREST, Edge Functions or Realtime, which R3 already avoids. Daily backups (PDPA-01) become DevOps's job in a self-hosted case.

### 4.2 Request context

Every request resolves a context `{ clubId, userId, roles }` from the server session. The roles are read from `app_user_role` on each request (a primary-key lookup), not copied into the cookie, so removing a role or deactivating a person takes effect at once. The club is **never** read from a URL, header, or body parameter sent by the client.

- Player, coach, staff: the LIFF ID token (or the browser LINE login) is verified server-side with LINE, audience = that club's LINE Login channel id. Each club has its own LINE provider, so a LINE user id differs per club and the key is `(club_id, line_user_id)` (decision D7). We then create our own signed httpOnly session carrying `clubId`, `userId`. A token issued for club A's channel cannot open club B.
- One shared BOOQ domain with the club in the URL, for example `/c/{slug}/...` (decision D6). The domain is not yet known and is configuration (`APP_BASE_URL`), never written in code. The slug only chooses **which club's LINE channel starts the login**. After login the session's club is the truth; a request whose slug differs from the session's club is refused. Each club's LIFF endpoint URL is its own `/c/{slug}` path.
- BOOQ staff: separate session, separate app (§4.4).

The server wrapper:

```ts
// packages/db
withClubTx(ctx, async (tx) => { /* all queries here */ })
//  begin;
//  select set_config('app.club_id',  $ctx.clubId, true),
//         set_config('app.user_id',  $ctx.userId, true),
//         set_config('app.roles',    $ctx.roles.join(','), true),
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
create function app.roles() returns text[] language sql stable as   -- e.g. 'coach,player'
  $$ select string_to_array(coalesce(current_setting('app.roles', true), ''), ',') $$;
create function app.has_any_role(variadic wanted text[]) returns boolean language sql stable as
  $$ select app.roles() && wanted $$;
```

Pattern for every club table: a **restrictive** tenant policy (always ANDed, so nobody can loosen it by adding a permissive policy later) plus permissive policies that say who in the club:

```sql
alter table booking enable row level security;
alter table booking force  row level security;

create policy booking_tenant on booking as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());

create policy booking_staff   on booking for all    to booq_app
  using (app.has_any_role('owner','front_desk')) with check (app.has_any_role('owner','front_desk'));
create policy booking_finance on booking for select to booq_app using (app.has_any_role('accountant'));
create policy booking_player  on booking for select to booq_app using (customer_id = app.user_id());
create policy booking_coach   on booking for select to booq_app using (coach_id = app.user_id());
```

Two layers, on purpose:

- **RLS** guarantees club isolation and "own rows only" for players and coaches. It catches a missing `where club_id = ...`.
- **Server `authorize()`** is the authoritative action check (can this role cancel, adjust a wallet, change a price). It reads one permission matrix in code, `packages/auth`, derived from the hand-off roles table, and every route is wrapped as `route({ permission: 'booking.cancel' }, handler)`. A route without a declared permission fails the build.

What RLS cannot do, stated plainly:

- It does not stop arbitrary SQL. A session setting can be changed by anyone who can run SQL as `booq_app`. So queries are parameterised (the query layer builds all SQL, no string concatenation, a lint checks), and `booq_app` cannot run DDL.
- "Front desk cannot see revenue or coach pay": front desk must read individual payments and orders to take cash, so a row policy cannot hide totals. We enforce it on the server (no aggregate endpoints for that role, report routes require owner or accountant) and mark it for Security review (adopted, section 10.1). Coach pay tables have no policy for front desk at all.

Per-role table access summary (RLS shape; the server adds action checks on top). A person with several roles gets the union of the columns they hold:

| Table group | Player | Coach | Front desk | Accountant | Owner |
|---|---|---|---|---|---|
| Own profile, own bookings/credits/wallet/receipts | own rows | - | - | - | - |
| Bookings, occupancy, closures | own | own sessions | read/write | read | read/write |
| Customers (`app_user`, notes) | self (no notes) | roster of own sessions | read/write | **names only** through a view (decision D35) | read/write |
| Orders, payments, receipts | own | - | read; cash create | read | read/write |
| Ledgers | own, read | - | read; adjust with reason | read | read; adjust with reason |
| Coach pay, payouts | - | own | none | read | read/write |
| Prices, packages, promos, settings, staff | read active | - | read | read | read/write |
| Audit entries | - | - | - | - | read |
| Staff notes, slips | - | - | read/write | - | read/write |

### 4.4 How BOOQ staff are structurally blocked (PLAT roles, PDPA-01)

The spec: BOOQ staff never see "players, bookings, payments, slips, receipts, wallets or reports", and the support view is setup only. RLS alone is a row filter that a bad policy can open. So this is layered, with the strongest layers being absence of privilege and absence of credential:

1. **Separate identity.** BOOQ staff are not rows in `app_user`. They live in `platform.platform_staff` and sign in with email plus a second factor, separate from LINE (decision D3); the recommended implementation is Supabase Auth with TOTP. They have no `club_id`.
2. **Separate database role with default-deny grants.** `booq_platform` is granted SELECT/INSERT/UPDATE only on the **S** tables in §2.2 (and the `platform` schema). On every **D** table it has no privilege at all, so a query fails with `permission denied`, even if a policy were wrong. New tables are D by default.
3. **Separate application and credentials.** `apps/platform` is its own Next.js deployment. Its environment has only the `booq_platform` connection string. It does not hold `booq_app` or `booq_worker` credentials and cannot be made to read player data by a coding mistake in a route.
4. **RLS on the S tables for the platform role**, from the support session: a staff member may touch club X only if they are a platform admin, or an onboarding specialist assigned to X. A specialist can take an assigned club through Draft, Testing and Live; **only a platform admin can pause or resume** a club (decision D15), which the pause function checks by role, not by policy alone. Writes are allowed only when `club.status in ('draft','testing')` or `club.allow_booq_changes_until > now()` (PLAT-02). Look-only otherwise, and a Paused club is look-only unless the owner allows changes (D27). The support view shows courts and hours, products and pricing with add-ons, LINE, payment connections and settings; it does not show staff, coaches, closures or promo codes. A request for a club or record the caller may not reach returns 404, not 403.
5. **No "log in as".** The support view is a fixed set of routes with fixed projections over S tables. There is no code path that mints a club-user session for BOOQ staff.
6. **Secrets are write-only.** LINE tokens, Beam keys (two sets, decision D32) and webhook secrets sit in `club_secret`, encrypted in the application before they reach the database (decision D34). `booq_platform` can `INSERT/UPDATE` them but not `SELECT`. When a secret is written, the last four characters are copied to a non-secret `secret_last4` column on `line_connection` or `payment_connection`, and that is all the support view shows (D27). "Test connection" runs server-side and returns pass or fail only.
7. **Aggregates, not rows, for P1.** P1 shows "bookings in the last 30 days" and "LINE messages used this month". These come from `platform.club_usage_daily` (counts only), incremented by the single `platform.bump_usage()` SECURITY DEFINER function with a fixed search path. The platform role cannot count rows in `booking`. Decision D2 allows aggregate counts (bookings in the last 30 days per club) and the owner's contact details, and nothing finer: no per-player or per-booking breakdown, and no count cut by something that identifies a person. P1's LINE usage field (§5.6) is the same kind of figure: used, limit, percent and state per club.
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

### 4.6 CSV import and club data export (decisions D13, D14)

- **Import** (PLAT-06): owner only. The file is parsed into a staging table; every row is validated first and the import is **all or nothing**, with an error report. It imports players, packages and balances, never bookings. Imported players match on phone at their first LINE sign-in. Balances and credits enter through the ledgers with reason `import` (added to the credit ledger reasons in §2.3 and to the wallet list in section 10.1). How an imported package maps onto `credits_total` is for the F06 design.
- **Export**: the owner downloads it. BOOQ staff can only start one: they insert a row in `platform.export_request` (club and requester only) and see its status. A worker task runs under that club's context, writes the file to the private storage bucket under `club_id/`, and only the owner receives a short-lived signed link. BOOQ staff never receive the file or its link. Because every query is already club-scoped, export reuses the normal repositories.
- There is no delete-club feature in v1.

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
- A sent message increments `platform.club_usage_daily` (LINE-06). A token failure writes `platform.club_health`. The behaviour at a club's monthly cap is decided (LINE-07, decision D17) and described in §5.6; the sender asks the cap state before every send.
- **Not a friend** (decision D9). A player who has not added the club's LINE account must never block checkout. LINE's documentation says a push to a user who is not a friend, has blocked the account, or has deleted their LINE account returns **HTTP 200 and the user simply does not receive it**, with no error to detect, and such messages are not counted against the quota. So friend status cannot be learned from a failed push. It is kept in `app_user.line_friend` (nullable) from three sources: the `follow` and `unfollow` events of each club's LINE webhook (`POST /api/webhooks/line/{token}`, verified with `x-line-signature`, HMAC-SHA256 of the raw body with the channel secret, same raw-body pattern as §6), `liff.getFriendship()` when the app opens (needs the `profile` scope), and the result of the add-friend prompt at sign in. If `line_friend` is false, the sender does not push, marks the row `undeliverable`, and the confirmation is shown in the app with a prompt to add the account. If it is null (unknown), the sender pushes; a silent drop is acceptable because the app always shows the confirmation too. Whether a `follow` event marks an unblock (`isUnblocked`) is not confirmed from the docs.
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
| `birthday_discount_message` | Monthly | `date_of_birth` month = Bangkok current month | Outbox "birthday discount" | `(user_id, year)` | 1st of month (09:00 Bangkok, section 10.1) |
| `line_usage_sync` | Sweep, per club | LINE's quota and consumption figures (§5.6) | Update `platform.club_line_usage`; recompute state; on a rise to 70% raise the P1 alert and the club admin banner; at 100% on a paid plan tell the owner once for the month | `(club_id, month)` row; owner message `dedupe_key` per month | every 10 min |
| `housekeeping` | Daily | Old `idempotency_key`, dead outbox rows | Purge | n/a | daily |

Not a job: pause (PLAT-03) is one transaction that shifts every package `expires_at` by the pause length through `extend_package()` (with a `package_extension` row each), and rewrites pending expiry-reminder outbox rows.

Rules for reminders created late: a booking made less than 24 h before start gets no 24 h reminder, and less than 2 h gets no 2 h reminder. The spec is silent; this is the least surprising,.

### 5.5 Monitoring, test time and test tools

- A heartbeat row per task type; P1 health alerts when hold-release lag passes a threshold or a task has dead jobs. Payload is counts, not data.
- Test tools (decision D30): Vitest for unit and integration tests, Playwright for end-to-end, a real Postgres in tests (the Supabase local stack), and a controllable clock.
- Time is injectable: application code reads `clock.now()` and SQL reads `app.now()` (which is `now()` in production). In test databases only, `app.now()` honours a setting so tests can say "it is now 11:59 on the hold". This is how the timing acceptance tests (BOOK-03, CANCEL-01, PKG-03) run without sleeping. The override is impossible in production because the setting that enables it is absent from production roles.

### 5.6 LINE message cap (LINE-07, decision D17)

**Rule** (platform-wide thresholds, from `platform.config`): at 70% of the club's monthly limit, an alert in P1 and a banner in the club admin. At 80%, stop sending the 24 h and 2 h reminders; every other message keeps going (booking confirmed, booking released, cancellation result, waitlist offer, club closed this slot, coach changed, package expiring, birthday discount, referral reward). Skipped reminders are never sent later. At 100% on a paid plan, keep sending everything and tell the owner that LINE bills the club for extra messages. At 100% on the free plan, LINE blocks sending: the app shows the confirmation in My bookings and on the confirmation screen, and a waitlist offer that cannot be sent passes to the next person. Bookings and payments are never blocked by the cap.

**Usage store.** `platform.club_line_usage (club_id, month, used, limit, plan_kind, state, source, synced_at)`.
- `state` is derived: `normal`, `alert` (70% and over), `reminders_stopped` (80% and over), `over_limit` (100% and over). It is computed from `used / limit` and the thresholds in `platform.config`, never stored as an editable fact elsewhere.
- `source` is `line` or `own_count`.
- **Where the numbers come from** (LINE's public documentation, read 30 Oct 2026). `GET https://api.line.me/v2/bot/message/quota` returns `type` (`none` means no target limit is set, `limited` means one is set) and `value` (the free plus additional messages for the current month, when limited). `GET https://api.line.me/v2/bot/message/quota/consumption` returns `totalUsage`, which LINE calls **approximate** and which includes messages sent from LINE Official Account Manager. Both use the club's channel access token. Messages are counted per recipient (push, multicast, broadcast and narrowcast count; reply does not; a message to a blocked or non-existent user is not counted). The docs do **not** say whether the figures are real-time, which time zone the month uses, when it resets, whether a free plan returns `none` or `limited`, or give any plan name for Thailand. `line_usage_sync` runs about every 10 minutes per club.
- **Between syncs and as fallback.** `used_estimate = consumption at last sync + messages our outbox has sent since`. If LINE's endpoints fail or do not exist as assumed, the store falls back to our own count (`source = 'own_count'`, a Bangkok calendar month), and a `club_health` alert says so. The sender still counts every send into `platform.club_usage_daily` (LINE-06).
- **Plan kind and limit.** The API does not tell us the plan, so `line_connection.line_plan_kind` and `plan_message_limit` are entered in P2 step 4. When the quota response is `limited`, its `value` is the limit; when it is `none` or the call fails, `plan_message_limit` is used; when neither exists the state stays `normal` and a `club_health` alert says the cap cannot be computed. **Month boundary:** because LINE's boundary is not documented, the store keys on the Bangkok calendar month, and a drop in LINE's `totalUsage` between two syncs is treated as LINE's own rollover, which resets the estimate at once. The own-count fallback counts one per recipient and excludes known non-friends, as LINE does.

**How the sender obeys it.**
1. **At queue time.** When a booking confirms or moves, reminder outbox rows are created only if the state is below `reminders_stopped`. At 80% the confirmation is sent and no reminder is queued (LINE-07's acceptance check).
2. **At send time.** A due reminder is re-checked: if the state is `reminders_stopped` or worse, the row is voided with reason `cap`. It is not revived when the state later drops or the month rolls over. Pending reminders never wait for later.
3. **Other messages** always go, except on a free plan at `over_limit`.
4. **Free plan at 100%.** The sender marks the row `undeliverable` with reason `cap` (the same path as a player who is not a friend, §5.3), the app shows the confirmation on screen, and `waitlist_advance` skips the entry: it releases the offer hold, marks the entry `passed_unsendable` and offers the slot to the next person. A send that LINE answers with 429 ("You have reached your monthly limit.") takes the same path, whatever the stored state says.
5. **Paid plan at 100%.** Everything keeps sending. One owner message per month (outbox `dedupe_key` `cap_paid_over:{month}`), plus the banner. This message and the banner texts need new locale keys for the writers; none are written here.
6. Bookings, payments and Beam callbacks do not read the cap state at all.

**P1 and the banner.** P1 gets a LINE usage field per club: used, limit, percent and state, with an alert badge at `alert` and above (the LINE-06 "messages used this month" figure uses the same row). The club admin banner reads its own club's row through the RLS policy above, so it needs no platform credential. Both are counts and states only; message content never leaves the club's data.

**Tests (from LINE-07).** Use the fake LINE with a settable quota and consumption: (a) at 69% nothing changes; (b) at 70% the P1 alert and banner appear; (c) at 80% a booking confirms, the confirmation is sent and no reminder row exists; (d) a reminder queued at 79% and due at 80% is voided and never sent after a month rollover; (e) at 80% a waitlist offer, a cancellation result and a package-expiring message still go; (f) at 100% on a paid plan everything sends and the owner is told once; (g) at 100% on the free plan the confirmation shows in the app, the push is not attempted, and an unsendable waitlist offer passes to the next entry; (h) bookings and Beam callbacks succeed in every state; (i) LINE's endpoints failing falls back to the own count and raises a health alert.

## 6. Beam callback handling (PAY-02, PAY-03, PAY-07; decisions D18, D24, D25, D26)

### 6.1 What Beam's public documentation says

Read on 30 Oct 2026 from `docs.beamcheckout.com` (page paths in brackets). Nothing below comes from memory or from other gateways.

| Topic | What the docs say |
|---|---|
| Authentication | HTTP Basic, `Authorization: Basic base64(merchantId:apiKey)` [get-started/authentication]. Playground and Production have different keys, hosts (`playground.api.beamcheckout.com`, `api.beamcheckout.com`) and webhooks, and "do not cross between them" [switching-to-production] |
| Create a QR charge | `POST /api/v1/charges`. Body: `amount` (integer, "smallest currency unit", so satang), `currency` `THB`, `paymentMethod { paymentMethodType: "QR_PROMPT_PAY", qrPromptPay: { expiryTime } }`, `referenceId` (our own reference, searchable later), `returnUrl`. Response: `chargeId`, `actionRequired: "ENCODED_IMAGE"`, `encodedImage { expiry, imageBase64Encoded, rawData }`. The create response "does not tell you whether the payment succeeded". A failed payment still returns HTTP 2xx [charges/charges-api] |
| Statuses | `PENDING`, `SUCCEEDED`, `FAILED`. A charge "can stay `PENDING` indefinitely" and "a very late `charge.succeeded` webhook is still possible" [charges/charges] |
| Expiry | `qrPromptPay.expiryTime`, an RFC 3339 timestamp by example; the response echoes `encodedImage.expiry` [charges/charges-api] |
| Idempotency | Header `x-beam-idempotency-key` on POST and PATCH, up to 255 characters, kept 12 hours; the same key with a different payload gives 412 `IDEMPOTENCY_KEY_ERROR` [get-started/idempotency-request, error] |
| Webhook events | `charge.succeeded`, `charge.failed` (and others we do not use). The event type is in header `x-beam-event`. The body is "the original object as you would expect from calling our GET endpoint": `chargeId`, `merchantId`, `referenceId`, `status`, `currency`, `amount`, `transactionTime`, `failureCode`, ... [webhook-event-types] |
| Webhook signature | Header `X-Beam-Signature`: HMAC-SHA256 over the exact raw body, key = the base64-decoded HMAC key shown in the Beam dashboard (Lighthouse), result base64 encoded [webhook-authentication] |
| Webhook delivery | Registered in Lighthouse (Developers, Webhook Settings). Any 2xx stops retries; otherwise "10 times with exponential backoff" [webhook-overview, playground] |
| Retrieve a charge | `GET /api/v1/charges/{chargeId}`; list by `referenceId` [charges/charges-api] |
| Refunds | `POST /api/v1/refunds` exists. We never call it (CANCEL-02, PAY-05) |
| Sandbox | Playground accepts the same calls and "doesn't move real money". A QR charge there leads to a "Force Charge" page with a Mark as Succeeded button [test-data] |
| Errors and limits | Error codes such as `INVALID_CREDENTIALS_ERROR`, `API_VALIDATION_ERROR`, `IDEMPOTENCY_KEY_ERROR`; 429 `TOO_MANY_REQUESTS_ERROR` with a backoff-with-jitter recommendation; no numeric limits [get-started/error] |

### 6.2 What the documentation does not say

To be checked in the Playground by DevOps before the F05 design is approved (Q24 residual):

- Any replay protection: **no timestamp** in the signature and **no event id** in the payload (the go-live checklist only advises de-duplicating "by event id (or by resource id + event type)").
- The unit of `amount` in webhook payloads (create-side docs say satang; webhook examples are bare integers).
- The default, minimum and maximum QR expiry, and what Beam does to the charge when the QR expires, or whether it accepts a payment after expiry.
- Retry intervals, response timeout, and an IP allow-list for webhooks.
- The full create-charge schema (the API reference page did not render for the reader), the result of repeating a request with the same key and the same payload, and how a QR payment failure is simulated.
- Registering a webhook through the API (the docs show only the dashboard), and a webhook resend tool in the sandbox.

### 6.3 Gateway interface

The flow is written against a `PaymentGateway` interface in `packages/payments`; the facts above and the unknowns in §6.2 are adapter code, not flow:

```ts
interface PaymentGateway {
  createQr(input: { clubId; paymentId; amountSatang; expiresAt; reference }): Promise<{ chargeId; qrImage; expiresAt }>;
  verifyWebhook(input: { rawBody: Buffer; headers: Headers; secrets: Secret[] }): VerifiedEvent | Rejected;
  getCharge(input: { clubId; chargeId }): Promise<{ status; amountSatang; currency; referenceId }>;
  // No refund method exists. Value never goes back as cash (CANCEL-02, PAY-05); a lint fails if one is added.
}
```

### 6.4 Creating the charge

1. Server prices the order and runs `claim_occupancy` with the hold. Transaction 1 commits: `booking` (awaiting payment), `occupancy` (held), `orders`, `order_line`, `payment` (pending, `amount_satang` frozen), credit and wallet reserve rows.
2. Outside any transaction, call `createQr`: amount in satang, `currency` THB, `referenceId` = our `payment.id`, header `x-beam-idempotency-key` = `payment.id`, and `qrPromptPay.expiryTime` = **the hold's end** (decision D18: the QR expires exactly when the hold ends). For a package bought alone (PAY-04) the expiry is now plus the package QR minutes setting.
3. Transaction 2 stores `gateway_charge_id` and the QR image.
4. If Beam fails, run `release_hold()` and return an error code. If the process dies between steps, the hold expires by itself.

Nothing left to pay (PAY-07) skips Beam: one transaction confirms the booking.

### 6.5 Receiving the callback

`POST /api/webhooks/beam/{webhookToken}`. The token is a long random value per club **and per key set** (test and live, decision D32), so we know which club's secret to use before verifying anything. The token only selects the club; it authenticates nothing. In Beam's dashboard the platform registers this URL for the club's own merchant account and pastes the club's HMAC key, which is stored as a write-only secret (§4.4).

1. Read the **raw body bytes**. Do not parse first.
2. Load the club's HMAC key(s) (current and previous, for rotation), base64-decode, compute HMAC-SHA256 over the raw bytes, base64-encode, and compare with `X-Beam-Signature` in constant time. **Bad signature: respond 401, change nothing, log a security event with no body content and raise an alert** (decision D24).
3. Parse. Find `payment` by `gateway_charge_id` **and** the club from the token.
4. **De-duplicate.** There is no event id, so the key is `chargeId` plus the `x-beam-event` type: insert into `payment_event` with unique `(club_id, gateway, gateway_charge_id, event_type)` and `ON CONFLICT DO NOTHING`. A duplicate is **ignored with success**: respond 200 (decision D24).
5. **Confirm with Beam.** Because the signature carries no timestamp, a captured callback could be replayed; and the webhook amount unit is unconfirmed. So after the signature check, call `getCharge` and apply the result of **that** lookup, not the body. If Beam cannot be reached, respond 500 so Beam retries (up to 10 times). Cost: one API call per callback.
6. **Compare** the looked-up `amount` and currency with `payment.amount_satang` and THB. **Mismatch (validly signed, wrong amount): do not confirm the booking, record the event with outcome `mismatch`, flag it for the owner (club health alert and an admin task), respond 200 (a success status, so Beam stops retrying: decision D36, refining D24).** Staff then credit the wallet with a written reason from A6 (decision D24).
7. If the looked-up status is not `SUCCEEDED`, record and stop.
8. Run `applyPayment()` in the same transaction as the event insert; respond 200 after commit.

PAY-02 says a bad signature or wrong amount "changes nothing". It is read as: no booking, order, payment status or ledger change. The immutable `payment_event` row is written because it is the evidence.

### 6.6 `applyPayment()` (decision D25)

Lock order per §3.4. Every state change is guarded by `UPDATE ... WHERE status = 'pending'` with a row-count check.

"Late payment" means Beam reports the payment after the hold ended (D18). "Slot still open" means no other hold, booking or closure on the court, and for a solo class on the coach too (D25).

| Case | Booking | Money |
|---|---|---|
| Paid while the hold is live | `confirmed`; occupancy `confirmed`, hold cleared; payment `succeeded`; receipt issued; outbox "booking confirmed" | none |
| Late, slot still open | Re-attempt the original claim (court and coach together, §3.3) and re-reserve the credits and wallet the order used. All succeed: `confirmed` as above | none |
| Late, slot not open (solo class: court or coach not free) | Stays `released` | The whole amount goes to the wallet (reason `late_payment`); the player gets a LINE message; its own receipt is issued for the money received (decision D37, §2.4) |
| Late, slot open, but credits, wallet or promo cannot be re-applied | Stays `released` | Wallet, as above (adopted as recommended) |
| A second success for an order already paid | unchanged | The second amount to the wallet (`duplicate_payment`) |
| Success for a cancelled order | unchanged | Wallet |
| Package-only order, success after its QR expired | Order stays cancelled (nothing is held) | Wallet (adopted as recommended) |

The "re-attempt the claim" step is the same function and constraints as a fresh booking, so a late payment can never double book. The hold-release job and the callback both lock the booking row first, so whichever commits first wins and the other sees the new status (test T10).

### 6.7 Safety net, sandbox, tests

- `beam_reconcile` (§5.4) covers a callback that never arrives, using `getCharge`.
- Test payments use Beam's Playground only; there is no in-app "simulate payment" (decision D26). Each club holds two Beam key sets (decision D32). A Testing club uses the test set; a Live club uses the live one. Swapping to the live set is a required item on the P4 go-live checklist with a smoke test (F01 §9.3). A callback that arrives on the URL of the set that is not active for the club's status (for example a test callback after Go live) is recorded, flagged and answered 200, and changes nothing. In the Playground a tester completes a payment with the Force Charge page.
- QA's fake Beam signs bodies exactly as §6.1 describes (base64 HMAC-SHA256 with a base64 key) and covers: valid, bad signature, wrong amount, late, duplicate, replayed old callback, out of order, unknown charge, lookup failing, and Beam down at create time.

### 6.8 Needs messages

The wallet fallback ("your late payment went to your wallet") and the owner flag for a wrong-amount payment are events no LINE-05 message or admin text covers. They need new locale keys in both files, listed for the writers (CLAUDE.md, TEXT-04). None are added here.

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
| Age and student price | Computed from `date_of_birth` and the Bangkok date; the price switches on the 18th birthday. No date of birth on file means Adult prices (D12). A Student package already bought stays valid when the holder becomes an Adult (round 1) |
| Package validity | Calendar months from the purchase date, ending at 23:59 Asia/Bangkok on that day; if that day does not exist, the last day of the month (31 Jan + 1 month = end of Feb). Pause extensions use the same rule (decision D20). Stored as `expires_on date`; the package is usable while `now()` is before the start of the next Bangkok day. A purchase on 5 Jan with 3 months expires 5 Apr, which resolves canvas gap B5 |
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
- **Registry.** `packages/db/audited-tables.ts` lists audited tables; a CI check fails if one lacks its trigger. The list: `club`, `club_setting`, `club_feature`, `location`, `resource`, `opening_hours`, all price tables and `package_product`, `add_on`, `promo_code`, `app_user` (including date of birth, which the owner can see changed, decision D12), `app_user_role`, tags, `coach` (tier, price override, pay model), `booking`, `occupancy` via booking, `class_template`, `class_session`, `closure`, `customer_package`, `package_extension`, `credit_ledger`, `wallet_ledger`, `orders`, `payment` (cash with reason code), `receipt` (void). The registry is reviewed per feature design.
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
- **API conventions that every feature uses:** errors are typed codes with parameters, never text (TEXT-01); mutating routes take `Idempotency-Key`; every route declares a permission; money in responses is integer satang; timestamps are ISO 8601 with `+07:00`; no club id in request bodies; the club slug in the path only picks the login channel (§4.2).

## 10. Questions and decisions

### 10.1 Answered or adopted, no longer for review

Decisions round 4 is headed "approved as recommended" in `docs/decisions.md` and itemises D18 to D31. Where a row below cites a D number, the log states it. Rows marked "adopted" were open recommendations in the previous revision and are applied as recommended; they are **not individually itemised in the log**, so the log should list them.

| Q | Answer | Source | Applied in |
|---|---|---|---|
| Q1, Q2 | There is no existing Booq core; tables are named `club` and `location` from the start | Round 2b | §1 |
| Q3 | Roles are a set | D1 | §2.2, §4.2, §4.3 |
| Q4 | `reserve` -1, `return` +1, `expire` the negative remainder, `adjust` and `import` signed; `use` and `forfeit` carry change 0 | Adopted | §2.3 |
| Q5 | Wallet reasons: `refund` (money back from a cancellation), `late_payment`, `duplicate_payment`, `referral_reward`, `spend`, `return` (wallet use returned), `adjust`, `import`, `expire` only if the wallet expiry setting is set | Adopted, D21, D25 | §2.3, §6.6 |
| Q6 | Wallet value applied at Pay is reserved by a ledger row and reversed if the hold ends. Order of use at checkout: package credit, then wallet, then money | Adopted, D22 | §2.3 |
| Q7 | Money rounding is half up to the satang; a code applies to items in its scope, add-ons excluded unless the code says so | D23 | §2.1 |
| Q8 | Receipts are numbered per club; a receipt is issued for money received, including a late payment that goes to the wallet, which gets its own receipt (D25, D37). One series per club per Bangkok year, adopted | Round 2b, D25, D37, adopted | §2.4 |
| Q9 | Test data flagged, separate non-legal series, purged at Go live; testers are the owner and named BOOQ testers; BOOQ sees pass or fail | D4, D16 | §2.6 |
| Q10 | Expiry is calendar months, ending 23:59 Bangkok; last day of the month if the day does not exist; same for pause extensions | D20 | §7 |
| Q14 | "In a row" is back-to-back hours; a free hour resets; unpaid held hours count; a group class counts until cancelled | D19 | §3.3 |
| Q15, Q20 | BOOQ staff may see aggregate counts and the owner's contact details, nothing finer | D2 | §2.2, §4.4 |
| Q16 | BOOQ staff sign in with email plus a second factor, separate from LINE | D3 | §4.4 |
| Q17 | One LINE provider per club | D7 | §4.2 |
| Q18 | One shared domain with the club in the URL; domain supplied later, kept as configuration | D6 | §4.2 |
| Q19 | "Front desk cannot see revenue" is enforced on the server; Security reviews it as part of design approval | Adopted | §4.3 |
| Q21 | Skip any reminder whose time has already passed when the booking is made | Adopted | §5.4 |
| Q22 | Birthday message at 09:00 Bangkok on the 1st | Adopted | §5.4 |
| Q23 (hosting) | Supabase in Singapore with a DPA; the legal check is deferred by the user; alternative is self-hosted Postgres in Thailand | D5 and its update | §4.1 |
| Q25 | A late payment is approved only if the slot is open (no other hold, booking or closure; a solo class needs court and coach); otherwise all of it goes to the wallet. Re-applying credits, wallet and promo, and a package-only order paid after its QR expired, follow the recommendation | D25, adopted | §6.6 |
| Q26 | A validly signed wrong-amount callback does not confirm, is flagged for the owner, staff credit the wallet with a reason; a duplicate is ignored with success | D24 | §6.5 |
| Q27 | Anonymise personal fields on the user and redact them in audit JSON; keep ledgers, receipts and audit under pseudonymous ids; retention periods are set when legal input is available | Adopted | F01 design |
| Q28 | The audit log is read by the owner only; BOOQ sign-ins and failures go to P6 | Adopted, ROLE-02-AC5 | §8 |
| Q30 | Package-expiring messages keep sending at 80% of the LINE cap | D29 | §5.6 |
| Q24, Q31 | Researched from the public documentation; what the docs say is in §6.1 and §5.6, and what they do not say is in §6.2 and in 10.2 | This revision | §6, §5.6 |

Decisions D32 to D36 (this revision): D32 two Beam key sets and test LINE messages counting toward the cap (§2.2, §2.6, §6.7); D33 test rows excluded everywhere (§2.6); D34 TLS in transit, host disk encryption at rest, app-level encryption for stored secrets (§2.2, §4.4); D35 the Accountant sees names but not phone or date of birth (§4.3); D36 the wrong-amount callback is recorded, flagged and answered with success (§6.5). Decision D37 (a late payment that goes to the wallet gets its own receipt) is applied in §2.3, §2.4 and §6.6. Other decisions this revision applies: D26 (Playground only for test payments), D27 (setup-only support view, 404 for what a caller may not reach, secrets write-only with the last four characters shown), D28 (audit and ledgers append-only, already in the design), D30 (test tools), D31 (the i18n role generates `copy-index.csv`; read only for us).

### 10.2 Still open, with a recommendation

| Q | Question | Recommendation | Decides | Blocks |
|---|---|---|---|---|
| Q11 | Booking window edge | By Bangkok date: today through today + N, both inclusive | Product | F03 |
| Q12 | Coach on a multi-hour court selection | The coach picker shows only when exactly one hour is selected, matching "coaches available for that exact hour" | Product | F03, F07 |
| Q13 | Class session versus an existing booking or closure | The booking or closure wins; the session is flagged "needs attention" for the owner | Product | F08 |
| Q29 | Which accounts the Go live purge removes | Tester player accounts and their data are purged; owner, staff and coach accounts, which come from invitations and setup, are kept | Product | F15 |
| Q24 (residual) | The Beam facts the docs do not state (§6.2) | Check each in the Playground with the club's sandbox keys and record the answers in the F05 design; the interface already isolates them | DevOps | F05 |
| Q31 (residual) | LINE: month boundary and time zone, whether a free plan returns `none` or `limited`, freshness of the figures, Thai plan names | Check against a real club account; until then plan kind and limit are entered by hand (§5.6) | DevOps | F10 |
| Q32 | The C1 checkbox "Add {club} as a LINE friend" (LINE-01-AC6) assumes a per-login choice. LINE's LIFF setting "Add friend option" (On normal, On aggressive, Off) is per LIFF app, not per login | Spec and platform differ, so this stops for a person. Recommendation: set the LIFF app to On (normal), where the add-friend choice sits on LINE's own consent screen, and turn the C1 checkbox into a note without a control. Needs a spec change | Product | F02 |
| Q33 | The docs do not say that the LINE user ID from Login is the same as the Messaging API user ID under one provider. LINE-01-AC5 relies on it | Test with a real club account (one Login channel, one Official Account, one provider) before F02 is built. If they differ, the push target must be learned from the webhook | DevOps | F02 |

### 10.3 Open and not decidable here

- Consent for players under 18 (decision D10, skipped): undecided; needs legal input before the consent text is final.
- From `docs/canvas-gaps.md`: C2 (are wallets in "owed to customers"), C4 and C5 (rich menu labels, address toggle), C7 (branches per club); C3 (message cap) is decided (LINE-07, D17).
- The domain name (D6), Hunter's Beam merchant account, and the club's LINE plan.
- Questions inside the F01 and F02 requirements that the designs assume an answer for are listed in each design's section "Assumptions".

## 11. What happens next

1. A person reviews this file. Q11, Q12, Q13, Q29, Q32 and Q33 are the only open rows; Q32 needs a spec decision before the F02 design can be approved.
2. `specs/features/F01-platform-foundation/design.md` and `specs/features/F02-line-login-liff/design.md` are drafted from this document (gate 2, for approval).
3. The claim function, ledgers and receipts counter get their own design sections in the F03, F06 and F13 designs, each citing the section here and adding a test list.
4. DevOps spike (small): custom roles through the Supabase pooler, `btree_gist`, a direct connection for the worker, backups, the Beam Playground checks (§6.2) and the LINE checks (Q31, Q33).
5. No code is written until the relevant requirements and design are approved (CLAUDE.md, rule 5).
