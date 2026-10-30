# F09 Cancellation, no show and closures · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 from the approved F09 design (`design.md`, approved 30 Oct 2026, gate 2, D155; answers D158) and the approved requirements (`requirements.md`). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `CANCEL-03 cancel every affected booking in one transaction`. A merged migration is never edited. New text goes in `locales/pending/F09.json` (D81).

Roles: **BE-B** back end booking, **FE-P** front end player app, **FE-A** front end admin, **QA**, **Content**.

Depends on: F01 (`cancel_window_hours`, `booking_window_days`, route wrapper T13, blind suite T18, worker T34); F03 (`release_hold`, `occupancy` with `closure_id`, `public_slot_state`, `count_live_occupancy`); F04 (`restore_line`, order lines, promo and birthday restore); F05 (late payment decisions); F06 (`credit_return`, `credit_forfeit`, `credit_reverse_forfeit`, `wallet_credit`, `wallet_return_line` from F06-T25); F07 (`coach_was_changed`); F08 (`class_session.edited`, `f08_cancel`); F10 (`app.enqueue_message`); F13 (no receipt for a refund). Migration numbers 1001 to 1011, one task per file, rising in task order (T01 1001, T02 1002, T03 1003, T04 1004, T05 1005, T06a 1006, T06b 1007, T07 1008, T08a 1009, T08b 1010, T09 1011; the design's table lists the same files). Four digit numbers are accepted by `check-migrations`.

**Cross-feature tasks this list needs, with their approval and dependency order:** F06-T25 (`wallet_return_line`, migration 0515, D158) before T05; F07-T07 (`coach_was_changed`) and F08-T02 (`class_session.edited`) before T04; F10-T06 and F10-T23 before T11. F08-T07 register handlers in T03's registry, so T03 comes before F08-T07.

## A. Tables and registry

- [x] **F09-T01** Migration 1001: `booking_cancel` (append only; version, outcome, returned, reason) and the view `booking_state` with Played derived from `confirmed` and `end_at` (D158). IDs: CANCEL-01-AC11, CANCEL-04-AC1 to AC3, AC12, F07 R5-AC5. Role: BE-B · Deps F03 `booking` · Size: M
  Tests first: update and delete fail for every role; a confirmed booking whose slot has ended reads Played with no job; another club's rows are not reachable.
- [x] **F09-T02** Migration 1002: `closure`, `closure_resource`, the foreign key from `occupancy.closure_id`. IDs: CANCEL-03-AC1, AC9, AC13. Role: BE-B · Deps F03 `occupancy` · Size: S
  Tests first: a closure row carries the exclusion constraint with bookings and holds; a repeat rule is stored; another club's closure is not reachable.
- [ ] **F09-T03** Migration 1003: the registry `app.cancel_handlers (ord, handler)`, same pattern as `release_handlers`. IDs: CANCEL-01-AC13, AC17, AC19. Role: BE-B · Deps T01 · Size: S
  Tests first: handlers run in `ord` order inside the cancel transaction; an unregistered handler is absent; a handler failure rolls the cancel back.

## B. Functions

- [ ] **F09-T04** Migration 1004: `app.cancel_outcome(booking, actor)`: in time, late or full value, from the club's `cancel_window_hours`; full value for a closure, a club cancel, a substituted coach (F07 `coach_was_changed`) and an edited group session (F08 `edited`); no outcome for a played booking. IDs: CANCEL-01-AC1 to AC10, AC18, AC20, D111. Role: BE-B · Deps T01, F07-T07, F08-T02 · Size: M (one function; the six cases are branches of one rule table, so it fits a day)
  Tests first: exactly at the window boundary; a solo class with a changed coach shows full value (AC18); an edited session shows full value; the client sends no outcome.
- [ ] **F09-T05** Migration 1005: `app.return_booking_value(booking, kind)`: per line `credit_return`, `wallet_return_line`, `wallet_credit` with reason `refund`, with the dedupe keys of design 4.4; late: `credit_forfeit` and the wallet part forfeited with it (D158). IDs: CANCEL-01-AC1 to AC10, CANCEL-02-AC1 to AC6, D21, D158. Role: BE-B · Deps T04, F06-T25 · Size: M
  Tests first: a mixed payment cancelled in time returns credit to the package and money to the wallet with reason `refund` (D21); a late cancel forfeits credit and wallet part; a repeat returns once; no function, route or Beam call sends money back.
- [ ] **F09-T06a** Migration 1006: `app.cancel_order_effects(booking, kind)`: `restore_line` of F04, the promo code use and birthday entitlement restored only when the last live line of the order is cancelled (D67), the partner redemption count (D70), the order set `cancelled` when every line is cancelled. IDs: CANCEL-01-AC11, AC12, AC15, D67, D70. Role: BE-B · Deps T05, F04 `restore_line` · Size: S
  Tests first: cancelling one of two lines restores nothing yet; cancelling the last live line restores the promo use once; the order becomes `cancelled` only when every line is; a repeat changes nothing.
- [ ] **F09-T06b** Migration 1007: `app.cancel_booking`: locks in FA §3.4 order, outcome, returns through T05, status `cancelled` or `late_cancelled`, deletes the occupancy row (court and coach together), the `booking_cancel` row, order effects through T06a, the cancel handlers, the message hook. IDs: CANCEL-01-AC13, AC14, AC16, AC17, AC19, AC21, AC22, CC-4. Role: BE-B · Deps T03, T05, T06a · Size: M
  Tests first: a second tap or two devices return the existing row; cancelling one hour of a two hour order frees only that hour; a solo class frees court and coach together; a failure in a handler rolls everything back; an `awaiting_payment` booking is released through `release_hold`, not cancelled here.
- [ ] **F09-T07** Migration 1008: `app.mark_no_show`, `app.mark_late_cancel`, `app.reverse_mark` (reason required; no show only after the slot ends, D118 and D158; reversal restores the booking and is refused when the slot has ended or is taken, D158). IDs: CANCEL-04-AC4 to AC12. Role: BE-B · Deps T05, T06b · Size: M
  Tests first: a no show before the end is refused; a reversal after the slot ended is refused and staff use an `adjust`; a reversal returns a credit with a `return` row and a note, never an edit; no setting is read for no show timing.
- [ ] **F09-T08a** Migration 1009: `app.closure_preview`, `app.create_closure` (one transaction for the whole closure: cancel affected confirmed bookings with full value, release holds, cancel group sessions through F08's handler, then insert the `closure` and its `occupancy` rows). IDs: CANCEL-03-AC1 to AC8, AC13 to AC17, CC-4. Role: BE-B · Deps T02, T06b, F08-T07 · Size: M
  Tests first: one transaction for the whole closure and a refusal above the platform limit; confirmed bookings cancel with full value, holds are released, group sessions cancel for everyone; the closure rows are inserted after the deletes; a Beam payment arriving later goes to the wallet (PAY-03); a race with a new booking leaves no double booking (CONC-13, bounded retry).
- [ ] **F09-T08b** Migration 1010: `app.end_closure`, `app.roll_closures`. IDs: CANCEL-03-AC9 to AC12. Role: BE-B · Deps T08a · Size: S
  Tests first: ending a closure frees the future slots and does not restore cancelled bookings; a repeat rule gains its occurrence once; a staff booking found in a new occurrence is cancelled with the same routine.
- [ ] **F09-T09** Migration 1011: policies and grants, executable-by lists, table class, audit and test table registry entries. IDs: CC-1, CC-3, CANCEL-02. Role: BE-B · Deps T01 to T08b · Size: S
  Tests first: the blind suite shows BOOQ staff read nothing; front desk and owner reach the marks and closures, a player only their own cancel; the route inventory test finds no refund route.

## C. Jobs and messages

- [ ] **F09-T10** Worker task `closure_roll` (per club, `withClubTx`, idempotent, test clock): adds occurrences as the booking window reaches them and runs the cancel routine over any booking found there. IDs: CANCEL-03-AC9. Role: BE-B · Deps T08b, F01-T34 · Size: S
  Tests first: a repeat closure gains its next occurrence once; a staff booking beyond the window is cancelled with the same routine.
- [ ] **F09-T11** Enqueue `cancellation_result`, `club_closed_slot`, `session_change` through `app.enqueue_message`; the owner sees the list of players who could not be messaged. IDs: CANCEL-01-AC14, CANCEL-03-AC2, LINE-05. Role: BE-B · Deps T06b, T08a, F10-T06, F10-T23 · Size: S
  Tests first: one message per player by dedupe key; a message that fails never undoes the cancel.

## D. Routes

- [ ] **F09-T12** Player routes: `GET /me/bookings/{id}/cancel-preview`, `POST /me/bookings/{id}/cancel` with Idempotency-Key (schemas in `packages/contract`). IDs: CANCEL-01-AC1 to AC12, AC14. Role: BE-B · Deps T06b, F01-T13 · Size: S
  Tests first: another player's booking answers 404; the client cannot send an outcome; a repeat with the key returns the same result.
- [ ] **F09-T13** Staff routes: cancel preview and cancel with `clubCancel` and reason, `mark`, `mark/reverse`, closures preview, create, list, end. IDs: CANCEL-01-AC20, CANCEL-03, CANCEL-04, CC-2. Role: BE-B · Deps T07, T08a, T08b, T09, F01-T13 · Size: M
  Tests first: reason required for club cancel, marks and reversals; a closure works in a Paused club; no route sends money back.

## E. Screens

- [ ] **F09-T14** C13b cancel sheet (H-C13b, G-C13b states) stating the outcome with the window as `{hours}`. IDs: CANCEL-01-AC1 to AC10, AC23. Role: FE-P · Deps T12, T17 · Size: M
  Tests first: in time, late and full value states; the window is a variable (Gaps A5); longest Thai strings do not wrap buttons.
- [ ] **F09-T15** A2 booking actions: club cancel, mark no show, late cancel, reverse (H-A02). IDs: CANCEL-01-AC20, CANCEL-04-AC4 to AC12. Role: FE-A · Deps T13, T17 · Size: M
  Tests first: the form cannot submit without a reason; Mark no show is disabled before the slot ends; no check-in or late flag exists (Gaps A1).
- [ ] **F09-T16** Closures screens in A2 and A8 (preview list, create with repeat, end). IDs: CANCEL-03-AC1 to AC17. Role: FE-A · Deps T13, T17 · Size: M
  Tests first: the preview lists every occurrence in the window; ending a closure warns that cancelled bookings are not restored.
- [ ] **F09-T17** Content: `locales/pending/F09.json` (design section 12), existing keys first; window and amounts as named variables. IDs: TEXT-01 to TEXT-06. Role: Content · Deps none · Size: S
  Tests first: key sets and variables match in both languages; no existing key edited.

## F. QA

- [ ] **F09-T18** Concurrency and no cash suite: two cancels at once, a cancel racing a closure, a Beam callback racing a cancel, a return repeated, a closure racing a new booking; the route inventory has no refund. IDs: CANCEL-01-AC14, CANCEL-02, CANCEL-03-AC15, CC-4. Role: QA · Deps T06b, T08a · Size: M
  Tests first: the suite is the task (20 parallel requests per case).
- [ ] **F09-T19** Acceptance sweep: every acceptance criterion of CANCEL-01 to CANCEL-04 has a named test, with the F06 R1-AC6, AC7 and AC10 cases listed against the F06 sweep; walk the F09 boards; file gaps with the ID. IDs: CANCEL-01 to CANCEL-04. Role: QA · Deps all · Size: M
  Tests first: a table of criteria to tests with none empty.

Order: T01 to T05, T06a, T06b, T07, T08a, T08b, T09 (migration order, T03 early), T10, T11, T12, T13, T17 early, then the screens, then F. About 21 tasks, each under a day. The screens use T17's keys: a screen task starts with the keys that exist and adds the rest in `locales/pending/F09.json`.
