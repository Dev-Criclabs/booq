# F08 Group classes and waitlist · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, round 10 ("approve all"): the F13, F09, F07 and F08 drafts and the answers D118 to D121 were approved by the user. Revision 2 applies D84, D115 and D121. Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Feature: F08 Group classes and waitlist. Depends on: F06. Requirement IDs: CLASS-01, CLASS-02, WAIT-01 (F03 shows Join waitlist on a taken court slot; F08 owns the waitlist rules, D44). Wave 4.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Group classes and waitlist; Pricing and packages (group class lines); Payments (Credits and wallet); Customer app pages C7, C8, C8b (pack choice), C13 (Waitlist tab), C16; Admin A8; LINE notifications; Key flows C and I |
| HO | `specs/product/handoff-v1.2.md` | Business rules as requirements (CLASS-01, CLASS-02, WAIT-01, BOOK-04, BOOK-06); Data model (Class template and session, Waitlist entry) |
| Decisions | `docs/decisions.md` | D19, D25, D44, D45, D48, D49, D59, D62, D84, D121; LINE-07 (D17, D29) |
| Gaps | `docs/canvas-gaps.md` | A5, B1, B2 |
| QA | `docs/qa/traceability.md`, `open-questions.md`, `concurrency-tests.md` (branch `qa/test-strategy`) | CLASS rows; Q-06, Q-07; CONC-22 |
| Other features | F03, F04, F06, F07, F09, F10, F11 | Court hold, price, credits, coach, cancel, messages, A8 |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026; every board has a T- Thai twin.

## Scope

In scope: class templates and the sessions generated from them, the week schedule and class detail, who may see and book a class (audience), booking a seat (group credit, drop in, wallet), seats and the minimum and maximum, below minimum alerts and cancelling a session, the waitlist for full classes and for taken court slots, offers and claims.

Out of scope: the court hold mechanics (F03), prices and the order of use (F04), pack and credit ledgers (F06), the coach rules (F07), cancel decisions of a player (F09, F08 supplies the session cancel), LINE messages (F10), A8 screen (F11), coach roster screen (F12).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin, F1-, F2- flow copies (not repeated). Boards: H-C07-Group-classes, H-C08-Class-detail, H-C08b-Class-pack-choice, H-C16-Waitlist-offer, G-C04-Waitlist-joined, G-C13-Waitlist-tab, H-C13-My-bookings, H-C10P-Pack-plus-class, H-C12P-Seat-plus-pack, H-A08-Group-classes, H-K5-Session-detail, L-Msg-Waitlist.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Templates, sessions, seats and waitlist entries carry the club ID and every query filters by it. A request for another club's record answers 404 (D27).

**CC-2 Server side.** The server decides audience, seats and offers. A class hidden from a player is also refused by the API. Roles: the owner manages templates (A8); front desk sees below minimum alerts; the coach sees only their own roster (F12).

**CC-3 PDPA.** A roster shows players' names and levels to the owner, front desk and the session's coach only; a player never sees other players' names (HO Roles: player cannot see other players). Seats show as counts. Waitlist position is the player's own. BOOQ staff never see rosters (PLAT-02).

**CC-4 No double booking.** A class session reserves its court and its coach for its hour under the same uniqueness rule as a court booking (BOOK-04): no court booking, hold or other session can take that court or coach at that hour. Seats are limited to the maximum by the server, inside the seat transaction. A waitlist offer never takes a seat by itself; claiming does, under the seat limit. Two people claiming the last seat give exactly one success (CONC-22).

**CC-5 Language files (TEXT-01 to TEXT-06).** All text from `locales/*` by key, Thai and English. Sample values are named variables with the same names in both files: `{class}`, `{coach}`, `{court}`, `{date}`, `{time}`, `{spots}`, `{min}`, `{max}`, `{minutes}` (claim time), `{hours}` (cut off), `{amount}`. The claim time, the cut off and the alert time are club settings and variables, never typed (Gaps A5). Class names are club typed Thai and English fields. Existing wording is not edited; new text gets new keys in both files, proposed by the drafter, owned by the writers (D51). The terms are คลาสกลุ่ม and รายชื่อรอ. Layouts survive the longest string; cards and buttons never wrap; the week view scrolls.

