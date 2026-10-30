# F03 Court booking, schedule and payment hold · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 from the approved design (`design.md`, approved 30 Oct 2026, decisions D59 to D61 applied). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `BOOK-04 exclusion constraints on occupancy`. Each task is under a day. **FA** is `docs/architecture/foundation.md`, **D** is this feature's `design.md`. No task writes user-facing text in code; every new key goes in both locale files and is listed for the writers (decision D51).

Roles: **BE-B** back end booking, **FE-P** front end player app, **Arch**, **QA**, **Content**.

Depends on: F01 T03 to T07 (database, context, tenant suite), T08 (settings), T10 and T11 (audit), T12 (people), T13 (route wrapper), T26 (test flag), T34 (worker); F02 T05 to T07 (club resolution and session). F03 can write its tests earlier against stubs.

## A. Tables and the claim

- [x] **F03-T01** Migrations 0201 and 0202: `orders` shell and `booking` with CHECKs (one hour, on the hour in Bangkok), statuses, indexes, test-flag registration, class D registration. IDs: BOOK-06, BOOK-01-AC1, AC2, CC-1. Role: BE-B · Deps F01-T06, T26 · Size: M
  Tests first: a 90 minute row and an 18:30 row are rejected by the database; two hours of one order are two rows; another club's order cannot be referenced.
- [x] **F03-T02** Migration 0203: `occupancy` exactly as FA §3.1 with the one-hour CHECK for non-closure kinds and both exclusion constraints. IDs: BOOK-04-AC1, AC2, AC3, AC6. Role: Arch · Deps T01 · Size: M
  Tests first (direct SQL, bypassing the app): an overlapping court row is rejected; an overlapping coach row on another court is rejected; back-to-back hours both succeed; a solo class row with only a court is rejected.
  - Built: `0203_occupancy.sql` as FA 3.1 with the one-hour CHECK for non-closure kinds and `occupancy_no_overlap_resource` / `occupancy_no_overlap_coach`. `coach_id`, `class_session_id`, `closure_id` are plain uuid until F07/F08/F09 add their composite foreign keys; `booking_id` and `resource_id` have real ones. No privilege for any app role (definer functions of 0204 write). Registered `is_test` (purge order 100, before booking 200). The same migration registers `orders` and `booking` for audit (FA 8.1: occupancy is audited through its booking).
- [x] **F03-T03** Booking time rules in `packages/time` and `packages/domain/booking`: on the hour, window by Bangkok date (day 30 inclusive), hour started (player) versus hour ended (staff), last start 23:00. IDs: BOOK-01-AC1, AC3, AC4, AC5, AC12, decisions D39, D42. Role: BE-B · Deps F01-T02 · Size: M
  Tests first (controllable clock): day 30 accepted and day 31 refused at 23:59 and 00:01 Bangkok; at 18:10 a player cannot book 18:00 and staff can; 24:00 never a start.
- [x] **F03-T04** Opening hours and resource reader (weekday hours, `24:00` close, active flag). IDs: BOOK-01-AC3, AC9. Role: BE-B · Deps F01-T06 · Size: S
  Tests first: hours differ by weekday; an inactive court is not offered and requests for it are refused.
- [x] **F03-T05** `app.hold_minutes(club)` reading the setting (the one place F16 will override) and the `hold_setting_unset` rule. IDs: BOOK-03-AC3, decision D52. Role: BE-B · Deps F01-T08 · Size: S
  Tests first: only 10, 15 or 20 read back; an unset setting refuses a payment hold but not a PAY-07 booking.
- [x] **F03-T06** `app.release_hold`, the `app.release_handlers` registry, and the lazy release inside the claim. IDs: BOOK-03-AC5, AC6, BOOK-04-AC6, decisions D45, D48. Role: BE-B · Deps T02 · Size: M
  Tests first: an expired hold with the job not run does not block the next request, and the old booking ends `released`; a handler runs once; one released message per order.
