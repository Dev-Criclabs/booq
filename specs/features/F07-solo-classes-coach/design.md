# F07 Solo classes, coach picker and rest rule · Design

Status: **Approved 30 Oct 2026 (gate 2, D155).** The answers D156 are folded in. Drafted 30 Oct 2026 from the approved F07 requirements (`requirements.md`, approved 30 Oct 2026, D111, D115, D120 applied) and the code on `main` (F03 migration 0213 already holds the coach hooks). The Architect reviews it. A change to anything below goes through the PRD, then the hand-off, then this file. Tasks (gate 3) follow approval.

Feature: F07 Solo classes, coach picker and rest rule. Requirement IDs: COACH-01 to COACH-04 and the local rules R1 to R6 of the requirements (the requirements file has no R7). Depends on F03, F06. Wave 4.

Shared decisions are in `docs/architecture/foundation.md`, cited as **FA §n**; F01 to F06, F10 and F13 designs as **F01 §n** and so on. FA §3 fixes the occupancy table, the two exclusion constraints, the lock order and the rest rule's row lock; F03 §4.2 step 9 and migration `0213_solo_class.sql` fix the hook (`app.coach_rules_hook`, `app.lock_coach`) that this feature fills. This file adds the coach tables, the rules that decide who can be offered, the picker queries, Add a coach after booking, substitutions, the flags and the coach pay fields.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| COACH-01 (who is offered) | §5.1 rules; §5.2 offers; §6 routes |
| COACH-02 (solo class price) | §4.1 `coach_price_override`; §5.3 pricing inputs (F04 prices) |
| COACH-03 (credits and checkout coach) | §5.3; §5.5 Add a coach |
| COACH-04 (credit and court fee) | §5.3 (F04 and F06 compute; F07 supplies the tier) |
| R1 (C5 and C6) | §4.1; §5.2 court assignment; §6 |
| R2 (availability and leave) | §4.1; §5.6; §6 |
| R3 (rest rule) | §5.1 step 5; §8 |
| R4 (substitutions) | §5.7 |
| R5 (solo booking record) | §4.2; §5.4 |
| R6 (changes under a booking) | §5.8 |
| CC-1 to CC-6 | §11 |

## 2. What this design does not build

