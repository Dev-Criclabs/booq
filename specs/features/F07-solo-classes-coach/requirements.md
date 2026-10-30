# F07 Solo classes, coach picker and rest rule · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, round 10 ("approve all"): the F13, F09, F07 and F08 drafts and the answers D118 to D121 were approved by the user. Revision 2 applies D111, D115 and D120. Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Feature: F07 Solo classes, coach picker and rest rule. Depends on: F03, F06. Requirement IDs: COACH-01, COACH-02, COACH-03, COACH-04, and the rules the hand-off has no ID for (labelled R1 to R7, local to this file). Wave 4. The coach portal screens are F12 (CPORT-01 to CPORT-07); coach pay is F12 and F13.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Court booking (Add a coach at checkout, After booking); Solo classes and coach rules (Booking a solo class, Rest rule, Coach rates and pay, Substitutions); Pricing and packages; Customer app pages C5, C6, C10b; Coach portal K3, K4; Admin A7; Key flows B and G; Data model (Coach, Coach tier, Availability rule, Leave request) |
| HO | `specs/product/handoff-v1.2.md` | Business rules as requirements (COACH-01 to COACH-04, BOOK-03, BOOK-04, BOOK-06); Data model (Coach, Coach tier, Availability rule and leave); Architecture (Integrity rules) |
| Decisions | `docs/decisions.md` | D1, D19, D21, D22, D25, D28, D40, D49, D59, D62, D84, D85, D95, D111, D115, D120; round 1 |
| Gaps | `docs/canvas-gaps.md` | B3, B4 |
| QA | `docs/qa/traceability.md`, `open-questions.md`, `concurrency-tests.md` (branch `qa/test-strategy`) | COACH rows; Q-08, Q-10 |
| Other features | F03, F04, F06, F09, F10, F11, F12 | Hold and uniqueness, price, credits, cancel, messages, A7, portal |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026; every board has a T- Thai twin.

## Scope

In scope: the solo class (one coach, one customer, 60 minutes, always with a court), the coach list and profile (C5, C6), the times a coach can be booked (availability, leave, bookings, the 6 hour rest rule), the coach picker at court checkout and Add a coach after booking, the solo class price rules as F07 owns them (tier and price group, override), solo pack credits (tier based), and substitutions.

Out of scope: the hold itself and the uniqueness rule (F03), price lines and the order of use (F04), the credit ledger (F06), cancellation rules (F09), LINE messages (F10), the A7 and K screens (F11, F12), coach pay amounts and the payout report (F12, F13).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin, F1-, F2- flow copies (not repeated). Boards: H-C05-Solo-classes, H-C06-Coach-profile, G-C10-Add-coach-checkout, G-C10-Coach-picked, F1-08-C10-Coach-picked, G-C12-Add-coach, H-C10b-Checkout-solo, G-C10b-Solo-with-credit, G-C13b-Coach-changed, H-A07-Coaches, H-K3-Availability, H-K4-Leave, H-K1-Today.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Coaches, tiers, availability rules, leave and solo bookings carry the club ID and every query filters by it. A request for another club's record answers 404 (D27).

**CC-2 Server side.** The server decides who can be booked. A coach hidden on a screen is also refused by the API. A coach sees only their own schedule and earnings (HO Roles). A person who is a coach and a player or staff holds a set of roles (D1).

**CC-3 PDPA.** A coach sees the name, level and past notes of players on their own sessions only; session notes are private to the coach and staff, never shown to the player. The coach profile (bio, photo, certifications) is public in the player app by the coach's role. Coach pay is never shown to players (F12). BOOQ staff never see sessions, rosters or notes (PLAT-02).

**CC-4 No double booking.** A coach is reserved by the same uniqueness rule as a court (BOOK-04): one coach, one hour. A solo class reserves court and coach together or not at all, including during the payment hold (BOOK-03). Held, confirmed and staff booked hours all block the coach. The rest rule is checked inside the booking transaction so two parallel bookings cannot both pass the 6 hour limit.

