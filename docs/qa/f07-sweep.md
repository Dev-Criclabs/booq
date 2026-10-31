# F07 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F07-coaches/requirements.md`. The database work is complete (rules, offers, leave, substitution, add a coach, solo class claim, policies, admin). Routes, jobs and screens are still to come.

**Result: 68 criteria. 43 were already cited, 13 newly traced, 12 still open (reasons below). No new finding.**

The lane's tests are strong where it counts: the rest rule is run across a selection, runs count held and group hours, the 6th and 7th hour in parallel give one success (CONC-17), the check takes no override argument, and a solo class claims court and coach in one occupancy row with the loser leaving nothing behind.

Newly traced: COACH-01-AC2, AC3, AC5, AC6, AC9, AC10, AC11, AC12; COACH-02-AC2, AC7, AC8; COACH-03-AC1, AC4.

Still open:

| Criterion | Why it is open |
|---|---|
| COACH-02-AC4 | A coach with no price shows no price and cannot be picked: the card and the quote refusal are not built. |
| COACH-02-AC5 | Court portion as a club setting: the checkout test uses the price rule; the setting itself is not covered. |
| COACH-02-AC6, COACH-02-AC9 | Coach card at checkout (screen, Playwright). AC9 (no prices hard coded) needs a source scan once the card exists. |
| COACH-03-AC2, AC5 | A solo pack credit used through Classes, and valid after its package expires: `credit-functions` covers the tier fit; the reserve at pay time and the expiry rule have no test yet. |
| COACH-04-AC1 to AC4 | Solo class with a solo credit (coach line zero, court by Beam, one order, return on a 12 hour cancel): the pay and cancel routes are not built. |
| R4-AC7 | Substitution audited: the audit of `substitute_coach` is not asserted in the lane test. |
| R5-AC4 | The Booking confirmed card names coach and court: `coach-message-hook` checks the facts; the card text is F10. |
