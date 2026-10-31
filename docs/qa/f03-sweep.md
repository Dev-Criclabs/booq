# F03 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F03-court-booking/requirements.md` and `design.md`.

**Result: 70 criteria. 56 covered by lane tests (traced), 3 new QA tests, 0 findings, 11 still open (each with its reason).**

The court booking lane tested the database rules thoroughly: the claim (`reserve-court`, `reserve-check`, with a 20 way race and a stress run), the occupancy exclusion rules (`occupancy`), the future hours limit including the staff override (`future-hours`), the pay tap limit (`pay-tap`), releases (`release-hold`), closures (`closure`) and the public schedule views (`public-views`). Most of those tests do not cite the criterion ID, so `F03-court-booking.traced.spec.ts` holds one pointer test per covered criterion; it fails if the cited test is renamed or removed.

QA wrote three tests (`F03-court-booking.new.spec.ts`): a staff booking awaiting payment holds the slot for the same time as an online booking and blocks the slot (BOOK-03-AC17); a pause leaves an existing hold untouched and starts no new hold for a player or for staff (BOOK-03-AC16); the future hours message uses `{hours}` in both languages (BOOK-05-AC8).

Open items are all either screens (Playwright, once the booking pages run) or rules owned by a feature that was not finished when this sweep ran (F06, F07, F08, F09, F13). They are listed with the sweep of that feature.

