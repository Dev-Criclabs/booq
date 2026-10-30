# F08 Group classes and waitlist · Design

Status: **Approved 30 Oct 2026 (gate 2, D155).** The answers D157 are folded in; the changes of section 12 are tasks in the owning features' lists. Drafted 30 Oct 2026 from the approved F08 requirements (`requirements.md`, approved 30 Oct 2026, decisions D19, D44, D45, D48, D59, D62, D84, D121, D147 applied). The Architect reviews it. A change to anything below goes through the PRD, then the hand-off, then this file. Tasks (gate 3) follow approval.

Feature: F08 Group classes and waitlist. Requirement IDs: CLASS-01, CLASS-02, WAIT-01. Depends on F06 (and on F03, F04, F05, F10). Wave 4.

Shared decisions are in `docs/architecture/foundation.md`, cited as **FA §n**; the F01 to F06 and F10 designs as **F03 §n** and so on. FA §3.6 fixes the idea that a seat does not touch `occupancy` and that an offer is a hold; FA §5.4 names the jobs `waitlist_advance`, `offer_expiry` and `class_below_minimum`. This file settles what FA left to F08: the seat counting method, the offer as a held booking, the session generation, the claim path and the changes needed in other designs.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| CLASS-01-AC1, AC10 (templates, 60 minutes, 4 to 6, edits) | §3.2, §4.1, §4.2 |
| CLASS-01-AC2, AC3, AC9, AC12 (sessions, court and coach reserved, flags, rest run) | §4.2, §4.3 |
| CLASS-01-AC4, AC14, AC15, AC17 (seat limit, payment, no credit, booking type) | §4.4, §4.5 |
| CLASS-01-AC5, AC6, AC7, AC8 (audience, schedule, detail, guest) | §4.6, §5.1 |
| CLASS-01-AC11, AC13 (cancel template or session) | §4.7 |
| CLASS-01-AC16 (below minimum alert) | §6 `class_below_minimum` |
| CLASS-01-AC18 (canvas samples not used) | §9 |
| CLASS-02-AC1, AC8, AC12, AC16 (join, own position, refuse a holder, no maximum) | §4.8 |
| CLASS-02-AC2, AC4, AC5, AC9, AC10, AC13, AC14, AC15 (offers, passing on, cut off, cap, held for first) | §4.9, §4.10 |
| CLASS-02-AC3, AC6, AC7 (claim, court slot offer, last seat) | §4.11, §4.5 |
| CLASS-02-AC11 (end entries on cancel and closure) | §4.7, §4.12 |
| WAIT-01-AC1 to AC5 (court slot waitlist) | §4.8 to §4.11 with `subject_kind = court_slot` |
| CC-1 to CC-6 | §11 |

## 2. What this design does not build

The court hold, the occupancy rule and `release_hold` (F03); prices, the order of use and Pay (F04); Beam and the late payment decision (F05); credit and wallet ledgers (F06); the coach rules (F07); the player's own cancel and the value return (F09, F08 supplies the session cancel only); LINE sending (F10); the A8 screen (F11) and the coach roster screen (F12). Wording is the writers'. A class price list is not invented here (see Q3).

## 3. Data and migrations

### 3.1 Migration order

F08 uses the number block 0901 to 0999 (assumption A-1; the proposal `docs/proposals/migration-blocks.md`). One file per task, numbers rising in the order tasks merge.

| File | Contents |
|---|---|
| `0901_class_template.sql` | `class_template` and its CHECKs |
| `0902_class_session.sql` | `class_session`, unique `(club_id, template_id, start_at)`, statuses |
| `0903_seat_link.sql` | `booking.class_session_id`, `booking.waitlist_entry_id`, the partial unique index for one live seat per player and session, the CHECK tying `type = 'class_seat'` to a session |
| `0904_waitlist.sql` | `waitlist_entry`, `waitlist_seq`, indexes, the one live entry per player and subject |
| `0905_class_functions.sql` | `app.class_visible`, `app.generate_sessions`, `app.check_template` (and `0912_generate_sessions_locks.sql`, the court lock of FA 3.4 step 3c) |
| `0906_take_seat.sql` | `app.take_seat` |
| `0907_class_cancel_edit.sql` | `app.cancel_session`, `app.edit_session` |
| `0908_waitlist_functions.sql` | `app.join_waitlist`, `app.leave_waitlist`, `app.waitlist_advance`, `app.offer_hold`, `app.decline_offer`, `app.offer_expire`, `app.waitlist_pass_on`, the trigger that marks an entry claimed when its booking confirms |
| `0909_release_handler.sql` | `app.f08_release` registered in `app.release_handlers` with `ord` 50, and `app.f08_cancel` registered in F09's `app.cancel_handlers` with `ord` 30 |
| `0910_public_views.sql` | `public_class_state` (counts only), `waitlist_position` view |
| `0911_grants_policies.sql` | Policies and grants for the tables, views and functions above |

Every table is registered in `packages/db/table-classes.ts` (class D), `app.test_tables` (F01 §7.6) and the audit registry (FA §8.1). There are no new settings keys: `group_min_players`, `group_max_players`, `below_min_alert_minutes`, `waitlist_claim_minutes` and `waitlist_no_offer_hours` are in the registry already (F01 0041, `settings-registry.ts`); `booking_window_days` and `hold_minutes` are F03's.

