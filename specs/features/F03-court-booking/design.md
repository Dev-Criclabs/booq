# F03 Court booking, schedule and payment hold · Design

Status: **DRAFT for approval (gate 2).** Drafted 30 Oct 2026 by the Architect role from the approved F03 requirements (`requirements.md`, approved 30 Oct 2026, `docs/decisions.md` round 7) with decisions D18, D19 and D39 to D52 applied. Nothing here is approved until a person says so. No tasks and no code follow until then.

Feature: F03 Court booking, schedule and payment hold. Requirement IDs: BOOK-01 to BOOK-06, with WAIT-01 shared with F08. Depends on F01 and F02. Wave 2.

**Traceability note.** The hand-off now has BOOK-06 (several hours are one order with one booking per hour, decision D40) and WAIT-01 (court slot waitlist, F08 owns it, decision D44). `requirements.md` still lists BOOK-01 to BOOK-05 and its open questions as open. The spec drafter should bring it in line with the hand-off and the decisions below; this design treats D39 to D52 as the answers.

Shared decisions are in `docs/architecture/foundation.md` (revision 7), cited as **FA §n**; F01's design as **F01 §n**; F02's as **F02 §n**.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| BOOK-01 (hours, window, past) | §4.2 validation; §5 `schedule`; D39, D42 |
| BOOK-02 (rich menu tile) | §5.1 (C4 is a public page); F02 §6.3 for the link |
| BOOK-03 (hold) | §4.3 `reserve_court`; §4.5 `release_hold`; §6 jobs; D43, D46, D47, D52 |
| BOOK-04 (no double booking) | §3.3 `occupancy` rules; §4.3; §9 tests; D18, D19, D48 |
| BOOK-05 (future hours limit) | §4.4; D49 |
| BOOK-06 (one order, one booking per hour) | §3.2; §4.3; D40, D41 |
| WAIT-01 (court slot waitlist) | §4.7 hooks only; F08 owns it; D44 |
| CC-1 to CC-6 | §10 |

## 2. What this design does not build

