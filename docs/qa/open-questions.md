# QA open questions

Places where the spec is silent or contradicts itself, found while writing the test strategy on 30 Oct 2026. QA does not guess a rule (`CLAUDE.md`). Each question says which tests wait for the answer. The product owner answers; the answer goes into the PRD, then the hand-off, then the feature spec.

**Priority.** **A** blocks a test design or a build task this month. **B** needs an answer before the 7 Dec window. **C** needs an answer before go live on 29 Dec.

Questions already open elsewhere are not repeated: `canvas-gaps.md` C1 (corrected DOB and held Student packages), C2 (wallets in "owed to customers"), C3 (LINE monthly cap), C4 (rich menu labels), C5 (address toggle), C6 (slip provider), C7 (platform items); and the hand-off open items (add on prices, Head Coach price, referral and birthday amounts, max future hours, class below minimum time, wallet expiry, coach pay, Hunter's Beam account and LINE plan).

## Booking and holds (F03)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-01 | B | BOOK-03 | A player taps Pay twice, or Pay on two devices, for the same slot. Do they get the same hold and QR again, or an error? | CONC-07, E2E |
| Q-02 | A | BOOK-03, PAY-02 | Does the Beam QR expire exactly when the hold ends? If the QR can still be paid after the hold ends, that is the PAY-03 late case; if it cannot, PAY-03 can only happen through a Beam delay. Which is it, and what expiry does QA's fake Beam set? | Fake Beam, PAY-03 tests |
| Q-03 | B | BOOK-01 | Can a player book the hour that has already started (it is 18:10, slot 18:00 to 19:00)? Is there a lead time? Is 23:00 to 24:00 the last bookable slot and "24:00" never a start? | BOOK-01 unit table |
| Q-04 | B | BOOK-01 | "Up to 30 days ahead": is day 30 from today bookable (the C4 strip shows 30 days) or day 31? Where does "today" change (Bangkok midnight)? | BOOK-01 boundary |
| Q-05 | B | BOOK-05 | What counts toward the future hours limit: held (unpaid) hours, hours paid by bundle credit, solo class hours, staff made bookings? Is it enforced when staff book for a player? | BOOK-05 tests, CONC-28 |
| Q-06 | B | (no ID) | The court slot waitlist ("Join waitlist" on a taken slot) has no requirement ID and no timing. Do the 30 minute claim time and the 2 hour cut off apply? Does it use the same offer rules as classes? | Waitlist tests |
| Q-07 | B | CLASS-02 | While an offer is open (30 min), is the spot protected for the first in line, or can another player take it from the schedule? If an offer is open when the 2 hour mark passes, does it still stand? What if the first in line does not pay inside the 30 minutes, is claim also pay? | CONC-22 |

## Coaches (F07, F12)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-08 | B | COACH-01 | Does a leave request that is still pending hide the coach, or only approved leave? | COACH-01 fixtures |
| Q-09 | A | COACH-01, rest rule | What is "in a row"? Does one free hour between two teaching hours break the run? Do unpaid held hours count toward the six? Does a group class hour count even if the class is below minimum? | Rest rule unit table, CONC-17 |
| Q-10 | B | Substitutions | Does the rest rule apply when the owner assigns a substitute, and when staff drag a booking in A1 (PRD says "no override")? What if no substitute is free: can the owner cancel for full credit? | Substitution tests |

## Packages, wallet, cancellation (F06, F09)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-11 | A | PKG-02 | "Purchase date plus 3 months": calendar months? Purchase on 30 Nov gives 28 Feb (end of month)? Does it expire at the end of that day (23:59:59 Bangkok) or at the purchase time of day? Same for pause extension. | PKG-02 unit table |
| Q-12 | B | PKG-01, PKG-03 | Wallet reasons are only "booking or referral" in the data model, but money also enters the wallet from cancellations, late Beam payments (PAY-03) and staff adjustments. Please list the allowed wallet reasons. Wallet balance expiry is an empty setting: empty means never expires? | Ledger tests |
| Q-13 | A | CANCEL-01 | An order paid partly by bundle credit, partly by wallet, partly by Beam and with add ons, a promo code or the birthday discount: what returns on a cancel 12 hours or more ahead? Is a used promo or birthday discount given back? Are add ons returned (towel, water) or only the court? Which wallet or credit gets each part? | CANCEL-01 tests |
| Q-14 | B | CANCEL-04 | When staff reverse a no show or late cancel, does the forfeited credit or payment come back, and does coach pay change? Can staff mark a no show before the slot ends? | CANCEL-04 tests |
| Q-15 | A | COACH-04, PRD Credits | In what order are bundle hours, solo credit, wallet and Beam applied? The PRD says the wallet "is spent first at checkout" but C10 lists credits before wallet. | Checkout tests |
| Q-16 | B | CANCEL-03 | A closure covers a slot that is currently in a payment hold, a group session, or a booking already played. What happens to each? Are bookings during a Pause affected? | CONC-13 |
| Q-17 | A | Pricing | Percentage promo and birthday discounts on satang: round half up, down, or to the whole baht? Does the discount apply to add ons? | Pricing unit table |
| Q-18 | B | PROMO-02 | "Friend's first paid booking is played": does a booking paid with credits or wallet count as paid? If the friend's first booking is cancelled or a no show, does the reward wait for the next one? One reward per referred friend? | PROMO-02 tests |

## Payments, receipts (F05, F13)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-19 | A | PAY-02 | "A callback with a bad signature or wrong amount changes nothing". (a) What HTTP status does the app return, and is it logged or alerted? (b) For a **wrong amount that is validly signed** real money has reached the club's Beam account. Who sees it, and how is the player made whole (wallet, or staff action)? (c) A duplicate valid callback: ignore with success? | Fake Beam scenarios 2, 3, 4 |
| Q-20 | A | PAY-03 | Define "slot is still open" for a late payment: no active hold by another player and no confirmed booking and no closure? For a solo class where the court is free but the coach was booked, is it all wallet (no partial)? Does the player get a LINE message, and which? Is a receipt issued for money that went to the wallet? | PAY-03 tests |
| Q-21 | B | PAY-04 | Is the package QR validity ("[15] minutes") the same club setting as the hold time (10, 15 or 20)? If a payment arrives after the unpaid package order was cancelled, does the value go to the wallet like PAY-03? | PAY-04 tests |
| Q-22 | B | PAY-06 | What are the cash reason codes (list)? Is cash allowed for packages? Which roles (Front desk and Owner only?) | PAY-06 tests |
| Q-23 | A | RCPT-01, Test mode | The 7 Dec window creates mock bookings and payments on the real Hunter club in status Testing. (a) Do mock payments get receipt numbers from the real sequence HTC-2027-000001, or from a separate test sequence? Receipts must be unbroken from go live. (b) What happens to mock data at go live: purged, kept, or hidden? (c) Is a mock payment produced by Beam sandbox, or by a "simulate payment" action inside the app? The second would be a way around the signature check and must not exist for a Live club. | Receipt tests, go live plan |
| Q-24 | B | PDPA-01 | "Delete on request": receipts must keep an unbroken legal sequence, ledgers must balance, and audit entries are needed. Does delete mean anonymise the player and keep the financial rows? What does "copy of my data" contain (staff notes? slips?) | PDPA tests, RLS-R01 |
| Q-25 | B | RCPT-01, LINE-04 | Does the sequence restart each year (HTC-2027-000001 then HTC-2028-000001)? Is a receipt issued when the amount paid is zero (bundle credit only), and what number does the LINE card then show? Is there a receipt for a refund to the wallet (credit note)? Is the year from the Bangkok date? | Receipt tests, LINE-04 |
| Q-26 | B | RCPT-03 | Daily close: does it list wallet and credit use as methods, or only money (Beam, cash)? Day boundary at Bangkok midnight (the club closes at 24:00)? Can a closed day be reopened? | Daily close tests |
| Q-31 | A | PAY-02 | Beam's wire details are not in the spec: callback signature scheme and header names, timestamp or replay window, retry policy, how a charge is created and expires, the event ids used for idempotency, refund API (must never be used). Needs the Beam sandbox documentation (open item: Hunter's Beam merchant account). The fake Beam is built on a placeholder wire format until then. | Fake Beam |