- [x] **F03-T07** `reserve_court` part 1: context checks, status gate, selection shape, opening hours, window, past and started hour, resource. IDs: BOOK-01, BOOK-03-AC2, BOOK-06, decisions D39, D42, D60. Role: BE-B · Deps T03, T04, T05 · Size: M
  Tests first: a guest and a signed out session are refused; Draft for a non tester, Paused (staff too), and an inactive court are refused with the typed codes; non-consecutive hours and two courts are refused.
  Review amendment: SR-07 (blocking). `reserve_court` is `SECURITY DEFINER` with a fixed search path; the club comes from `app.club_id()`; the customer is `app.user_id()` unless the caller is staff; `source` is derived from the role; `override_reason` is staff only. Extra tests: a player passing another customer's id gets their own or a refusal; a direct `INSERT` into `booking` as a player fails.
- [x] **F03-T08** `reserve_court` part 2: insert one booking and one `occupancy` row per hour in one transaction, all or nothing, with the typed `slot_unavailable{by}`. IDs: BOOK-04-AC1, AC4, AC5, AC12, BOOK-06. Role: BE-B · Deps T06, T07 · Size: M
  Tests first (parallel): 2 requests then 20 requests for one slot give exactly one success and no half created rows; a three hour selection with hour two taken books nothing.
  Review amendment: SR-07. The insert path is the definer function only. Extra tests: a call with club B's order id from club A's context finds nothing.
- [x] **F03-T09** Solo class path: lock the coach row, call the `coach_rules_check` hook, refuse with `coach_rules_not_installed` until F07, claim court and coach in one insert. IDs: BOOK-03-AC11, BOOK-04-AC2, AC3, AC10, decision D19. Role: BE-B · Deps T08, F01-T12 · Size: M
  Tests first: two solo requests for one coach on different courts give one success and the loser leaves nothing on its court; a coach request is refused until F07 registers the check.
- [x] **F03-T10** Future hours limit: `app.future_hours`, the customer advisory lock, the refusal `limit_reached{hours}`, the staff override with a logged reason. IDs: BOOK-05-AC1 to AC8, decisions D49, D59. Role: BE-B · Deps T08, F01-T10 · Size: M
  Tests first: unset means no limit; N allowed and N plus 1 refused whole; unpaid held, bundle paid and solo hours count and group seats and played hours do not; two parallel requests at N minus 1 give exactly one success; staff over the limit need a reason and it is audited.
