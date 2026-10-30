# F09 Cancellation and closures · Design

Status: **Approved 30 Oct 2026 (gate 2, D155).** The answers D158 are folded in. Drafted 30 Oct 2026 from the approved F09 requirements (`requirements.md`, approved 30 Oct 2026, D107, D111, D118 applied). A change to anything below goes through the PRD, then the hand-off, then this file. Tasks (gate 3) follow approval.

Feature: F09 Cancellation and closures. Requirement IDs: CANCEL-01 to CANCEL-04. Depends on F03, F04, F05, F06 and F10. Wave 3.

Shared decisions are in `docs/architecture/foundation.md`, cited as **FA §n**; the other designs as **F03 §n**, **F04 §n**, **F06 §n**, **F10 §n**. FA §3.4 fixes the lock order every function here follows, FA §2.3 the ledger rules, FA §5.4 the jobs. F03 owns `booking`, `occupancy`, `release_hold` and the release handlers; F04 owns the order, its lines and their stored allocation; F06 owns every ledger write; F10 sends the messages. F09 owns the decision (what returns, what is forfeited), the cancel record, the closure and the staff marks. It writes no ledger row itself: it calls F06.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| CANCEL-01 (return in time, forfeit late, sheet states the outcome) | §4.1 outcome; §4.2 `cancel_booking`; §5 routes; §6 states |
| CANCEL-02 (no cash, ever) | §4.4; §9 route inventory test |
| CANCEL-03 (closures) | §3.2 tables; §4.6 to §4.8; §8 jobs |
| CANCEL-04 (played, no show, late cancel, reversal) | §3.3 derived Played; §4.5 marks |
| CC-1 to CC-6 | §11 |

## 2. What this design does not build

The ledger rows (F06), the order and price (F04), Beam and the late payment decision (F05), the waitlist offer and class session cancel (F08), the coach rules and substitution (F07), the messages' sending and wording (F10), the A2 and A12 pages (F11), the referral reward (F14), coach pay amounts (F12, F13), a check in of any kind (removed, Gaps A1), any refund of money (CANCEL-02).

## 3. Data and migrations

F09 uses the number block 1001 to 1099 (assumption A-1: the build plan names blocks only up to F06 and F10 and F13 took 0601 and 0701; the Architect confirms that four digit numbers order correctly in `migrate.ts` and `tools/check-migrations.mjs`, which today accept every number from 0501 up). One file per task; numbers rise in the order tasks merge.

| File | Contents |
|---|---|
| `1001_booking_cancel.sql` | `booking_cancel` (append-only), the `booking_state` view (derived Played, §3.3) |
| `1002_closure.sql` | `closure`, `closure_resource`; the foreign key from `occupancy.closure_id` (FA §3.1) |
| `1003_cancel_handlers.sql` | The registry `app.cancel_handlers (ord, handler)` for features that react to a cancel (§4.3) |
| `1004_cancel_outcome.sql` | `app.cancel_outcome` (in time, late or full value; reads F07's `coach_was_changed` and F08's edited session flag for the free cancel) |
| `1005_return_value.sql` | `app.return_booking_value(booking, kind)`: the credit, wallet and money returns (§4.2 step 3), also called by F08's `cancel_session` |
| `1006_cancel_booking.sql` | `app.cancel_booking` and its helpers |
| `1007_staff_marks.sql` | `app.mark_no_show`, `app.mark_late_cancel`, `app.reverse_mark` |
| `1008_closure_functions.sql` | `app.closure_preview`, `app.create_closure`, `app.end_closure`, `app.roll_closures` |
| `1009_grants_policies.sql` | Policies, grants, executable-by lists, the table class registry entries |

No settings rows: `cancel_window_hours` already exists (F01 §10, unset not allowed, Hunter 12). The no show timing setting is not added (Q1).

### 3.1 `booking_cancel` (class D, append only)

One row per cancel, mark or reversal; the booking row keeps only its status.

