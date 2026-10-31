# F09 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F09-cancellation-closures/requirements.md`, after the F09 lane work up to T07 (main cf4d871). F09 criteria were first covered inside the F06 sweep (the no refund inventory, QA-F09-1). T08 (the staff and player screens' routes) is not on main yet, so it is not swept.

The lane's tests number criteria without the prefix (AC9, AC14, AC21), so ID matching missed them. 22 criteria are now mapped by test title: CANCEL-01-AC4, AC5, AC6, AC9, AC14, AC15, AC16, AC17, AC20, AC21, AC22, AC23 (`cancel-booking.test.ts`, `return-booking-value.test.ts`, `cancel-outcome.test.ts`), CANCEL-03-AC3, AC4, AC5, AC6, AC8, AC13, AC15, AC17 (`closure-create.test.ts`), CANCEL-04-AC6, AC7, AC10 (`staff-marks.test.ts`). The mapping is by title, so a renamed lane test turns it red.

The cancel session closure of F08 (migration 0919, `cancel_session` with reason `closure`) is covered by `class-cancel-edit.test.ts`, and `record_booking_cancel` (1012) by `record-booking-cancel.test.ts`.

Still todo (waiting on T08 or on a later task): CANCEL-01-AC7, AC12, AC19; CANCEL-02-AC2, AC6; CANCEL-03-AC10, AC11, AC14; CANCEL-04-AC2, AC8, AC11, AC12. 

New question for the product owner (Q-36 in `open-questions.md`): CANCEL-04-AC9 still says the no show timing is read from a club setting, but D118 says staff mark a no show only after the slot ends and nothing else, and the lane test confirms no setting is read. AC9 looks stale.

## Update, 31 Oct (main cee820f)

- **Q-36 settled as D172:** CANCEL-04-AC9 is withdrawn (no show timing setting; D118). It stays as a todo skeleton until the requirement text is removed.
- **New QA tests** (`F09-cash-and-solo-closure.new.spec.ts`): CANCEL-02-AC5 (also F05 PAY-06-AC7): a booking paid in cash, cancelled in time, returns to the wallet as a refund and changes no payment row. CANCEL-03-AC7: a solo class in a closed range is cancelled with full value even inside the window, and the court and the coach are both free. Both pass.

## F09-T18 and T19, 31 Oct (main 43b77b0)

**T18 concurrency and no cash** (`F09-concurrency.new.spec.ts`): a Beam callback racing the player leaving the page (the hold is released as player), 20 rounds: the payment is final, one receipt, and either the booking is confirmed with the wallet untouched, or it stays released and the whole amount goes to the wallet (a late payment that credits half the amount turns it red). Proved by the lane and traced: two cancels at once (`cancel-booking.test.ts`), a repeated return (`return-booking-value.test.ts`), a cancel racing a closure and a closure racing a new booking (`closure-create.test.ts`). No refund anywhere: route and source inventory (`F09-cancellation-closures.new.spec.ts`), the schema checks of F13-T20, and the wallet function list of F06-T23.

**T19 sweep gate** (`F09-gate.new.spec.ts`): 57 criteria, 52 with a real test, 5 listed. The F06 R1-AC6, AC7 and AC10 cases are listed against the F06 sweep: AC6 and AC7 (full value on a club cancel and a closure) are traced here to `cancel-outcome.test.ts` and `closure-create.test.ts`; AC10 (a solo class paid with a solo credit) waits for the solo credit pay path (F07 COACH-04). New QA tests: nothing removed is built (no check in, no gift voucher, no message editor, no slip queue: routes, pages, the sidebar and the schema; three mutations red) and the closure table records its courts, range, repeat, reason and staff member (`F09-removed-and-record.new.spec.ts`).