## LINE (F10, F02)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-27 | B | LINE-01, -03, -05 | (a) Language of a push when the player has not set one: the LINE app language at sign in? Does it change when they toggle language in Profile (messages already queued)? (b) If the player has not added the OA or has blocked it, push fails: retry, fallback, or ignore? (c) A booking made less than 24 h or 2 h before start: are the missed reminders skipped? (d) Is "booking released" also sent to Beam clubs (PRD says "No slip within 15 minutes")? (e) Are push messages counted by message object or by recipient? | LINE tests, LINE-06 |
| Q-32 | C | LINE-06 | Behaviour at the club's monthly message cap is undecided (canvas-gaps C3). Until then QA tests the counter and the token failure alert only. | LINE-06 |

## Platform and security (F01, F15)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-28 | A | PLAT-06, P1, P3, P4 | The rule is "BOOQ staff never see players, bookings, payments...". But P1 shows "bookings in the last 30 days" and LINE usage; P4 shows test mode results; P3 has "Export club data". Are aggregate counts allowed? Who receives the P3 export (the club owner, or BOOQ)? | RLS-P05, P15, P16 |
| Q-29 | A | PLAT-02, roles | (a) What exactly is "setup only": are coaches and staff profiles, closures, promo code definitions, add ons in it? (b) Can platform staff edit a Paused club? (c) Can a stranger's request for another club's record answer 404 or 403 (which)? (d) How does platform staff sign in (the PRD says everyone uses LINE) and how is "assigned club" stored? (e) Can platform staff read back stored secrets (Beam keys, LINE token) or only overwrite? (f) Is the Accountant allowed to see customer contact details? | RLS plan sections 6 and 7 |
| Q-30 | B | PLAT-04, PKG-01 | (a) Are the audit log and the credit and wallet ledgers append only (no edit, no delete by anyone)? QA assumes yes. (b) Is the club's own audit log visible to platform staff, and are platform visits shown in the club's audit log as the PRD says? | RLS-M11, M12, P13 |