**CC-6 Other platform rules.** All times Asia/Bangkok. Money is integer satang. A class is always 60 minutes on the hour. Never invent a setting: the claim time (default 30 minutes), the cut off (default 2 hours) and the below minimum alert time (TBD, empty) are club settings.

---

## CLASS-01 Group classes: templates, sessions, audience

**Source.** HO CLASS-01. PRD Group classes and waitlist, Pricing and packages; D19, D59, D62; Gaps B1, B2.

**Requirement.** Group classes are 60 minutes, 4 to 6 players by default. Students see Student classes only, adults Adult only.

**Acceptance criteria.**

- CLASS-01-AC1. Given an owner creates a class template in A8 (name in Thai and English, audience Adult or Student, level, coach, court, weekday and time, duration, minimum and maximum players), when it is saved, then the duration is 60 minutes (a template with any other duration is refused) and the players are 4 to 6 by default (the PRD default; owner may change them).
- CLASS-01-AC2. Given a template, when it is saved, then sessions are generated for the whole booking window (D121).
- CLASS-01-AC3. Given a session, when it exists, then its court and its coach are reserved for that hour (CC-4): a template that clashes with a court booking, another session or the coach's availability, leave or rest cap (F07) is refused when saved, and a session that cannot be generated is reported to the owner, not skipped silently.
- CLASS-01-AC4. Given a session, when a player books a seat, then the seat count never exceeds the maximum (the server refuses the last seat if full).
- CLASS-01-AC5. Given a player, when the schedule loads or a seat is requested, then they see and may book the classes of their own price group (by the date of birth on file) and the classes that match the group credits they hold, for example a player who is now 18 or older with a Student group credit still sees the Student classes that credit was bought for (D121, D84, D62). A class outside both is not shown and a request for it is refused by the server, not only filtered in the screen (CLASS-01, PRD).
- CLASS-01-AC6. Given the schedule (C7), when it loads, then it shows the week, filterable by level, with class cards (coach, court, time, spots left), Full plus Waitlist for a full class, and only the customer's audience.
- CLASS-01-AC7. Given class detail (C8), when it loads, then it shows level, audience, date and time, duration, coach, court, players booked against the maximum, the minimum to run, and the credit or drop in price.
- CLASS-01-AC8. Given a guest, when they browse C7 and C8, then it loads without sign in and shows the Adult schedule (D121); booking starts sign in (F02).
- CLASS-01-AC9. Given a class template with the coach on leave or over the rest cap for a session hour, when the session is generated, then it is flagged for the owner (F07 R6), not removed.
- CLASS-01-AC10. Given the owner edits a template, when it is saved, then the change applies to future sessions that have no players; a session that has players keeps its details unless the owner edits that session, in which case its players are messaged and may cancel free (D121).
- CLASS-01-AC11. Given the owner cancels a template or a session, when it is saved, then it follows CLASS-01-AC13 for booked players.
- CLASS-01-AC12. Given a group class hour, when the coach's rest run is counted, then it counts until the session is cancelled (D19, F07).
- CLASS-01-AC13. Given a session is cancelled by staff (below minimum or otherwise), when it is saved, then every player gets full credit back (or the money to the wallet), a LINE message (F10), and the court and coach are freed (PRD; F09 CANCEL-03 style). Waitlist entries for it end.
- CLASS-01-AC14. Given payment for a seat, when the player books, then they may pay with a group credit for the right audience, a drop in price, or the wallet, in the order of F04 R4 (PRD).
- CLASS-01-AC15. Given a player with no group credits, when they open class detail, then C8 offers the drop in price or the 8 pack with one session used now (F06 R3-AC3, C8b).
- CLASS-01-AC16. Given a below minimum session, when the club's below minimum alert time (a club setting, empty by default) has been set and the time before start arrives, then front desk get an alert (Class below minimum, F10). Until the setting is set, a below minimum session runs and no alert is sent (D121). If staff cancel it, AC13 applies.
- CLASS-01-AC17. Given a seat booked, when it is saved, then it is a booking of type class seat tied to the session (HO Data model) and counted as a one hour booking for its player (BOOK-06); group seats do not count toward the future court hours limit (D59).
- CLASS-01-AC18. Given the sample sessions on the canvas (Thursday 20:00 "Full 6 of 6" against "3 booked, needs 4"), when tests are written, then they are not used (Gaps B1, B2).

