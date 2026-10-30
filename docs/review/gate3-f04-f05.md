# Gate 3 check: F04 and F05 task lists

Reviewer, 30 Oct 2026. Read from `origin/main` (head 9d3e2a9): `specs/features/F04-checkout-pricing/tasks.md` (18 tasks) and `F05-beam-payments/tasks.md` (14 tasks), against their approved requirements and designs (D82), F03's task list, the migration rules in the build plan (numbers only go up, `migrate.ts` refuses a lower number than one already applied), and `docs/review/checklist.md`. AC coverage was counted by script from the `IDs:` lines; a task that names a whole rule ("R1 to R4", "PAY-02") was counted as covering that rule, which is generous.

## Verdict

**Not ready to approve.** Four blocking items (task size, migration order, an unassigned migration range, tasks with no requirement ID) and five should-fix items (G3-5 to G3-9). The only question is G3-9, for the Orchestrator.

## Blocking

### G3-1 | blocking | Three tasks are labelled L (over a day)
F04-T11 (`POST /checkout/pay`: gate, reprice, lock order, `reserve_court`, order and lines, credit and wallet reservation, code count, birthday record, zero money path), F05-T05 (`app.apply_payment`: confirm, reclaim, late to wallet, duplicate, cancelled, paused, deleted, wallet credit with order, receipt and ledger row) and F05-T08 (webhook: token, HMAC, dedupe, lookup, five response cases) each exceed the one-day rule (CLAUDE.md step 3, hand-off). Fix: split.
- F04-T11 into: (a) gate and reprice with `price_changed`; (b) order, lines and `reserve_court` under the FA 3.4 lock order; (c) credit, wallet, code and birthday reservation; (d) zero money path.
- F05-T05 into: (a) confirm and reclaim; (b) late payment to the wallet with its own receipt; (c) duplicate, cancelled, paused and deleted-account cases (D107, D109).
- F05-T08 into: (a) token, signature and dedupe; (b) lookup and amount decision (PAY-02-AC6); (c) response codes and alerts.

### G3-2 | blocking | Migration numbers do not follow task order
F04: T04 is 0304, T05 is 0306, and T06 is "0307 and the template handlers (migration 0305)". Task order puts 0306 before 0305, and T06 does not depend on T05, so 0305 can merge after 0306 and `migrate.ts` refuses it ("out of order"). Fix: order the tasks so numbers rise (T04 0304, template handlers 0305, grants 0306, settings keys 0307), or renumber, and make the dependencies say so. Split T06 into its two migrations.
F05: T01 uses 0401 and 0402, T02 uses 0404, and the design's 0403 (`app.apply_payment`, `credit_wrong_amount`, `start_payment`) belongs to T04, T05 and T06 with no task naming the number. T02 (0404) does not depend on T05 (0403), so the same inversion is possible. Fix: name 0403 in the function tasks (one task owns the file) and make T02 depend on it.

### G3-3 | blocking | F05 migration 0405 and F04 migration 0307 have no task or owner clarity
F05's 0405 (settings keys `package_qr_minutes`, `qr_expiry_margin_seconds`, reconcile settings) is assigned to no task. F01 already registers `package_qr_minutes` as a Tennis template setting (spec-consistency F01-8), so registering it again in 0405 may duplicate it. Fix: one task per migration file; state which migration registers each setting key and remove the duplicate.

### G3-4 | blocking | Tasks with no requirement ID
- F05-T09 (`beam_reconcile`, `package_order_expiry`, QR image clean-up): IDs are "decisions D73, D74" only. It should name PAY-02-AC15, PAY-04-AC1 to AC7.
- F05-T10 (alerts and `club_health` rows): "decision D75" only. Should name PAY-01-AC7, PAY-02-AC5, AC6, AC9.
- F05-T13 (Playground checks): "design 3.3". Acceptable only if it is declared a setup task that no requirement covers; say so, as F02-T00 does.
- F04-T09 (money formatter): "D69, CC-5". Add R4-AC11 (the whole baht rule).
- F04-T18 and F05-T14 (sweeps): CC IDs only. A sweep must name the ACs it closes (F01-T37 and F02-T25 name "all F01").
Checklist 1.2 and CLAUDE.md step 3 require every task to name its requirement IDs.

## Should fix

### G3-5 | Tests-first line missing
No "Tests first" line on F04-T15, T16, T17 (screens) and F05-T12 (C11), T13, T14. The two screen tasks need a Playwright test written from the ACs (and the longest Thai string, TEXT-06); T13 is a manual Playground task and needs a "done when" line instead; sweeps may say "this task is the tests".