Checkout, pricing, add-ons and promo codes (F04, which calls `reserve_court` from its Pay route); Beam and the late payment decision (F05, which calls `reclaim_order`); credits and the wallet (F06, which registers a release handler); the coach picker and coach rules (F07; F03 holds the coach and calls F07's check); the waitlist (F08); cancellation, no show and closures (F09; F03 gives them `release_hold`); LINE messages (F10; F03 enqueues outbox rows); the screens A1 and A2 (F11). F03 supplies the booking record up to Confirmed, the claim, the schedule and the hold.

## 3. Data and migrations

### 3.1 Migration order

F03 uses numbers 0201 to 0206, after F01 (0001 to 0009) and F02 (0101 to 0103). Rules and conventions are FA §2.1.

| File | Contents |
|---|---|
| `0201_orders_shell.sql` | `orders` shell (id, club, customer, source, status, `is_test`, created_at). F04 adds pricing columns and `order_line` in its own migration; the shell exists now because a booking needs its order (decision D40) |
| `0202_booking.sql` | `booking`, indexes, CHECKs, statuses |
| `0203_occupancy.sql` | `occupancy` exactly as FA §3.1 with the one-hour CHECK tightened (below), the two exclusion constraints, indexes |
| `0204_functions.sql` | `app.reserve_court`, `app.release_hold`, `app.reclaim_order`, `app.confirm_booking`, `app.move_booking`, `app.future_hours`, `app.hold_minutes`, `app.release_handlers` registry |
| `0205_public_views.sql` | `public_slot_state`, `public_day_state` |
| `0206_grants_policies.sql` | Policies and grants for the tables and views above |

Each file is registered in `packages/db/table-classes.ts` (class D), `app.test_tables` (F01 §7.6) and the audit registry (FA §8.1). CI checks from F01 §3.1 apply.

### 3.2 Tables

**`orders` (shell).** `id`, `club_id`, `customer_id`, `source` (`online` or `staff`), `status` (`open`, `paid`, `released`, `cancelled`; F04 owns transitions after `open`), `is_test`, `created_at`. `unique (club_id, id)`. One order holds one court selection of one or more hours (D40). The order is also the unit that gets one receipt (F13).

**`booking`** (D). One row per booked hour:

| Column | Notes |
|---|---|
| `id`, `club_id`, `order_id` | composite FK `(club_id, order_id)` to `orders` |
| `type` | `court`, `solo_class`, `class_seat`; F03 writes `court` and, when a coach is held, `solo_class` (F07 owns the coach rules) |
| `resource_id`, `coach_id` (null for a court only booking) | composite FKs; for `class_seat` the resource is the class's court (F08) |
| `start_at`, `end_at` | `timestamptz`; CHECK `end_at - start_at = interval '1 hour'` and the start is on the hour in Bangkok |
| `customer_id` | composite FK to `app_user`; null only for a staff walk-in without a customer record |
| `status` | `awaiting_payment`, `confirmed`, `released`, `cancelled`, `no_show`, `late_cancelled`. F03 writes the first three; F09 writes the rest |
| `source` | `online` or `staff` (A1 colours) |
| `created_by` | the user (player or staff) |
| `hold_expires_at` | set at creation from the hold setting at that moment and never changed (decision D46); null once confirmed |
| `release_reason` | `expired`, `player`, `closed`, `staff` when status is `released` |
| `override_reason` | the written reason when staff exceeded the future-hours limit (D49) |
| `confirmed_at`, `released_at`, `is_test`, `created_at`, `updated_at` | |

Indexes (all lead with `club_id` except the partial one): `(club_id, customer_id, start_at desc)`; `(club_id, start_at)`; `(club_id, order_id)`; partial `(hold_expires_at) where status = 'awaiting_payment'` for the release job; `(club_id, customer_id) where status in ('awaiting_payment','confirmed')` for the limit count.

**`occupancy`** is FA §3.1. F03's migration tightens its hour check to one hour per row for every non-closure kind: `check (kind = 'closure' or end_at - start_at = interval '1 hour')`, because a selection is one row per hour (FA §3.1). A held row has `hold_expires_at`; a confirmed row has none. The exclusion constraints on resource and on coach are the uniqueness rule (BOOK-04-AC1, AC2).

**Public views** (class D views, readable by `booq_app` for every role including guests):
- `public_slot_state (club_id, resource_id, start_at, state)`, where `state` is `held`, `taken` or `closed`. It reads `occupancy` and closures, drops held rows whose `hold_expires_at <= now()` (BOOK-03-AC6), exposes **no** booking id, customer, coach or order, and is `security_barrier` with the tenant filter and the club-visibility rule (live or paused clubs for guests; Draft and Testing only for testers) built in.
- `public_day_state (club_id, resource_id, day, open_hours)`, the count of open hours per court per day, for the date strip and the Day full state (BOOK-01-AC14).
- "My booking" is not in the views: the schedule query joins `booking` by `customer_id = app.user_id()` for a signed in player.

### 3.3 The uniqueness rule, in short

FA §3 is the design. For F03 this means: every hour of a court booking (and the coach, when held) is one `occupancy` row; two exclusion constraints reject an overlap on the resource and on the coach, so both court and coach are claimed in one `INSERT` or neither (BOOK-04-AC3); a released, cancelled or expired booking has no `occupancy` row, so it never counts (AC6); a selection of several hours is inserted together in one transaction, so a clash on one hour rolls back the whole selection (AC5, D40).

## 4. Behaviour

### 4.1 Settings F03 reads (from F01's registry, never typed in code)

`hold_minutes` (10, 15 or 20; decision D52: F03 only reads it through `app.hold_minutes(club)`, and F16 will make that function return 60 in backup mode), `booking_window_days`, `max_future_court_hours` (empty means no limit), the opening hours of each weekday, the resource `active` flag.

### 4.2 Validation order in `reserve_court`

All checks run on the server inside the transaction. In order:

1. **Context.** A signed in user (BOOK-03-AC2: a guest or signed out session is refused, F02 AUTH-01-AC3). The club's status: Live allows everyone; Testing allows testers only; Draft refuses; **Paused refuses everyone, staff included** (assumption A-2); the refusal is `club_paused` or `club_not_available`.
2. **Hold setting present.** An empty `hold_minutes` (Blank template) refuses payment holds with `hold_setting_unset` (BOOK-03-AC3); a booking that needs no payment (PAY-07) does not need it.
3. **Selection shape (BOOK-01-AC1, AC2, AC11, BOOK-06).** One court, one or more hours, each on the hour in Bangkok, each exactly one hour, consecutive with no gap, all on the same Bangkok date. There is no separate maximum (D41); the selection is bounded by that day's opening hours.
4. **Opening hours (AC3).** Each hour lies inside the opening hours of its own weekday; 23:00 is the last start and 24:00 is never a start (D39).
5. **Window (AC4, decision D42).** The Bangkok date of every hour is at most today plus `booking_window_days`, inclusive: day 30 is bookable, day 31 is refused. The window changes at Bangkok midnight (BOOK-01-AC12).
6. **Past and started hours (AC5, decision D39).** A **player** may book only an hour whose start is after the current moment (`start_at > now()`), so the hour that has already started cannot be booked. **Staff** may book an hour that has started but not ended (`end_at > now()`) for a walk in. An hour that has ended is refused for everyone.
7. **Resource (AC9).** The resource belongs to the club and is active.
8. **Future-hours limit** (§4.4).
9. **Coach, if one is given.** The coach row is locked, then F07's check runs (availability, leave, the rest rule under D19: back-to-back hours only, a free hour resets, unpaid held hours count, a group class counts until cancelled). Until F07 ships, a request with a coach is refused with `coach_rules_not_installed`, so a coach can never be held without the rules (assumption A-8).
10. **Release overlapping expired holds** (FA §3.2, `release_hold`), then **insert** the booking rows and the `occupancy` rows, one pair per hour, in one transaction. An exclusion violation (`23P01`) rolls everything back and returns `slot_unavailable` with `by` set to `resource` or `coach`. The message never says who holds the slot (BOOK-04 Meets).

Typed codes returned: `sign_in_required`, `club_paused`, `club_not_available`, `hold_setting_unset`, `not_on_the_hour`, `not_consecutive`, `outside_hours`, `outside_window`, `in_the_past`, `hour_started`, `resource_inactive`, `limit_reached` (with `hours`), `slot_unavailable` (with `by`), `coach_unavailable`, `rest_rule`, `coach_rules_not_installed`. Every code maps to a locale key (§11); no text is built in code.

### 4.3 The functions

`app.reserve_court(order, customer, resource, start_hours[], coach, source, confirm_now, override_reason)` returns the order id, the booking ids and `hold_expires_at`.

- `confirm_now = false` (a payment is due): bookings are `awaiting_payment`, `occupancy` rows are `held`, and `hold_expires_at = now() + hold_minutes` for every hour of the order (the same instant, so the whole order expires together). A **staff** booking that is awaiting payment holds the slot the same way for the same time (decision D43).
- `confirm_now = true` (nothing left to pay, PAY-07, or staff cash): bookings are `confirmed` and `occupancy` rows `confirmed` in the same transaction; the slot is still checked and claimed (BOOK-03-AC9).
- **Second tap (decision D47, BOOK-03-AC15).** Before claiming, the function looks for the caller's own live `awaiting_payment` order with the identical selection (court, hours, coach). If found it returns that order and its original `hold_expires_at` and creates nothing, so a second tap, or a second device, gets the same hold and the same QR (F05 returns the stored QR for the payment). The `Idempotency-Key` header protects the exact same request in parallel; this lookup protects the same intent from a new request.
- **Orders and receipts.** One `orders` row per call (D40). The receipt is one per order (F13).

`app.confirm_booking(order)` (used by F04 and F05 on payment): in one transaction, for every booking of the order, `awaiting_payment` to `confirmed`, `occupancy` to `confirmed`, hold cleared. It is guarded by `UPDATE ... WHERE status = 'awaiting_payment'` and a row count, and it takes the lock order of FA §3.4, so it and `release_hold` cannot both win (BOOK-04-AC8).

`app.reclaim_order(order)` (used by F05 for a late payment): re-inserts the `occupancy` rows for the order's released bookings and nothing else. It does **not** repeat the window, limit or hour checks, because the player already paid; it asks only whether the slot is still open, which is exactly the constraints (no other hold, booking or closure; for a solo class court and coach both free), decision D25. On success it confirms the order; on a constraint failure it raises `slot_unavailable` and F05 sends the whole amount to the wallet (FA §6.6). Nothing partial is ever left (BOOK-03-AC8).

`app.move_booking(booking, resource, start_at, by_staff)` (A1 drag, A2): updates the booking and its `occupancy` row in place. The exclusion constraints re-check the move (BOOK-04-AC7), the coach rules run when a coach is held, and a message to the customer is enqueued (a new L key). Staff only.

### 4.4 Future hours limit (BOOK-05, decision D49)

`app.future_hours(club, customer)` counts every hour of the customer with status `awaiting_payment` (hold not expired) or `confirmed`, type `court` or `solo_class`, with `end_at > now()`. That is the player's confirmed, bundle paid, solo class and unpaid held hours, and **staff made bookings count** (D49). Group class seats are not in the list and are not counted (assumption A-1). A played or past hour is not counted (BOOK-05-AC5).

- The check runs **inside the booking transaction** after taking the customer's advisory lock (FA §3.4 step 0), so two parallel requests from one player at N minus 1 held hours let exactly one through (BOOK-05-AC4).
- If `max_future_court_hours` is unset, there is no limit and no default (AC1). If set to N, a request that would bring the total over N, including a multi hour selection, is refused whole with `limit_reached{hours: N}` (AC2, AC3).
- **Staff override (D49).** Front desk and owner may exceed the limit by giving a written reason; the reason is stored in `booking.override_reason`, written to the audit log, and required by the function whenever the limit would be exceeded by staff. A player cannot override.
- Changing the setting is an audited settings change (F01); existing bookings are untouched (AC6).

### 4.5 Releasing a hold

`app.release_hold(booking, reason)` is the only way a hold ends without payment. It locks the order's bookings in id order, re-checks the status under the lock, and for an order whose holds are still `awaiting_payment`: sets `released` with `release_reason`, deletes the `occupancy` rows, and calls every handler in `app.release_handlers` (F06 reverses reserved credit and wallet; F08 starts `waitlist_advance`; F10 receives the outbox message). It is called by:

- the `hold_release` job when `hold_expires_at <= now()` (§6);
- `reserve_court` itself, lazily, for an expired hold that overlaps a new request (FA §3.2), so a late job blocks nobody;
- the player cancelling a hold from C11 (reason `player`);
- F09 when a closure covers a held slot (decision D48): the hold is cancelled, the player is told with the club closed message, and a later payment follows PAY-03, which fails the reclaim and sends the value to the wallet;
- staff abandoning an awaiting booking (reason `staff`).

**The message (decision D45).** "Booking released" is sent to every club whatever its payment option, once per order (outbox `dedupe_key` `released:{order_id}`), not once per hour, and not when the reason is `closed` (the closure message replaces it). A known non friend gets no push (FA §5.3).

### 4.6 Slot states

The schedule computes seven states per court and hour, each with a text label and an icon as well as a colour (BOOK-01-AC7):

| State | Source |
|---|---|
| Open | No `occupancy`, inside opening hours, not past (and not started, for a player) |
| Selected | Client only |
| Held | `public_slot_state = held` (live hold) |
| Taken | `public_slot_state = taken` |
| Closed | Closure, or outside opening hours inside the day |
| Past | The hour has started (player) or ended (staff view) |
| My booking | The signed in player's own live booking (joined by customer) |

`waitlist` is a boolean beside Taken and Day full: the app shows Join waitlist when it is true. The waitlist itself is F08's (decision D44, WAIT-01).

### 4.7 Hooks F03 offers to later features

| Hook | For |
|---|---|
| `app.release_handlers` | F06 reverse credit and wallet reserve; F08 waitlist advance; F10 released message |
| `app.coach_rules_check` | F07 coach availability, leave, rest rule |
| `reserve_court` and `confirm_booking` | F04 Pay route and PAY-07 |
| `reclaim_order` | F05 late payment |
| `release_hold(reason)` | F09 closures and cancellations |
| `app.count_live_occupancy(club, resource, window)` | The F01 routes that change opening hours or deactivate a court: they are refused while live occupancy falls outside the new hours or on the court (decision D50); the owner uses a closure instead |

## 5. API routes (prefix `/api/c/{slug}`)

Conventions as FA §9: typed codes, no text, no club id in a body, 404 for out of reach, `Idempotency-Key` on mutating routes.

### 5.1 Public (no session)

| Method and path | Purpose |
|---|---|
| `GET /courts` | Active courts with sport labels and the opening hours of the weekdays in the window; the booking window value |
| `GET /schedule/days?from=&to=` | Per court and day, the open hour count, for the date strip and Day full |
| `GET /schedule?date=YYYY-MM-DD` | Per court and hour: the state of §4.6, `waitlist`, and for a signed in player `mine`. No ids, names or counts of who. One query over `public_slot_state` plus the opening hours. Returns `Cache-Control: no-store` |

C4 is a public page, so the rich menu tile opens it as a guest (BOOK-02-AC1, AC2, AC5); the link carries the club (F02 §6.3, BOOK-02-AC3). A paused club shows C4 as paused (BOOK-02-AC4).

### 5.2 Player

There is no player route that creates a hold on its own. The only way a player creates one is **Pay** in checkout (F04), which prices the order and calls `reserve_court` in the same transaction as the order and payment rows (FA §6.4). This keeps a hold from existing without a price.

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /bookings/{id}` | player (own), staff | One booking for C12 and the countdown; includes `hold_expires_at` and status |
| `POST /bookings/{id}/release` | player (own, `awaiting_payment` only) | The player leaves C11; reason `player` |

The page that watches for confirmation (the polling or push on C11) belongs to F05.

### 5.3 Staff (A1, A2 screens are F11)

| Method and path | Permission | Purpose |
|---|---|---|
| `POST /staff/bookings` | `booking.create.staff` (front desk, owner) | Walk in or booking for a player: court, hours, customer or walk in, `confirm_now` for cash or credit (payment itself is F04), or awaiting payment with the same hold (D43); `overrideReason` when over the limit |
| `PUT /staff/bookings/{id}/move` | `booking.move` | Move to another court or time; conflicts refused; customer messaged |
| `POST /staff/bookings/{id}/release` | `booking.create.staff` | Abandon an awaiting booking |

The accountant has read access to bookings by names only (decision D35) through the reports (F13). The coach sees only their own sessions (F12).

## 6. Jobs

`hold_release` (FA §5.4), owned here: every 15 to 30 seconds it selects `awaiting_payment` bookings with `hold_expires_at <= now()` in batches, groups them by order, and calls `release_hold(order, 'expired')` per order, each in its own club-context transaction. The selection uses the partial index. Correctness never depends on it (BOOK-03-AC6). The job reports its lag to the heartbeat table; P1 health alerts when the lag passes a threshold set in platform config.

Reminders and other messages are created by F10 from `confirm_booking`. Nothing else in F03 is scheduled.

## 7. State machine

| From | To | Trigger | Who |
|---|---|---|---|
| (none) | `awaiting_payment` | `reserve_court` with a payment due | Player (via Pay), staff |
| (none) | `confirmed` | `reserve_court` with `confirm_now` | Player (nothing due), staff |
| `awaiting_payment` | `confirmed` | `confirm_booking` on a verified payment inside the hold | F04, F05 |
| `awaiting_payment` | `released` | Expiry, player leaves, closure, staff | job, player, F09, staff |
| `released` | `confirmed` | `reclaim_order` on a late payment when the slot is still open | F05 |
| `confirmed` | `cancelled`, `no_show`, `late_cancelled` | F09 | F09 |

The hold and the booking are one fact: `occupancy.state = held` exactly while the booking is `awaiting_payment` and the hold has not ended. Nothing else changes `occupancy`.

## 8. Permission checks

| Permission | Guest | Player | Coach | Front desk | Accountant | Owner |
|---|---|---|---|---|---|---|
| `schedule.read` | yes | yes | yes | yes | yes | yes |
| `booking.hold` (through checkout) | no | yes | yes (as a player) | yes (as a player) | yes (as a player) | yes (as a player) |
| `booking.read.own` | | yes | yes | yes | yes | yes |
| `booking.read.all` | | | own sessions (F12) | yes | names only (D35) | yes |
| `booking.create.staff`, `booking.move` | | | | yes | | yes |
| `booking.limit.override` | | | | yes | | yes |

A person with several roles gets the union (ROLE-01). Staff booking as a player pays as a player and is held as a player (ROLE-01-AC4). Row policies follow FA §4.3: the tenant policy on every table, player sees own rows, staff see the club's, guests only the public views. BOOQ staff have no grant on any F03 table.

## 9. Tests (written first at the build step)

Real Postgres, controllable clock (decision D30). The shared tests T1 to T15 of FA §3.7 are the core; F03 adds the following.

| Test | Covers |
|---|---|
| Two parallel requests, same court and hour: exactly one succeeds | BOOK-04-AC1 |
| 20 parallel requests, one slot: one success, 19 refused, no half created rows | BOOK-04-AC12 |
| Two parallel requests for the same coach on different courts: one success; the loser leaves nothing on its court | BOOK-04-AC2, AC3 |
| A three hour selection where hour two is taken: nothing is booked, no `occupancy` row for hours one and three | BOOK-04-AC5, BOOK-06 |
| A two hour selection: two bookings, two `occupancy` rows, one order; cancelling one hour leaves the other | BOOK-06, D40 |
| 18:30, 18:01, a 90 minute request, and two hours with a gap: refused by the server and by the database CHECK | BOOK-01-AC1, AC2, AC11 |
| 23:00 accepted; 24:00 never a start; a start before opening refused | BOOK-01-AC3, D39 |
| Day 30 accepted, day 31 refused, at 23:59 and 00:01 Bangkok (controllable clock) | BOOK-01-AC4, AC12, D42 |
| At 18:10: a player cannot book 18:00; staff can; at 19:00 nobody can book 18:00 | BOOK-01-AC5, D39 |
| An inactive court, a Draft club for a non tester, a Paused club: refused (staff too when Paused) | BOOK-01-AC9, AC10 |
| A guest and a signed out session: hold refused; Continue creates nothing | BOOK-03-AC2 |
| Hold ends at now plus the setting; changing the setting afterward leaves an existing hold's end time | BOOK-03-AC1, D46 |
| Hold setting unset: payment hold refused; PAY-07 booking still works | BOOK-03-AC3, AC9 |
| Expired hold, job not run: the next request succeeds and the old booking ends `released` | BOOK-03-AC6, FA T8 |
| Callback and expiry at the same instant: exactly one outcome | BOOK-04-AC8, FA T10 |
| Late payment: slot open reclaims and confirms; slot taken or closed raises `slot_unavailable`; a solo class with the coach busy raises it too | BOOK-03-AC7, AC8, D25 |
| A second Pay tap, and a tap on a second device: the same order and the same `hold_expires_at`, no second hold | BOOK-03-AC15, D47 |
| Staff booking awaiting payment holds for the hold time; walk in on a started hour | D43, D39 |
| Closure over a held slot: the hold is released with reason `closed`, one closure message, no released message; later payment follows PAY-03 | BOOK-04-AC9, D48 |
| Booking released message: sent for a Beam club and a slip club, once per order | D45 |
| Limit unset: no limit. Limit N: N allowed, N plus 1 refused whole; unpaid held, bundle paid and solo class hours count; group seats do not; played hours do not | BOOK-05-AC1 to AC5, D49 |
| Two parallel requests at N minus 1: exactly one succeeds | BOOK-05-AC4 |
| Staff over the limit without a reason refused; with a reason allowed and audited | D49 |
| Hours or court changes with live bookings: refused, with the closure hint | D50 |
| Guest schedule response contains no booking id, customer or coach; a snapshot test fails if a field is added | BOOK-01-AC6, CC-3 |
| A club's bookings are invisible to another club and cannot collide with them | BOOK-04-AC11, CC-1 |
| Grid under 2 seconds on a throttled 4G profile with a full month of seeded bookings; loading and offline states render | BOOK-01-AC13 |
| Static: no hard coded text, the number of minutes and days are variables | CC-5 |

## 10. How the cross-cutting rules are met

- **Club ID scope (CC-1):** every F03 table has `club_id` and composite keys; the exclusion constraints are per resource and coach, which belong to one club; the views carry the tenant filter; the club comes from the URL and the session (F02 §6.3).
- **Server permissions (CC-2):** §8 plus the checks of §4.2 inside the function; a guest can read the schedule and nothing else.
- **PDPA (CC-3):** the schedule and the refusals never say who holds a slot; the views drop all identity; the booking record is club data that BOOQ staff cannot read (class D, no platform grant); a deletion request anonymises the user and leaves booking rows under a pseudonymous id (F01 §7.7).
- **No double booking (CC-4):** FA §3 and §3.3 above; tests in §9.
- **TEXT (CC-5):** every refusal, state label and message is a locale key (§11); numbers that are club settings (`{days}`, `{minutes}`, `{hours}`) are named variables, replacing the fixed numbers in the canvas lines (Gaps A5).
- **Other (CC-6):** Bangkok dates and the day change; satang (F04); 60 minute hours enforced by CHECK; no setting invented.

## 11. Text keys and canvas boards

**Existing keys:** P-0327 and P-0328 (offline error and Try again), P-0442 (paused). Others are found by the content role from `copy-index.csv` (D31).

**New keys proposed by the drafter (decision D51; writers own the wording; both languages; numbers assigned by the content role).** One key per refusal code, each with the named variables shown:
- `P-new` slot no longer available (court taken); the same for a coach no longer available; no variable.
- `P-new` limit reached, `{hours}`.
- `P-new` the hours must be consecutive on one court; this hour has already started; this date is beyond the booking window, `{days}`; the club is not open at that time; the court is not available.
- `P-new` Time ran out text if S-C11-Time-ran-out has no key; hold countdown uses `{minutes}`.
- `P-new` the replacements for the fixed numbers in the C9c, C10P, C11 and C16 lines (Gaps A5), with `{minutes}`, `{days}`.
- `L-new` Booking released, with `{minutes}` only if the number is shown; Booking moved by the club (A1 move), with `{court}`, `{date}`, `{time}`.
- `A-new` the override reason prompt and the over-the-limit notice for staff, with `{hours}`.

**Canvas boards used:** H-C04-Book-a-court and T-, S-C04-Day-full and T-, S-C04-Loading and T-, G-C04-Waitlist-joined (F08), S-C11-Time-ran-out and T-, S-Error-Offline and T-, S-C03-Paused and T-, H-C10-Checkout (F04), H-C11-Beam (F05), H-C12-Confirmed, L-Rich-menu, F1-02-C04-Book-a-court, and the A1 and A2 boards (F11). No board exists for the refusal messages (D51 covers the keys; the player-facing layout follows the existing error component).

## 12. Assumptions approved with this design (to be confirmed on approval)

| Id | Assumption |
|---|---|
| A-1 | Group class seats do not count toward the future court hours limit (D49 lists confirmed, bundle, solo and unpaid held hours) |
| A-2 | A Paused club refuses new holds from staff as well as players (PLAT-03 says "new booking and buying off") |
| A-3 | There is no player route that holds a slot without Pay. A bad actor can still hold slots by repeating Pay while `max_future_court_hours` is empty. A per-player rate limit is proposed as a platform config value, **no value invented here**; Security to decide whether the limit is needed before launch |
| A-4 | The `orders` shell is created in F03 and extended by F04; F04's design must agree with its columns |
| A-5 | Moving a booking sends a customer message through a new L key (the PRD front desk rules say the customer is messaged) |
| A-6 | A player cancelling a hold from C11 releases it at once with reason `player` |
| A-7 | `reclaim_order` skips the window, limit and hour checks because the player already paid |
| A-8 | Until F07 ships, a request with a coach is refused (`coach_rules_not_installed`) |
| A-9 | The hold release job batches by order so one order's hours release together |
| A-10 | "Future" for the limit means the hour has not ended (`end_at > now()`) |

## 13. Not decided here

F16's 60 minute backup hold (D52, F16 sets it); the court waitlist and its screens (F08, D44); pricing and the Pay route (F04); the late payment application (F05); closure creation and the player cancel sheet (F09). The wording of the new keys (writers, D51).
