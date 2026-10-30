# F07 Solo classes and coach picker · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 from the approved F07 design (`design.md`, approved 30 Oct 2026, gate 2, D155; answers D156) and the approved requirements (`requirements.md`). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `COACH-01 refuse a coach on approved leave`. A merged migration is never edited. New text goes in `locales/pending/F07.json` (D81).

Roles: **BE-B** back end booking, **BE-C** back end commerce, **FE-P** front end player app, **FE-A** front end admin and coach, **QA**, **Content**.

Depends on: F01 (people, roles, settings registry with `rest_cap_hours`, route wrapper T13, blind suite T18, worker T34); F03 (`app.reserve_court`, `app.coach_rules_check` hook in 0213, `app.release_handlers`, `occupancy` exclusion constraints, `move_booking`); F04 (price lines, `coach_tier`, `coach_tier_price`, Pay); F06 (credit eligibility); F09 (`cancel_handlers`, the free cancel after a coach change); F10 (`app.enqueue_message`, until then the no op hook). Migration numbers 0801 to 0808, one task per file, rising in task order (T01 0801, T02 0802, T03 0803, T04 0804, T05 0805, T06 0806, T07 0807, T08 0808; the design's table lists the same files).

**Overlap to resolve first.** F03-T29 already lists a migration for `app.add_coach_to_booking(booking, coach)`. F07's design defines `app.add_coach_to_booking(booking, coach, order)` with the add order and a release handler (T06). Decided by the orchestrator (30 Oct 2026): F03-T29 is dropped (never built) and F07-T06 owns the function.

**Cross-feature tasks (named here, owned by other lists, listed for the orchestrator), with their approval and dependency order:** F03-T31 (0228) before T09; F10-T06 before T10; F09-T04 (it reads `coach_was_changed`) after T07; T18 after F09-T04. The tasks are: F03-T31 (`app.move_booking` calls `coach_rules_check_move`), F07-T03 supplies the second handler; F09's free cancel for a substituted coach (F09-T04). Not startable until the rest of F07 exists: F13-T10 and F12 read `coach_pay` (T02).

## A. Tables and rules

- [ ] **F07-T01** Migration 0801: `coach`, `coach_availability_rule`, `coach_leave` (time range on whole hours, optional free text type and note, no list of types, D156), `coach_price_override` (one nullable price per price group, D156); foreign keys from `booking.coach_id` and `occupancy.coach_id` to `coach`. IDs: COACH-01, COACH-02-AC3, R2, CC-1. Role: BE-B · Deps F03 0213, F04-T01 (`coach_tier`) · Size: M
  Tests first: composite club keys; an overlapping leave for one coach is allowed but only `approved` rows block; another club's coach is not reachable; an override per price group, none means the tier price.
- [ ] **F07-T02** Migration 0802: `coach_pay` (owner only; monthly base, per session solo and group, fixed or percent of the coaching portion; nulls for unset values, D156). IDs: COACH-02, R2, CC-3. Role: BE-B · Deps T01 · Size: S
  Tests first: no role but the owner reads or writes it; the Accountant, front desk and BOOQ staff are refused; a null is allowed and never replaced by a default.
- [ ] **F07-T03** Migration 0803: `app.coach_check(club, coach, starts[], ignore_booking, ignore_session) returns text` (the `ignore_session` default argument is for F08's session edit, D155 C-3), `app.coach_rest_run`, `app.coach_rules_check` registered with `app.register_coach_rules`, `app.coach_rules_check_move` for `move_booking`, `app.lock_coach` replaced with a row lock. IDs: COACH-01-AC1 to AC12, R3-AC1 to AC7, CC-4. Role: BE-B · Deps T01, F03 0213 · Size: M
  Tests first (the design's list): leave, no rule, a closed time over an open rule, a held hour, a confirmed group class, an inactive coach; a 7th hour refused, a free hour resets the run, unpaid held hours count, staff bookings refused with no override argument; an empty `rest_cap_hours` uses 6 (D156); two parallel bookings of the 6th and 7th hour give one success (CONC-17).
- [ ] **F07-T04** Migration 0804: `app.coaches_offerable`, `app.assign_court` (lowest numbered open court, kept for the hours of one selection), `public.public_coach_card` view, `public.public_coach_times` function. IDs: COACH-01, R1-AC1 to AC8, COACH-02-AC1. Role: BE-B · Deps T03 · Size: M
  Tests first: the public view exposes only the fields of a published, consenting coach and never leave, notes or pay; no court open shows `no_court_open`; the same court is kept across two hours of one selection.
- [ ] **F07-T05** Migration 0805: `app.save_coach`, `app.set_coach_active` (refuses with future sessions), `app.publish_coach_profile` (needs the consent record), `app.set_coach_price_override`, `app.set_availability`, `app.request_leave`, `app.decide_leave`. IDs: COACH-02, R2-AC1 to AC7, D120. Role: BE-B · Deps T03 · Size: M
  Tests first: only the owner saves, publishes, deactivates and decides leave; a coach edits only their own availability and leave; a pending leave is still offered; a decline changes nothing; each change writes an audit row.
- [ ] **F07-T06** Migration 0806: `booking_coach_add`, `app.add_coach_to_booking(booking, coach, order)`, release handler `app.f07_release` registered at `ord` 35. IDs: COACH-03, R5-AC1, R5-AC2, R6-AC1 to AC3, BOOK-04-AC2, AC3, D111. Role: BE-B · Deps T03, F03 (hold, release handlers), F04 Pay · Size: M
  Tests first: a solo class stores coach and court together and the database refuses one without the other (R5-AC1); a two hour selection is one order with one solo booking per hour and the rest rule is checked every hour (R5-AC2); a busy coach refuses and the booking is unchanged; a free coach is claimed on the existing occupancy row; a second coach on the same hour is refused by the database; an unpaid add order released frees the coach again; staff may add in a Paused club.
- [ ] **F07-T07** Migration 0807: `coach_substitution` (append only), `coach_flagged_session` view, `app.substitute_coach` (owner), `app.coach_was_changed`, the no op `app.coach_message_hook`. IDs: R4-AC1 to AC7, COACH-03. Role: BE-B · Deps T03, T06 · Size: M
  Tests first: the new coach passes `coach_check` including the rest rule; the old coach is freed in the same transaction; the customer's cost does not change; a flagged session lists solo and group sessions of a coach on leave; `coach_was_changed` is true for the F09 free cancel; a rejected substitute changes nothing.
- [ ] **F07-T08** Migration 0808: policies and grants, the coach and Accountant column limits, table class, audit and test table registry entries. IDs: CC-1, CC-3, PDPA-01. Role: BE-B · Deps T01 to T07 · Size: S
  Tests first: the blind suite shows BOOQ staff read nothing; a coach reads only their own leave, availability and sessions; the Accountant reads no pay.

## B. Wiring in other features (listed, owned by their lists)

- [ ] **F07-T09** Wiring test for F03-T31: `app.move_booking` uses `app.coach_rules_check_move` so a moved booking ignores its own row (design A-3). IDs: COACH-01-AC11, R3. Role: QA · Deps T03, F03-T31 · Size: S
  Tests first: moving a six hour run by one hour does not count its own row twice; a move that breaks the rest rule is refused.
- [ ] **F07-T10** F10 follow-up: replace `app.coach_message_hook` with `app.enqueue_message` for `coach_changed` and `session_change` once F10-T06 is merged. IDs: R4-AC5, R5-AC4, LINE-05. Role: BE-B · Deps T07, F10-T06 · Size: S
  Tests first: a substitution enqueues one message for the customer and one for each coach, once, by dedupe key; the confirmed card names coach and court and the coach gets New session (R5-AC4).

## C. Routes

- [ ] **F07-T11** Public and player routes: `GET /coaches`, `/coaches/{id}`, `/coaches/{id}/times`, `/coaches/offerable`, `POST /bookings/{id}/coach` (schemas in `packages/contract`). IDs: R1, COACH-01, COACH-03. Role: BE-B · Deps T04, T06, F01-T13 · Size: M
  Tests first: a guest sees public fields only; a hidden coach is refused by the API as well as the screen; typed codes `coach_unavailable`, `rest_rule` (with `hours`).
- [ ] **F07-T12** Owner and coach routes: coaches, pay, price overrides, availability, leave, flagged sessions, substitutes, substitute. IDs: COACH-02, R2, R4, CC-2. Role: BE-B · Deps T05, T07, F01-T13 · Size: M
  Tests first: front desk cannot substitute, decide leave or read pay; a coach cannot read another coach's leave; the pay route returns nulls for unset values.
- [ ] **F07-T13** Checkout inputs: F04's quote and Pay accept the coach and `coach_source` and take the tier price, the override and the tier from F07 (F04's quote and Pay already take the coach; F07 only supplies the override table and `coach_check`); F07 supplies `coach_check` and the tier. IDs: COACH-02-AC1 to AC9, COACH-03-AC1 to AC5, COACH-04-AC1 to AC4, R5-AC3, R5-AC6, F06 R1-AC10. Role: BE-C · Deps T03, T04, F04 Pay, F06 credit eligibility · Size: M
  Tests first: the price for a Student and an Adult group; an override replaces the tier price for one group; a solo credit covers the coaching line only and the court is paid separately (COACH-04); a held coach hour is refused at Pay; future solo hours count toward the booking limit (R5-AC3, D49); a price change after booking keeps the booked price (R5-AC6, D120); a solo credit covers the coaching line only (F06 R1-AC10, which closes that F06 criterion).

## D. Screens

- [ ] **F07-T14** C5 Solo classes and C6 Coach profile (H-C05-Solo-classes, H-C06-Coach-profile) with times and states. IDs: R1-AC1 to AC8, COACH-01. Role: FE-P · Deps T11, T19 · Size: M
  Tests first: no court open and coach no longer available states; longest Thai strings do not wrap buttons.
- [ ] **F07-T15** C10 coach pick, C10b solo checkout and the Add a coach flow (G-C10-Add-coach-checkout, G-C10-Coach-picked, H-C10b-Checkout-solo, G-C12-Add-coach). IDs: COACH-03, COACH-04, R6. Role: FE-P · Deps T11, T13, T19 · Size: M
  Tests first: the solo summary shows `{coach}` and `{court}`; the rest cap refusal shows `{hours}`; a coach that became unavailable offers another.
- [ ] **F07-T16** A7 Coaches (profile, tier, publish with consent, overrides, pay, leave decisions, flagged sessions, substitute) (H-A07-Coaches). IDs: COACH-02, R2, R4. Role: FE-A · Deps T12, T19 · Size: M
  Tests first: front desk does not see pay or Substitute; a pay field left empty shows as not set.
- [ ] **F07-T17** K3 Availability and K4 Leave for the coach (H-K3-Availability, H-K4-Leave). IDs: R2-AC1 to AC7. Role: FE-A · Deps T12, T19 · Size: M
  Tests first: a coach edits only their own rules; leave is chosen as whole hours; a decision shows on the coach's list.
- [ ] **F07-T18** C13b Coach changed state (G-C13b-Coach-changed) and the free cancel entry. IDs: R4-AC4, CANCEL-01-AC18. Role: FE-P · Deps T11, F09-T04, T19 · Size: S
  Tests first: the new coach's name is shown and nothing else about them; the cancel sheet shows full value.
- [ ] **F07-T19** Content: `locales/pending/F07.json` (design section 13), existing keys first. IDs: TEXT-01 to TEXT-06. Role: Content · Deps none · Size: S
  Tests first: key sets and variables match in both languages; no existing key edited.

## E. Cross checks and sweep

- [ ] **F07-T20** Concurrency and no double booking suite: court and coach claimed together or not at all, a loser on the coach leaves nothing on the court, substitution with two coaches locked in id order, add coach racing a staff booking. IDs: COACH-01, COACH-03, R3, R4, BOOK-04, CC-4. Role: QA · Deps T06, T07 · Size: M
  Tests first: the suite is the task (20 parallel requests per case).
- [ ] **F07-T21** Acceptance sweep: every acceptance criterion of COACH-01 to COACH-04 and R1 to R6 has a named test; walk the F07 boards; file gaps with the ID. IDs: COACH-01 to COACH-04, R1 to R6. Role: QA · Deps all · Size: M
  Tests first: a table of criteria to tests with none empty. R5-AC5 (Played at the end of the slot, K5 attendance) is closed by F09-T01 (Played is derived) and the F12 K5 task; the sweep lists those tests against it.

Order: T01, T02, T03, T04, T05, T06, T07, T08 (migration order), T19 early, then T09, T10, T11, T12, T13, the screens, then E. About 21 tasks, each under a day. F13-T10 and F12 wait for T02.
