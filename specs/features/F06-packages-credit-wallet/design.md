# F06 Packages, credit and wallet ledgers · Design

Status: **Approved 30 Oct 2026 (gate 2, D153).** Drafted 30 Oct 2026 from the approved F06 requirements (`requirements.md`, approved 30 Oct 2026, decisions D83 to D90, D116 and the Reviewer's findings applied). The Architect's review findings of 30 Oct 2026 are folded in. A change to anything below goes through the PRD, then the hand-off, then this file. Tasks (gate 3) follow approval.

Feature: F06 Packages, credit and wallet ledgers. Requirement IDs: PKG-01, PKG-02, PKG-03 and the local rules R1 to R3 of the requirements. Depends on F04. Wave 3.

Shared decisions are in `docs/architecture/foundation.md`, cited as **FA §n**; the F01 to F05 designs as **F01 §n** and so on. FA §2.3 already fixes the ledger shapes, append-only enforcement, derived balances and the no-overspend lock; this file adds what F06 builds on them and settles the points FA left to F06. Where the requirements and FA differ, the requirements win and the point is listed in section 13.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| PKG-01 (ledgers, reasons, derived balance, append only, no negative, withdrawals) | §3 tables; §4.1 to §4.3 functions; §5 routes; §7 permissions |
| PKG-02 (products, prices, validity, expiry, Student packages) | §3.1; §4.4 grant and expiry arithmetic |
| PKG-03 (reminders, expiry job, extension, pause, wallet expiry) | §4.5 to §4.7; §6 jobs |
| R1 (reserve, use, return, forfeit) | §4.2; §4.3 |
| R2 (wallet funding and use) | §4.1; §4.3 |
| R3 (buying a package) | §4.4; §5 |
| Imported balances and claims (PLAT-06-AC3, AC7; D13, D105) | §4.8 |
| Payment ports called by `app.apply_payment` (F05; `docs/architecture/apply-payment.md`) | §4.9 |
| CC-1 to CC-6 | §10 |

## 2. What this design does not build

The order price and the order of use (F04 calls F06); the Beam payment and `apply_payment` (F05 calls `grant_package` and the wallet credit functions); cancel and closure decisions (F09 calls F06's return and forfeit); the LINE messages (F10 enqueues from the jobs here); the referral reward rules (F14 calls the wallet credit); receipts (F13); the A6 and A9 screens (F11). F06 supplies the ledger functions all of these call; nothing else writes a ledger.

## 3. Data and migrations

F06 uses the number block 0501 to 0599.

| File | Contents |
|---|---|
| `0501_package_tables.sql` | `package_product` (F06 creates it: F04 has no migration for it), `customer_package`, `package_extension`, `wallet_account` (FA §2.3); foreign key from `order_line.package_product_id` (§3.1) |
| `0502_ledgers.sql` | `credit_ledger` and `wallet_ledger` as FA §2.3; append-only triggers, revoke, deferred balance checks |
| `0503_balance_views.sql` | `wallet_balance`, `package_balance`, `package_status` views |
| `0504_wallet_credit_order.sql` | `orders.kind` (default `sale`) and the order line kind `wallet_credit` with its sum rule (§4.9; neither exists in F04 0303) |
| `0505_wallet_functions.sql` | The wallet functions of §4.1 |
| `0506_credit_functions.sql` | The credit functions of §4.2 (written in two parts, 0506 and 0507) |
| `0507_credit_functions_b.sql` | `credit_use`, `credit_forfeit`, `credit_reverse_forfeit`, `credit_adjust`, `credit_expire` (§4.2) |
| `0508_package_functions.sql` | `grant_package`, expiry arithmetic, `extend_package`, `extend_for_pause`, `wallet_expire` (§4.4, §4.7) |
| `0509_release_handler.sql` | `app.release_handlers` registration (F03 §4.5) for F06 |
| `0510_claim_handler.sql` | The reason `import_transfer` added to both ledger CHECKs; `app.f06_claim_transfer(club, imported, claimant)` registered in `app.claim_handlers` as `wallet_transfer`; the inert guard (§4.8) |
| `0511_payment_ports.sql` | Registers the three F06 ports in `app.payment_ports` (§4.9): `reserve_credit_and_wallet`, `grant_package`, `credit_wallet`; `wallet_ledger.payment_id` column |
| `0512_jobs_support.sql` | Sweep queries as functions; dedupe indexes |
| `0513_grants_policies.sql` | Policies and grants for the tables, views and functions above |
| `0514_package_reminders.sql` | Replaces the no-op `app.package_reminder_hook` of 0508 with the real enqueue through `app.enqueue_message` (§4.5); written after F10-T06 |

A merged migration is never edited; a fix is a new migration (build plan).

### 3.1 Tables (class D unless noted)

- **`package_product`** (class S; created by F06 migration 0501, with the foreign key from F04's `order_line.package_product_id`): `club_id`, `id`, `name_th`, `name_en`, `credit_type` (`court_hour`, `solo_class`, `group_session`), `credits`, `validity_months`, `price_group_id` null, `coach_tier_id` null (solo only), `price_satang`, `active`. Check: `solo_class` needs a tier; `group_session` and `solo_class` need a price group for Student and Adult versions. Price and validity are read at purchase; changing them never alters packages already sold (PKG-02-AC4).
- **`customer_package`**: `club_id`, `id`, `customer_id`, `product_id`, `product_snapshot jsonb` (credit type, tier, price group, validity months, price paid), `credits_total` (immutable by trigger), `purchased_at`, `purchase_date` (Bangkok date, derived at insert), `expires_at timestamptz` (changed only by `extend_package`), `order_id`, `status_cache` none (status is derived, §3.3), `is_test`. Unique `(club_id, order_id, product_id)` makes a repeated callback unable to grant twice.
- **`package_extension`**: `club_id`, `id`, `package_id`, `kind` (`owner`, `pause`), `old_expires_at`, `new_expires_at`, `reason`, `staff_id` null, `pause_id` null, `created_at`. Append-only (§3.2). A staff extension needs a non empty reason and `staff_id` (PKG-03-AC5).
- **`wallet_account`**: `(club_id, customer_id)`, no balance column; a lock anchor only (FA §2.3).
- **`credit_ledger`** and **`wallet_ledger`**: exactly FA §2.3. The credit reasons are reserve, return, use, forfeit, expire, adjust, import; the wallet reasons are the D78 set. Added here: a `wallet_ledger.reason` CHECK of the D78 set, with `expire` allowed only through `app.wallet_expire` (§4.7); `credit_ledger.change` sign rules per FA §10.1 Q4 (reserve -1, return +1, expire the negative remainder, adjust and import signed, use and forfeit carry 0).
- **Views:** `wallet_balance (club_id, customer_id, balance_satang)` is `sum(change_satang)`; `package_balance (club_id, package_id, credits_left)` is `credits_total + sum(change)`; `package_status` derives `active`, `used_up`, `expired` (expiry passed or `expires_at <= app.now()`), never stored.

### 3.2 Append-only (PKG-01-AC5; decision D28)

As FA §2.3: `revoke update, delete, truncate` from every application role, a `BEFORE UPDATE OR DELETE` trigger that raises, FORCE RLS, and a CI test that tries `UPDATE` and `DELETE` as each role. The same three-way protection applies to `package_extension`. The one named exception for anonymisation (D104) concerns audit JSON, not ledgers: ledger rows are kept under pseudonymous ids (FA §10.1 Q27).

### 3.3 Why statuses are derived

Expiry and use are predicates of time and ledger sums, not stored fields, so a late job never lets an expired credit be used (FA §5.1). `credit_eligible(package, at)` is `expires_at > at and credits_left > 0`.

## 4. Functions (the only writers of the ledgers)

All run `SECURITY DEFINER` with a fixed search path, take `club_id` from `app.club_id()`, check the caller's right inside, write the audit entry in the same transaction where staff act (PLAT-04), and carry a `dedupe_key`. Lock order follows FA §3.4: customer advisory lock, then `wallet_account`, then packages in id order. All amounts are satang; all credits whole numbers.

### 4.1 Wallet

- **`app.wallet_credit(customer, amount_satang, reason, ref, staff null, note null)`** writes a positive row. Allowed reasons by caller: `refund` (F09, returned money), `late_payment`, `wrong_amount`, `duplicate_payment` (F05), `referral_reward` (F14), `return` (F04 restore), `adjust` (staff, note required), `import` (F01 import, owner). `dedupe_key` supplied by the caller (for example `late_payment:{payment_id}`, `referral:{referral_id}`) so a repeat credits once.
- **`app.wallet_spend(customer, amount_satang, order_id, line_id)`** locks the anchor, reads the sum, requires `sum >= amount`, inserts a negative `spend` row tied to the order (reserve pattern, FA §2.3), `dedupe_key spend:{order_line}:{attempt}` numbered the same way as credit reserves so a late reclaim can spend again. A deferred constraint trigger checks `balance >= 0` as a backstop (PKG-01-AC7, AC8; D83).
- **`app.wallet_return(order_id, reason)`** writes the compensating `return` rows for an order's spend rows when a hold ends (F04 R7-AC6) or a cancel returns wallet use (D21). One call returns each spend once (`dedupe_key return:{spend_id}`).
- **`app.wallet_adjust(customer, delta, note)`** (staff): refuses when the result would be negative (D83); needs a non empty note; audited.
- **`app.wallet_expire(...)`**: only when the club has set `wallet_expiry_months` (D89); see §4.7.

### 4.2 Credits

- **`app.eligible_credits(customer, line_spec, at)`** (called by F04 pricing): returns active packages whose credit type, tier and price group fit the line, ordered by earliest `expires_at`, then id (so the credit nearest expiry is used first). A Student credit fits only the Student item it was bought for, also after the holder turns 18 (D84, R4-AC6 of F04).
- **`app.credit_reserve(package, booking, order_line)`** locks the package row, checks `credits_left >= 1` and `expires_at > at`, inserts a `reserve` row (change -1, `dedupe_key reserve:{order_line}:{attempt}`) in the same transaction as the booking (R1-AC1, CC-4). `attempt` is one more than the number of `reserve` rows already written for that order line, counted under the package lock: a hold that is released writes a `return`, and a late payment that reclaims the order reserves the same line again (`apply_payment`, F05), so the key must differ each time while a repeated call of the same attempt still writes once. Two parallel bookings for the last credit give exactly one success (PKG-01-AC8).
- **`app.credit_return(booking, reason)`**: writes `return` (+1) for a reserved credit of a booking cancelled in time or released; if the package is already expired and the booking is cancelled by the player after expiry, no return is written and the credit is lost (D85, CANCEL-01-AC11); a closure return still returns the credit (F09 CANCEL-03-AC12; the extension is the owner's action, D118).
- **`app.credit_use(booking)`** (job `session_start`): converts the reservation into a `use` row (change 0) once the session starts (R1-AC3).
- **`app.credit_forfeit(booking, staff, note)`**: writes `forfeit` (change 0) for late cancel or no show (CANCEL-01-AC10).
- **`app.credit_reverse_forfeit(booking, staff, note)`**: a staff reversal of a no show writes a `return` row (+1) with the note, never an edit (R1-AC5).
- **`app.credit_adjust(package, delta, staff, note)`**: a staff `adjust`; refuses a result below zero (D83); audited.
- **`app.credit_expire(package)`**: writes one `expire` row for the remainder (§4.6).

### 4.3 Reserve at Pay and reverse at release

F04's Pay transaction calls `credit_reserve` and `wallet_spend` for each line's allocation (F04 §4.3). `app.release_handlers` gets F06's handler `app.f06_release(order, reason)`, registered in migration 0509 with `ord` 30 (one rule: F04 10, F05 20, F06 30, F08 and F10 above 40), which calls `credit_return` for every reservation of the order and `wallet_return` for every spend row, in id order. The handler is idempotent through the `dedupe_key`s. `app.restore_order_entitlements` (F04) calls the same functions on a cancel.

### 4.4 Granting a package (R3, PKG-02)

- **`app.grant_package(order)`** (the port of §4.9; the products and the customer are read from the order's `package` lines) is called by `app.apply_payment` (F05) when a package order is paid, and by staff cash (F05 PAY-06). In one transaction it inserts the `customer_package` row with `purchased_at = app.now()`, `credits_total`, the product snapshot and `expires_at`, and it enqueues the expiry reminder outbox rows (§4.5). Unique `(club_id, order_id, product_id)` makes a repeat harmless. One call grants every package line of the order; a line is granted once.
- **Expiry arithmetic (PKG-02-AC2; D20):** `expires_at = (purchase_date + validity_months months) at 23:59:59.999 Asia/Bangkok`, with the day clamped to the last day of the month when the day does not exist (30 Nov plus 3 months is 28 Feb, 29 in a leap year). It is computed in SQL on `date` values in the Bangkok zone, never from UTC dates (FA §7). A test table covers 31 Oct, 30 Nov, 29 Dec across the year end, 31 Aug plus 6 months, 29 Feb 2028 plus 12 months, and the sample 5 Jan 2027 plus 3 months giving 5 Apr 2027 (Gaps B5).
- **Student products** refuse a buyer whose date of birth makes them 18 or older (PKG-02-AC6; F04 R1-AC6). Adults without a date of birth are not Student.
- **Package with a booking (Flow H, I):** one order, one bill: F04 adds the package line and the credit that covers one hour or session now; in `app.apply_payment` the order is `grant_package`, then `reserve_credit_and_wallet(order)`, then `confirm_booking`, in one sub-block with the wallet fallback (Architect review of 30 Oct; the F05 migration that adds the step is the Architect's). At Pay time the new package does not exist, so F04 stores the allocation of that line with **no package id and a marker** (proposed name `scope.new_package_line`, meaning credit from the package bought in this order). `reserve_credit_and_wallet` resolves the marker to the package this order granted and reserves from it with the usual keys. Any false or refusal undoes the sub-block and the whole amount goes to the wallet (R3-AC2, AC3, AC7, D87). **Two agreements are needed before the build:** F04's Pay stores the marker (F04 owner), and F06's reserve resolves it (this design). Assumption A-15.
- **Late payment cases:** a package order paid after its QR time went to the wallet with `late_payment` and its own receipt, no package created (R3-AC9, D74). A package bought with a booking whose late payment cannot confirm the booking: all of it goes to the wallet, nothing partly created (R3-AC7, D87).

### 4.5 Reminders (PKG-03-AC1, AC2, AC6; D116)

At `grant_package`, `extend_package` and pause, F06 enqueues outbox rows `package_expiring` with `send_at = expires_at - N days` for each N in the club setting `package_expiry_reminder_days` (Tennis template 14 and 3), `dedupe_key = package_expiring:{package_id}:{expires_at}:{N}` (F10 sends). F06 builds before F10, so `grant_package`, `extend_package` and pause call a hook `app.package_reminder_hook(package)` that is a no op in 0508; migration 0514 (F06-T14, after F10-T06) replaces it with the real enqueue. A package granted before 0514 has no reminders; this cannot occur after launch. Because the key holds `expires_at`, an extension or pause makes new keys and the sender voids the old rows. The sender re-checks at send time: a package with no credits left skips the reminder (FA §5.3). The numbers are settings, never typed in a key (D116).

### 4.6 Expiry job

`package_expire` (FA §5.4): every 5 minutes, packages with `expires_at <= app.now()` and credits left get one `expire` row for the remainder, unique `(package_id, 'expire')`. A credit already reserved before expiry stays valid for that session: the sweep counts reserved credits as not left (`credits_left` is after reserves), so it expires only what is unreserved (D85, PKG-03-AC8). A credit reserved for a session after expiry is allowed only because it was reserved earlier; a new `credit_reserve` after expiry is refused by the predicate.

### 4.7 Extension, pause and wallet expiry

- **`app.extend_package(package, new_expires_at, reason, staff)`** (owner only, one package at a time, D88): requires a non empty reason, `new_expires_at` at 23:59:59.999 Bangkok on a later day, writes `package_extension` (`kind owner`), updates `expires_at`, voids and re-enqueues reminders, audits (PKG-03-AC5).
- **`app.extend_for_pause(club, pause_id, length)`** (called by F01 resume in the same transaction, PLAT-03): for every package of the club with `expires_at >= pause start`, adds the exact pause length to `expires_at` then sets the time to 23:59:59.999 of the resulting Bangkok day (D90, PKG-03-AC7), one `package_extension` (`kind pause`) per package, and the same for the wallet expiry when set. A pause shorter than a day moves expiry by the exact length and then runs to 23:59 (D90).
- **Wallet expiry (D89):** `wallet_expiry_months` (the existing key, F01 0041) is unset by default (never expires). When first set, the settings route warns staff and records the date; `app.wallet_expire(customer)` is called by a sweep only for clubs with the setting, writing an `expire` wallet row for the remainder of balances older than the setting by the FIFO rule of Q1 below. With the setting empty the function refuses to run.

### 4.9 Payment ports (`app.payment_ports`, contract in `docs/architecture/apply-payment.md`)

`app.apply_payment` (F05) reaches F06 only through the registry `app.payment_ports (port, handler regprocedure)`. Migration `0511_payment_ports.sql` registers these three ports; a port that is not registered raises `payment:port_missing:{port}` and rolls the whole payment back, so F06 must be registered before F05 can confirm a payment. All three run `SECURITY DEFINER`, take the club from `app.club_id()`, are executable by `booq_worker` only (the webhook and lookup run as the worker), and run inside `apply_payment`'s transaction, so any raise rolls the whole case back.

| Port | Registered function | Arguments | Result and outcomes | Idempotency |
|---|---|---|---|---|
| `reserve_credit_and_wallet` | `app.port_reserve_credit_and_wallet(p_order uuid) returns boolean` | the order whose lines carry the frozen allocation (`credit_package_id`, `credit_units`, `wallet_satang`, F04 §4.3) | **true**: every credit and every wallet part of every line is reserved, in the lock order of FA §3.4, as one sub-block. **false** and **nothing written**: any credit is missing, used up or expired, the wallet is short, or the customer is not claimed or not active. Never partially reserves: a savepoint covers all lines. Used by the late reclaim (`apply_payment` step 6), after `app.reapply_order_entitlements` | Per line `reserve:{order_line}:{attempt}` and `spend:{order_line}:{attempt}` (§4.1, §4.2); a line already reserved and not returned is skipped, so a second call after success returns true and writes nothing |
| `grant_package` | `app.port_grant_package(p_order uuid) returns void` (the function of §4.4) | a paid package order | Creates a `customer_package` for each `package` line, with product snapshot, `credits_total`, `purchased_at = app.now()` and `expires_at` per D20, and enqueues the expiry reminders (§4.5). **Raises** (`payment:grant:order_not_package`, `payment:grant:product_missing`) when the order has no package line or a product is gone, which rolls the payment back rather than taking money without a package. For a package bought with a booking the booking's credit is reserved after the grant inside the same transaction (§4.4) | Unique `(club_id, order_id, product_id)` on `customer_package` |
| `credit_wallet` | `app.port_credit_wallet(p_order_kind text, p_customer uuid, p_amount_satang integer, p_reason text, p_dedupe_key text, p_payment uuid) returns uuid` | `p_order_kind` is `wallet_credit` (the only value used; any other raises); `p_reason` one of `late_payment`, `duplicate_payment`, `wrong_amount`, `refund` (an unlisted reason raises `payment:wallet:reason`); `p_amount_satang > 0` | Writes the wallet ledger row with that reason and `payment_id`, and creates the order of kind `wallet_credit` with one line of kind `wallet_credit` for the amount (FA §2.4, D37), both in the caller's transaction. **Returns the id of the `wallet_credit` order** (the port looks it up itself, so F05 reads no F06 table), which `apply_payment` hands to the F13 port `issue_receipt`. The columns come from 0504 (`orders.kind`, line kind `wallet_credit`). The customer must exist; a deleted (anonymised) account still receives the credit (D109) | `dedupe_key` (for example `late_payment:{payment}`): the same key returns the same order id and creates no second order |

**Arguments and outcomes in one sentence each.** `reserve_credit_and_wallet` answers whether the late reclaim may keep the booking; `grant_package` turns a paid package order into packages or raises; `credit_wallet` turns money that cannot confirm anything into wallet value plus an order the receipt can attach to.

**Naming.** If the Architect renames a port, only the registry rows in 0511 and the table above change. The ports hold no business rule of their own; they call the functions of §4.1 to §4.4.

**Tests.** Port missing raises and leaves the payment pending; `reserve_credit_and_wallet` returns false and writes nothing when the wallet is short or a package expired, and true twice writes once; a released then reclaimed order reserves again with `attempt` 2 and the balance equals the ledger sum; `grant_package` twice grants once and raises on a non package order; `credit_wallet` twice with one dedupe key returns one id, one order, one row; an unlisted reason raises; the wallet balance after a wallet outcome equals the amount received.

### 4.8 Imported balances and the claim transfer (decisions D13, D105; migration 0103 on `main`)

`0103_claims.sql` (F01 and F02) makes an imported player an `app_user` with no LINE id and `claim_state = 'unclaimed'`, and runs the handlers in `app.claim_handlers` inside `app.claim_confirm`, each called as `handler(club, imported, claimant)` in one transaction with the merge. F06 registers one handler.

- **Imported rows are inert until confirmation.** The CSV import writes ledger rows with reason `import` (credit: `change` signed; wallet: `change_satang` positive) for the imported user and creates `customer_package` rows for them (F01 PLAT-06). Every F06 function that spends, reserves or lists value for a customer (`wallet_spend`, `credit_reserve`, `eligible_credits`, `wallet_adjust` and `credit_adjust` when it would reduce) first requires `app_user.claim_state is null` and `active`; an `unclaimed` or `merged` user is refused with the typed code `customer_not_claimed`. So staff booking at the desk for an unclaimed record, or a stray call, can never use an imported balance. Nobody can sign in as an unclaimed user (no LINE id), and the claimant never sees the imported balance before confirmation (C2 says nothing, F02 AUTH-02-AC30).
- **Handler `wallet_transfer`: `app.f06_claim_transfer(club, imported, claimant)`** runs when the front desk confirms. In the caller's transaction it locks the two `wallet_account` anchors and the imported user's packages in id order (lock order of §4), then writes **paired append-only rows**, never an edit:
  1. Wallet: if the imported balance `b` is greater than zero, one `import_transfer` row of `-b` on the imported user and one of `+b` on the claimant, same `order_id` null, `dedupe_key = 'claim_wallet:{imported}:{claimant}'` and `'claim_wallet_in:{...}'`.
  2. Packages: for each imported package with credits left `r`, one `import_transfer` credit row of `-r` on the old package and a new `customer_package` for the claimant with the same product snapshot, `credits_total = 0` and the **same `expires_at`** (no extension, D88), plus one `import_transfer` credit row of `+r` on the new package, so its credit comes from that row alone and both halves are pairs (D154; approved under D147, 30 Oct 2026: `credits_total` may be 0 only for a package without an order, a sold package keeps more than 0); `dedupe_key = 'claim_pkg:{old_package}:{claimant}'`. A package with no credits left is not copied.
  3. The audit entry names the staff member who confirmed (F01 audit via `claim_request`) and lists the amounts moved.
  The handler is idempotent through the `dedupe_key`s, so a retried confirm cannot transfer twice. It runs only for the pair confirmed; a rival claimant's request is rejected by `claim_confirm` before the handler (F01).
- **Reason `import_transfer` is new (approved, D154; PRD change log "Decisions 30 Oct (12)", hand-off PKG-01).** D78 lists the wallet reasons and the hand-off lists the credit reasons without it. Migration 0510 adds it to both CHECKs, and the PRD then the hand-off must name it (rule changes start in the PRD, CLAUDE.md rule 5). Until they do, this design treats the addition as a proposal; the orchestrator confirms (item A-9 in §13).
- **Balances stay derived.** The imported user's balance returns to zero after the transfer, the claimant's rises by the same amount; `wallet_balance` and `package_balance` need no change. The sum of both users' `import` and `import_transfer` rows equals the amount imported (PKG-01-AC1 property test).
- **After the merge** the imported record is `merged` and inactive; its ledger rows remain as history for the club's accounts (F01 audit).

## 5. API routes

Conventions as FA §9: typed codes, no text, 404 for out of reach; amounts in satang. The routes read; writes go through the functions.

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /api/c/{slug}/packages` | public (guest) | Active products for C9: named public columns only (D103); price per credit and saving computed server side |
| `GET /api/c/{slug}/me/credits` | own | Packages with credits left, expiry and status, and wallet balance for C14 |
| `GET /api/c/{slug}/me/ledger?kind=credit\|wallet&cursor=` | own | History of movements, newest first, with the reason key and booking reference |
| `POST /api/c/{slug}/staff/customers/{id}/wallet-adjust` | `wallet.adjust` (front desk, owner) | `wallet_adjust` with a note |
| `POST /api/c/{slug}/staff/customers/{id}/credit-adjust` | `credit.adjust` (front desk, owner) | `credit_adjust` with a note |
| `POST /api/c/{slug}/staff/packages/{id}/extend` | `package.extend` (owner) | `extend_package` |
| `POST /api/c/{slug}/staff/orders/{id}/package-sale` | `payment.cash` (front desk, owner) | Staff package sale at the desk with cash, reason code (F05 PAY-06); calls `grant_package` |
| `GET /api/c/{slug}/staff/customers/{id}/credits` | front desk, owner | The same views for A6 |
| `GET /api/c/{slug}/staff/reports/owed` | owner, accountant | Value owed: unused credit and wallet balances shown separately (D57); consumed by F13 |

Checkout, Pay and the Beam callback are F04's and F05's routes. There is no route that withdraws or refunds wallet value (PKG-01-AC9, CANCEL-02).

## 6. Jobs

| Job | Source of truth | Side effect | Idempotency |
|---|---|---|---|
| `package_expire` | `expires_at <= now()` with credits left (§4.6) | `expire` row | unique `(package_id, 'expire')` |
| `session_start` (F03's job, F06 handler) | Confirmed bookings with `start_at <= now()` | `credit_use` | `use:{booking_id}` |
| `wallet_expire` | clubs with `wallet_expiry_months` set | `expire` wallet rows | `expire:{customer}:{date}` |
| reminders | outbox rows created at grant, extension, pause (§4.5) | LINE push by F10 | key includes `expires_at` and N |

Time rules live in query predicates, not in jobs (FA §5.1).

## 7. Permission checks

| Permission | Player | Coach | Front desk | Accountant | Owner | BOOQ staff |
|---|---|---|---|---|---|---|
| Read own credits, wallet, ledger | yes | yes | yes | yes | yes | no |
| Read any customer's credits and wallet | no | no | yes | names only (D35) | yes | no |
| `wallet.adjust`, `credit.adjust` | no | no | yes | no | yes | no |
| `package.extend` | no | no | no | no | yes | no |
| Cash package sale | no | no | yes | no | yes | no |
| Products read (public) | yes | yes | yes | yes | yes | setup view (class S) |
| Value owed report | no | no | no | yes | yes | no |

Row policies follow FA §4.3. Every club person also holds the Player role (D115), so a coach or staff member can buy and use packages as a player. BOOQ staff never read ledgers, packages or balances; the products are class S and show in the support view (D27).

## 8. State rules

`customer_package`: derived `active` to `used_up` or `expired`; an extension re-activates an expired one only by changing `expires_at` through `extend_package`. Credit units: reserved to used, returned or forfeited. No state is stored as a mutable balance.

## 9. Concurrency and failure

- Two spends or reserves of the last unit: row lock on the anchor or package, check after the lock; exactly one succeeds (PKG-01-AC8).
- Two parallel returns for one booking: the `dedupe_key` makes the second a no-op.
- Repeated `grant_package`: unique order and product; repeated wallet credits: unique `dedupe_key`.
- A failed step rolls back the whole Pay or callback transaction; no ledger row survives without its booking or order (PKG-01-AC6).
- A returned credit for a package that expires during the cancel: §4.2 rule (D85).

## 10. How the cross-cutting rules are met

- **Club ID scope (CC-1):** every table has `club_id`, composite foreign keys, policies by `app.club_id()`; the functions take the club from context; a request for another club's record answers 404.
- **Server side (CC-2):** only the functions write; the client sends nothing that decides a balance; staff rights are checked inside each function.
- **PDPA (CC-3):** ledgers are club financial data (class D), staff by role; the Accountant sees names but not phone or date of birth (D35); deletion anonymises the player and keeps ledger rows (F01); test rows are flagged and excluded (D33); data is encrypted in transit and at rest (D34).
- **No double booking (CC-4):** a credit reserves nothing on the schedule; the reserve is in the booking's transaction, so no credit is used without a booking and no booking is confirmed without its credit; the booking's uniqueness rule is F03's.
- **TEXT (CC-5):** all text by key with the variables of `locales/README.md` (`{credits}` maps to the writers' count variables, `{amount}`, `{date}`, `{days}` from the setting); one key per ledger reason on C14; new keys are proposed in `locales/pending/F06.json` (D81).
- **Other (CC-6):** Bangkok time everywhere; integer satang; no cash route; no default values in code; wallet expiry unset means never.

## 11. Tests (written first at the build step)

Property: after any random sequence of reserve, return, use, forfeit, expire, adjust and import, balance equals the ledger sum and never goes negative (PKG-01-AC1, AC7). Concurrency: two spends of the last ฿100; two reserves of the last credit; 20 parallel grants of one order (PKG-01-AC8). Append-only: `UPDATE` and `DELETE` as each role fail (AC5). Expiry table (PKG-02-AC2, AC3). Student credit after 18 (AC5; D84). Reserve before expiry then cancel after expiry loses the credit (D85). Pause moves package and wallet expiry, including under a day (D90). Reminders once per N, voided and rebuilt on extension (PKG-03). Late payment on a package order goes to the wallet with a receipt (R3-AC9). Route inventory: no withdraw or refund route (CANCEL-02). Claim transfer (§4.8): an imported balance cannot be spent, reserved or listed while the record is unclaimed (`customer_not_claimed`); confirming a claim writes paired `import_transfer` rows so the imported user ends at zero and the claimant gains exactly the amount, packages keep their expiry, and a repeated confirm transfers once; the sum of `import` and `import_transfer` rows equals the amount imported.

## 12. Text keys and canvas boards

Keys: one per credit and wallet reason on C14 (13 labels), package expired, extended, not offered, adjust reason fields (A-0120 reused where it fits), package pause label (A), `package_expiring` (L, F10 draws it). Proposed in `locales/pending/F06.json`; the writers own the wording (D51).

Boards: H-C09-Packages, H-C09b-Packages-solo, H-C09c-Packages-group, H-C10P-Package-checkout, H-C10P-Bundle-plus-booking, H-C10P-Pack-plus-class, H-C11P-Pay-package, G-C11P-Beam-package, H-C12P-Hours-added, H-C12P-Seat-plus-pack, H-C14-Credits-wallet, H-C08b-Class-pack-choice, G-A02c-Sell-package, H-A06-Customer-profile, H-A09-Pricing and the T- twins. Gaps used: B5 (expiry sample wrong).

## 13. Assumptions to confirm on approval

Recommended defaults, each marked so the orchestrator can confirm or amend them (D147).

| # | Assumption | Basis |
|---|---|---|
| A-1 | Migration block 0501 to 0599 for F06 | Build plan |
| A-2 | Credits are used nearest expiry first when several packages fit (`eligible_credits` order) | The spec is silent; least waste |
| A-3 | Wallet expiry, when set, expires the oldest value first (FIFO by credit row date); with the setting empty nothing expires | D89; the FIFO rule is mine |
| A-4 | The product snapshot is stored on `customer_package` so later price or validity edits never change packages sold | PKG-02-AC4 |
| A-5 | The expiry reminder sender voids rows by key, not by update (append-only outbox history is kept) | FA §5.3 |
| A-6 | `eligible_credits` returns a package even when it is a Student credit held by an adult, for Student items only | D84 |
| A-7 | A closure return after expiry returns the credit and lists the package for the owner to extend (D118); F06 does not extend automatically | D118 |
| A-8 | Staff cash package sales use F05's cash function and call `grant_package` after the receipt is issued | F05 PAY-06 |
| A-9 | The new ledger reason `import_transfer` (credit and wallet) is added by migration 0510 and recorded in the PRD and hand-off first | Orchestrator request; D78 and the hand-off enumerate reasons |
| A-10 | Value imported for an unclaimed player counts as owed to customers in the value owed report (it is a liability of the club), shown on its own line until claimed | D57; the report is F13's, to confirm |
| A-11 | A claimed package keeps its original expiry; the owner may extend it afterwards (D88) | D13, D88 |
| A-12 | `credit_wallet` returns the `wallet_credit` order id (Architect review of 30 Oct); the port finds it from the ledger row it writes | `review-F06-F10-F13.md`, `apply-payment.md` |
| A-15 | The marker for credit from the package bought in this order is `scope.new_package_line` on the allocation (name proposed; F04 stores it, F06 resolves it) | Architect review of 30 Oct, B |
| A-13 | Reserve and spend dedupe keys carry an attempt number so a late reclaim can reserve again after a release | FA §2.3 comment on re-reserve; found while naming the ports |
| A-14 | `reserve_credit_and_wallet` is all or nothing for the whole order and writes nothing when it returns false | `apply-payment.md` ("re-reserve ... false when it cannot") |

## 14. Open items

None block the build. The wallet and credit reason labels, and the wording of the new keys, belong to the writers.