### 3.2 Tables

**`class_template`** (class D, owner writes): `club_id`, `id`, `name_th`, `name_en`, `audience` (`adult`, `student`), `level` text, `coach_id`, `resource_id`, `weekday smallint` (0 to 6), `start_time time` (on the hour), `duration_minutes smallint` CHECK `= 60` (CLASS-01-AC1), `min_players smallint`, `max_players smallint` CHECK `1 <= min_players <= max_players`, `drop_in_price_satang integer null` (see Q3: null means no drop in price), `active boolean`, `created_by`, `created_at`, `ended_on date null`. The form pre-fills `min_players` and `max_players` from the club settings `group_min_players` and `group_max_players` (Tennis template 4 and 6, the PRD default); the database stores what was saved. The class names are club typed Thai and English fields, never keys.

**`class_session`** (class D): `club_id`, `id`, `template_id`, `start_at`, `end_at` (CHECK one hour, on the hour in Bangkok), plus a **snapshot of the details a session keeps**: `name_th`, `name_en`, `audience`, `level`, `coach_id`, `resource_id`, `min_players`, `max_players`, `drop_in_price_satang`; `status` (`scheduled`, `needs_attention`, `cancelled`), `attention_reason` (`court_clash`, `coach_clash`, `coach_leave`, `coach_rest`, `outside_hours`) null, `cancel_reason` (`below_minimum`, `owner`, `template`, `coach`) null, `edited boolean` (the owner edited this session by hand), `cancelled_by`, `cancelled_at`, `is_test`, `created_at`. Unique `(club_id, template_id, start_at)`. A session that is `scheduled` has an `occupancy` row of kind `group_class` (FA §3.1): its court and its coach, from the same exclusion constraints as a court booking (CLASS-01-AC3, CC-4). A session that is `needs_attention` has none.

**Seats** are `booking` rows of `type = 'class_seat'` (FA §3.6, F03 §3.2). F08 migration 0903 adds `booking.class_session_id uuid` (composite FK `(club_id, class_session_id)`) and `booking.waitlist_entry_id uuid null`, with CHECK `(type = 'class_seat') = (class_session_id is not null)` and a partial unique index `(club_id, class_session_id, customer_id) where status in ('awaiting_payment', 'confirmed')` (one live seat per player and session, CLASS-02-AC12). A seat's `resource_id` is the session's court and `coach_id` is null: the coach and court are held by the session, not by the seat. A seat writes no `occupancy` row.

**`waitlist_entry`** (class D): `club_id`, `id`, `customer_id`, `subject_kind` (`class_session`, `court_slot`), `class_session_id null`, `resource_id null`, `slot_start_at null` (a court slot is one resource and one hour), `seq bigint` (from `waitlist_seq`, one sequence per club, strictly increasing, the position order), `status` (`waiting`, `offered`, `claimed`, `declined`, `expired`, `ended`, `left`), `offer_no integer default 0`, `offered_at`, `offer_expires_at`, `offer_booking_id null` (the held booking of the live offer, §4.9), `ended_reason` (`session_cancelled`, `closure`, `slot_passed`, `joined_seat`, `left`) null, `is_test`, `created_at`. CHECK `(subject_kind = 'class_session') = (class_session_id is not null)`, and a court slot needs `resource_id` and `slot_start_at`. Partial unique index `(club_id, customer_id, class_session_id) where status in ('waiting','offered')` and the same for `(club_id, customer_id, resource_id, slot_start_at)`: a player is in a list once. Indexes lead with `club_id`: `(club_id, class_session_id, seq) where status in ('waiting','offered')`, `(club_id, resource_id, slot_start_at, seq) where status in ('waiting','offered')`, partial `(offer_expires_at) where status = 'offered'` for the offer job. The position a player sees is derived: `waitlist_position` counts the `waiting` and `offered` rows of the subject with a lower `seq`, plus one, and returns only the caller's own row (CC-3). There is no maximum length (CLASS-02-AC16).

### 3.3 Capacity

FA §3.6 gives two alternatives: counting under `SELECT ... FOR UPDATE` on the session row, or numbered seats. **This design counts under the session row lock**, because it needs no extra rows and keeps the `booking` shape of F03: `app.take_seat` and `app.offer_hold` lock the `class_session` row, then count `booking` rows of that session with `status = 'confirmed'`, or `status = 'awaiting_payment'` and `hold_expires_at > app.now()`. A live offer is such a booking (§4.9), so there is no separate "offers" term and the count can never disagree with the seats held. The count is `taken`; seats left are `max_players - taken` (CLASS-01-AC4, CC-4, CONC-22). The lock order is FA §3.4: the customer advisory lock first, then the session row, then bookings in id order.

## 4. Behaviour

### 4.1 Settings F08 reads (never typed in code)

