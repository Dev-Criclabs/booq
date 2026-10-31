# F08 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F08-classes-waitlist/requirements.md`. The database work is complete (templates, sessions, generation, views, take seat, waitlist, offers, handlers). Routes, jobs and screens are still to come.

**Result: 39 criteria. 23 were already cited, 11 newly traced, 2 new QA tests, 4 still open (reasons below). No new finding.**

The lane's tests are strong: eight parallel takers of three seats give exactly three (CC-4), a held seat counts toward capacity, offers go to the first in line, an offer ends at the earlier of claim time and start, declines pass on, and a released seat or cancelled hold offers the spot in the same transaction.

Newly traced: CLASS-01-AC6, AC7, AC8, AC9, AC12; CLASS-02-AC5, AC7, AC10, AC14, AC15; WAIT-01-AC5.

Partial traces to note: CLASS-02-AC7 is shown by two parallel takers of the last seat; the claim of an offer by its holder against a walk-in is covered by AC14. CLASS-01-AC6 and AC7 are covered at the view; the C7 and C8 screens are Playwright.

New QA tests (`F08-claim-time.new.spec.ts`): CLASS-02-AC13, a changed claim time applies to the next offer only (the first keeps 03:30, the second gets the new 10 minutes), and a changed cut off blocks the next offer while an open one stands. Both pass.

Still open:

| Criterion | Why it is open |
|---|---|
| CLASS-01-AC15 | C8 offers the drop in price or the 8 pack when there are no group credits: screen (Playwright), F06 R3-AC3. |
| CLASS-01-AC16 | Below minimum alert at the club's alert time: the lane tests the alert being voided when the minimum is reached; the producer job is not built. |
| CLASS-01-AC18 | Rule for test authors (do not use the canvas samples). Nothing to run. |
| WAIT-01-AC4 | A court waitlist entry ends when its time passes: the expiry job is not built. |

## F08-T20 and T21, 31 Oct (main 43b77b0)

**T20 concurrency** (`F08-concurrency.new.spec.ts`): a seat freed by a cancel while a walk-in asks for it at the same instant: over 4 rounds the walk-in never gets the seat and the first in line is offered it, and the session never holds more than its maximum (unregistering the waitlist cancel handler turns it red). An offer expiring while its holder confirms the seat: never a confirmed seat on an expired entry. Mutations of `offer_expire` (ignoring the status or the time) stay green: `pass_offer_on` re-checks the status under its own lock, and the time gate does not matter once the offer has ended (equivalent). Already proved by the lane: two takers of the last seat, eight takers of three seats, a held seat counts toward the maximum.

**T21 sweep gate** (`F08-gate.new.spec.ts`): 39 criteria, 37 with a real test, 2 listed (CLASS-01-AC15 the C8 screen and the F06 pack flow; CLASS-01-AC18 a rule for test authors).
