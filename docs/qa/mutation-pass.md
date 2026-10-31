# Mutation pass on the new QA tests

31 Oct 2026. For each new test, one edit is made to the product code (a migration or a source file), the test is run, and the edit is undone. A test that stays green is recorded here. `tests/support/mutate.sh <file> <sed> <tests...>` does one edit and restores the file; it refuses a file with uncommitted changes. No product file is changed in the repository.

| Test | Edit to the product | Result |
|---|---|---|
| CONC-31 parallel reconcile | `apply_payment` no longer returns early for a payment already succeeded (0809 line 78) | red (a second amount goes to the wallet) |
| CANCEL-02-AC5 cash cancelled to wallet | `return_booking_value` writes the reason `adjust` instead of `refund` (1005 line 82) | red |
| CANCEL-03-AC7 solo class in a closure | the closure calls `cancel_booking` as a staff cancel without the closure id (1009 line 286) | red |
| CANCEL-03-AC7 | the closure passes club cancel false but keeps the closure id | **green**. Equivalent: the closure id alone decides full value |
| CANCEL-03-AC7 | `cancel_booking` no longer deletes the occupancy row (1007 line 107) | **green**. Equivalent: `create_closure` frees the hour itself before closing it |
| R4-AC7 substitution audit | the audit registration of `coach_substitution` is commented out (0807 line 57) | red |
| CLASS-02-AC13 claim time | `waitlist_advance` reads a fixed 30 instead of the setting (0908 line 145) | red |
| ADMIN-06 customer CSV | the formula prefix is removed from `cell()` in `export/csv.ts` | red |
| PAY-01-AC2 no slip route | a route in `export/routes.ts` is renamed `/slips/check` | **green at first, fixed**: see S1 |
| CONC-27 callback against hold release | `apply_payment` no longer locks the order and payment rows | **green** |
| CONC-27 | `release_hold` no longer locks the booking rows | **green** |
| CONC-27 | `release_hold` no longer takes the customer lock | **green** |
| CONC-27 | `reclaim_order` no longer locks the booking rows | **green** |
| CONC-27 | all of the above together, and `lock_resource` removed from `reclaim_order` | **green** |
| CONC-27 | `apply_payment` always sends an expired order to the wallet (never reclaims) | red |

## What stayed green

**S1, fixed.** The PAY-01-AC2 inventory read the mounted route tables only. A route factory that is written but not mounted is invisible to it, and that is exactly the state of the export routes today. The test now also reads every `path:` literal under `apps/web/src/api` and `apps/platform/src`; the same edit now turns it red.

**S2, QA-T-1 (a test that cannot see lock removal).** CONC-27 goes red when the outcome is wrong (the last row) but stays green when any lock, or all of them, is removed, even with a test only trigger that sleeps 40 ms inside every booking update to widen the window. Two readings fit, and QA cannot tell them apart from the outside: (a) the invariant is also held by the exclusion constraint on occupancy and the status guards in the updates, so a lock is not what keeps the outcome right; (b) the two calls still do not interleave inside the unlocked section. Not a product defect. What it means: CONC-27 proves the outcome, not the lock order. If the lock order matters (it is in the architecture, FA 3.4), it needs a deterministic barrier that the test can hold, such as a test only function the lane exposes, or a second connection holding `pg_advisory_xact_lock` on the same key. **Accepted (orchestrator, 31 Oct):** CONC-27 stays an outcome check. The guarantee the product relies on is the exclusion constraint plus the status guards, not the lock order. The constraint is tested directly by the lane (`packages/db/src/occupancy.test.ts`: overlapping court row, overlapping coach row, held against confirmed, closure against booking); removing `occupancy_no_overlap_resource` from migration 0203 turns five of those tests red. CONC-27 itself stays green with the constraint removed, because its scenario has one order and no second party for the slot; the double booking guarantee is proven by the occupancy tests and by the lane's `reclaim-order` parallel test, not by CONC-27.

**S3, equivalent mutants.** The two CANCEL-03-AC7 survivors are not holes in the test: another part of the closure does the same work, so the edit changes nothing observable.

## Found on the way (product wiring, not a QA finding)