`group_min_players`, `group_max_players` (form defaults), `below_min_alert_minutes` (empty by default, CLASS-01-AC16), `waitlist_claim_minutes` (Tennis template 30, CLASS-02), `waitlist_no_offer_hours` (Tennis template 2), `booking_window_days` and `hold_minutes` (F03), `rest_cap_hours` through F07. Changing a setting changes new offers and new alerts only; an offer already made keeps its end time (CLASS-02-AC13, as D46 for holds). All times are Asia/Bangkok through `app.now()`.

### 4.2 Templates and generating sessions (CLASS-01-AC1 to AC3, AC9, AC10)

`app.check_template(coach, court, weekday, start_time, template default null)` (the proposed fields, so it runs before the row exists; the template id, when given, keeps a template's own sessions from clashing with it; accepted by the orchestrator 30 Oct) is a dry run over every date of the booking window that matches the weekday. For each date it checks, in this order: the hour is inside that weekday's opening hours; the court has no booking, hold, closure or other session at that hour (`occupancy` overlap test, the same constraint); the coach has no booking, hold or session at that hour; the coach is available and has no approved leave, and the rest run is within the cap (F07 hook `app.coach_rules_check`, F03 §4.7). Saving a template is **refused** (typed code `template_clash` with the list of dates and the reason) when the court or the coach clashes with a booking, a hold, a closure or another session (CLASS-01-AC3). A coach on leave, outside availability or over the rest cap does **not** refuse the save: the session is generated flagged `needs_attention` with `coach_leave` or `coach_rest` for the owner (CLASS-01-AC9, F07 R6). A duration other than 60 minutes is refused by the CHECK and by the route.

`app.generate_sessions(club, from, to)` creates the sessions for the window. It runs: at template save (for the whole window), when the window moves (job `class_generate`, once a day just after Bangkok midnight, and idempotent through the unique `(club_id, template_id, start_at)`). For each date it inserts the `class_session` with its snapshot and claims the `occupancy` row (kind `group_class`) in the same statement block; an exclusion violation does not abort the run: the session is inserted as `needs_attention` with `court_clash` or `coach_clash` and no `occupancy` row. Nothing is skipped silently: the A8 list shows every `needs_attention` session with its reason (CLASS-01-AC3), and the owner sees a count banner in A8. The coach rest run counts a session until it is cancelled (CLASS-01-AC12; the `occupancy` row is the fact F07 reads).

**Editing a template (CLASS-01-AC10, D121).** Saving a template change applies to the future sessions that have **no live seat** (no confirmed seat and no unexpired held seat) and are not `edited`: `app.apply_template_edit(template)` rewrites their snapshot and moves their `occupancy` row inside the same constraint check. A session that has players keeps its details. A session is changed by hand only through `app.edit_session` (owner): it sets `edited`, applies the change under the same checks, and for every live seat enqueues a message to the player (§7) who may then cancel free (the free cancel flag of F09, A-8). An edit that would clash is refused.

### 4.3 Session status

`scheduled` to `cancelled` (owner, staff cancel, template cancel); `needs_attention` to `scheduled` when the owner resolves it (`app.resolve_session`, which retries the `occupancy` claim) or to `cancelled`. A past session is never changed. `needs_attention` sessions are never offered to players: they are not on C7 and take no seat.

### 4.4 Taking a seat (CLASS-01-AC4, AC14, AC17)

`app.take_seat(order, session, customer, confirm_now)` is called by F04's Pay transaction in the same way as `reserve_court` (F04 §4.3). It is `SECURITY DEFINER` with a fixed search path and the only write path for a seat. In order:

1. Context: signed in; the club is Live (Testing for testers only, Draft refused, Paused refuses everyone, D60).
2. The session is `scheduled` and its start is after `app.now()` (a player cannot take a seat in a class that has started).
3. **Audience** (§4.6): `app.class_visible(session, customer)`; a class outside both of the player's price group and their group credits is refused with `class_not_for_you`, the same refusal the C8 route gives (CLASS-01-AC5).
4. Lock the session row, count (§3.3), refuse `session_full` when `taken >= max_players`. A player who already holds a live seat is refused `already_seated` by the unique index.
5. Insert the `booking` (`type class_seat`, order, customer, session, status `confirmed` when nothing is due or a cash payment exists, else `awaiting_payment` with `hold_expires_at = now() + hold_minutes` set once, never changed, F03 D46). A seat booked from an offer reuses the offer's booking (§4.11) and inserts nothing.
6. **Second tap:** the customer's own live `awaiting_payment` seat for the same session returns that booking and its original `hold_expires_at` (the same rule as F03 D47).

The seat counts as a one hour booking of its player (BOOK-06) and does not count toward the future court hours (D59); `app.future_hours` already ignores the type.

**Payment.** A seat is paid, in the order of F04 R4 (D22: credit, then wallet, then money), with a group credit of the right audience, with the drop in price, or with the wallet (CLASS-01-AC14). The pack plus class path is F06's (C8b, C10P): the 8 pack is bought and one session used now (CLASS-01-AC15, F06 R3-AC3). F08 adds no ledger code; it requires F04 to price a class seat (§12 change C-2). The release handler of F06 (`ord` 30) returns the reservation when a held seat is released.

### 4.5 Last seat (CLASS-02-AC7, CONC-22)

Two players taking or claiming the last seat both call a function that locks the session row first. The second sees `taken = max_players` and is refused `session_full` (for a claim: `spot_gone`, the message that tells the player the spot is gone). Exactly one wins, whatever the interleaving.

### 4.6 Audience and the schedule (CLASS-01-AC5 to AC8, D62, D84, D121)

`app.class_visible(session, customer)` is true when the session's `audience` equals the customer's price group (computed by F02's `price_group_for(dob, today in Bangkok)`; no date of birth gives Adult, D12; the date of birth is read inside the function and is never returned), **or** when the customer holds a group credit whose package product's price group matches that audience, with credits left and not expired (a player now 18 or older with a Student group credit still sees the Student classes that credit was bought for, D84). A guest sees the Adult schedule. The same function runs in the schedule query, class detail, `take_seat`, `join_waitlist` and the claim route, so a class hidden from a player is refused by the API and not only hidden (CC-2). Student items are refused for a player 18 or over without a matching credit (F04 R1, D62); an Adult item may be bought by anyone.

`public_class_state` is a `security_barrier` view (class D view, readable by every role including guests) over `class_session`: `club_id`, `session_id`, `start_at`, name, level, audience, coach display name, court name, `min_players`, `max_players`, `spots_left` (never the names or ids of players), `full` and `waitlist` booleans. It filters to `scheduled`, to future starts, and to live clubs for guests (Draft and Testing for testers, as F03). The audience filter is added by the route using `class_visible`. The coach's display name is the public coach name F07 exposes; no other coach data.

### 4.7 Cancelling a session and a template (CLASS-01-AC11, AC13, CLASS-02-AC11)

`app.cancel_session(session, reason, staff)` (owner, front desk): in one transaction it sets `cancelled`, deletes the `occupancy` row (the court and the coach are free, CLASS-01-AC13), ends the session's waitlist entries (`ended`, reason `session_cancelled`) and releases their offer holds, and for every live seat calls F09's value return (`app.return_value(booking, 'staff_cancelled')`, A-7): full credit to the package or the money to the wallet with reason `refund` (value never returns as cash). It enqueues `cancellation_result` for each seat holder and `waitlist_ended` for each entry (§7) and `session_change` for the coach. A cancelled template ends the template (`ended_on`) and cancels its future sessions the same way, session by session, each in its own transaction (a failure leaves the others and reports the rest). A session cancelled because it is below minimum is the same call with the reason `below_minimum`; the alert only informs, nothing cancels a session on its own (CLASS-01-AC16: until `below_min_alert_minutes` is set, a below minimum session runs and no alert is sent).

### 4.8 Joining and leaving the waitlist (CLASS-02-AC1, AC8, AC12, AC16, WAIT-01-AC1)

`app.join_waitlist(subject, customer)`: signed in (a guest signs in first, F02); the club accepts bookings; **for a class session**: scheduled, `class_visible`, the player holds no live seat (`already_seated`, CLASS-02-AC12), the session is full (otherwise they should book: `not_full`); **for a court slot** (WAIT-01): the hour is in the future inside the booking window and is **taken** or **held** in `public_slot_state` (a hold can end, so a held hour shows Join waitlist like a taken one, D157; matches F03-T20); the player holds no live booking at that slot. It inserts the entry with the next `seq`, charges nothing and holds nothing. A repeat returns the existing entry. `app.leave_waitlist(entry)`: own entry only; `waiting` becomes `left`; an `offered` entry is declined first (§4.10). The Waitlist tab (C13) shows the player's own entries with their own position (CLASS-02-AC8).

A **court slot entry** ends (`ended`, reason `slot_passed`) when its hour starts (WAIT-01-AC4): the `offer_expiry` job sweeps these. A class entry ends when its session starts, is cancelled or when the player takes a seat in it (`joined_seat`).

### 4.9 Offers (CLASS-02-AC2, AC5, AC14, AC15, WAIT-01-AC2, AC3)

**An offer is a held booking.** `app.waitlist_advance(subject)` runs in the transaction that frees a spot or seat (it is called by the F08 release handler, by `cancel_session` of a single seat, by the `f08_cancel` handler that F09's cancel and closure run, A-7, and by the `offer_expiry` job). It takes the subject lock (session row, or an advisory lock on `(club, resource, slot_start_at)` for a court slot) and then, **while a spot is free and an entry is waiting**:

1. **Cut off.** If `start_at - app.now() < waitlist_no_offer_hours`, make no offer (CLASS-02-AC5). An offer already open stands when the mark passes (CLASS-02-AC15): the open offer is a held booking and nothing ends it but its own time, a decline or a claim.
2. **Free spot.** For a class: `max_players - taken > 0` (§3.3). For a court slot: no `occupancy` row, no closure, and the hour is inside opening hours and not past (the same conditions as an Open slot).
3. **Pick the first entry** in `seq` order that is `waiting`, whose player has no live seat (class) or no live booking in that hour, and who is not the subject of a live offer at the same start time for another subject (Q1 default, A-5). A player skipped for that reason keeps their place.
4. **Place the hold.** For a class: insert a `booking` of type `class_seat`, `awaiting_payment`, `hold_expires_at = offer_expires_at`, linked by `waitlist_entry_id`. For a court slot: insert an `orders` shell (F03 `orders`) and a `booking` of type `court`, `awaiting_payment`, with its `occupancy` row held until `offer_expires_at` (the same insert as `reserve_court` step 10, so the same exclusion constraints decide). If the insert is refused, nothing is offered and the entry stays `waiting`.
5. **Set the entry**: `status offered`, `offer_no + 1`, `offered_at = now`, `offer_expires_at = least(now + waitlist_claim_minutes, start_at)` (assumption A-6: a hold cannot outlast the hour it holds), `offer_booking_id`. The claim time is read at this moment and stored: a later change of the setting does not move it (CLASS-02-AC13).
6. **Message.** `app.enqueue_message('waitlist_offer', player, params, 'offer:{entry_id}:{offer_no}', now())` with ids only (F10 catalogue; the card shows the spot, the credit to be used, the claim countdown).

Because the freed slot or seat goes straight from released to held inside one transaction, **a slot with a waitlist never shows Open to others** while the first in line has a live offer (WAIT-01-AC3, CLASS-02-AC14): `public_slot_state` shows it `held`. A class with several free seats makes several offers, one per free seat.

When no entry is waiting, or the cut off applies, nothing is held, the slot is Open (a class shows spots left) and the entries that remain wait for the next opening.

### 4.10 Passing on (CLASS-02-AC4, AC9)

An offer ends in one of four ways, each in one transaction that releases the held booking with the release reason `offer_ended` (A-3: new reason in F03 `booking.release_reason`) and then calls `waitlist_advance` for the same subject:

- the player **declines** (`app.decline_offer`): entry `declined`, never offered this spot again;
- the offer **passes its time** (`offer_expire`, called by the job): entry `expired`, never offered this spot again;
- F10 reports the offer message **undeliverable** on the free plan at the cap (CLASS-02-AC9, LINE-07-AC6): F10's sender calls `app.waitlist_pass_on(entry)`, which ends the offer as `expired` with reason `undeliverable` and advances. (F10's migrations come first, so F10 calls this function at run time and does not reference it at migration time.)
- the **session is cancelled or the slot closes** (§4.12).

The player of an ended offer gets no further offer for it. The `waitlist_offer` message is sent at 80 percent of the cap (it is an always sent kind in the F10 catalogue, CLASS-02-AC10).

### 4.11 Claiming (CLASS-02-AC3, AC6, AC7)

The claim is the normal Pay of F04 on the held booking, not a second reservation: `POST /waitlist/{entry}/claim` checks that the entry is `offered`, belongs to the caller and `offer_expires_at > now`, and then prices the order and runs F04's Pay with the offer's booking. Pay finds the booking as the caller's own live `awaiting_payment` booking for the identical selection (F03 D47) and returns it with its **original** `hold_expires_at`, which is the offer end, so the money step must finish inside the claim time (D121). The paths:

- A group credit or the wallet covers the whole price: F04 confirms in the same transaction; the claim is confirmed on the tap.
- Money is due: the F05 Beam QR is created for the order, valid until `hold_expires_at`; `apply_payment` confirms it. A payment after the offer end follows the late payment rules of F05 (PAY-03), and the release handler has already advanced the list.
- **Court slot offers** (CLASS-02-AC6): the hold is the booking, so the claim is a booking under BOOK-03 and BOOK-04 with the same constraints.

A trigger in migration 0908 sets the entry `claimed` when a booking with `waitlist_entry_id` becomes `confirmed`. The claim route answers `spot_gone` if the offer has ended and the hold is released. Two players cannot both claim: each offer is a distinct held booking counted under the session lock, so the last seat is offered once (§4.5).

### 4.12 Closures and ending entries (CLASS-02-AC11, D48)

F09's closure function covers court slots and sessions. For a closed court hour with a waitlist, the entries end (`ended`, reason `closure`) and the players get `waitlist_ended`; an offer hold on a closed slot is released like any hold under a closure (F03 §4.5) and no offer follows. A `club_closed_slot` message goes to seat holders by F09/F10.

### 4.13 The release handler

`app.f08_release(order, reason)` is registered in `app.release_handlers` with `ord` 50 (the rule: F04 10, F05 20, F06 30, F07 35, F08 50, F10 60). For each released booking of the order: a held **class seat** that came from an offer is an ended offer (§4.10, entry `expired` unless it was declined, which sets its own status first); a released **court booking or seat** that was not an offer frees the spot, so `waitlist_advance` runs for its subject. A `released` booking whose reason is `closed` or whose session is cancelled does not advance (nothing to offer). The handler is idempotent through the entry status guard.

## 5. API routes (prefix `/api/c/{slug}`)

Conventions as FA §9: typed codes, no text, no club id in a body, 404 for out of reach, `Idempotency-Key` on mutating routes.

### 5.1 Public and player

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /classes?from=&to=&level=` | guest, player | C7: the week from `public_class_state`, filtered by `class_visible` (guest: Adult); level filter; counts only |
| `GET /classes/{id}` | guest, player | C8: detail with minimum, maximum, spots left, the credit or drop in price, `waitlist`; 404 when not visible to the caller |
| `POST /classes/{id}/waitlist` | player | `join_waitlist` for a class |
| `POST /schedule/waitlist` | player | `join_waitlist` for a court slot (`resourceId`, `startAt`); F03 shows the button |
| `GET /me/waitlist` | player (own) | C13 Waitlist tab: own entries, own position, own offer countdown |
| `DELETE /me/waitlist/{id}` | player (own) | Leave; declines an open offer |
| `GET /me/waitlist/{id}` | player (own) | C16: the offer, the spot, the credit to be used, the end time |
| `POST /me/waitlist/{id}/claim` | player (own) | §4.11 (calls F04 Pay) |
| `POST /me/waitlist/{id}/decline` | player (own) | `decline_offer` |

The seat itself is taken only by Pay in checkout (F04), as for a court hold: there is no player route that takes a seat on its own.

### 5.2 Staff

| Method and path | Permission | Purpose |
|---|---|---|
| `GET/POST/PUT /staff/class-templates` | `class.template` (owner) | A8: create, edit, end a template; `template_clash` with dates on a refused save |
| `GET /staff/class-sessions?from=&to=&status=` | front desk, owner | A8 list with seats, status and `needs_attention` reasons |
| `PUT /staff/class-sessions/{id}` | owner | `edit_session` |
| `POST /staff/class-sessions/{id}/cancel` | front desk, owner | `cancel_session` with reason |
| `POST /staff/class-sessions/{id}/resolve` | owner | Retry the claim of a `needs_attention` session |
| `GET /staff/class-sessions/{id}/roster` | front desk, owner, the session's coach | Names and levels of the seat holders (§8); never the date of birth |
| `GET /staff/waitlist?sessionId=` | front desk, owner | Entries for a session or slot, names for staff |
| `GET /coach/sessions/{id}/roster` | coach (own sessions) | K5 roster (F12 screen) |

## 6. Jobs

| Job | Source of truth | Side effect | Cadence |
|---|---|---|---|
| `class_generate` | templates, window | `generate_sessions` for the days now in the window; reports `needs_attention` | daily after Bangkok midnight and at template save |
| `offer_expiry` | `status = 'offered' and offer_expires_at <= now()` | `offer_expire` per entry (release the hold, pass on); also ends court slot entries whose hour has started and class entries whose session has started | every 30 seconds (FA §5.4) |
| `class_below_minimum` | per session at `start_at - below_min_alert_minutes` | enqueue `class_below_minimum` (`below_min:{session_id}`) to front desk when seats `< min_players` | inert while `below_min_alert_minutes` is unset (FA §5.4) |

`waitlist_advance` is not a job: it is called in the transaction that frees a spot (FA §5.4). Correctness never depends on `offer_expiry`: an expired offer's hold is also released lazily by the next `reserve_court` or `take_seat` that overlaps it (F03 §4.5), and that release calls `f08_release`, which advances the list.

## 7. Messages (through F10)

Every message is an outbox row from `app.enqueue_message` with ids only (CC-3). Kinds: `waitlist_offer` (F10 catalogue), `class_below_minimum` (F10 catalogue), `cancellation_result` (a session cancel, reusing the player's cancel result card), `session_change` (the coach). Two kinds are not in the F10 catalogue and are needed: **`waitlist_ended`** (an entry ended by a cancel or a closure, CLASS-02-AC11) and **`class_session_changed`** (a player's seat when the owner edits a session, CLASS-01-AC10). They go in as additions to the F10 catalogue (§12 change C-4), both an always sent kind. Wording is the writers'.

## 8. Permission checks

| Permission | Guest | Player | Coach | Front desk | Accountant | Owner |
|---|---|---|---|---|---|---|
| See C7, C8 (Adult for a guest) | yes | own audience | own audience | yes | yes | yes |
| Join, leave, claim a waitlist | no | yes | yes (as a player) | yes (as a player) | yes (as a player) | yes (as a player) |
| Own waitlist position | | yes | yes | yes | yes | yes |
| Roster with names | | no | own sessions only | yes | names only (D35, reports) | yes |
| Waitlist entries with names | | no | no | yes | no | yes |
| Cancel a session, resolve | | no | no | yes | no | yes |
| Create, edit, end a template, edit a session | | no | no | no | no | yes |
| Below minimum alert received | | no | no | yes | no | no |

A person with several roles gets the union (ROLE-01); staff booking as a player claim as a player (ROLE-01-AC4). Row policies follow FA §4.3: the tenant policy on every table, a player reads their own seat and entries, staff read the club's, guests only the public view. BOOQ staff have no grant on any F08 table and see no roster (PLAT-02).

## 9. Tests (written first at the build step)

Real Postgres and a controllable clock (D30). Shared tests T1 to T15 of FA §3.7 are the core.

| Test | Covers |
|---|---|
| 20 parallel `take_seat` for the last seat: one success, 19 `session_full`, no half rows; the same with 200 repeats | CLASS-01-AC4, CONC-22 |
| Two claims of one last seat by two offers cannot both exist; the second player is told `spot_gone` | CLASS-02-AC7 |
| A template with a clash is refused with the dates; a coach on leave or over the rest cap is saved and the session is flagged, not removed | CLASS-01-AC3, AC9 |
| A template with 90 minutes is refused by the route and by the CHECK | CLASS-01-AC1 |
| Sessions fill the window; a rerun creates none twice; a clash at generation becomes `needs_attention` with no `occupancy` row and shows in A8 | CLASS-01-AC2, AC3 |
| A template edit changes future sessions with no seats and leaves one with a seat; an owner edit of a session messages its players and offers a free cancel | CLASS-01-AC10 |
| A cancelled session frees court and coach, returns full credit or wallet value, ends the waitlist, and sends the messages; no cash path exists | CLASS-01-AC13, CLASS-02-AC11 |
| A Student class is not shown, not detailed and not bookable by an Adult with no Student credit (404 and refusal); an 18 year old with a Student group credit still sees it; a guest sees only Adult | CLASS-01-AC5, AC8, D84, D121 |
| A held seat counts toward capacity until its hold ends; an expired hold does not | CLASS-01-AC4 |
| A seat is a one hour booking and does not count toward the future court hours | CLASS-01-AC17, D59 |
| Join: nothing charged, nothing held, position is the player's own; a holder of a seat is refused; a repeat returns the same entry | CLASS-02-AC1, AC12 |
| A freed seat is offered to the first waiting player, the hold is a booking counted in capacity, the entry stores its end time; a later change of the claim time does not move it | CLASS-02-AC2, AC13 |
| Within the cut off no offer is made; an offer open at the mark stands | CLASS-02-AC5, AC15 |
| While an offer is open the spot shows as held to everyone else (class spots left and court slot `held`) | CLASS-02-AC14, WAIT-01-AC3 |
| Decline, expiry and an undeliverable offer each pass to the next player; the passed player gets no second offer for it | CLASS-02-AC4, AC9 |
| The offer message is sent at 80 percent of the cap | CLASS-02-AC10 |
| Claim with credit or wallet confirms on the tap; claim with money needs Beam inside the claim time; a payment after the end follows PAY-03 | CLASS-02-AC3, D121 |
| A court slot offer becomes a held booking and a booking under BOOK-03 and BOOK-04; two parallel claims for one slot give one | CLASS-02-AC6, WAIT-01-AC2 |
| A court slot entry ends when its hour starts | WAIT-01-AC4 |
| No maximum length: 200 entries join one list | CLASS-02-AC16 |
| The below minimum alert is inert while the setting is empty and fires once at the time when set | CLASS-01-AC16 |
| The canvas samples (Thursday 20:00 "Full 6 of 6", "3 booked, needs 4") appear in no test | CLASS-01-AC18, Gaps B1, B2 |
| Blind suite: BOOQ staff read no session roster, entry or seat; a player reads no other player's name or position | CC-3, PLAT-02 |

## 10. State machines

`class_session`: `scheduled` to `cancelled`; `needs_attention` to `scheduled` or `cancelled`; final at the start. `waitlist_entry`: `waiting` to `offered`; `offered` to `claimed`, `declined`, `expired` or `ended`; `waiting` to `left` or `ended`; every end is final. A declined or expired offer is final for that entry: the player gets no further offer for it and may join again at the back (A-4). `booking` seats follow F03 §7.

## 11. How the cross-cutting rules are met

- **Club ID scope (CC-1):** every table has `club_id`, composite keys and policies by `app.club_id()`; the functions take the club from context; a record of another club answers 404 (D27).
- **Server side (CC-2):** `class_visible`, the seat limit and the offers are decided in functions; a hidden class is refused by the API; permissions are in the table of §8.
- **PDPA (CC-3):** the schedule and the detail show counts only; a roster shows names and levels to the owner, front desk and the session's coach only; a player sees their own position only; outbox `params` hold ids; the date of birth is used inside `class_visible` and never returned; BOOQ staff see nothing.
- **No double booking (CC-4):** a session claims court and coach through the same `occupancy` exclusion constraints as a court booking, held offers included; seats are counted under the session row lock inside the seat transaction; an offer is a held booking, so nobody can take the spot during the offer and one claim wins; a failed insert leaves nothing.
- **TEXT (CC-5):** all text by key with the variables of `locales/README.md` (`{class}`, `{coach}`, `{court}`, `{date}`, `{time}`, `{spots}`, `{min}`, `{max}`, `{minutes}`, `{hours}`, `{amount}`); the claim time, the cut off and the alert time are settings and variables (Gaps A5); new keys go in `locales/pending/F08.json` (D81), writers own the wording; class names are club typed fields.
- **Other (CC-6):** Bangkok time through `app.now()`; sessions are 60 minutes on the hour; integer satang; value returns by credit or wallet only; no default price or setting in code.

## 12. Changes needed in approved designs (for the Architect and the orchestrator)

F08 depends on these. Each needs its own PRD, hand-off or design change before the F08 tasks that use it can be built; none is made here.

| # | Needed in | Change |
|---|---|---|
| C-1 | F03 | `booking.release_reason` gains `offer_ended`; F10's `booking_released` skips it, as it skips `payment_unavailable` |
| C-2 | F04 | `order_line.kind` gains `class_seat`; Pay calls `app.take_seat` for it; a class seat is priced from credit, wallet or the drop in price; Pay accepts an offer's held booking and order (the claim, §4.11) |
| C-3 | F07 | F08 calls F07's `app.coach_check(club, coach, starts[], ignore_booking) returns text` (null when bookable, else the first refusal code; F07 §5.1) with the one start of the session. F07 adds a default argument `ignore_session uuid` so that a session being edited does not collide with its own `occupancy` row. (An earlier draft of this line named a different signature; F07's is the one built.) |
| C-4 | F10 | The catalogue gains `waitlist_ended` and `class_session_changed` (both always sent); F10's sender calls `app.waitlist_pass_on` for an undeliverable `waitlist_offer` |
| C-5 | F09 | F09 names step 3 of its cancel as `app.return_booking_value(booking, kind)` (credit, wallet and money returns with their keys) so that F08's `cancel_session` can call it for every seat; F09 gives players of an edited session a free cancel flag; F08 registers `app.f08_cancel` in F09's `app.cancel_handlers` at `ord` 30, and that handler calls `app.waitlist_advance` (F09 does not call it directly) |
| C-6 | F03 | `booking` gains `class_session_id` and `waitlist_entry_id` (migration 0903 of F08, an addition to the table, no existing column changes) and the F03 `public_slot_state` includes the court slot offer hold as `held` (already so, since an offer hold is an `occupancy` row) |

## 13. Assumptions to confirm (recommended defaults, D147)

| # | Assumption | Basis |
|---|---|---|
| A-1 | Migration block 0901 to 0999 for F08 | `docs/proposals/migration-blocks.md` |
| A-2 | Seat capacity is counted under the session row lock, not by numbered seats | FA §3.6 alternative; one fewer table |
| A-3 | An offer is a held `booking` with the new release reason `offer_ended` | FA §3.6 (an offer is a hold); change C-1 |
| A-4 | A declined or expired offer is final for that entry and spot; the player may join again and goes to the back | CLASS-02-AC4 ("no further offer for it") |
| A-5 | (Q1) One player may be on several waitlists; a player with a live offer at a start time is skipped for another offer at the same start time and keeps their place | D121 sets no maximum and says nothing on this; avoids two overlapping holds for one person |
| A-6 | An offer's end is `least(now + claim time, start)` | A hold cannot outlast the hour; when the cut off is 0 it matters |
| A-7 | F09 owns the value return (`return_booking_value`); F08's `f08_cancel` handler in `cancel_handlers` calls `waitlist_advance`, and F08's `cancel_session` calls `return_booking_value` for every seat | F09 CANCEL-03 style (CLASS-01-AC13) |
| A-8 | A session edited by the owner lets its players cancel free; the flag is F09's | CLASS-01-AC10 |
| A-9 | `needs_attention` sessions are shown to the owner in A8 (list and count banner), with no LINE message to the owner | F10 catalogue has no owner kind for it; the owner reads A8 |
| A-10 | `class_generate` runs once a day after Bangkok midnight and at template save | BOOK window moves at Bangkok midnight |
| A-11 | Join Waitlist is offered on a Taken and on a Held court slot (D157, Q2 answered) | A hold can end and the slot then goes to the first in line; matches F03-T20 |
| A-12 | The roster shows name and level; the level is the club's own text on the template or the player's level field if one exists (F11 A6); no date of birth ever | CC-3 |

## 14. Text keys and canvas boards

New keys in `locales/pending/F08.json` (P, A, L), proposed from the requirements list: full, join waitlist, you are number `{n}` on the waitlist, spot gone, offer ended, class cancelled, seat limit, class not for your age group, waitlist ended, class session changed; A: template clash with `{date}` list, session generation report and `needs_attention` reasons, below minimum alert setting; L: spot gone, offer passed on. Existing keys first; writers own the wording (D51). Numbers come from the i18n role.

Boards: H-C07-Group-classes, H-C08-Class-detail, H-C08b-Class-pack-choice, H-C16-Waitlist-offer, G-C04-Waitlist-joined, G-C13-Waitlist-tab, H-C13-My-bookings, H-C10P-Pack-plus-class, H-C12P-Seat-plus-pack, H-A08-Group-classes, H-K5-Session-detail, L-Msg-Waitlist, S-C04-Day-full and their T- twins. The canvas samples on C7, C16 and A08 are not used (Gaps B1, B2, A5).

## 15. Open items

1. **Q1 One player on several waitlists. Answered, D157:** allowed. Recommended default: allowed, and a player with a live offer at the same start time is skipped for another offer at that time without losing their place (A-5). The orchestrator confirms or amends.
2. **Q2 Join waitlist on a Held slot (F03 Q2). Answered, D157:** a held hour shows Join waitlist like a taken one.
3. **Q3 Drop in price of a class. Answered, D157:** a nullable price on the class template with no default, a club setting; F04 prices it (C-2). Draft text: The requirements say a seat can be paid at a drop in price, but no approved document says where that price is set or whether it is per template, per level or per audience. Recommended default: a nullable `drop_in_price_satang` on the class template (null means no drop in price and the seat needs a credit or wallet), set by the owner in A8, with no default value (never invent a price). The user confirms where the price lives; F04 prices it (C-2).
4. **Changes C-1 to C-6** above need the Architect and the owners of F03, F04, F09 and F10 before the dependent tasks start.
