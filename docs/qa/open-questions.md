# QA open questions

Places where the spec is silent or contradicts itself, found while writing the test strategy on 30 Oct 2026. QA does not guess a rule (`CLAUDE.md`). Each question says which tests wait for the answer. The product owner answers; the answer goes into the PRD, then the hand-off, then the feature spec.

**Priority.** **A** blocks a test design or a build task this month. **B** needs an answer before the 7 Dec window. **C** needs an answer before go live on 29 Dec.

Questions already open elsewhere are not repeated: `canvas-gaps.md` C1 (corrected DOB and held Student packages), C2 (wallets in "owed to customers"), C3 (LINE monthly cap), C4 (rich menu labels), C5 (address toggle), C6 (slip provider), C7 (platform items); and the hand-off open items (add on prices, Head Coach price, referral and birthday amounts, max future hours, class below minimum time, wallet expiry, coach pay, Hunter's Beam account and LINE plan).

> Updated after the user's answers (decisions D18 to D31). Answered questions moved to the section "Answered" below.

## Booking and holds (F03)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-01 | B | BOOK-03 | A player taps Pay twice, or Pay on two devices, for the same slot. Do they get the same hold and QR again, or an error? | CONC-07, E2E |
| Q-03 | B | BOOK-01 | Can a player book the hour that has already started (it is 18:10, slot 18:00 to 19:00)? Is there a lead time? Is 23:00 to 24:00 the last bookable slot and "24:00" never a start? | BOOK-01 unit table |
| Q-04 | B | BOOK-01 | "Up to 30 days ahead": is day 30 from today bookable (the C4 strip shows 30 days) or day 31? Where does "today" change (Bangkok midnight)? | BOOK-01 boundary |
| Q-05 | B | BOOK-05 | What counts toward the future hours limit: held (unpaid) hours, hours paid by bundle credit, solo class hours, staff made bookings? Is it enforced when staff book for a player? | BOOK-05 tests, CONC-28 |
| Q-06 | B | (no ID) | The court slot waitlist ("Join waitlist" on a taken slot) has no requirement ID and no timing. Do the 30 minute claim time and the 2 hour cut off apply? Does it use the same offer rules as classes? | Waitlist tests |
| Q-07 | B | CLASS-02 | While an offer is open (30 min), is the spot protected for the first in line, or can another player take it from the schedule? If an offer is open when the 2 hour mark passes, does it still stand? What if the first in line does not pay inside the 30 minutes, is claim also pay? | CONC-22 |

## Coaches (F07, F12)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-08 | B | COACH-01 | Does a leave request that is still pending hide the coach, or only approved leave? | COACH-01 fixtures |
| Q-10 | B | Substitutions | Does the rest rule apply when the owner assigns a substitute, and when staff drag a booking in A1 (PRD says "no override")? What if no substitute is free: can the owner cancel for full credit? | Substitution tests |

## Packages, wallet, cancellation (F06, F09)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-12 | B | PKG-01, PKG-03 | Wallet reasons are only "booking or referral" in the data model, but money also enters the wallet from cancellations, late Beam payments (PAY-03) and staff adjustments. Please list the allowed wallet reasons. Wallet balance expiry is an empty setting: empty means never expires? | Ledger tests |
| Q-14 | B | CANCEL-04 | When staff reverse a no show or late cancel, does the forfeited credit or payment come back, and does coach pay change? Can staff mark a no show before the slot ends? | CANCEL-04 tests |
| Q-16 | B | CANCEL-03 | A closure covers a slot that is currently in a payment hold, a group session, or a booking already played. What happens to each? Are bookings during a Pause affected? | CONC-13 |
| Q-18 | B | PROMO-02 | "Friend's first paid booking is played": does a booking paid with credits or wallet count as paid? If the friend's first booking is cancelled or a no show, does the reward wait for the next one? One reward per referred friend? | PROMO-02 tests |

## Payments, receipts (F05, F13)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-19 | B | PAY-02 | D24 answers the rules (bad signature: rejected, logged, alerted; valid signature with wrong amount: not confirmed, flagged for the owner, staff credit the wallet with a reason; duplicate: ignored with success). **Still open:** the HTTP status the app returns for a validly signed wrong amount (2xx stops Beam retrying; a 4xx makes Beam retry up to 10 times, DOC) | Fake Beam scenario 3 |
| Q-20 | B | PAY-03 | D25 answers "still open", the solo class case and the LINE message. **Still open:** D25 says a receipt is issued for money received "(accountant to confirm)". Until confirmed the tests mark receipts for a late wallet credit as undecided | PAY-03 tests |
| Q-21 | B | PAY-04 | Is the package QR validity ("[15] minutes") the same club setting as the hold time (10, 15 or 20)? If a payment arrives after the unpaid package order was cancelled, does the value go to the wallet like PAY-03? | PAY-04 tests |
| Q-22 | B | PAY-06 | What are the cash reason codes (list)? Is cash allowed for packages? Which roles (Front desk and Owner only?) | PAY-06 tests |
| Q-24 | B | PDPA-01 | "Delete on request": receipts must keep an unbroken legal sequence, ledgers must balance, and audit entries are needed. Does delete mean anonymise the player and keep the financial rows? What does "copy of my data" contain (staff notes? slips?) | PDPA tests, RLS-R01 |
| Q-25 | B | RCPT-01, LINE-04 | Does the sequence restart each year (HTC-2027-000001 then HTC-2028-000001)? Is a receipt issued when the amount paid is zero (bundle credit only), and what number does the LINE card then show? Is there a receipt for a refund to the wallet (credit note)? Is the year from the Bangkok date? | Receipt tests, LINE-04 |
| Q-26 | B | RCPT-03 | Daily close: does it list wallet and credit use as methods, or only money (Beam, cash)? Day boundary at Bangkok midnight (the club closes at 24:00)? Can a closed day be reopened? | Daily close tests |
| Q-31 | A | PAY-02 | Beam wire format: the signature, event name header, amounts, retries and idempotency header are now taken from Beam's docs (see `tests/fakes/README.md` section 3.4). **Still a guess:** no event id or timestamp in the webhook (so duplicate detection and replay protection cannot rely on them), what an expired QR becomes, whether a QR can still be paid after its expiry, backoff intervals, failure codes, and **whether a sandbox PromptPay QR can be marked paid by a tester** (the /test-data and /charges lifecycle pages were not read). The last one decides whether D26 (sandbox only) is workable on 7 Dec. Needs Hunter's sandbox account | Fake Beam, 7 Dec plan |

## LINE (F10, F02)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-27 | B | LINE-01, -03, -05 | (a) Language of a push when the player has not set one: the LINE app language at sign in? Does it change when they toggle language in Profile (messages already queued)? (b) If the player has not added the OA or has blocked it, push fails: retry, fallback, or ignore? (c) A booking made less than 24 h or 2 h before start: are the missed reminders skipped? (d) Is "booking released" also sent to Beam clubs (PRD says "No slip within 15 minutes")? (e) Are push messages counted by message object or by recipient? | LINE tests, LINE-06 |

## Platform and security (F01, F15)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-29 | B | PLAT-02, roles | D27, D3 and D15 answer: what setup only includes, Paused is look only, 404 for another club, BOOQ staff sign in, secrets write only. **Still open:** (f) may the Accountant see customer contact details (names, phones) in reports and exports? | RLS-R04 |

## Answered (user decisions, `docs/decisions.md`)

QA tests and the fakes follow these. Wording of the rules is in the decision log; do not restate it here.

| # | Req | Decision |
|---|---|---|
| Q-02 | BOOK-03, PAY-02 | D18 |
| Q-09 | COACH-01, rest rule | D19 |
| Q-11 | PKG-02 | D20 |
| Q-13 | CANCEL-01 | D21 |
| Q-15 | COACH-04, PRD Credits | D22 |
| Q-17 | Pricing | D23 |
| Q-23 | RCPT-01, Test mode | D4, D16, D26 |
| Q-32 | LINE-06 | D17 (new LINE-07) |
| Q-28 | PLAT-06, P1, P3, P4 | D2, D14 |
| Q-30 | PLAT-04, PKG-01 | D28 |

Also answered in part: Q-27b by D9 (a non friend is not blocked at checkout; the app shows the confirmation and asks them to add the OA), Q-29 and Q-19 as narrowed above.

## New questions after the F01/F02 requirements and decisions

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-33 | A | PLAT-07, D16 | The 7 Dec test runs on **production** with Hunter in Testing (D16). How does a production club in Testing use Beam's **sandbox** keys and the paid LINE OA, and how are the live keys swapped at Go live? A wrong key at Go live means real payments fail or test payments are accepted. QA needs this as a go live check in P4 and a smoke test. Also: test pushes use the real OA and count toward the monthly cap (LINE-07) | 7 Dec plan, PLAT-07 |
| Q-34 | B | PLAT-07-AC7 | Are test flagged rows excluded from every report, the daily close, receipts lists and the P1 aggregates, not only P1? The spec is silent outside P1 (its own Q-E) | PLAT-07 tests |
| Q-35 | B | PDPA-01 | PDPA-01-AC9 says data is encrypted but names no standard (its Q23). Needs a decision before QA can test it | PDPA tests |

## Gaps in the requirement set itself

| # | Pri | Gap |
|---|---|---|
| G-01 | A | 28 of 52 hand-off IDs had no acceptance check. F01 and F02 requirements (approved) now cover 8 of them (PLAT-01 to 06, PDPA-01, LINE-01); 20 remain (list in `traceability.md`). QA's proposed checks are in the traceability file for reuse. |
| G-02 | A | F11 (club admin) uses the ID "ADMIN" in the backlog, but there are no ADMIN-nn requirements. Pages A0 to A17 are described only in the PRD, so the F11 tests have no IDs to name. F12 (coach portal) has no portal-specific IDs either. |
| G-03 | B | `locales/copy-index.csv` is named in `CLAUDE.md` but is not in the repo, so TEXT-02 cannot be tested. |
| G-04 | B | The canvas boards (L-Msg-Confirmed, R-Receipt-TH, R-Receipt-EN, H- screens) are the stated acceptance targets for LINE-04 and RCPT-02, but the repo has no export of them. Visual comparison cannot be automated without images or a text description. |
| G-05 | B | The P4 go live checklist (PLAT-01 "every check in P4") is not listed anywhere. |
| G-06 | C | The PRD says "Refunds go back by PromptPay" (Option A, Beam). This contradicts CANCEL-02 and PAY-05 (canvas-gaps A3). Tests follow CANCEL-02. The PRD text should be corrected. |
| G-07 | C | PRD message table lists "Slip needs re upload" which LINE-05 omits (F16 only). Confirm it is out of Hunter's scope. |
