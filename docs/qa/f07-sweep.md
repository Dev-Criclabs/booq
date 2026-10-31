# F07 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F07-coaches/requirements.md`. The database work is complete (rules, offers, leave, substitution, add a coach, solo class claim, policies, admin). Routes, jobs and screens are still to come.

**Result: 68 criteria. 43 were already cited, 13 newly traced, 1 new QA test, 11 still open (reasons below). No new finding.**

The lane's tests are strong where it counts: the rest rule is run across a selection, runs count held and group hours, the 6th and 7th hour in parallel give one success (CONC-17), the check takes no override argument, and a solo class claims court and coach in one occupancy row with the loser leaving nothing behind.

Newly traced: COACH-01-AC2, AC3, AC5, AC6, AC9, AC10, AC11, AC12; COACH-02-AC2, AC7, AC8; COACH-03-AC1, AC4.

New QA test (`F07-substitution-audit.new.spec.ts`): R4-AC7, a substitution writes an audit entry with the owner as actor, the reason and the new coach, and a refused one writes none. It passes; the lane test did not assert the audit.

Still open:

| Criterion | Why it is open |
|---|---|
| COACH-02-AC4 | A coach with no price shows no price and cannot be picked: the card and the quote refusal are not built. |
| COACH-02-AC5 | Court portion as a club setting: the checkout test uses the price rule; the setting itself is not covered. |
| COACH-02-AC6, COACH-02-AC9 | Coach card at checkout (screen, Playwright). AC9 (no prices hard coded) needs a source scan once the card exists. |
| COACH-03-AC2, AC5 | A solo pack credit used through Classes, and valid after its package expires: `credit-functions` covers the tier fit; the reserve at pay time and the expiry rule have no test yet. |
| COACH-04-AC1 to AC4 | Solo class with a solo credit (coach line zero, court by Beam, one order, return on a 12 hour cancel): the pay and cancel routes are not built. |
| R5-AC4 | The Booking confirmed card names coach and court: `coach-message-hook` checks the facts; the card text is F10. |

## F07-T09, T20, T21, 31 Oct (main 43b77b0)

**T09 wiring test** (`F07-move-wiring.new.spec.ts`): the move hook is `app.coach_rules_check_move`; a solo class moved inside its own run is not counted twice (six in a row, the last moved to the hour before the run: allowed); a move that does make a seventh hour is refused with `rest_rule` and nothing moves. Mutation checked: unregistering the move hook turns 2 of 3 red; not ignoring the booking's own row turns the move test red.

**T20 concurrency** (`F07-concurrency.new.spec.ts`): two substitutions in opposite directions at once never deadlock and swap the coaches (8 rounds, `QA_ROUNDS` for more); a player's Add a coach racing a staff booking of the same coach for the same hour: exactly one wins, the coach is held once. The lock order of a substitution is shown deterministically: a test connection holds the higher coach id while the substitution runs, and the lower id must already be held by the waiting substitution; locking the from coach first turns it red. Racing alone does not find a lock order bug (80 rounds with a wrong order still pass). Removing the coach lock from a substitution or from the add stays green: the exclusion constraint and the booking row lock hold the guarantee (accepted, as QA-T-1). Already proved by the lane and traced: a solo class claims court and coach together; the loser leaves nothing; 6th and 7th hour in parallel.

**T21 sweep gate** (`F07-gate.new.spec.ts`): 68 criteria, 55 with a real test, 13 listed with a reason (the C6 and C10 screens, the solo credit pay path, and four rules waiting on F09 and F12). COACH-02-AC9 (no price in the code) is a QA test: the only large numbers in the checkout, coach and class code are basis points (`F07-no-hardcoded-prices.new.spec.ts`; a price constant turns it red).
