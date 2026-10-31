# QA open questions

Places where the spec is silent or contradicts itself, found while writing the test strategy on 30 Oct 2026. QA does not guess a rule (`CLAUDE.md`). Each question says which tests wait for the answer. The product owner answers; the answer goes into the PRD, then the hand-off, then the feature spec.

**Priority.** **A** blocks a test design or a build task this month. **B** needs an answer before the 7 Dec window. **C** needs an answer before go live on 29 Dec.

Questions already open elsewhere are not repeated: `canvas-gaps.md` C1 (corrected DOB and held Student packages), C2 (wallets in "owed to customers"), C3 (LINE monthly cap), C4 (rich menu labels), C5 (address toggle), C6 (slip provider), C7 (platform items); and the hand-off open items (add on prices, Head Coach price, referral and birthday amounts, max future hours, class below minimum time, wallet expiry, coach pay, Hunter's Beam account and LINE plan).

> Updated after the user's answers (decisions D18 to D121). Answered questions moved to the section "Answered" below.

## Booking and holds (F03)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|

## Player app (F02, F03)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-37 | C | CC-5, F02 welcome | Is there a maximum length for the club name (Thai and English)? The spec sets none. The C1 hero clips the last line of an English name of about 100 characters at 320 px (QA-UI-1). A limit in the owner's setup (A0, P2 step 1) would close it; otherwise the hero must grow with the text | QA-UI-1 test |

## Coaches (F07, F12)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|

## Packages, wallet, cancellation (F06, F09)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-16 | B | CANCEL-03 | D48 answers a closure over a held slot (the hold is cancelled and the player told; a later payment follows PAY-03) and D118 covers repeat closures and expired packages. **Still open:** a closure over a group session and over a booking already played | CONC-13 |
| Q-18 | B | PROMO-02 | "Friend's first paid booking is played": does a booking paid with credits or wallet count as paid? If the friend's first booking is cancelled or a no show, does the reward wait for the next one? One reward per referred friend? | PROMO-02 tests |

## Payments, receipts (F05, F13)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-24 | B | PDPA-01 | D104 answers audit rows (an anonymised deleted player gets a placeholder in audit rows; nothing else in an audit row can change). **Still open:** what "copy of my data" contains (staff notes? slips?), and how a deletion treats receipts and ledgers that must stay unbroken | PDPA tests, RLS-R01 |
| Q-31 | A | PAY-02 | Beam wire format is taken from Beam's docs (`tests/fakes/README.md` section 3). D73 (status check when a callback never arrives) and D80 (QR expiry slightly before the hold end) are decided. **Still a guess:** no event id or timestamp in the webhook (duplicates are detected on the charge; no replay protection), what an expired QR becomes, whether a QR can be paid after its expiry, backoff intervals, failure codes, and **whether a sandbox PromptPay QR can be marked paid by a tester** (the /test-data and charge lifecycle pages were not read). The last one decides whether D26 is workable on 7 Dec | Fake Beam, 7 Dec plan |

## LINE (F10, F02)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|
| Q-27 | B | LINE-01, -03, -05 | D45 answers (d) and D9 answers (b) in part. **Still open:** (a) language of a push when the player has not set one, and whether it changes after a Profile toggle for messages already queued; (c) are missed reminders skipped for a booking made less than 24 h or 2 h before start (D116 only makes the numbers settings); (e) are push messages counted by message object or by recipient | LINE tests, LINE-06 |

## Platform and security (F01, F15)

| # | Pri | Req | Question | Waits |
|---|---|---|---|---|

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
| Q-20 | PAY-03 | D25, D37 (a late payment that goes to the wallet gets its own receipt for the money received) |
| Q-19 | PAY-02 | D24, D36 (validly signed wrong amount: recorded, flagged for the owner, answered with a success status so Beam stops retrying) |
| Q-29 | PLAT-02, roles | D27, D3, D15, D35 (Accountant sees names, not phone numbers or dates of birth) |
| Q-33 | PLAT-07, D16 | D32 (two Beam key sets, test and live; Testing uses test; the key swap is a P4 go live item with a smoke test; test LINE pushes use the real OA and count toward the cap) |
| Q-34 | PLAT-07-AC7 | D33 (test rows excluded from reports, daily close, receipts lists and platform counts; shown only in test mode views) |
| Q-35 | PDPA-01-AC9 | D34 (TLS in transit, host disk encryption at rest, extra app level encryption for stored secrets) |
| Q-01 | BOOK-03 | D47 (a second tap on Pay returns the same hold and QR) |
| Q-03 | BOOK-01 | D39 (players cannot book an hour already started; staff can for walk ins; 23:00 is the last start) |
| Q-04 | BOOK-01 | D42 (day 30, today plus 30, is bookable by Bangkok calendar date) |
| Q-05 | BOOK-05 | D49, D59 (all future hours count: confirmed, bundle paid, solo, unpaid held; staff bookings count; group class seats do not; staff override with a logged reason, D110) |
| Q-06 | court slot waitlist | D44 (follows the class waitlist rules; F08 owns it) |
| Q-07 | CLASS-02 | D121 (the spot is held for the first in line during an offer; an offer open at the 2 hour mark stands; claim is confirmed on the tap when credit or wallet covers it, Beam payment inside the claim time when money is due) |
| Q-08 | COACH-01 | D120 (only approved leave hides a coach) |
| Q-10 | Substitutions | D120 (substitutes follow the rest rule; if none is free the owner cancels for full credit) |
| Q-12 | PKG-01, PKG-03 | D78 (wallet reasons: refund, late_payment, wrong_amount, duplicate_payment, referral_reward, spend, return, adjust, import, and expire only if wallet expiry is set) |
| Q-14 | CANCEL-04 | D118 (no show only after the slot ends; reversal changes coach pay by the normal rule; a paid referral reward stays paid) |
| Q-21 | PAY-04 | D74 (the package QR time is its own setting, default 15 minutes; a payment after the order was cancelled goes to the wallet with its own receipt) |
| Q-22 | PAY-06 | D56 (No banking app, QR failed at the counter, Other with a note; cash allowed for packages; Front desk and Owner only) |
| Q-25 | RCPT-01, LINE-04 | D106 (numbers per club per Bangkok year, prefix set in P2 step 1), D64 (a receipt for a zero money order, same series), D119 (no credit note when value goes to the wallet) |
| Q-26 | RCPT-03 | D119 (money methods listed; wallet and credit use as separate non money lines; a closed day is not reopened, a later void shows on the day it is made) |
| Q-36 | CANCEL-04-AC9 | D172 (no show timing is not a setting; AC9 withdrawn) |
| G-02 | ADMIN IDs | D53 (one ADMIN-nn ID per page; ADMIN-01 to ADMIN-17 now in the hand-off) |
| G-03 | copy-index.csv | D31 (generated from the canvas by the i18n role) |

Also answered in part: Q-27b by D9 (a non friend is not blocked at checkout; the app shows the confirmation and asks them to add the OA).

## Gaps in the requirement set itself

| # | Pri | Gap |
|---|---|---|
| G-01 | A | 28 of 52 hand-off IDs had no acceptance check. F01 and F02 requirements (approved) now cover 8 of them (PLAT-01 to 06, PDPA-01, LINE-01); 20 remain (list in `traceability.md`). QA's proposed checks are in the traceability file for reuse. |
| G-04 | B | The canvas boards (L-Msg-Confirmed, R-Receipt-TH, R-Receipt-EN, H- screens) are the stated acceptance targets for LINE-04 and RCPT-02, but the repo has no export of them. Visual comparison cannot be automated without images or a text description. |
| G-05 | B | The P4 go live checklist (PLAT-01 "every check in P4") is not listed anywhere. |
| G-06 | C | The PRD says "Refunds go back by PromptPay" (Option A, Beam). This contradicts CANCEL-02 and PAY-05 (canvas-gaps A3). Tests follow CANCEL-02. The PRD text should be corrected. |
| G-07 | C | PRD message table lists "Slip needs re upload" which LINE-05 omits (F16 only). Confirm it is out of Hunter's scope. |