**CC-5 Language files (TEXT-01 to TEXT-06).** All text from `locales/*` by key, Thai and English. Sample values are named variables with the same names in both files: `{coach}`, `{tier}`, `{court}`, `{date}`, `{time}`, `{amount}`, `{hours}`. The rest cap (default 6), the cancel window and the hold time are variables, never typed. Coach bios, specialties and certifications are club typed Thai and English fields. Existing wording is not edited; new text gets new keys in both files, proposed by the drafter, owned by the writers (D51). Layouts survive the longest string; cards and buttons never wrap; the times list scrolls. Dates use the international year.

**CC-6 Other platform rules.** All times Asia/Bangkok. Money is integer satang. Bookings are 60 minutes on the hour. Never invent a price: the Head Coach price is an empty setting.

---

## COACH-01 Which coaches are offered

**Source.** HO COACH-01. PRD Court booking (Add a coach at checkout), Solo classes and coach rules (Rest rule); D19; QA Q-08, Q-10.

**Requirement.** C10 shows only coaches who work that hour, are not on leave, are not booked, and are under 6 hours in a row.

**Hand-off acceptance check, kept.** A coach on leave never appears; a 7th hour in a row never appears.

**Acceptance criteria.**

- COACH-01-AC1. Given a coach on approved leave for that hour, when checkout or the schedule asks for coaches for it, then the coach is not offered, and a direct request for them is refused (hand-off check).
- COACH-01-AC2. Given a coach with no availability rule open for that hour (weekly rule or one off open time, or a one off closed time), when coaches are listed, then they are not offered.
- COACH-01-AC3. Given a coach already booked for that hour (a confirmed solo class, a group class session, a staff booking, or a payment hold), when coaches are listed, then they are not offered (BOOK-04).
- COACH-01-AC4. Given a coach who has taught 6 hours in a row (back to back hours; a free hour in between resets the count), when the hour would be the 7th, then it is not offered and a direct request is refused (hand-off check, D19).
- COACH-01-AC5. Given the rest cap setting (default 6), when the owner changes it, then the new value applies to new offers; the setting is read from the club's settings and is audited (PLAT-04).
- COACH-01-AC6. Given what counts toward the run, then solo classes, group classes and staff bookings all count, unpaid held hours count, and a group class counts until it is cancelled (D19, PRD). There is no override for any role (PRD).
- COACH-01-AC7. Given the hour changes on checkout, when the player picks a different slot, then the list updates live for that exact hour, and a coach who is no longer free disappears; if a coach becomes unavailable before payment, the card disappears and the player is asked to pick again (PRD).
- COACH-01-AC8. Given a coach whose availability or leave changes after a booking exists, when the change is saved, then existing bookings are not deleted: affected sessions are flagged for the owner (R6).
- COACH-01-AC9. Given a leave request that is pending, when coaches are listed, then the coach is still offered; only approved leave hides a coach (D120).
- COACH-01-AC10. Given an inactive coach, when coaches are listed, then they are not offered.
- COACH-01-AC11. Given the rest rule check, when two parallel bookings both try to add the 6th and 7th hour in a row for one coach, then exactly one succeeds (CONC-17).
- COACH-01-AC12. Given staff move or create a booking in A1 or A2, when the coach would break the rest rule, then it is refused with no override (PRD Front desk rules).

**Meets.**

- PDPA: the listing shows only public coach data; availability reasons (leave type, notes) are not shown to players.
- No double booking: AC3, AC11 and CC-4.
- Club scope: per club coaches, rules and cap.
- TEXT: C10 coach cards and "No court open"/unavailable states from P keys; rest cap in any text is `{hours}`.

**Canvas.** G-C10-Add-coach-checkout (T-), G-C10-Coach-picked, H-C06-Coach-profile, H-K3-Availability, H-K4-Leave.

---

## COACH-02 A coach makes it a solo class: the price