`exportRoutes` (F01-T25, `POST /exports` and `GET /exports/:id`) is exported from `apps/web/src/index.ts` but no mount in `apps/web/src/server/mounts.ts` calls it, so the owner's club data export (PLAT-06-AC11, AC12) is not reachable from the app. The customer CSV (`GET /staff/customers/csv`) is mounted.

## Cancel record (1012) and closure end and roll (1010), run 31 Oct on main 6fe08d8

These are the lane's tests (`record-booking-cancel.test.ts`, `closure-end-roll.test.ts`).

| Edit | Result |
|---|---|
| `end_closure`: the invalid range check (past, before the start, not shorter) removed | red |
| `end_closure`: an ended closure may be ended again | red |
| `end_closure`: no reason needed | red |
| `roll_closure`: the occurrences found are not applied | red (2 tests) |
| `closure_roll_allowed`: a player may roll | red |
| `record_booking_cancel`: the reason is not trimmed | red |
| `record_booking_cancel`: a player cancel keeps a reason | red |
| `roll_closure`: an ended closure rolls | green, equivalent: `closure_new_occurrences` finds nothing past the cut end |
| `roll_closure`: a one off closure rolls | green, equivalent: the one occurrence is already on the occupancy, so nothing is new |
| `roll_closure`: no booking window setting, roll anyway | green, equivalent: no new occurrence is found without a window (checked by reading `closure_new_occurrences`; not provable from outside) |

The three survivors guard the same thing twice (defence in depth). No test is missing.

## Offer Pay (0417), cap thresholds (0605, 0613) and cancel session records (1013), run 31 Oct on main d709178

| Edit | Result |
|---|---|
| `price_offer_order`: a second tap prices again | red (lane test) |
| `price_offer_order`: an ended hold still prices | **green in the lane test, red in QA's new test**. The route refuses an ended hold before the function, so the function's own check was untested. QA added `F04-offer-price.new.spec.ts`, which calls the function directly |
| `price_offer_order`: another player may price the shell | green in the lane test, **red in QA's new test**. The `exists()` check on the booking's customer is a second guard, so the mutation had to remove both; the new test calls the function as another player |
| `price_offer_order`: the entry need not be offered; more than one booking is fine; the order kind is not checked; the customer lock removed | green, not killed. The entry check is covered by the hold and booking checks (a declined offer releases the hold); the booking count and kind cannot be built through the offer path; the lock needs a race. Recorded, not chased |
| `cap_state`: `>` for `>=` at 70, 80 or 100 percent | red (lane tests, 2 to 5 tests each) |
| `cap_state`: the alert reads the stop threshold | red |
| `cap_state`: the percent computed on a wrong base | red (11 tests) |
| `record_line_usage`: the owner told on a free plan | red |
| `record_line_usage`: reminders voided only at 100 percent | red |
| `record_line_usage`: the owner told on every sync, not once a month | red |
| `record_line_usage`: reminders voided at the alert state (70 percent) | green, equivalent: `void_cap_reminders` checks the state itself. QA still added `F10-cap-below-eighty.new.spec.ts`, because the lane never asserted that a reminder stays pending at 70 and 79 percent |
| `cancel_session` (1013): no cancel record, a fixed kind, no reason | red |
| `cancel_session` (1013): the returned value is not stored on the record | **green in the lane test, red in QA's new test** (`F09-session-cancel-record.new.spec.ts`) |

## Package saving (0519), desk package sale, notification switches (0602), run 31 Oct on main 43b77b0

| Edit | Result |
|---|---|
| `package_saving`: no clamp at zero, ignores the pack price, credits not multiplied, differing prices still count, weekend price not required | red (1 to 7 lane tests each) |
| `package_saving`: unset prices tolerated (`count(*) = count(price)` removed) | green, equivalent: the group check (every group in scope has its whole week priced) already refuses an unset price |
| Desk package sale (`staff.ts`): a looser permission, no idempotency, cash taken when the wallet covers the price, the wallet amount reported as 0 | red |
| Desk package sale: the quote read with `forCustomer: false` | green, equivalent: front desk and owner can read the buyer's date of birth through the ordinary route, so both paths give the same answer. It would matter if staff could not read it |
| Notification switches: default promotions on, default reminders off, a save that writes the other switch | red |