The hold and the uniqueness rule (F03; F07 fills `app.coach_rules_check` and replaces `app.lock_coach`); price lines, order of use and quotes (F04); the credit ledger and eligibility (F06); cancellation and the full credit after a coach change (F09 reads the fact F07 records, §5.7); the LINE messages (F10 sends `coach_changed`, `session_change`, `leave_decision`); the A7 page and K1 to K6 screens (F11, F12 call the routes here); group class sessions and their coach (F08 owns the session; F07's rules read their occupancy rows); coach pay amounts and the payout report (F13). F07 creates the pay model fields (§4.1) and does not compute with them.

## 3. Shared pieces this design relies on

`occupancy` and `booking` (F03, migrations 0203 and 0211 to 0224), `app.reserve_court`, `app.move_booking`, `app.reclaim_order`, `app.release_handlers`, `app.coach_rules_hook`, `app.lock_coach` (0213); `coach_tier`, `coach_tier_price`, `price_group` (F04 0301); `rest_cap_hours` (F01 0041, settings registry, `unsetAllowed false`); `app_user`, `app_user_role` (F01); `app.enqueue_message` (F10, migration 0605; until it exists the substitution and leave functions go through a hook, §5.7); `app.now()` (FA §5.5).

## 4. Data and migrations

F07 uses the number block 0801 to 0899 (assumption A-1; `docs/proposals/migration-blocks.md`, the Architect adopts the table). One file per task, numbers rise in merge order.

| File | Contents |
|---|---|
| `0801_coach_tables.sql` | `coach`, `coach_availability_rule`, `coach_leave`, `coach_price_override`; foreign keys from `booking.coach_id` and `occupancy.coach_id` to `coach` (0213 left them to F07) |
| `0802_coach_pay.sql` | `coach_pay` (owner only; the pay model fields, §4.1) |
| `0803_coach_rules.sql` | `app.coach_check`, `app.coach_rest_run`, `app.coach_rules_check` registered with `app.register_coach_rules`; `app.lock_coach` replaced with a row lock |
| `0804_coach_offers.sql` | `app.coaches_offerable`, `app.assign_court`, `public.public_coach_card` view, `public.public_coach_times` function |
| `0805_coach_admin_functions.sql` | `app.save_coach`, `app.set_coach_active` (refuses with future sessions), `app.publish_coach_profile`, `app.set_coach_price_override`, `app.set_availability`, `app.request_leave`, `app.decide_leave` |
| `0806_add_coach.sql` | `booking_coach_add`, `app.add_coach_to_booking`, release handler `app.f07_release` registered in `app.release_handlers` |
| `0807_substitution.sql` | `coach_substitution` (append only), `coach_flagged_session` view, `app.substitute_coach`, `app.coach_was_changed`, the no op `app.coach_message_hook` |
| `0808_grants_policies.sql` | Policies and grants; the coach and Accountant column limits |

`rest_cap_hours` already exists (F01 0041 and the registry). No settings migration and no template migration are needed.

### 4.1 Tables

**`coach`** (class D, because the profile and pay contain personal data; FA §2.2 lists it among the setup tables, the profile fields below are public by role): `club_id`, `id` (= `app_user.id`; composite FK `(club_id, id)` to `app_user`), `tier_id` (composite FK to `coach_tier`, null until set), `bio_th`, `bio_en`, `certifications_th`, `certifications_en`, `specialties_th text[]`, `specialties_en text[]`, `ages_levels_th`, `ages_levels_en`, `languages text[]`, `photo_path` (an object path in the club's storage area, no URL), `profile_consent_at timestamptz null`, `profile_consent_by uuid null` (the owner who recorded the coach's agreement, D120), `published boolean default false` (set only through `app.publish_coach_profile`, which needs the consent), `active boolean default true`, `created_at`. `unique (club_id, id)`. A coach has one `coach` row and holds the `coach` role in `app_user_role` (the role and the row go together, enforced in `app.save_coach`). A coach also holds `player` (D115) and has the `language` field F01 gives every person (D95).

**`coach_availability_rule`** (D): `club_id`, `id`, `coach_id`, `kind` in (`weekly`, `open`, `closed`), `weekday smallint` (0 to 6, Bangkok week, only for `weekly`), `on_date date` (only for `open` and `closed`), `start_time time`, `end_time time` (whole hours; CHECK `end_time > start_time` and minutes zero, because bookings are 60 minutes on the hour), `created_at`. CHECK: `weekly` needs `weekday` and no date; `open` and `closed` need a date and no weekday. A coach works an hour when a `weekly` rule or an `open` rule covers it **and no `closed` rule covers it** (a closed time wins). With no rule at all the coach is never offered (COACH-01-AC2).

**`coach_leave`** (D): `club_id`, `id`, `coach_id`, `start_date`, `end_date`, `from_hour smallint null`, `to_hour smallint null` (whole Bangkok hours; both null means full days; both set means a part day on a single date; assumption A-5, D156), `type text null` (free text, no list of types is built, D156), `note text`, `status` in (`pending`, `approved`, `declined`), `decided_by uuid null`, `decided_at null`, `created_at`. Only `approved` rows block (COACH-01-AC9, D120). Leave type and note are visible to the coach and the owner only (R2 Meets).

**`coach_price_override`** (S, owner): `club_id`, `coach_id`, `price_group_id`, `price_satang integer check (price_satang >= 0)`. Unique `(club_id, coach_id, price_group_id)`. A row replaces the tier price for that group (COACH-02-AC3); no row means the tier price; no price is typed into code. Audited (PLAT-04). F04's pricing reads it (F04 §4.2 step 1: "or the coach's override from F07").

**`coach_pay`** (D, owner only; **this is the table that holds the coach pay fields**): `club_id`, `coach_id`, `monthly_base_satang integer null` (null for freelancers), `solo_pay_kind` in (`fixed`, `percent`) null, `solo_pay_value integer null` (satang when fixed, basis points when percent, applied to the coaching portion only), `group_pay_kind null`, `group_pay_value integer null`. Null means the owner has not set it; no default is ever written (HO open items). F13's payout functions and F12's K6 read it; the coach reads only the amounts F13 computes for them, never this table (CPORT-06); front desk, the Accountant (payouts come through F13 views) and BOOQ staff cannot read it. Whether F12 needs more fields is Q-2.

**`booking_coach_add`** (D): `club_id`, `order_id`, `booking_id`, `coach_id`, `status` in (`pending`, `confirmed`, `released`), `hold_expires_at timestamptz` (set while `pending`, null otherwise: the booking is already confirmed, so the hold of the add order cannot sit on a booking row; 0806, orchestrator approved 30 Oct), `created_at`. One row for the order made by Add a coach (§5.5).

**`coach_substitution`** (D, append only): `club_id`, `id`, `booking_id`, `from_coach_id`, `to_coach_id`, `by_staff_id`, `reason` (`leave`, `closed_time`, `inactive`, `other`), `created_at`. `revoke update, delete`, trigger, FORCE RLS (as FA §2.3). It is the fact F09 reads for "this solo class had its coach changed" (CANCEL-01-AC18).

**Flags** are not stored. `coach_flagged_session` is a view over future confirmed bookings of a coach whose hour is no longer offerable by the availability, leave or active rules (§5.8), so a flag cannot go stale; it clears when the rule is fixed or a substitute is set.

### 4.2 Booking record rules (R5-AC1)

`occupancy` already requires both resource and coach for `solo_class` (FA §3.1 CHECK). F07's 0801 adds the matching CHECK on `booking` (`type <> 'solo_class' or coach_id is not null`) if F03's migrations have not, and the foreign keys to `coach`.

## 5. Behaviour

### 5.1 The coach check (COACH-01, R3)

`app.coach_check(club, coach, starts timestamptz[], ignore_booking uuid default null) returns text` returns null when every hour is bookable, else the first refusal code. A booking decision calls it with the coach row locked. In order:

1. **Coach exists in the club and is active.** Read with `club_id = app.club_id()`; another club's coach or an inactive coach is `coach_unavailable` (AC10, CC-1). Staff may book an unpublished active coach; publication matters only for the public views (§5.2).
2. **Working.** Each hour is covered by an availability rule and not by a closed rule (`coach_unavailable`, AC2).
3. **No approved leave** covers the hour (`coach_unavailable`, AC1, D120).
4. **Not busy.** No `occupancy` row for this coach overlaps the hour in state confirmed, or held with `hold_expires_at > now()` (the exclusion constraint is the real guard, BOOK-04; this only answers early; `coach_unavailable`, AC3). `ignore_booking` removes the moved or added-to booking's own row so it does not collide with itself.
5. **Rest rule.** `app.coach_rest_run(coach, starts, ignore_booking)` merges the candidate hours with the coach's adjacent busy hours (`occupancy` rows for the coach of every kind: solo class, group class, staff booking; held and not expired, and confirmed; a group class counts until cancelled because its rows exist until then) and finds the longest run of back to back hours containing any candidate hour. A run longer than the cap refuses `rest_rule` with the cap as a parameter (AC4, AC6, R3-AC1 to AC5). A free hour breaks the run (R3-AC2). No role has an override: the function takes no override argument (AC12, R3-AC5).

The **cap** is `rest_cap_hours`. F01's registry does not allow it empty, but a Blank club that has not set it yet falls back to the PRD default 6 (R3-AC6; assumption A-2). A change is audited by F01's settings route (AC5).

`app.coach_rules_check(club, coach, resource, starts[])` is registered with `app.register_coach_rules` and called by `app.reserve_court` (0213 step 9) after the coach is locked. It calls `coach_check` and `app.refuse`s with the code. `app.move_booking` must ignore the moved booking's own row; the hook's four argument signature has no booking id, so 0803 registers a second handler `app.coach_rules_check_move(club, coach, resource, starts[], booking)` and F03 gets a small task to call it (assumption A-3).

`app.lock_coach(coach)` is replaced in 0803 by `select 1 from coach where club_id = app.club_id() and id = $1 for update`, as the comment in 0213 says. Lock order is unchanged (FA §3.4): the coach row first, then the order, then the occupancy insert; with two coaches (substitution) they are locked in id order.

### 5.2 What the picker and the lists offer (COACH-01-AC1 to AC10, R1)

- `app.coaches_offerable(resource uuid null, starts timestamptz[]) returns setof uuid` is the list for C10 and the staff picker: every active coach with `coach_check` null for all the hours, so what is offered is what can be booked (AC7). It locks nothing; the booking re-checks under the lock. The tier price for the caller's price group (or the override) comes from F04's price function; an unset price shows the coach with no price and no pick action (COACH-02-AC4, `coach_price_not_set`).
- **Court assignment (R1-AC4, D120).** `app.assign_court(coach, starts[])` returns the court the same selection already holds for those hours (for a multi hour selection and for Add a coach) if it is open, otherwise the lowest numbered active open court (assumption A-4). A coach free with no court open is `no_court_open` and cannot be picked (R1-AC3).
- **C6 times.** `public.public_coach_times(coach, date range)` returns per hour `open` (with the assigned court number), `no_court_open`, or nothing (not offerable, shown as unavailable without a reason: leave type and notes are never exposed). It uses `coach_check` in public mode, so a coach with a pending leave is shown (D120).
- `public.public_coach_card` shows only active, **published** coaches (consent recorded, §5.9), with the public profile fields. A guest may read them (R1-AC6); a Paused club answers `club_paused` and the app shows Classes as paused (R1-AC8).

### 5.3 Prices and credits (COACH-02, COACH-03, COACH-04)

F07 owns no price arithmetic. It supplies to F04 the coach's `tier_id`, the override rows and the `coach_source` value (`checkout` or `classes`) that F04's quote body already carries. F04 prices the coach line (override else tier price for the player's price group from the date of birth: COACH-02-AC1, AC2, AC7), refuses an unset price, and asks F06 for a solo credit **only when `coach_source = 'classes'`** (COACH-03-AC1, AC2). The credit's tier equals the coach's tier, any coach in the tier (COACH-03-AC4). With a credit the coach line is money 0 and the court line stays due (COACH-04-AC1); court and coach are held together at Pay (COACH-04-AC2, CC-4). Order of use, expiry, D84 and D85 are F06's (COACH-03-AC5); cancel returns are F09's (COACH-04-AC4). F07's tests prove the worked examples (Adult 50000 + 80000 = 130000; Student 70000 + 50000 = 120000) through the F04 route.

A price or tier change after booking never touches a booked session: order lines are frozen (R5-AC6, F04 R7-AC2).

### 5.4 Booking a solo class (R1-AC5, R5)

Through C5 and C6 and through C10 the call is F03's `app.reserve_court(order, resource, starts[], coach, override_reason)`. With a coach it locks the coach (§5.1), calls `coach_rules_check`, releases overlapping expired holds, then inserts **one `booking` and one `occupancy` row per hour**, each claiming court and coach, so one exclusion violation on either undoes the selection (BOOK-04-AC3, R5-AC2, CC-4). A two hour selection is one order with one booking per hour and the rest rule runs across the whole selection (BOOK-06). Solo class hours count toward the future court hours limit (R5-AC3, D49). After payment F03 confirms and F10 sends `booking_confirmed` naming the coach and court (R5-AC4); `session_change` goes to the coach. A coach of another club answers 404; any failed check answers `coach_unavailable` or `rest_rule` and writes nothing.

### 5.5 Add a coach after booking (COACH-03-AC3, D111, D120)

`app.add_coach_to_booking(booking, coach, order)` (the player on their own booking, or staff in A2):

1. Lock the coach; `coach_check(club, coach, [start], ignore_booking => booking)` must be null; the booking must be a future confirmed court only booking of the caller (or staff, who may add to existing bookings in a Paused club, F03 A-2).
2. F04 prices **only the coaching portion** (no court line, no credits, D120) as a **second order** with one `coach` line on the existing booking; F05 pays it with its own receipt (D111).
3. In one statement `UPDATE occupancy SET coach_id, kind = 'solo_class'` and `UPDATE booking SET coach_id, type = 'solo_class'`; the coach exclusion constraint re-checks (FA §3.3) and a violation returns `coach_unavailable` with nothing changed. The coach is therefore **held during payment** (CC-4); `booking_coach_add (pending)` records which order owns the hold.
4. On payment F03's confirm sets the add row `confirmed`. On release or expiry the release handler `app.f07_release(order, reason)` (registered in `app.release_handlers` with `ord` 35: F04 10, F05 20, F06 30, F08 and F10 above 40) reverts booking and occupancy to `court_booking` with no coach in one statement and sets the row `released`; the court booking is unchanged. A late payment reclaim re-adds the coach when still free; if not, the amount goes to the wallet (D74) and the booking stays court only.

### 5.6 Availability and leave (R2)

`app.set_availability` replaces a coach's rules (the coach their own; the owner any). `app.request_leave` creates a `pending` request for the coach. `app.decide_leave` (owner) approves or declines; the coach gets `leave_decision` (F10, key `leave:{request_id}:{status}`) and the flag view shows what an approval breaks. All are audited (PLAT-04, R2-AC5). A coach reads and writes only their own rows (policy `coach_id = app.user_id()`, R2-AC6, CC-2); club wide rows are owner only. Saving rules never deletes a booking (COACH-01-AC8, R2-AC4).

### 5.7 Substitutions (R4)

`app.substitute_coach(booking, new_coach, reason)` is **owner only** (assumption A-6) and runs in one transaction:

1. Lock both coaches in id order, then the booking.
2. The booking must be a future confirmed `solo_class` (a group class session's coach is F08's, Q-3). `coach_check(club, new_coach, [start], ignore_booking => booking)` must be null: availability, leave, other bookings and the rest rule apply to the substitute, with no override (R4-AC6).
3. `UPDATE occupancy SET coach_id = new` and `UPDATE booking SET coach_id = new`: the court is kept, the old coach freed and the new one claimed in one statement; a violation returns `coach_unavailable` and changes nothing (R4-AC2).
4. Insert `coach_substitution`; audit (R4-AC7); enqueue `coach_changed` to the customer (`coach_changed:{booking_id}:{new_coach}`, new coach's name only, R4-AC3) and `session_change` to both coaches. Until F10's `app.enqueue_message` exists the enqueue goes through the no op `app.coach_message_hook` that an F10 follow up replaces (A-7).
5. Order lines are untouched: the price stays (R4-AC5). Pay goes to the coach in `booking.coach_id` at delivery (F13).

`app.coach_was_changed(booking) returns boolean` reads `coach_substitution`; F09 uses it to allow full credit whatever the time (R4-AC4, CANCEL-01-AC18). If no coach is free the owner cancels through F09 with full credit (R4-AC6, D120); F07 adds nothing.

### 5.8 When a rule changes under a booking (R6)

`coach_flagged_session` lists future confirmed bookings (and F08 sessions, which only F08 may act on) of a coach whose hour fails steps 1 to 3 of §5.1 (inactive, no working rule, closed time, approved leave), ignoring the rest rule and other bookings. It is owner only and feeds the A7 flags (R6-AC1). Saving a rule, approving leave or deactivating never deletes or moves a booking (COACH-01-AC8, R6-AC2). `app.set_coach_active(coach, false)` refuses with `coach_has_future_sessions` (with the count) while any future confirmed or held session exists (R6-AC3, D120).

### 5.9 Profile and consent (R1-AC7, CC-3)

`app.publish_coach_profile(coach, true)` requires `profile_consent_at` (the owner records the coach's agreement; the club keeps the record, D120) or refuses `consent_required`. Without it the coach is absent from the public views and the picker. Bio, specialties and certifications are club typed Thai and English fields shown by the player's language (R1-AC7).

## 6. API routes

Conventions as FA §9: typed codes, no text, 404 for out of reach, club from the URL and session.

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /api/c/{slug}/coaches` | guest | C5: published active coaches, public card fields, next open time, the price for the caller's group |
| `GET /api/c/{slug}/coaches/{id}` | guest | C6: profile |
| `GET /api/c/{slug}/coaches/{id}/times?from=&to=` | guest | C6 times with the assigned court or `no_court_open` |
| `GET /api/c/{slug}/coaches/offerable?resource=&starts=` | player, staff | C10 and the staff picker list for exact hours |
| `POST /api/c/{slug}/bookings/{id}/coach` | own booking, staff | §5.5 Add a coach (creates the add order) |
| `GET/PUT /api/c/{slug}/staff/coaches/{id}` | owner | Profile, tier, active, publish with consent, price overrides |
| `GET/PUT /api/c/{slug}/staff/coaches/{id}/pay` | owner | The coach pay fields (§4.1) |
| `GET/PUT /api/c/{slug}/coach/availability` | coach (own) | K3 |
| `GET/POST /api/c/{slug}/coach/leave` | coach (own) | K4 |
| `GET /api/c/{slug}/staff/leave`, `POST .../leave/{id}/decision` | owner | A7 approve or decline |
| `GET /api/c/{slug}/staff/flagged-sessions` | owner | A7 flags (§5.8) |
| `GET /api/c/{slug}/staff/bookings/{id}/substitutes` | owner | Coaches offerable for that session |
| `POST /api/c/{slug}/staff/bookings/{id}/substitute` | owner | §5.7 |

Checkout with a coach is F04's `POST /checkout/quote` and Pay with the coach and `coach_source` in the body. Typed codes: `coach_unavailable`, `rest_rule` (with `hours`), `no_court_open`, `coach_price_not_set`, `coach_has_future_sessions`, `consent_required`, `club_paused`. A coach of another club answers 404.

## 7. State machines

`coach_leave`: `pending` to `approved` or `declined` (final; a change is a new request). `booking_coach_add`: `pending` to `confirmed` or `released` (final). `coach_substitution`: append only. A coach's `active` moves both ways but is refused to `false` with future sessions. A solo class booking's own states are F03's and F09's.

## 8. Concurrency and failure

- **Rest rule race (COACH-01-AC11, R3-AC7, CONC-17).** The coach row is locked `FOR UPDATE` before the run is counted and the insert is in the same transaction, so bookings for the 6th and 7th hour serialise and the second sees the first (a constraint cannot express the rule, FA §3.4).
- **Court and coach together.** One `occupancy` row per hour claims both, so an exclusion violation on either undoes everything, including during the hold (BOOK-04-AC2, AC3). `app.assign_court` is advisory; the constraint is final.
- **Substitution** locks coaches in id order and updates one row per hour; two owners racing: the second finds the coach already changed and the check or constraint refuses.
- **Add a coach** and a parallel move of the same booking serialise on the booking row; an expired hold is reverted by the release handler in the same transaction as F03's release.
- **Leave decided after a booking exists:** the booking stays and appears in the flag view (R6).
- A failed message never rolls back a substitution (the outbox row commits with it, F10 §10).

## 9. Jobs

None. Holds expire through F03's release job, which calls `app.f07_release`; flags are a view; reminders are F10's. Retention of old leave rows is parked (F01 Q12).

## 10. Permission checks

| Permission | Guest | Player | Coach | Front desk | Accountant | Owner | BOOQ staff |
|---|---|---|---|---|---|---|---|
| C5, C6 public cards and times | yes | yes | yes | yes | yes | yes | no |
| Offerable list at checkout | no | yes | yes | yes | no | yes | no |
| Add a coach to a booking | no | own | own | yes (A2) | no | yes | no |
| Own availability and leave | no | no | yes | no | no | yes (any coach) | no |
| Approve leave, substitute, deactivate, publish | no | no | no | no | no | yes | no |
| Price override | no | no | no | no | no | yes | no |
| Coach pay fields | no | no | no | no | no | yes | no |
| Leave type and note | no | no | own | no | no | yes | no |
| Substitution history | no | own booking (coach name only) | own sessions | yes | no | yes | no |

Row policies follow FA §4.3. A person who is a coach and staff holds the union of roles (D1). BOOQ staff read none of this (PLAT-02); the setup-only support view shows counts only.

## 11. How the cross-cutting rules are met

- **Club ID scope (CC-1):** every table has `club_id`, composite foreign keys and policies by `app.club_id()`; functions take the club from context; public views carry the tenant filter; another club's coach answers 404.
- **Server side (CC-2):** `coach_check` runs inside every booking, move, add and substitution, so a coach hidden on a screen is refused by the API; the client never sends a price or a court; rights are checked in the function and the route.
- **PDPA (CC-3):** public views select only the profile fields of a published, consenting coach; leave type, notes and pay never leave the owner and the coach; a coach sees names and levels of players on their own sessions only (roster is F12); the customer is told the new coach's name only; BOOQ staff see nothing. A deleted or anonymised coach keeps past sessions as records (A-8, parked with F01 Q22).
- **No double booking (CC-4):** §5.4, §5.5, §5.7 and §8.
- **TEXT (CC-5):** every label and refusal by key with the named variables (`{coach}`, `{tier}`, `{court}`, `{date}`, `{time}`, `{amount}`, `{hours}`); the cap is a variable; bios, specialties and certifications are club typed Thai and English fields; new keys in `locales/pending/F07.json` (D81).
- **Other (CC-6):** Bangkok time for rules, leave and days; whole hours; integer satang for overrides and pay; no price or pay number in code.

## 12. Tests (written first at the build step)

Offer rules: leave, no rule, a closed time over an open rule, a held hour, a confirmed group class, an inactive coach, a pending leave still offered, a changed cap (COACH-01-AC1 to AC10). Rest rule: a 7th hour refused, a free hour resets, unpaid held hours count, a group class counts, staff bookings refused with no override, two parallel bookings of the 6th and 7th hour give exactly one success (AC11, AC12, R3, CONC-17). Court and coach claimed together: a loser on the coach leaves nothing on its court (BOOK-04-AC2, AC3). Prices through F04: Adult 130000, Student 120000, override replaces the tier price, an unset Head Coach price cannot be picked, a guest sees Adult (COACH-02). Credits: a checkout coach never uses a credit, a Classes coach is covered by a tier credit with the court line due, a Student credit after 18 (COACH-03, COACH-04, with F06). Add a coach: only the coaching portion, the coach held while unpaid, an expired hold reverts to court only, a late payment re-adds or sends the money to the wallet. Substitution: only offerable coaches listed, all or nothing, price unchanged, `coach_changed` enqueued with the new name, `coach_was_changed` true for F09, owner only. R6: leave over a booking flags it and deletes nothing; deactivation refused with future sessions. Public views: no leave type, no notes, no pay, an unpublished coach absent, another club 404. Blind suite: BOOQ staff read nothing; a coach reads only their own rows.

## 13. Text keys and canvas boards

New keys in `locales/pending/F07.json` (D81; writers own the wording, D51): C10, C5 and C6 states (no court open, coach no longer available, pick another coach, coach not available at this hour), the solo class summary lines with `{coach}` and `{court}`, the rest cap refusal with `{hours}`, A7 labels (flagged session, substitute, reason, decide leave), K3 and K4 validation messages, the Add a coach confirmation. Existing keys first (look up by screen in `locales/copy-index.csv`).

Boards: H-C05-Solo-classes, H-C06-Coach-profile, G-C10-Add-coach-checkout, G-C10-Coach-picked, F1-08-C10-Coach-picked, G-C12-Add-coach, H-C10b-Checkout-solo, G-C10b-Solo-with-credit, G-C13b-Coach-changed, H-A07-Coaches, H-K3-Availability, H-K4-Leave, H-K1-Today and the T- twins; H-A16-Settings for the cap.

## 14. Assumptions to confirm (recommended defaults, D147)

| # | Assumption | Basis |
|---|---|---|
| A-1 | Migration block 0801 to 0899 for F07, one file per task | `docs/proposals/migration-blocks.md` |
| A-2 | If `rest_cap_hours` is empty the PRD default 6 applies in the rule (D156), although F01 forbids an empty value at Go live | Requirements R3-AC6, PRD |
| A-3 | `app.move_booking` calls a second handler that carries the moved booking's id so the rule ignores its own row; F03 gets a small follow up task | F03 §4.3, 0213 hook signature |
| A-4 | "Lowest numbered open court" is ordered by the court's position field in F01; the same court is kept for the hours of one selection and for Add a coach | R1-AC4, D120 |
| A-5 | A half day leave is stored as from and to whole hours chosen by the coach, so no morning or afternoon cut off is invented | R2-AC2; no cut off in the PRD (Q-1) |
| A-6 | Only the owner substitutes, decides leave, publishes a profile and deactivates a coach; front desk may add a coach to a booking in A2 | PRD "the owner picks"; HO roles |
| A-7 | Until F10's `app.enqueue_message` exists, substitution messages go through a no op hook that an F10 follow up replaces | F06 §4.5 pattern, F10 §5.1 |
| A-8 | A deleted or anonymised coach keeps past sessions as records; the profile is unpublished | PDPA-01, parked retention |
| A-9 | The coach price override is stored per price group; a missing row means the tier price | COACH-02-AC3; Q-5 |
| A-10 | The Add a coach order holds the coach during payment by updating the existing occupancy row, undone by a release handler with `ord` 35 | FA §3.3; F04 §4.2 |
| A-11 | The coach pay model lives in `coach_pay`, owner only, with nulls for unset values | HO Coach data; F13 §3.4 |

## 15. Open items

1. **Q-1 Half day leave and leave types. Answered, D156:** leave is a time range on whole hours; no leave types and no half day length are invented. Draft text kept for reference: The PRD says "full or half day" and a leave type but gives neither the hours of a half day nor a list of types. Recommended default: the coach picks the hours (A-5) and `type` is free text until the writers supply a list.
2. **Q-2 Coach pay fields in F12. Answered, D156:** F12 uses only the PRD pay model. Draft text: F12 names coach earnings (CPORT-06) and says pay numbers are empty settings; it lists no field beyond the PRD pay model. `coach_pay` holds exactly that model (monthly base; per session solo and group, fixed or percent of the coaching portion). Confirm no field is missing.
3. **Q-3 Group class coach change. Answered, D156:** the owner substitutes for solo and group classes alike (F08 calls the same substitution). Draft text: R4 covers solo classes. A group class whose coach is on leave is F08's session; the flag view lists it and F08's design decides how it is substituted.
4. **Q-4 Coach consent record. Answered, D156:** any coach consent text is part of the D152 notice work. Draft text: D120 says the club keeps a consent on record. Whether it also needs PDPA consent text and a copy to the coach is a legal question (parked with the privacy notice, D152).
5. **Q-5 Override shape. Answered, D156:** one nullable price per price group. Draft text: The PRD says "override the price for one coach". A-9 stores it per price group; if one price for both groups is meant the table has a single column. Recommended default: per group.