**Source.** HO COACH-02. PRD Court booking, Coach rates and pay, Pricing and packages; D12, D62; F04 R2.

**Requirement.** Picking a coach makes it a solo class: court ฿500 plus that coach's price for the player's price group.

**Hand-off acceptance check, kept.** Adult with a Coach tier coach pays ฿1,300.

**Acceptance criteria.**

- COACH-02-AC1. Given a coach picked at court checkout, when the order is priced, then the order becomes a solo class with a court line and a coach line (F04 R2): Adult with a Coach tier coach pays 50000 plus 80000 satang, ฿1,300 (hand-off check); Student pays 50000 plus 70000, ฿1,200.
- COACH-02-AC2. Given each coach has a rate tier (for example Head Coach, Coach) with an Adult price and a Student price per 60 minutes, when a coach is priced, then the tier's price for the player's price group is used (a player with no date of birth gets Adult, D12).
- COACH-02-AC3. Given the owner sets a price override for one coach, when that coach is priced, then the override applies in place of the tier price; it is audited (PLAT-04).
- COACH-02-AC4. Given a tier or coach with no price (the Head Coach price is empty), when the coach is listed, then the card shows no price and the coach cannot be picked until the owner sets it (F04 R2-AC3).
- COACH-02-AC5. Given the court portion (default ฿500, a club setting), when a solo class is priced, then the court line is the court price rule for that hour (F04 R1) and coach pay is calculated on the coaching portion only (F13).
- COACH-02-AC6. Given each coach card at checkout, then it shows name, tier, specialties, the price for this player (Adult or Student) and a Profile link that opens the coach profile (PRD).
- COACH-02-AC7. Given the coach price, when it is priced, then it follows the price group from the date of birth on file (a player under 18 pays the Student coach price, no date of birth means Adult), not the audience of any Adult item they bought (D120, D62, D12).
- COACH-02-AC8. Given adding a coach is optional, when the player skips it, then the booking stays a court only booking.
- COACH-02-AC9. Given the solo class prices, then they are never hard coded: the Hunter values are club settings (HO).

**Meets.** PDPA: price group uses the date of birth only to choose the price. No double booking: picking a coach does not reserve; Pay does (BOOK-03). Club scope: tiers and prices per club. TEXT: price lines `{amount}`, `{coach}`.

**Canvas.** G-C10-Coach-picked (T-), F1-08-C10-Coach-picked, H-C10b-Checkout-solo, H-A07-Coaches (tier and override), H-A09-Pricing (tiers).

---

## COACH-03 Solo pack credits and a coach added at checkout

**Source.** HO COACH-03. PRD Change log "Checkout" (30 Oct), Court booking; F04 R2-AC4, F06 R1-AC9.

**Requirement.** Solo pack credits do not apply to a coach added at court checkout. They apply only when booking through Classes, Solo classes.

**Hand-off acceptance check, kept.** Given a player with solo credits, when they add a coach on C10, then the full coaching price is charged.

**Acceptance criteria.**

- COACH-03-AC1. Given a player with solo credits who adds a coach at court checkout (C10), when the order is priced, then the full coaching price is charged and no credit is reserved (hand-off check).
- COACH-03-AC2. Given a player with solo credits who books through Classes, then Solo classes (C5, C6), when the order is priced, then a solo pack credit of the right tier and customer type covers the coaching line (F06 R1).
- COACH-03-AC3. Given Add a coach after booking (from C12), when it is priced, then only the coaching portion is charged and solo credits do not apply there either (D120); the top up is its own order and its own receipt (D111).
- COACH-03-AC4. Given a solo pack credit is tied to a tier, when it is used, then it works with any coach in that tier (PRD).
- COACH-03-AC5. Given a solo pack credit is reserved before its package expires, when the session is after the expiry date, then the credit stays valid for that session (D85); a credit of a package bought as Student stays usable for the Student price items it was bought for after the holder turns 18 (D84), and its order of use at checkout is credit, then wallet, then money (D22).