`club_id`, `id`, `booking_id`, `order_id`, `kind` (`player_cancel`, `staff_cancel`, `club_cancel`, `closure`, `late_cancel_mark`, `no_show_mark`, `reversal`), `outcome` (`returned` or `forfeited`), `version integer` (1 for the first row of a booking, one more for each later row), `returned jsonb` (credits per package, wallet satang, money satang sent to the wallet, per line; ids and numbers only), `credit_lost boolean` (a credit lost after package expiry, D85), `reason text` (staff reason, required for every staff kind; null for a player cancel), `by_user`, `closure_id` null, `created_at`, `is_test`. `unique (club_id, booking_id, version)` makes a repeated call a no-op. Append-only like the ledgers: `revoke update, delete, truncate`, trigger, FORCE RLS, CI test (FA §2.3). `reason` is never selected by a player route (CC-3).

### 3.2 Closures (class D)

`closure` (the definition): `club_id`, `id`, `reason`, `range_start`, `range_end` (timestamptz, any minute range, Bangkok wall clock when entered), `repeat_rule jsonb` null (`weekly` on named weekdays or `daily`, with an optional `until`; never typed values in code), `status` (`active`, `ended`), `created_by`, `created_at`, `ended_by`, `ended_at`, `is_test`. `closure_resource (club_id, closure_id, resource_id)` names the courts.

The slots are `occupancy` rows of kind `closure` (FA §3.1: `closure_id` set, no coach, any range), one per court per occurrence; they carry the exclusion constraint, so a closed range can never overlap a booking or a hold. A repeat closure holds occurrence rows only as far as the booking window reaches (CANCEL-03-AC9, §8 `closure_roll`).

### 3.3 Played is derived, not stored (assumption A-2, FA §5.4)

FA §5.4 (`session_end`) says Played is a derived status. F03 §3 lists `confirmed`, `cancelled`, `no_show`, `late_cancelled` and has no `played`. The view `booking_state(club_id, booking_id, state)` returns `played` when `status = 'confirmed'` and `end_at <= app.now()`, otherwise the stored status. Because it is a predicate of time, a late job never leaves a finished booking unplayed and never marks a cancelled one (CANCEL-04-AC1, AC2). Player and staff screens, F13 reports and F14's referral rule read the view; a reversed No show returns to `confirmed`, which reads as Played once the slot has ended (AC5, AC11). The requirement's "a job sets Played" is met by this view; the `session_end` sweep of FA §5.4 stays only as the referral evaluation, owned by F14.

## 4. Behaviour

All functions are `SECURITY DEFINER` with a fixed search path, take the club from `app.club_id()`, check the caller's right inside, write the audit entry in the same transaction for staff action (PLAT-04), and follow the lock order of FA §3.4: customer advisory lock, coach row, `wallet_account` and `customer_package` rows in id order, then the `booking` and `class_session` rows in id order. The functions first read the order lines without locks to learn which packages and which customer are involved, take the locks in that order, then re-read under the locks.

### 4.1 The outcome (one function for the sheet and the cancel)

`app.cancel_outcome(booking, by_staff boolean, club_cancel boolean) returns jsonb` is read only and is the only place the rule lives, so the sheet (CANCEL-01-AC1) and the cancel always agree.