**Meets.**

- PDPA: AC rosters and roles (CC-3); audience uses the date of birth, which is never shown to the coach.
- No double booking: CLASS-01-AC3, AC4, CC-4.
- Club scope: templates, sessions and seats per club.
- TEXT: class names are Thai and English fields; spots and minimum text from variables.

**Canvas.** H-C07-Group-classes (T-), H-C08-Class-detail (T-), H-C08b-Class-pack-choice, H-A08-Group-classes (T-), H-C10P-Pack-plus-class.

---

## CLASS-02 The waitlist

**Source.** HO CLASS-02, WAIT-01. PRD Group classes and waitlist, Court booking, Key flows C; D44, D45, D48; LINE-07 (D17, D29); QA Q-07.

**Requirement.** First in line gets a LINE offer with [30] minutes to claim. No offers within [2] hours of start. The same rules apply to a taken court slot (D44).

**Acceptance criteria.**

- CLASS-02-AC1. Given a full class or a taken court slot, when a signed in player taps Join waitlist, then they are added with a position and nothing is charged or held (WAIT-01, G-C04-Waitlist-joined). A guest signs in first.
- CLASS-02-AC2. Given a spot opens (a cancel, a released hold, a session cancelled and reopened), when the first in line is next, then they get a LINE offer (Waitlist spot open) with the claim time in minutes (club setting, default 30), and C16 shows a countdown, the spot, the credit to be used, Claim spot or Decline (PRD C16).
- CLASS-02-AC3. Given the offer, when the player claims within the time, then the claim is confirmed on the tap when a group credit or the wallet covers it, and when money is due they pay by Beam inside the claim time (D121, F05); the seat or slot is booked atomically under the seat or slot limit (CC-4).
- CLASS-02-AC4. Given an offer that passes its time, or is declined, when it ends, then it passes to the next person in line and the player gets no further offer for it.
- CLASS-02-AC5. Given a spot opens less than the cut off (default 2 hours) before the start, when it opens, then no offers are made (PRD).
- CLASS-02-AC6. Given an offer for a court slot, when the player claims it, then it becomes a hold and a booking under BOOK-03 and BOOK-04; a court slot offer is the same as a class offer (D44). The offer's QR (if Beam is needed) follows F05.
- CLASS-02-AC7. Given two players claim the last spot at once, when both run, then exactly one succeeds and the other is told the spot is gone (CONC-22).
- CLASS-02-AC8. Given a player on a waitlist, when they open My bookings, then the Waitlist tab shows their position (C13, G-C13-Waitlist-tab) and they may leave the list.
- CLASS-02-AC9. Given a waitlist offer that cannot be sent because the club is at its message cap on the free plan, when the send fails, then the offer passes to the next person (LINE-07-AC6, F10).
- CLASS-02-AC10. Given the Waitlist spot open message, when it is sent, then it is sent even at 80 percent of the cap (LINE-07-AC3).
- CLASS-02-AC11. Given the session or slot is cancelled or closed, when it is saved, then waitlist entries end and those players are told (a closure follows D48).
- CLASS-02-AC12. Given a player already holds a seat in the session, when they try to join its waitlist, then it is refused.
- CLASS-02-AC13. Given the claim time and the cut off, when the owner changes them, then offers made already keep their end time and new offers use the new values (as D46 for holds).
- CLASS-02-AC14. Given an offer is open, when another player opens the schedule, then the spot is held for the first in line and is not offered to others until the offer ends (D121).
- CLASS-02-AC15. Given an offer open when the 2 hour mark passes, then it stands (D121).
- CLASS-02-AC16. Given a waitlist, when players join, then there is no maximum length (D121).