**Meets.** PDPA: not relevant. No double booking: not affected. Club scope: credits are per club. TEXT: checkout lines from P keys.

**Canvas.** G-C10-Add-coach-checkout, G-C12-Add-coach, G-C10b-Solo-with-credit.

---

## COACH-04 Solo credit and the court fee

**Source.** HO COACH-04. PRD Solo classes ("With a pack credit, the ฿500 court fee is paid by a bundle hour, wallet or PromptPay").

**Requirement.** With a solo pack credit, the ฿500 court is still paid by a bundle hour, wallet or payment.

**Hand-off acceptance check, kept.** Solo booking with a credit shows the court line due.

**Acceptance criteria.**

- COACH-04-AC1. Given a solo class booked with a solo pack credit, when it is priced, then the coach line is 0 money (covered by the credit) and the court line is due (50000 satang for Hunter), payable by a bundle hour, wallet or money in the order of F04 R4 (hand-off check).
- COACH-04-AC2. Given the same, when the player pays the court fee by Beam, then the order is one solo class with court and coach held together (CC-4).
- COACH-04-AC3. Given a Student, when a solo credit is used, then the court fee is the same (the court price is the same for both groups).
- COACH-04-AC4. Given the order is cancelled 12 hours or more ahead, when F09 returns value, then the solo credit returns to its package and the court fee returns by its own source (D21).

**Meets.** PDPA: not relevant. No double booking: court and coach reserved together. Club scope: per club. TEXT: P keys.

**Canvas.** G-C10b-Solo-with-credit (T-), H-C10b-Checkout-solo.

---

## R1 The solo class list and coach profile

**Source.** PRD Solo classes and coach rules (Booking a solo class), Customer app pages C5, C6.

**Requirement.** C5 lists coaches; C6 shows one coach's profile and times. Only times when the coach is available and a court is open can be booked.

**Acceptance criteria.**

- R1-AC1. Given C5, when it loads, then each card shows photo, name, rate tier, specialties, ages and levels taught, languages, the next open time, and the price for the customer's type including the court (a guest sees the Adult price).
- R1-AC2. Given C6, when it loads, then it shows bio, background, certifications such as the ITF level, and times by date, each with its assigned court, and a summary bar with the coach price plus the court price.
- R1-AC3. Given a time when the coach is available but no court is open, when C6 is shown, then it shows as unavailable ("No court open") and cannot be selected (PRD).
- R1-AC4. Given a time with the coach free and a court open, when the player picks it, then the system assigns the court already booked for that hour if there is one, otherwise the lowest numbered open court (D120).
- R1-AC5. Given a solo class is booked through C5 and C6, then court and coach are priced and held together in the same order (F04 R2, BOOK-03).
- R1-AC6. Given a guest, when they browse C5 and C6, then it loads without sign in; sign in runs when they continue to book (F02 AUTH-01).
- R1-AC7. Given a coach photo, bio or certification set by the club, when it is shown, then it is the Thai or English field for the player's language, and it is published only with the coach's consent, which the club keeps on record (D120).
- R1-AC8. Given a Paused club, when C5 loads, then Classes shows as paused (F01 PLAT-03-AC5).

**Meets.** PDPA: coach profile is public by the coach's role (the coach agrees when the owner publishes it; whether a consent is kept is Q5). No double booking: the court shown is only assigned at Pay (the hold). Club scope: per club. TEXT: P keys with named variables.

**Canvas.** H-C05-Solo-classes (T-), H-C06-Coach-profile (T-).

---

## R2 Availability and leave

**Source.** PRD Coach portal K3, K4; Data model (Availability rule, Leave request); Key flows G.

**Requirement.** A coach has weekly availability rules by day and one off open or closed times, and can request leave. The owner approves leave in A7.

**Acceptance criteria.**