- [x] **F03-T11** Second tap returns the same hold (lookup of the caller's live identical order) plus `Idempotency-Key` storage. IDs: BOOK-03-AC15, decision D47. Role: BE-B · Deps T08 · Size: M
  Tests first: a second tap, a tap on a second device, and the same key in parallel return one order and the same `hold_expires_at`; no second hold exists.
- [ ] **F03-T12** Limit on repeated Pay taps: `pay_tap` table (0207), platform config keys, `too_many_attempts`, the `pay_tap_limit_set` launch check. IDs: decision D61. Role: BE-B · Deps T08, F01-T27b · Size: S
  Tests first: attempts beyond the platform limit are refused; a repeat tap returning the same hold does not count; an unset limit fails the launch check; no value is built into code.
- [x] **F03-T13** `app.confirm_booking` and the PAY-07 path (`confirm_now`): guarded status change, hold cleared, same transaction. IDs: BOOK-03-AC7, AC9, BOOK-04-AC8. Role: BE-B · Deps T08 · Size: M
  Tests first: a confirmed booking has no hold; confirm and expiry at the same instant give exactly one outcome (FA T10); a taken slot refuses a PAY-07 order and nothing is used up.
  Review amendment: SR-07. `confirm_now` is not a parameter: the function confirms only when the order's frozen amount due is zero or a cash payment record exists; `reclaim_order` is callable only from the payment path. Extra tests: `confirm_now` cannot be forced; a player cannot call `reclaim_order`.
- [x] **F03-T14** `app.reclaim_order` for a late payment. IDs: BOOK-03-AC7, AC8, decision D25. Role: BE-B · Deps T13 · Size: M
  Tests first: slot open reclaims and confirms; slot taken, held or closed raises `slot_unavailable`; a solo class with the coach busy raises it and leaves nothing partial.
- [x] **F03-T15** `app.move_booking` (staff): in-place update, conflicts re-checked by the constraints, coach rules, customer message enqueued. IDs: BOOK-04-AC7. Role: BE-B · Deps T08 · Size: M
  Tests first: a move onto a taken slot or a busy coach is refused and nothing changes; a successful move enqueues one message; in a Paused club owner and front desk may still move (D107, migration 0225 replaces 0219's owner-only check).
- [x] **F03-T16** Opening hours and court change guard `app.count_live_occupancy`, called by the F01 `PUT /hours` and `PUT /resources/{id}` routes. IDs: decision D50. Role: BE-B · Deps T08, F01-T08 · Size: S
  Tests first: shortening hours or deactivating a court over a live booking is refused with the closure hint; with no bookings it succeeds.

## B. Views, policies, jobs

- [x] **F03-T17** Public views `public_slot_state` and `public_day_state`, with the tenant and club-visibility rules built in. IDs: BOOK-01-AC6, AC7, BOOK-03-AC4, CC-3. Role: Arch · Deps T02 · Size: M
  Tests first: expired holds are not shown as held; no booking id, customer, coach or order appears; a snapshot test fails if a field is added; Draft clubs are invisible to guests.
  - Built (Architect): `0220_public_views.sql` (the design's 0205; numbers up to 0219 were taken). `public_slot_state` (club, court, start, state held/taken/closed; closures expanded to the Bangkok hours they touch; expired holds not shown) and `public_day_state` (free hours per active court for today and the next 30 days, from the weekday's opening hours). Both carry the tenant filter and the visibility rule (Live or Paused: everyone; Testing: `app.is_club_tester()`; Draft: nobody); `booq_app` and `booq_worker` only. Hours already past today are not subtracted in the view; the schedule route does that.
- [x] **F03-T18** Migration 0206 policies and grants, registry entries, tenant isolation and platform blind suites extended to F03 tables. IDs: CC-1, PLAT-02-AC1, PDPA-01-AC1. Role: Arch · Deps T01, T02, F01-T07, T18 · Size: S
  Tests first: club A cannot see club B bookings; `booq_platform` is denied on every F03 table.
  - Built (Architect): `0221_booking_policies.sql` (the design's 0206). Reads only: staff roles read the club's orders, bookings and occupancy; a player their own orders and bookings; a coach the bookings that name them; the worker reads in the club's context. No write grant to any app role (definer functions only). `booking-policies.test.ts` covers tenant isolation, roles, no-context, direct writes refused, and BOOQ staff blind to every F03 table and both views.
- [x] **F03-T19** `hold_release` worker task: batch by order, per-order club-context transaction, lag heartbeat. IDs: BOOK-03-AC5, AC6. Role: BE-B · Deps T06, F01-T34 · Size: S
  Tests first: orders release together; the job after a lazy release does nothing; the lag metric is recorded.

## C. Routes

- [x] **F03-T20** Public routes `GET /courts`, `/schedule/days`, `/schedule` with `no-store`. IDs: BOOK-01-AC6, AC14, BOOK-02-AC1, AC2, AC5. Role: BE-B · Deps T17 · Size: M
  Tests first: guest access works; the response has the seven states (the client adds Selected), `mine` only for a signed in player, `waitlist` flag; a full day reports Day full.
- [x] **F03-T21** Player routes `GET /bookings/{id}` and `POST /bookings/{id}/release`. IDs: BOOK-03-AC14, ROLE-AC4. Role: BE-B · Deps T06, T13 · Size: S
  Tests first: another player's booking is 404; releasing a confirmed booking is refused.
- [x] **F03-T22** Staff routes `PUT /staff/bookings/{id}/move` and `POST /staff/bookings/{id}/release`, with permissions and the Paused rule (owner and front desk may still manage existing bookings, D107). IDs: BOOK-04-AC7, decisions D43, D60, D107. Role: BE-B · Deps T10, T15 · Size: M
  Tests first: front desk and owner only; in a Paused club owner and front desk can move and release.
  `POST /staff/bookings` is superseded by F04's `POST /staff/orders/quote` and `/pay` (F04-T13), which price the order and call `reserve_court`; its test "a staff booking awaiting payment holds for the hold time" moved to F04-T13.
- [ ] **F03-T23** Performance check of the schedule: seeded month of bookings, throttled 4G profile, under 2 seconds, loading and offline states. IDs: BOOK-01-AC13. Role: QA · Deps T20 · Size: S
  Tests first: the budget test is the task; fails if over.

## D. Front end and text

- [ ] **F03-T24** C4 schedule screen: date strip to the window, two court grid, seven states each with a label and icon, consecutive hour selection, Day full, loading, offline, Paused. IDs: BOOK-01-AC6, AC7, AC13, AC14, BOOK-02-AC4. Role: FE-P · Deps T20, F02-T18 · Size: M
  Tests first (Playwright): every state is distinguishable without colour; the Thai longest string does not wrap a button; selecting non-consecutive hours is not possible.
- [ ] **F03-T25** Refusal handling on C4 and checkout entry: slot no longer available (grid refresh), limit reached with `{hours}`, window, hour started, too many attempts. IDs: BOOK-01-AC15, BOOK-04-AC4, BOOK-05-AC8, decision D61. Role: FE-P · Deps T24 · Size: S
  Tests first: each typed code shows its locale key in both languages; nothing is charged on a refusal.
- [ ] **F03-T26** Locale keys: add the proposed keys in both files with named variables and list them for the writers. IDs: CC-5, decision D51. Role: Content · Size: S
  Tests first: the hard-coded text lint passes; both files have the same keys and variables.

## E. Concurrency and sweep

- [ ] **F03-T27** Concurrency suite: FA T1 to T15 plus 20 parallel requests, N minus 1 limit, double tap, idempotency in parallel, closure over a held slot (contract with F09). IDs: BOOK-04, BOOK-05-AC4, BOOK-03-AC15. Role: QA · Deps T08 to T14 · Size: M
  Tests first: the suite is the test; it runs red when the exclusion constraint is dropped.
- [ ] **F03-T28** Acceptance sweep: run the AC-to-test table in `design.md` section 9, close gaps, record results against the requirement IDs. IDs: all F03. Role: QA · Deps all · Size: M
  Done when: every AC has a passing test or a filed bug naming its ID.

## Follow-ups owned by other features (listed so nothing is lost)

F04 calls `reserve_court` from its Pay route and builds the order lines on the `orders` shell. F05 calls `confirm_booking` and `reclaim_order`. F06 registers its release handler. F07 registers `coach_rules_check`. F08 registers the waitlist advance handler and owns the Join waitlist screens. F09 calls `release_hold` for closures. F10 supplies the outbox behind the released and moved messages.

- [~] **F03-T29** **Superseded by F07-T06 (orchestrator decision, 30 Oct 2026): not built; F07-T06 owns `app.add_coach_to_booking(booking, coach, order)`.** Original text: Migration 0222 or the next free `02xx` number: `app.add_coach_to_booking(booking, coach)` (definer): claims the coach on an existing confirmed court booking under the same exclusion constraint, turns the booking into a solo class, runs the coach rules hook, and refuses with `slot_unavailable by coach` when the coach is busy. IDs: BOOK-04-AC2, AC3, R2-AC9 (F04), decision D111. Role: Arch · Deps F03-T02, T09 · Size: S
  Tests first: a busy coach refuses and the booking is unchanged; a free coach is claimed and the occupancy row now holds court and coach; a second coach on the same hour is refused by the database; another club's booking is not found; only the booking's owner or staff may add a coach.

## Order and size

T01 to T06 first (data and release), then T07 to T14 in sequence (the claim), T15 and T16 in parallel, then B, C and D in parallel, then E. About 28 tasks.

## Follow-ups added by F07 and F08 (gate 3 of those features, 30 Oct 2026)

- [ ] **F03-T30** Migration 0225: `booking.release_reason` gains `offer_ended` (a waitlist offer that ended: declined, expired or passed on); F10's `booking_released` skips it as it skips `payment_unavailable`. IDs: CLASS-02-AC2, AC14, WAIT-01-AC3, D155. Role: BE-B · Deps F03-T02 (booking), F08 design C-1 · Size: S
  Tests first: `release_hold(booking, 'offer_ended')` releases the hold and returns every reservation through the release handlers; the reason is accepted only for a booking with a `waitlist_entry_id` once F08-T03 exists; existing reasons are unchanged.
- [x] **F03-T31** Migration 0227 (0225 is the D107 Paused fix of `move_booking`; 0226 is held for T30): `app.move_booking` calls the second coach rules handler `app.coach_rules_check_move(club, coach, resource, starts[], booking)` that F07-T03 registers with `app.register_coach_rules_move`, so a moved booking ignores its own row. IDs: COACH-01-AC11, R3 (F07), BOOK-06. Role: BE-B · Deps F03 `move_booking`, F07-T03 · Size: S
  Tests first: moving a booking inside a six hour run does not count its own row twice; a move that breaks the rest rule is refused; with F07 not installed the move behaves as before.