**Meets.**

- PDPA: a waitlist entry shows its own position only; other entrants' names are never shown to a player.
- No double booking: CLASS-02-AC3, AC6, AC7 and CC-4; an offer is not a reservation unless Q5 says so.
- Club scope: per club entries and settings.
- TEXT: C16 and the offer message from P and L keys with `{minutes}`; fixed "30 minutes" in canvas text is a canvas bug (Gaps A5).

**Canvas.** H-C16-Waitlist-offer (T-), G-C04-Waitlist-joined (T-), G-C13-Waitlist-tab (T-), L-Msg-Waitlist (T-), H-C13-My-bookings.

---

## WAIT-01 Join waitlist on a taken court slot (F03 side, owned here)

**Source.** HO WAIT-01. PRD Court booking; D44; F03 WAIT-01.

**Requirement.** The court slot waitlist uses the same rules as the class waitlist (claim time, no offers within the cut off). F08 owns it; F03 shows Join waitlist on a taken slot.

**Hand-off acceptance check, kept.** Given a taken slot, when the player taps Join waitlist, then they are added with a position and nothing is charged.

**Acceptance criteria.**

- WAIT-01-AC1. Given a taken court slot, when the player taps Join waitlist, then they are added with a position and nothing is charged (hand-off check, CLASS-02-AC1).
- WAIT-01-AC2. Given a court slot waitlist, when a booking for that slot is cancelled or its hold is released, then CLASS-02 offer rules apply (claim time, cut off, passing on).
- WAIT-01-AC3. Given a slot with a waitlist, when the slot becomes Open, then the first in line is offered it and the slot is held for them for the claim time before it shows as Open to others (D121).
- WAIT-01-AC4. Given a court waitlist entry for a time that passes, when the time passes, then the entry ends.
- WAIT-01-AC5. Given a court slot that is Held (being paid for), when it is viewed, then whether Join waitlist shows is F03 Q2.

**Meets.** PDPA: own position only. No double booking: an offer becomes a hold under BOOK-03 only on claim. Club scope: per club. TEXT: same keys as CLASS-02.

**Canvas.** G-C04-Waitlist-joined, S-C04-Day-full.

---

## Data covered by F08 (HO Data model, for the design step)

Class template (club, name Thai and English, audience, level, coach, court, weekday, time, duration, minimum and maximum players), Class session (template, date, coach, status), Booking (type class seat), Waitlist entry (customer, session or court slot, position, offer sent, offer expires). The session reserves its court and coach by the same uniqueness rule as a court booking.

## Proposed new text keys (D51)

Proposed by the drafter; writers own the wording; numbers from the i18n role after `copy-index.csv` exists (D31). Existing keys first.

- P: full, join waitlist, you are number `{n}` on the waitlist, spot gone, offer ended, class cancelled, seat limit, class not for your age group.
- A: class template validation (clash, duration), session generation report, below minimum alert settings.
- L: spot gone, offer passed on.

No key is added by this draft.

## Open questions

D121 answers the earlier questions on session generation, the schedule by price group and credits, the guest schedule, template edits, spot protection, the 2 hour mark, claim and payment, waitlist maximum and the below minimum alert time. One remains:

1. **One player on several waitlists.** Can one player be on several waitlists at once, and if two offers arrive at the same time, may they claim both? (D121 sets no maximum length but does not say.)
2. **Join waitlist on a held slot (F03 Q2).** Does a slot that is only held (being paid for) also show Join waitlist? D44 and WAIT-01 say a taken slot.