- R2-AC1. Given a coach in K3, when they save a weekly rule or a one off time, then it is stored for that coach and applies to new offers; the 6 hour rest cap is applied in the view.
- R2-AC2. Given a coach requests leave (dates, full or half day, type, note) in K4, when it is submitted, then it is Pending and the owner sees it in A7.
- R2-AC3. Given the owner approves or declines, when it is saved, then the coach gets a LINE message (F10) and approved leave blocks the coach for those hours.
- R2-AC4. Given a coach's rules are changed so that a booked hour is no longer open, when it is saved, then the booking stays and is flagged (R6).
- R2-AC5. Given availability, leave and decisions, when any is changed, then it is audited (PLAT-04).
- R2-AC6. Given a coach, when they view K3 and K4, then they see only their own rules and requests (CC-2).
- R2-AC7. Given a coach is a person with a user record, when they are created, then they also hold the Player role (D115) and have a language field that defaults to their LINE app language, used for their LINE messages (D95).

**Meets.** PDPA: leave type and notes are visible to the coach and the owner only. No double booking: closed times are enforced by the same offer check; a booking cannot be created in them. Club scope: per club. TEXT: K keys, Thai and English.

**Canvas.** H-K3-Availability (T-), H-K4-Leave (T-), H-A07-Coaches.

---

## R3 Rest rule

**Source.** PRD Solo classes and coach rules (Rest rule), Change log 1.1; D19.

**Requirement.** A coach teaches at most 6 hours in a row (setting, default 6). Booking never offers an hour that would be the 7th in a row. Solo classes, group classes and staff bookings all count, with no override.

**Acceptance criteria.**

- R3-AC1. Given run length is the count of back to back hours around the requested hour, when it would exceed the cap, then the hour is not offered and is refused (COACH-01-AC4).
- R3-AC2. Given a free hour between two teaching hours, when the run is counted, then the count resets (D19).
- R3-AC3. Given an unpaid held hour, when the run is counted, then it counts (D19).
- R3-AC4. Given a group class, when the run is counted, then it counts until it is cancelled (D19).
- R3-AC5. Given a staff booking or a move in A1, when it would exceed the cap, then it is refused for every role (no override).
- R3-AC6. Given the cap setting is empty, when F07 reads it, then the default 6 applies; the PRD gives the default and the Blank template starts with it empty (D8), so Go live needs it set (F01 PLAT-01-AC4).
- R3-AC7. Given the run is checked inside the booking transaction, when two bookings race, then exactly one passes (COACH-01-AC11).

**Meets.** PDPA: not relevant. No double booking: the rest rule is not a uniqueness rule, so it shares the booking transaction. Club scope: per club cap. TEXT: refusal text with `{hours}`.

**Canvas.** H-K3-Availability, H-A16-Settings ("Max teaching hours in a row, 6 hours").

---

## R4 Substitutions

**Source.** PRD Solo classes and coach rules (Substitutions), Key flows G; QA Q-10.

**Requirement.** From a flagged session the owner picks a substitute from the coaches available at that time. Customers are messaged. Solo class customers may cancel for full credit regardless of the 12 hour rule. The price stays the same and pay goes to the coach who delivers.

**Acceptance criteria.**

- R4-AC1. Given a flagged session (approved leave), when the owner opens substitution in A7, then only coaches available at that time are listed (COACH-01 rules apply).
- R4-AC2. Given the owner picks a substitute, when it is saved, then the session moves to the new coach in one transaction (court kept, old coach freed, new coach reserved) or not at all (CC-4).
- R4-AC3. Given a substitution, when it is saved, then each customer gets Coach changed naming the new coach (F10).
- R4-AC4. Given a solo class customer, when the coach is changed, then they may cancel for full credit regardless of the 12 hour rule (F09 applies it).
- R4-AC5. Given the session price, when a substitute is assigned, then the customer's price stays the same and coach pay goes to the coach who delivers (F13).
- R4-AC6. Given a substitute, when the owner assigns one, then the rest rule applies to the substitute like any booking; if no substitute is free, the owner cancels the session for full credit (D120, D19).
- R4-AC7. Given a substitution, when it is saved, then it is audited (PLAT-04).