| Criterion | Text (cut) | Status |
|---|---|---|
| BOOK-01-AC1 | Given a request to book or hold a court, when the start time is not on the hour (18:30, 18:01), then | Covered by a lane test (traced) |
| BOOK-01-AC2 | Given a request, when the booking length is anything other than 60 minutes per hour booked, then the | Covered by a lane test (traced) |
| BOOK-01-AC3 | Given the club's opening hours for that weekday (Hunter 06:00 to 24:00), when a request starts befor | Covered by a lane test (traced) |
| BOOK-01-AC4 | Given the booking window setting (Hunter 30 days), when a request is further ahead than the window,  | Covered by a lane test (traced) |
| BOOK-01-AC5 | Given a request for the hour that has already started (18:10, slot 18:00 to 19:00) or any earlier sl | Covered by a lane test (traced) |
| BOOK-01-AC6 | Given the schedule (C4), when a guest or player opens it, then it shows a date strip from today to t | Covered by a lane test (traced) |
| BOOK-01-AC7 | Given a slot, when it is taken, closed or past, then it is shown but cannot be selected. A slot some | Covered by a lane test (traced) |
| BOOK-01-AC8 | Given a closure (F09) over a slot, when the schedule loads, then that slot shows Closed and every re | Covered by a lane test (traced) |
| BOOK-01-AC9 | Given an inactive court (Resource active = false), when the schedule loads, then it is not offered a | Covered by a lane test (traced) |
| BOOK-01-AC10 | Given a Draft or Testing club, when a request comes from someone who is not a tester, then it is ref | Covered by a lane test (traced) |
| BOOK-01-AC11 | Given a player selects several hours, when they continue, then the hours must be consecutive on one  | Covered by a lane test (traced) |
| BOOK-01-AC12 | Given the date strip, when the Bangkok date changes at midnight, then "today" changes with it and ye | Covered by a lane test (traced) |
| BOOK-01-AC13 | Given the court grid and class schedule, when they load on a 4G connection inside LINE, then they ap | Open: Grid and schedule load under 2 s on 4G: Playwright with network throttling (E2E-25) once the booking screens run, and a device check in LINE (S20). |
| BOOK-01-AC14 | Given a day with no open slots, or a taken slot, when it is shown, then the Day full state or a Join | Covered by a lane test (traced) |
| BOOK-01-AC16 | Given the owner changes opening hours or removes or deactivates a court while bookings or holds exis | Covered by a lane test (traced) |
| BOOK-01-AC15 | Given a slot shown as Open to a player, when they try to hold it and it was taken meanwhile, then th | Covered by a lane test (traced) |
| BOOK-02-AC1 | Given the club's rich menu, when a player or guest taps Book a court, then C4 (the court schedule) o | Covered by a lane test (traced) |
| BOOK-02-AC2 | Given a guest taps the tile, when C4 opens, then no sign in runs; sign in starts only when they cont | Open: Guest taps the rich menu tile and C4 opens with no sign in: Playwright (AUTH-01-AC10 is the same flow). |
| BOOK-02-AC3 | Given the tile's link, when it is opened, then it carries the club in the URL (D6) so C4 shows that  | Open: The tile link carries the club in the URL: the URL rule is traced under F02 AUTH-01-AC13/AC14; the tile itself is the rich menu (F10). |
| BOOK-02-AC4 | Given a Paused club, when the tile is tapped, then C4 shows as paused with upcoming bookings still r | Covered by a lane test (traced) |
| BOOK-02-AC5 | Given the C4 deep link opened in a browser (not LINE), when it loads, then it shows the same page. | Open: C4 deep link in a browser shows the same page: Playwright. |
| BOOK-03-AC1 | Given a signed in player on checkout (C10), when they tap Pay with an amount due, then the server cr | Covered by a lane test (traced) |
| BOOK-03-AC2 | Given a guest or a signed out session, when it asks for a hold, then the server refuses it. Continue | Covered by a lane test (traced) |
| BOOK-03-AC3 | Given the hold setting, when it is stored, then only 10, 15 or 20 minutes are accepted (60 only in b | Covered by a lane test (traced) |
| BOOK-03-AC4 | Given a held slot, when another player or a guest views the schedule, then it shows Held and cannot  | Covered by a lane test (traced) |
| BOOK-03-AC5 | Given a hold that has reached its end time without a confirmed payment, when it ends, then the booki | Covered by a lane test (traced) |
| BOOK-03-AC6 | Given the hold end time passes, when anyone reads the schedule before the release job has run, then  | Covered by a lane test (traced) |
| BOOK-03-AC7 | Given a payment is confirmed before the hold ends, when the payment arrives, then the booking become | Covered by a lane test (traced) |
| BOOK-03-AC8 | Given "slot still open" for a late payment, when it is decided, then it means no other hold, no book | Covered by a lane test (traced) |
| BOOK-03-AC9 | Given nothing is left to pay (credits or wallet cover it, PAY-07), when the player taps Pay, then th | Covered by a lane test (traced) |
| BOOK-03-AC10 | Given a booking made together with a package purchase, when the player pays, then the slot is held a | Open: Booking together with a package purchase holds the slot: needs F06 checkout with a bundle. Next batch (F06 sweep). |
| BOOK-03-AC17 | Given staff create a booking in A2 that is awaiting payment, when it is saved, then it holds the slo | New QA test |
| BOOK-03-AC11 | Given a solo class (coach picked at checkout, or booked through Classes), when the player taps Pay,  | Covered by a lane test (traced) |
| BOOK-03-AC12 | Given a held hour, when the rest rule is checked for a coach (F07), then unpaid held hours count tow | Covered by a lane test (traced) |
| BOOK-03-AC13 | Given the owner changes the hold setting, when a hold already exists, then it keeps the end time it  | Covered by a lane test (traced) |
| BOOK-03-AC14 | Given the countdown on the pay screen, when the hold has ended, then the screen shows Time ran out w | Covered by a lane test (traced) |
| BOOK-03-AC15 | Given the player taps Pay a second time, or on a second device, for the same slot, when the request  | Covered by a lane test (traced) |
| BOOK-03-AC18 | Given a per player limit on repeated Pay taps, when a player taps Pay again and again (the same orde | Covered by a lane test (traced) |
| BOOK-03-AC16 | Given a Paused club, when a hold already exists at the moment of the pause, then it runs to its norm | New QA test |
| BOOK-04-AC1 | Given two parallel requests to hold or book the same court and hour, when both reach the server toge | Covered by a lane test (traced) |
| BOOK-04-AC2 | Given two parallel requests that ask for the same coach at the same hour (on different courts), when | Covered by a lane test (traced) |
| BOOK-04-AC3 | Given a solo class, when court and coach are reserved, then both are reserved in one transaction or  | Covered by a lane test (traced) |
| BOOK-04-AC4 | Given a request that loses the race, when it is refused, then the player is told the slot is no long | Covered by a lane test (traced) |
| BOOK-04-AC5 | Given a multi hour selection, when one hour of it is taken, then the whole request is refused; never | Covered by a lane test (traced) |
| BOOK-04-AC6 | Given a hold or a booking that ends (released, cancelled, expired), when it frees a slot, then the s | Covered by a lane test (traced) |
| BOOK-04-AC7 | Given staff create or move a booking in A1 or A2, when they save it, then the same uniqueness rule a | Covered by a lane test (traced) |
| BOOK-04-AC8 | Given a payment that is confirmed at the same instant a hold expires, when both run, then exactly on | Covered by a lane test (traced) |
| BOOK-04-AC9 | Given a closure created over a slot that is held, when it is saved, then the hold is cancelled, the  | Open: Closure over a held slot cancels the hold: the F09 closure function (BE-B is on F09). The release and the closure constraint exist (release-hold, closure tests); the end to end rule is swept with F09. |
| BOOK-04-AC10 | Given a coach on leave or over the 6 hours in a row (COACH-01), when a coach is requested at checkou | Open: Coach on leave or over the rest cap is not offered and a direct request is refused: F07 rules. Swept with F07. |
| BOOK-04-AC11 | Given any booking or hold, when it is created, then a query by any other club's ID never sees it and | Covered by a lane test (traced) |
| BOOK-04-AC12 | Given 20 parallel requests for one slot, when they run (QA CONC tests), then exactly one succeeds an | Covered by a lane test (traced) |
| BOOK-05-AC1 | Given the max future hours setting is empty, when a player books many hours, then there is no limit  | Covered by a lane test (traced) |
| BOOK-05-AC2 | Given the owner sets a number N, when a player already holds N future court hours and asks for one m | Covered by a lane test (traced) |
| BOOK-05-AC3 | Given a request would take the player over N in one multi hour selection, when it is made, then the  | Covered by a lane test (traced) |
| BOOK-05-AC4 | Given two parallel requests from one player at N-1 held hours, when both run, then exactly one succe | Covered by a lane test (traced) |
| BOOK-05-AC5 | Given a played or past booking, when the limit is counted, then it does not count (future hours only | Covered by a lane test (traced) |
| BOOK-05-AC6 | Given the limit is changed, when it is saved, then it is a settings change and audited (PLAT-04); bo | Covered by a lane test (traced) |
| BOOK-05-AC7 | Given the limit is set, when it is counted, then it counts all of the player's future hours: confirm | Covered by a lane test (traced) |
| BOOK-05-AC9 | Given staff book for a player who is at the limit, when they save, then the booking is refused unles | Covered by a lane test (traced) |
| BOOK-05-AC8 | Given the limit is set, when a player is refused, then the message uses a named variable `{hours}` a | New QA test |
| BOOK-06-AC1 | Given a player selects two consecutive hours on one court, when they pay, then one order is created  | Covered by a lane test (traced) |
| BOOK-06-AC2 | Given a two hour order, when the player cancels one hour, then only that hour is cancelled and the o | Open: Cancel one hour of a two hour order: F09. Swept with F09. |
| BOOK-06-AC3 | Given a two hour order, when it is paid, then one receipt is issued for the order (RCPT-01, F13). | Open: One receipt per paid order: F13. Swept with F13. |
| BOOK-06-AC4 | Given a no show or late cancel on one hour, when staff mark it, then only that hour changes (CANCEL- | Open: No show on one hour changes only that hour: F09. Swept with F09. |
| BOOK-06-AC5 | Given a selection of any length, when it is submitted, then no limit on its length applies except th | Covered by a lane test (traced) |
| BOOK-06-AC6 | Given each hour of the order, when the hold ends, then every hour of the order is released together, | Covered by a lane test (traced) |
| WAIT-01-AC1 | Given a taken slot on C4, when a signed in player views it, then Join waitlist shows; a guest taps i | Covered by a lane test (traced) |
| WAIT-01-AC2 | Given the player taps Join waitlist, when it is saved, then they are added with a position, nothing  | Covered by a lane test (traced) |
| WAIT-01-AC3 | Given a held slot (not yet taken), when it is viewed, then Join waitlist shows only if F08 says it d | Covered by a lane test (traced) |
| WAIT-01-AC4 | Given the offer, claim time and cut off, then F08's rules apply (claim time and no offers within the | Open: Claim time and cut off are F08 rules. Swept with F08. |