### G3-6 | Acceptance criteria no task names
By script (whole-rule mentions excluded):
- F04: PROMO-01-AC9 (another club's code gives "code not valid"; T10's test text covers it but does not name the AC), AC10 (discount split and restore per hour; T04's test text covers cancel-one-hour but does not name it), AC11 (referral code as the one code), AC13 (code makes amount due zero), AC14 (restored use not counted in the partner report).
- F05: PAY-01-AC9 (sandbox only, no simulate route, no booking confirmed without a signed callback), PAY-01-AC10 (nothing sent to Beam on refund or credit; T03's no-refund interface test covers it but does not name it), PAY-04-AC1 to AC7 (package QR and late package payment).
Not covered by any task text at all: R2-AC9 (Add a coach after booking: coaching portion only; D111 makes the top-up its own order and receipt) and R3-AC6 (add-on lines linked to their booking so F09 can return them). F03 has no `add_coach_to_booking` task either, so the coach on an existing booking has no uniqueness protection (spec-consistency F04-8). Fix: add the IDs to the tasks that already test them, and add a task for the add-a-coach path and a test for R3-AC6 (D111: the add-on belongs to the first hour of the order).

### G3-7 | Open findings carried into the tasks
These are in the approved designs and the task lists inherit them. They are not new, but the task list is the last place to catch them.
- `reapply_order_entitlements` (spec-consistency F03-2): no task re-counts the code use and birthday entitlement when a late payment reclaims an order. F04-T04 builds only the restore side and F05-T05 does not call a re-apply. D109 widens the late-payment refusal reasons but the tasks do not name D107 or D109.
- F05-1: F05-T05's tests cover "every row of the 5.4 table", but the table has no row for a Beam success on a payment that cash already cancelled (F05-T07 cancels the pending Beam payment). Add that case and the guard that accepts it.
- F05-5: F05-T03 says the QR margin has "no value in code" but no test says what Pay does while the margin is unset. Add: Pay refuses with `payment_unavailable` and a P1 alert.
- F05-T04 releases the hold on `payment_unavailable`, which the F03 release reasons do not include and which would send a "Booking released" message (spec-consistency F03-6). Name the release reason and an F05 release handler.
- The `payment` row insert sits between F04-T11 (Pay) and F05-T04 (`startPayment`) with no task naming it (spec-consistency F04-10).

### G3-8 | Dependencies
- F04-T04 depends on F03-T10 (future hours limit), which it does not use; the release handler registry is F03-T06.
- F04-T11 depends on F03-T08 and T13 but also needs F03-T07 (selection checks), T09 for the solo path, T11 (same hold on a second tap, D47) and T12 (Pay tap limit). Add them.
- F04-T14 and F05-T05 depend on F06 and F13, which have no task list yet. The interface-plus-fake route is stated and fine; record that F04-T14 is not startable until F06's court bundle product exists, as it says.
- F05-T05 and T10 carry two roles (`Arch/BE-C`). `docs/review/lanes.md` gives `packages/db` to the Architect and commerce functions to BE-C under the approved build plan, so the PR must be one role's. Name one owner per task, or split the migration (Arch) from the code (BE-C).

### G3-9 | Gate order and a question
F04-T01 to T03 are ticked and merged (commits debc5a7, merged in 9d3e2a9) while the file says "DRAFT for a quick check (gate 3)". Gate 3 is "approved by a person (quick)" (`docs/DEVELOPMENT-PLAN.md` s.1). Checklist 0.1 asks that the task list be approved before code. **QUESTION** for the Orchestrator: was building F04-T01 to T03 authorised ahead of gate 3? If so, say it in the file's status line. The Reviewer's review of those three tasks (migrations 0301 to 0303) is not part of this check and has not been done.

## Notes

- F04-T07 is marked "Deps none" and "no database, no clock", which fits: it is pure code. Its test list names the worked examples (130000 and 120000 satang) and a sum property; good.
- F04-T08 says a tie goes to the code and a fixed code is split with largest remainder. Neither is stated by a decision (spec-consistency F04-2 and F04-9). Keep as a test the Reviewer will check against the design, not as a rule.
- F04-T10 and T12 name CC-2 and test that the client sends no amount; good. F05-T03's "the interface has no refund method and the double fails if one is attempted" is a good test of CANCEL-02.
- F05-T14 is size S for a sweep of 54 acceptance criteria; same point as G3-1 for the sweeps.
- F05-T11 is a BE-P task on payment setup and the key swap check; the swap must happen before Go live under D127 and D108, which the task states.

## Counts

Blocking 4, should fix 5 (G3-5 to G3-9), notes 5.