- **In time** when `start_at - app.now() >= cancel_window_hours * interval '1 hour'`, in Bangkok time with seconds (AC2: exactly 12:00:00 is in time, 11:59:59 is late). The setting is read from the club's settings; an hours value of 0 means in time until the start.
- **Always in full** whatever the time for: a closure (CANCEL-03-AC2), a staff `club_cancel` (AC20), a solo class whose coach was changed by the club (F07, AC18, read from F07's substitution record), and an abandoned hold (a release, not a cancel, AC16, §4.2).
- **Refused** when `start_at <= now()` for a player (AC15); staff may mark after the slot (§4.5) but not cancel a started booking.
- **What returns, per order line linked to the booking** (court hour line, coach line, add-ons on the first hour, D111): the stored allocation of the line, never a recomputation.
  - credit part (`credit_package_id`, `credit_units`): back to the same package;
  - wallet part (`wallet_satang`): back to the wallet;
  - money part (`money_satang`, Beam or cash): into the wallet with reason `refund` (AC4, CANCEL-02-AC5).
  The line's `net_satang` is already net of its discount share, so a partial cancel returns exactly the money of that hour net of its share (D111, AC23); an add-on returns only with the first hour. A solo credit covers the coaching line only (F06 R1-AC10) because the coach line carries its own allocation.
- **Late or forfeited:** credit parts and money are forfeited; a wallet part is also forfeited (it was spent on the booking, AC10; assumption A-3). The outcome says which, and says "credit lost" for a credit that cannot return because its package expired and the player cancels after expiry (D85, AC11). A closure or a club cancel never loses a credit (F06 §4.2, CANCEL-03-AC12).
- The result is `{ outcome, lines: [{ line, credits, walletSatang, moneyToWalletSatang }], creditLost, forfeited, codeRestore }` with no text; the screen builds the wording from keys.

### 4.2 `app.cancel_booking(booking, by_staff, club_cancel, reason, closure null)`

One transaction, called by the player route, the staff route and the closure. It:

1. loads the booking, takes the locks in FA §3.4 order, re-reads the status under the lock. Only `confirmed` can be cancelled; any other status returns the existing `booking_cancel` row for that booking (second tap, two devices, AC14) or refuses (`cancel:not_confirmed`). An `awaiting_payment` booking is not cancelled here: the player's abandon calls F03 `release_hold(booking, 'player')`, which returns reservations in full through the release handlers (AC16, F04 R7-AC6).
2. computes the outcome (§4.1) under the locks.
3. **In time or full value** (one function, `app.return_booking_value(booking, kind)`, which F08's `cancel_session` also calls for each seat of a cancelled session): per line, `app.credit_return(booking, reason)` for the credit parts, `app.wallet_return_line(order_line, reason)` (D158) for the wallet parts and `app.wallet_credit(customer, money_satang, 'refund', ref, ...)` for the money part, each with the dedupe keys of §4.4. **Late:** `app.credit_forfeit(booking, null, null)` for a credit; nothing else is written for money. No row is written by hand.
4. sets `booking.status` to `cancelled` (in time or full) or `late_cancelled` (late); deletes the booking's `occupancy` row (court and coach together, so a solo class frees both, CC-4); `restore_line` of F04 reports the stored parts and restores the promo code use and the birthday entitlement only when the last live line of the order is cancelled (D67, AC8); the partner redemption count follows (D70); sets the order `cancelled` when every line is cancelled.
5. inserts the `booking_cancel` row (version, outcome, returned, reason).
6. calls every handler in `app.cancel_handlers` for the booking, in `ord` order (§4.3), and enqueues the messages with `app.enqueue_message` (§4.9). All of it commits together or not at all (AC22, PKG-01-AC6).
7. A cancel of a class seat or a solo class also calls the F08 and F07 handlers (waitlist advance in the same transaction, AC13, AC17; coach told, AC19).

Cancelling one hour of a two hour order frees only that hour (BOOK-06, AC9): the other bookings and their lines are untouched.

### 4.3 The registry `app.cancel_handlers`

Same pattern as `app.release_handlers` (F03 §4.5): `(ord, handler regprocedure)`, each called as `handler(club, booking, kind)` inside the cancel transaction. `ord` rule: F07 20 (the coach is freed and told, substitution record), F08 30 (class seat and `waitlist_advance` enqueued in the same transaction, F08 §3.6), F14 40 (referral status re-read). Each handler is idempotent and added by its own feature; an unregistered handler is simply absent. Messages are not handlers: F09 enqueues them (§4.9). A handler failure rolls the cancel back; a message failure never does (CANCEL-03-AC15).

### 4.4 No cash (CANCEL-02) and the F06 calls, exactly

| F06 function | Called with | Dedupe key (F06 §4.1, §4.2) | Used for |
|---|---|---|---|
| `app.credit_return(booking, reason)` | `reason` `player_cancel`, `club_cancel` or `closure` | F06's `return:{reserve_id}` | credit back to its package; for `player_cancel` after expiry nothing is written and `credit_lost` is set (D85) |
| `app.wallet_return(order_id, reason)` | `reason` as above | F06's `return:{spend_id}` | wallet use back; **F06 returns all spend rows of an order**, but a one hour cancel needs only that hour's lines: assumption A-4 asks F06 for `app.wallet_return_line(order_line, reason)` |
| `app.wallet_credit(customer, amount, 'refund', ref, null, null)` | `ref` the order line and the cancel version | `refund:{order_line}:{version}` | money into the wallet; one call per line with a money part |
| `app.credit_forfeit(booking, staff, note)` | late cancel, no show | F06's forfeit key | forfeit row, change 0 |
| `app.credit_reverse_forfeit(booking, staff, note)` | reversal | F06's | a `return` row with the note, never an edit |

No receipt is issued for a refund to the wallet (D119, RCPT-01-AC16). There is no function, route, button or Beam call that sends money back: `refund` exists only as a wallet reason (CANCEL-02-AC1 to AC3). A route inventory test lists every route and admin action and fails if one refunds or withdraws; a Beam test double fails on any refund call (F05 PAY-05-AC3). The cancel sheet says wallet or credit and never cash (AC4); the text "Refunds go back by PromptPay" is not built.

### 4.5 Staff marks and reversal (CANCEL-04)

- `app.mark_no_show(booking, reason)`: front desk and owner; the booking is `confirmed` and **its slot has ended** (`end_at <= now()`, D118; before that the server refuses, AC6); reason required and not blank (AC3); sets `no_show`, calls `credit_forfeit`, writes a `booking_cancel` row kind `no_show_mark` with outcome `forfeited`; audited. The coach's Absent in K5 (F12) is only a hint shown on A2 and never calls this function (AC8).
- `app.mark_late_cancel(booking, reason)`: for a cancel made outside the app (AC4); the booking is `confirmed`; reason required; sets `late_cancelled`, forfeits as a late cancel and, when the slot has not started, deletes the `occupancy` row and calls the cancel handlers so a waitlist is offered the spot (CC-4); audited. Allowed only before the slot ends; after that staff use No show (assumption A-5).
- `app.reverse_mark(booking, reason)`: reason required; the latest `booking_cancel` row of the booking must be a `no_show_mark` or `late_cancel_mark`. For a no show: `credit_reverse_forfeit` writes a new `return` row and the status returns to `confirmed`, which reads as Played because the slot ended (AC5). For a late cancel the credit returns the same way, the status returns to `confirmed` and the `occupancy` row is claimed again with the usual exclusion constraints; if the slot has ended or the hour was taken meanwhile the reversal is refused (`reverse:slot_unavailable`) and staff correct the value with a wallet or credit `adjust` with a written reason (assumption A-6). A new `booking_cancel` row kind `reversal` records it with the next version. Coach pay changes by the normal rule (F13 R3) and a referral reward already paid stays paid (AC7). The mark and the reversal are audited with the reason (AC3, AC5).
- The no show timing setting is read nowhere yet (Q1); the rule built is D118's: marked only after the slot ends.

### 4.6 Closure preview (CANCEL-03-AC1)

`app.closure_preview(resources, range, repeat_rule)` is read only. It lists, for every occurrence inside the booking window (`booking_window_days`, F01), each `confirmed` booking and `awaiting_payment` hold overlapping the range on the named courts, the group class sessions and solo classes (F07, F08), the players' names (staff only, CC-3), the packages whose credit was reserved before expiry and has expired (AC12, listed so the owner can extend with a written reason, F06 PKG-03-AC5), and the count of played bookings it will not touch (AC8). It writes nothing.

### 4.7 Create a closure (CANCEL-03-AC2 to AC3, AC15, AC16)

`app.create_closure(resources, range, repeat_rule, reason)`: front desk and owner, in a Live or Paused club (AC13, D60), in one transaction for the whole closure (AC15):

1. take the locks in FA §3.4 order for every affected booking, bookings ascending by id.
2. for every affected `confirmed` booking whose slot has not ended: `cancel_booking(booking, true, true, reason, closure)` with kind `closure` (full value whatever the time; not applied to played bookings, AC8).
3. every affected hold: `release_hold(order, 'closed')` (F03 §4.5, D48); the Beam payment that arrives later fails the reclaim and its value goes to the wallet (PAY-03, F05 PAY-03, CANCEL-03-AC5); F03 sends no released message for the reason `closed`.
4. group class sessions in the range: the F08 handler cancels the session for everyone with full credit back and ends the waitlist entries (AC6); solo classes are bookings and take step 2, with the coach told by the F07 handler (AC7).
5. insert the `closure` row and its `occupancy` rows of kind `closure`, **after** the deletes of steps 2 to 4 in the same transaction. Because the closure rows carry the exclusion constraint, a booking or hold that another transaction inserted into the range meanwhile makes this insert fail with `23P01`; `create_closure` catches it, re-reads the affected set (the new booking is now included, AC3) and retries up to three times, then answers a typed error. So exactly one outcome stands (AC16, CONC-13): the booking was created first and is cancelled by the closure, or it is refused because the slot is closed.
6. enqueue `club_closed_slot` per player (§4.9) and `session_change` per coach; the commit holds them; a message that fails to send never undoes the cancel and the owner gets the list of players who could not be messaged (AC15, D118, read from the outbox rows with status `undeliverable` or `failed`, no extra table).

A closure whose effect is large is one operation but is bounded: the route refuses a range that would touch more than the limit set in platform config (assumption A-7; the number is a platform constant to be agreed, not typed here) and asks for it in smaller ranges.

### 4.8 Change or end a closure, repeats, hours and courts

- `app.end_closure(closure, new_end null, reason)`: shortens or ends; deletes the future `closure` occupancy rows in the removed part, so the slots become Open; **cancelled bookings are not restored** (AC11); audited.
- **Repeat closures** (AC9): `create_closure` creates occurrence rows through the booking window and `closure_roll` (§8) adds occurrences as the window reaches them; the preview lists every one.
- **Opening hours and courts under live occupancy** (D50, AC10): F03's `count_live_occupancy` makes F01's routes refuse; F09 builds nothing but the hint that points to a closure.
- Closed slots show `closed` in `public_slot_state` and drop out of booking and coach availability by reading `occupancy` (F03 §4.6, AC4).

### 4.9 Messages (F10 catalogue)

F09 enqueues with `app.enqueue_message` in the cancel transaction: `cancellation_result` (`cancel:{booking_id}:{version}`) to the player; `club_closed_slot` (`closure:{closure_id}:{booking_id}`) to each player; `session_change` (`session:{booking_id}:{version}:{coach_id}`) to the coach of a solo class or class (F10 §5.4). Params carry ids and values only, never names (F10 §4.1). A staff mark sends no message.

### 4.10 Paused club and Testing

A player's cancel in a Paused club is allowed with the same rules (D118); the owner and staff may move, add a coach, cancel and mark on existing bookings (D107, CANCEL-01-AC21). A closure works as in Live (AC13). Rows of a Testing club carry `is_test` and are excluded from reports (D33).

## 5. API routes (prefix `/api/c/{slug}`, conventions FA §9: typed codes, no text, amounts in satang, 404 for out of reach)

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /me/bookings/{id}/cancel-preview` | own booking | `cancel_outcome` for the C13b sheet |
| `POST /me/bookings/{id}/cancel` (Idempotency-Key) | own booking | `cancel_booking` by the player; the client sends no outcome |
| `GET /staff/bookings/{id}/cancel-preview` | front desk, owner | Outcome for A2 with the club cancel option |
| `POST /staff/bookings/{id}/cancel` | front desk, owner | `{ clubCancel, reason }`; reason required |
| `POST /staff/bookings/{id}/mark` | front desk, owner | `{ kind: 'no_show' or 'late_cancel', reason }` |
| `POST /staff/bookings/{id}/mark/reverse` | front desk, owner | `{ reason }` |
| `POST /staff/closures/preview` | front desk, owner | §4.6 |
| `POST /staff/closures`, `GET /staff/closures`, `POST /staff/closures/{id}/end` | front desk, owner | §4.7, list, §4.8 |

Schemas go in `packages/contract` in the same task as the route (build plan). No route sends money back or edits a ledger.

## 6. State machines

`booking`: `confirmed` to `cancelled` (in time, full value or closure), `late_cancelled` (late) or `no_show` (marked); `no_show` to `confirmed` and `late_cancelled` to `confirmed` by a reversal only; `awaiting_payment` to `released` is F03's. Played is derived from `confirmed` and `end_at` (§3.3), never stored. `order`: `paid` to `cancelled` when every line is. `closure`: `active` to `ended`. `booking_cancel` rows are only inserted.

## 7. Permission checks (server side; the client decides nothing)

| Permission | Player | Coach | Front desk | Accountant | Owner | BOOQ staff |
|---|---|---|---|---|---|---|
| Cancel own booking, see the outcome | yes (own only) | as player | as player | as player | as player | no |
| Cancel for a player, club cancel | no | no | yes (reason) | no | yes (reason) | no |
| Mark and reverse no show, late cancel | no | no | yes (reason) | no | yes (reason) | no |
| Create, preview, end closures | no | no | yes | no | yes | no |
| Read the staff reason | no | no | yes | no | yes | no |

Every club person also holds the Player role (D115), so staff cancel their own bookings as players. BOOQ staff never read bookings, cancels or closures (PLAT-02).

## 8. Jobs

| Job | Source of truth | Side effect | Cadence |
|---|---|---|---|
| `closure_roll` | `closure` with `repeat_rule` and `status active` | adds occurrence rows as the booking window reaches them; runs the cancel routine over any booking found there (assumption A-8) | daily per club |

No Played job (§3.3). `hold_release`, `session_start` and `session_end` are F03, F06 and F14's.

## 9. Concurrency and failure

- **One cancel wins.** The booking row lock and the status re-check under the lock make two taps or two devices one cancel; the second reads the first `booking_cancel` row (`unique (club_id, booking_id, version)`) and returns it (AC14). Value returns once through the F06 dedupe keys.
- **Cancel against a closure, a staff move or a Beam callback:** all lock the booking row in FA §3.4 order; the loser re-reads the status and answers a typed error or the existing result.
- **Closure against booking creation:** the exclusion constraint on `occupancy` is the judge (§4.7 step 5); the retry makes the outcome one of two.
- **Deadlocks:** many bookings in one closure lock in id order; `withClubTx` retries on `40P01` and `40001`; every function is safe to run twice.
- **Failure inside** rolls back the status change and every return together (AC22). Messages and LINE calls happen after commit.
- **A late Beam payment for a booking just cancelled** follows F05 (the order is cancelled, so the value goes to the wallet with `late_payment`).

## 10. Tests (written first at the build step)

The boundary: 12:00:00 in time, 11:59:59 late (CANCEL-01-AC2); the sheet outcome equals the cancel result for credit, money, wallet, mixed and add-on cases (AC1, AC3 to AC7, AC23); one hour of two cancelled, the other stays, the code use restored only with the last hour (AC8, AC9); late forfeits and a closure never does, including an expired package (AC10, AC11, CANCEL-03-AC12); a double tap and two devices cancel once (AC14); a started booking is refused (AC15); a hold released returns everything (AC16); a class seat and a solo class free their court and coach together and the waitlist is offered in the same transaction (AC13, AC17); a changed coach gives full value at any time (AC18); a Paused club cancels (AC21); ledger rows and status commit together or not at all with a forced failure (AC22). No cash: route inventory finds no refund action, Beam double fails on a refund call, cash payments return to the wallet (CANCEL-02). Closures: preview then confirm, a booking created after the preview is cancelled too, a booking created in parallel is cancelled or refused, never both and never double (CANCEL-03-AC3, AC16, CONC-13); a held slot is released with reason `closed`, one closure message and no released message; a repeat closure covers the window and rolls; played bookings are untouched; one failure rolls back the whole closure. Marks: no show before the slot ends is refused, without a reason is refused, a reversal writes a new `return` row, an old ledger row is never edited, coach Absent changes nothing, the Accountant and coach are refused (CANCEL-04). The blind suite shows BOOQ staff read nothing; `reason` is never in a player response.

## 11. How the cross-cutting rules are met

- **Club ID scope (CC-1):** every table has `club_id` with composite foreign keys; policies by `app.club_id()`; the window is a per club setting; another club's booking answers 404.
- **Server side (CC-2):** `cancel_outcome` and `cancel_booking` decide; the client sends no outcome; roles are checked inside each function.
- **PDPA (CC-3):** a player changes only their own record; staff reasons are staff only and never returned to a player; closure messages name the slot, not other players; the preview shows names to staff only; `booking_cancel.returned` holds ids and numbers; BOOQ staff see nothing; test rows flagged and excluded.
- **No double booking (CC-4):** the cancel frees court and coach in one transaction with the return; a closure replaces bookings with closure rows under the exclusion constraint; a cancelled or released row does not count against the rule.
- **TEXT (CC-5):** all text by key with the named variables `{hours}`, `{credits}`, `{amount}`, `{date}`, `{time}`, `{court}`, `{coach}`, `{reason}`; `{hours}` always from the setting; new keys in `locales/pending/F09.json` (D81, writers own wording, D51); nothing says cash.
- **Other (CC-6):** Bangkok time for the window and "played when the slot ends"; integer satang; no cash refund; no default value in code.

## 12. Text keys and canvas boards

New keys in `locales/pending/F09.json`: P cancel sheet outcome lines (credit returns, money goes to the wallet, wallet use returns, forfeited, credit lost after expiry), booking cancelled, cannot cancel a past booking, chips Played and No show; A closure preview and confirm, affected count, list of players who could not be messaged, packages to extend, no show and late cancel reason labels, reversal, repeat labels; L Cancellation result (returned, forfeited) and Club closed this slot. Existing keys first (for example A-0120 "Reason, required").

Boards: H-C13-My-bookings, H-C13b-Cancel-sheet, G-C13b-Late-cancel, G-C13b-Coach-changed, S-C13-Empty, G-C13-Waitlist-tab, H-A12-Closures, H-A02-Booking-create, G-A02b-Booking-detail, H-A01-Calendar, S-A01-Paused, H-K5-Session-detail, H-P2-Step5-Payments (the "refunds by PromptPay" text is a canvas bug, Gaps A3) and the T- twins. The check in leftovers on A01, C12 and My bookings are not built (Gaps A1).

## 13. Assumptions to confirm (recommended defaults, D147)

| # | Assumption | Basis |
|---|---|---|
| A-1 | Migration block 1001 to 1099 for F09; the Architect confirms four digit ordering | Build plan blocks |
| A-2 | Played is derived by the view `booking_state`, not stored and not set by a job | FA §5.4 `session_end` ("derived status"); F03 has no `played` status |
| A-3 | On a late cancel the wallet part of the payment is forfeited with the rest (the hand-off says the credit or payment is forfeited) | CANCEL-01-AC10, PRD |
| A-4 | F06 adds `app.wallet_return_line(order_line, reason)` because `wallet_return(order)` returns every spend row of an order and a one hour cancel needs one line | F06 §4.1; D40 |
| A-5 | Late cancel can be marked only before the slot ends | CANCEL-04-AC4; after the slot staff use No show |
| A-6 | Reversing a late cancel claims the hour again and is refused if the slot has ended or is taken; staff then use an `adjust` | CANCEL-04-AC5 ("Played or the prior state") |
| A-7 | A closure is refused above a platform config limit on the bookings it would cancel at once; the number is not set here | CANCEL-03-AC15 |
| A-8 | `closure_roll` cancels any booking it finds in a newly rolled occurrence (a staff booking beyond the window) with the same routine | CANCEL-03-AC9 |
| A-9 | `app.cancel_handlers` registry with `ord` F07 20, F08 30, F14 40 | Pattern of F03 §4.5 |
| A-10 | A closure whose booking is a solo class whose coach was substituted needs no special case | AC18 follows the cancel rule |

## 14. Open items

1. **Q1 The no show timing setting (A16). Answered, D158:** no new setting; marking opens after the slot ends. Draft text: CANCEL-04-AC9 says it is read from the club's settings and is empty until set, but no key is named in the F01 registry and the PRD gives only "waitlist and no show timing"; D118 already fixes that a no show is marked only after the slot ends. Its meaning (a delay after the end? a cut off for marking?) is not in the spec. Recommended default: build no setting and read none until the owner or the user says what it controls; the rule built is "after the slot ends". Needs a decision before any key is added to the registry.
2. **Q2 Played derived or stored (A-2). Answered, D158:** derived. Draft text: The requirement says a job sets Played; FA says derived. Recommended default: derived (§3.3). Orchestrator confirms.
3. **Q3 Late cancel forfeits a wallet part (A-3). Answered, D158:** forfeited with the rest. Draft text: Recommended default: forfeited with the rest; confirm.
4. **Q4 Reversal of a late cancel (A-6). Answered, D158:** the reversal restores the booking and is refused when the slot has ended or is taken. Draft text: Recommended default as written; confirm or choose that the reversal only returns the credit and leaves the booking cancelled.
5. **Q5 F06 amendment (A-4). Answered, D158:** F06 adds `wallet_return_line(order_line, reason)` (task F06-T04b below). Draft text: F06 needs `wallet_return_line`; the F06 owner and Architect confirm.