**Meets.** PDPA: the customer is told the coach name only. No double booking: AC2 and CC-4. Club scope: per club. TEXT: Coach changed message from L keys.

**Canvas.** G-C13b-Coach-changed (T-), H-A07-Coaches (substitutions), L-Msg-* (no Coach changed board; F10 Q1).

---

## R5 Solo class bookings and the booking record

**Source.** HO Data model (Booking: "A solo class always holds both coach and court"), BOOK-04, BOOK-06; D40; D59.

**Requirement.** A solo class is a booking of type solo class with both a coach and a court. A selection of several hours is one order with one booking per hour.

**Acceptance criteria.**

- R5-AC1. Given a solo class booking, when it is stored, then it has both a coach and a court; a record with one and not the other is refused by the database.
- R5-AC2. Given a two hour solo selection, when it is paid, then it is one order with one solo booking per hour; the rest rule and availability are checked for every hour (BOOK-06).
- R5-AC3. Given a solo class, when it is a future hour, then it counts toward the player's future court hours limit (D49: solo class hours count).
- R5-AC4. Given a solo class booked on the schedule, when it is confirmed, then the Booking confirmed card names the coach and court (F10 LINE-04-AC9) and the coach gets New session (F12 CPORT-07).
- R5-AC5. Given a solo class ends, when its slot ends, then it counts as played (no check in, F09); the coach marks Present or Absent in K5 (F12) for pay.
- R5-AC6. Given a tier or a price changes after a session is booked, when it is saved, then the booked session keeps the price it was booked at (D120, F04 R7-AC2).

**Meets.** PDPA: the booking names the coach and customer, visible to each by role. No double booking: AC1 and CC-4. Club scope: per club. TEXT: P keys.

**Canvas.** H-C12-Confirmed, H-C13-My-bookings, H-K5-Session-detail.

---

## R6 When availability changes under a booking

**Source.** PRD Front desk rules ("Moving a booking checks conflicts (court, coach and rest rule) and messages the customer"), Key flows G; D50.

**Requirement.** A change to a coach's availability, leave or status never silently removes a booking; the owner is told and decides.

**Acceptance criteria.**

- R6-AC1. Given approved leave or a closed time over booked sessions, when it is saved, then those sessions are flagged for the owner in A7 and the coach is still shown on them until a substitute is chosen.
- R6-AC2. Given a flagged session, when no substitute is picked, then the session stays booked; the owner may cancel it with full credit back (F09).
- R6-AC3. Given a coach with future sessions, when the owner tries to deactivate them, then it is refused until the sessions are moved or cancelled (D120).

**Meets.** PDPA: not relevant. No double booking: nothing is removed or double booked by a change. Club scope: per club. TEXT: A keys for the flag.

**Canvas.** H-A07-Coaches, H-K4-Leave.

---

## Data covered by F07 (HO Data model, for the design step)

Coach (user, bio Thai and English, certifications, specialties, ages and levels taught, languages, tier, price override, pay model, active), Coach tier (name, price per price group), Availability rule (coach, weekday, start, end, or a one off date open or closed), Leave request (coach, dates, full or half day, type, status, approver), Booking (type solo class, court, coach). The coach is reserved by a uniqueness rule on club, coach and hour.

## Proposed new text keys (D51)

Proposed by the drafter; writers own the wording; numbers from the i18n role after `copy-index.csv` exists (D31). Existing keys first.

- P: no court open for this coach, coach no longer available, pick another coach, coach not available at this hour, solo class summary lines with `{coach}` and `{court}`.
- A: substitution actions, flagged session labels, rest cap refusal with `{hours}`.
- K: leave and availability validation messages.

No key is added by this draft.

## Open questions

All 8 earlier questions are answered by D120 and removed. None remain.