## Gaps in the requirement set itself

| # | Pri | Gap |
|---|---|---|
| G-01 | A | 28 of 52 IDs have no acceptance check (list in `traceability.md`). The spec drafter should write Given, When, Then for each at gate 1. QA's proposed checks are in the traceability file for reuse. |
| G-02 | A | F11 (club admin) uses the ID "ADMIN" in the backlog, but there are no ADMIN-nn requirements. Pages A0 to A17 are described only in the PRD, so the F11 tests have no IDs to name. F12 (coach portal) has no portal-specific IDs either. |
| G-03 | B | `locales/copy-index.csv` is named in `CLAUDE.md` but is not in the repo, so TEXT-02 cannot be tested. |
| G-04 | B | The canvas boards (L-Msg-Confirmed, R-Receipt-TH, R-Receipt-EN, H- screens) are the stated acceptance targets for LINE-04 and RCPT-02, but the repo has no export of them. Visual comparison cannot be automated without images or a text description. |
| G-05 | B | The P4 go live checklist (PLAT-01 "every check in P4") is not listed anywhere. |
| G-06 | C | The PRD says "Refunds go back by PromptPay" (Option A, Beam). This contradicts CANCEL-02 and PAY-05 (canvas-gaps A3). Tests follow CANCEL-02. The PRD text should be corrected. |
| G-07 | C | PRD message table lists "Slip needs re upload" which LINE-05 omits (F16 only). Confirm it is out of Hunter's scope. |
