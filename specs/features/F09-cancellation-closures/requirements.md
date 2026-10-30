# F09 Cancellation and closures · Requirements

Status: **DRAFT for approval (gate 1).** Drafted 30 Oct 2026. Nothing here is approved until a person says so. No design or code follows until then.

Feature: F09 Cancellation and closures. Depends on: F06. Requirement IDs: CANCEL-01 to CANCEL-04. Wave 3.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Payments, cancellation, credits and wallet (Booking and cancellation policy, Credits and wallet); Court booking; Solo classes (Substitutions); Group classes and waitlist; Coach portal and admin console (A2, A12, Front desk rules); Customer app pages C13, C13b; LINE notifications; Key flows D |
| HO | `specs/product/handoff-v1.2.md` | Business rules as requirements (CANCEL-01 to CANCEL-04, BOOK-06, PKG-01, PROMO-01, COACH-04); Payments (PAY-03, PAY-05); Data model (Closure, Booking) |
| Decisions | `docs/decisions.md` | D19, D21, D25, D28, D40, D45, D48, D49, D50, D56, D67, D70, D78, D84, D85, D90; round 1 |
| Gaps | `docs/canvas-gaps.md` | A1 (check in leftovers), A3 |
| QA | `docs/qa/traceability.md`, `open-questions.md`, `concurrency-tests.md` (branch `qa/test-strategy`) | CANCEL rows; Q-13, Q-14, Q-16; CONC-13 |
| Other features | F03, F04, F05, F06, F07, F08, F10, F11, F14 | Slot and hold, order allocation, wallet, ledgers, coach, class, messages, A2 and A12, rewards |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026; every board has a T- Thai twin.

## Scope

In scope: a player's cancel and the sheet that states the outcome first (C13, C13b), what is returned and what is forfeited (the 12 hour line, mixed payments, add-ons, codes), the rule that value never returns as cash, a club closure and its preview and cancel (A12), the played status when a slot ends, and staff marking a no show or late cancel in A2 and reversing it.

Out of scope: the ledger rows themselves (F06 writes them), the payment rules and Beam (F05), the waitlist offer after a cancel (F08), the LINE messages (F10), the A2 and A12 screens as pages (F11), the referral reward (F14), coach pay amounts (F12, F13).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin, F1-, F2-, F3- flow copies (not repeated). Boards: H-C13-My-bookings, H-C13b-Cancel-sheet, G-C13b-Late-cancel, G-C13b-Coach-changed, S-C13-Empty, G-C13-Waitlist-tab, H-A12-Closures, H-A02-Booking-create, G-A02b-Booking-detail, H-A01-Calendar, S-A01-Paused, H-K5-Session-detail.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Bookings, closures and returned value carry the club ID and every query filters by it. A player can cancel only their own bookings; a request for another player's or club's booking answers 404 (D27).

**CC-2 Server side.** The server decides what returns and what is forfeited, from the club's settings and the booking's start time. The client never sends an outcome. Roles: players cancel their own bookings; front desk and owner cancel, mark no show and late cancel in A2 and create closures in A12; the Accountant cannot change bookings; coaches cannot (HO Roles).

**CC-3 PDPA.** A cancel changes the player's own records. A closure notice goes to the affected players only. Staff reasons for a no show or late cancel are staff only and never shown to the player. BOOQ staff never see bookings, cancels or closures (PLAT-02). Test records are flagged and excluded from reports (D33).

**CC-4 No double booking.** A cancel frees the slot (and the coach) in the same transaction as the return of value, so the slot can be booked or offered to a waitlist (F08) at once and never twice. A closure blocks the slot before it cancels bookings, so no new hold or booking can appear in the closed range between the preview and the cancel. A cancelled or released row does not count against the uniqueness rule (F03 BOOK-04-AC6). Cancelling one hour of an order frees only that hour (BOOK-06).

**CC-5 Language files (TEXT-01 to TEXT-06).** All text from `locales/*` by key, Thai and English. Sample values are named variables with the same names in both files: `{hours}` (the cancel window), `{credits}`, `{amount}`, `{date}`, `{time}`, `{court}`, `{coach}`, `{reason}`. The 12 hour window is a club setting and always a variable, never typed (Gaps A5). Existing wording is not edited; new text gets new keys in both files, proposed by the drafter, owned by the writers (D51). The cancel sheet says wallet or credit and never cash. Layouts survive the longest Thai or English string; the sheet and the closure preview scroll; buttons never wrap.

**CC-6 Other platform rules.** All times Asia/Bangkok, including the 12 hour line and "played when the slot ends". Money is integer satang. Value never goes back as cash. Never invent a setting: the cancel window (Hunter 12 hours) is a club setting; the no show timing is a club setting (A16).

---

## CANCEL-01 Cancel 12 hours or more ahead returns full value

**Source.** HO CANCEL-01. PRD Booking and cancellation policy, Credits and wallet, C13b; D21, D40, D67, D78, D84, D85; QA Q-13.

**Requirement.** Cancelling 12 hours or more before start returns full value: package credit goes back to the package, money goes to the wallet. Cancelling later, or not showing up, forfeits the credit or payment. The cancel sheet states the outcome before the customer confirms.

**Hand-off acceptance check, kept.** The cancel sheet states the outcome before confirming.

**Acceptance criteria.**

- CANCEL-01-AC1. Given a booking and the club's cancel window (Hunter 12 hours), when a player opens the cancel sheet, then it states the outcome before they confirm: what returns (credit to its package, money to the wallet, wallet use to the wallet) or what is forfeited (hand-off check), with `{hours}` from the setting.
- CANCEL-01-AC2. Given a cancel at exactly 12 hours 00 minutes 00 seconds before start or earlier, when it is confirmed, then full value returns; at 11 hours 59 minutes 59 seconds it is a late cancel and value is forfeited ("12 hours or more", QA unit boundary).
- CANCEL-01-AC3. Given a booking paid by package credit, when it is cancelled in time, then a `return` row puts the credit back to the same package (F06 R1-AC2, D21).
- CANCEL-01-AC4. Given a booking paid by money (Beam or cash), when it is cancelled in time, then the money goes to the wallet with the wallet reason `refund` (D21, D78). Never to the player's bank, Beam or in cash (CANCEL-02).
- CANCEL-01-AC5. Given a booking paid partly by wallet, when it is cancelled in time, then the wallet use returns to the wallet with the reason `return` (D21, D78).
- CANCEL-01-AC6. Given a mixed payment (credit, wallet and money), when it is cancelled in time, then each part returns to its own source, using the allocation stored on the order (F04 R4-AC8, D21).
- CANCEL-01-AC7. Given add-ons on the booking, when it is cancelled in time, then they return with the booking (D21).
- CANCEL-01-AC8. Given a promo code used on the order, when only some hours of the order are cancelled, then that hour's share of the discount is restored and the code use is restored only when every hour of the order is cancelled (D67, F04 PROMO-01-AC10); a restored code reduces the partner redemption count (D70). The birthday entitlement is restored like the code (D21); whether it follows the every-hour rule is Q1.
- CANCEL-01-AC9. Given a two hour order, when the player cancels one hour, then only that hour is cancelled and the other stays (BOOK-06, D40).
- CANCEL-01-AC10. Given a late cancel (under the window) or a no show, when it is confirmed or marked, then the credit or payment is forfeited: a `forfeit` row for credit, and money paid is not returned (PRD). The sheet says so before the player confirms and the player may still cancel to free the slot.
- CANCEL-01-AC11. Given a credit reserved before its package expired, when the booking is cancelled in time but after the package expiry date, then the credit is lost and not returned (D85). The sheet says so before confirming.
- CANCEL-01-AC12. Given a Student credit held by a player who is now an Adult, when the booking is cancelled in time, then it returns to the package as any credit (D84).
- CANCEL-01-AC13. Given a cancel, when it is saved, then the slot, the coach (for a solo class) and any seat are freed in the same transaction as the return, and the next in the waitlist is offered the spot under F08 rules (CC-4).
- CANCEL-01-AC14. Given a second tap on Confirm cancel, or two devices, when both arrive, then the booking is cancelled once and value returns once (idempotent).
- CANCEL-01-AC15. Given a booking that has already started or ended, when a player tries to cancel, then the server refuses; a past booking cannot be cancelled by a player.
- CANCEL-01-AC16. Given a booking that is Awaiting payment (a hold), when the player abandons it, then the hold is released and anything reserved returns in full (F04 R7-AC6); this is a release, not a cancel with a forfeit.
- CANCEL-01-AC17. Given a class seat, when the player cancels in time, then the group credit (or money to the wallet) returns and the seat is freed for the waitlist (F08); late cancel forfeits.
- CANCEL-01-AC18. Given a solo class whose coach was changed (F07 R4), when the customer cancels, then full value returns whatever the time (PRD Substitutions).
- CANCEL-01-AC19. Given a cancel, when it is saved, then the player gets Cancellation result stating whether value came back (LINE-05, F10) and the coach of a solo class or class gets New or changed session (F12 CPORT-07).
- CANCEL-01-AC20. Given a cancel by staff for a player (A2), when it is saved, then the same return rules apply by the same window unless staff mark it as a club cancel (Q2); a reason is required and audited (PLAT-04).
- CANCEL-01-AC21. Given a cancel by a player at a Paused club, when it is made, then whether it is allowed is Q3.
- CANCEL-01-AC22. Given any return, when it is saved, then the ledger rows and the booking status change are one transaction, or neither (PKG-01-AC6), and every ledger row is append only (D28).

**Meets.**

- PDPA: AC rows are the player's own records; the staff reason on AC20 is staff only.
- No double booking: AC13 and CC-4; AC9 frees only the cancelled hour.
- Club scope: the window and the setting are per club.
- TEXT: C13b outcome text from P keys with `{hours}`, `{credits}`, `{amount}`; Thai and English; the sheet never says cash.

**Canvas.** H-C13b-Cancel-sheet (T-), G-C13b-Late-cancel (T-), H-C13-My-bookings (T-), G-C13b-Coach-changed.

---

## CANCEL-02 Value never returns as cash

**Source.** HO CANCEL-02, PAY-05. PRD Payments (Value never comes back as cash); Gaps A3.

**Requirement.** Value never returns as cash. The wallet cannot be withdrawn.

**Hand-off acceptance check, kept.** No cash refund action exists anywhere.

**Acceptance criteria.**

- CANCEL-02-AC1. Given the whole system, when its routes, buttons and admin actions are listed, then none refunds money or withdraws the wallet (route inventory test; hand-off check).
- CANCEL-02-AC2. Given a cancel, closure, failed payment or wrong amount, when value returns, then it returns as wallet balance or package credit only.
- CANCEL-02-AC3. Given Beam, when the app is built, then it has no refund call and a test double fails if one is made (F05 PAY-05-AC3).
- CANCEL-02-AC4. Given the P2 step 5 Beam text "Refunds go back by PromptPay" and the PRD cost section that repeats it, when F09 is built, then that text is not built and the cancel sheet says wallet or credit (Gaps A3).
- CANCEL-02-AC5. Given a cash payment taken at the desk, when it is cancelled in time, then the value goes to the wallet, not as cash (D21, F05 PAY-06-AC7).
- CANCEL-02-AC6. Given the owner or front desk, when they want to give a player money back, then the only action is a wallet credit `adjust` with a written reason (F06 PKG-01-AC4).

**Meets.** PDPA: not relevant. No double booking: not relevant. Club scope: per club wallet. TEXT: cancel sheet and wallet text say wallet or credit.

**Canvas.** H-C13b-Cancel-sheet (T-), H-P2-Step5-Payments (the Option A text is a canvas bug).

---

## CANCEL-03 A club closure

**Source.** HO CANCEL-03. PRD Court booking, Front desk rules (Closures), A12; D48, D50; QA Q-16, CONC-13.

**Requirement.** A club closure cancels affected bookings with full credit back and a LINE message.

**Acceptance criteria.**

- CANCEL-03-AC1. Given front desk or the Owner in A12, when they create a closure (courts, start, end, a range, a day or a repeat, a reason), then the page first lists the existing bookings it affects (the preview) and nothing is cancelled until they confirm (PRD).
- CANCEL-03-AC2. Given the closure is confirmed, when it is saved, then each affected booking is cancelled with full value back whatever the time (not subject to the 12 hour line), as the same returns as CANCEL-01-AC3 to AC7, and each player gets Club closed this slot (LINE-05, F10).
- CANCEL-03-AC3. Given the closure, when it is saved, then the slots are closed in the same transaction, so no new hold or booking can appear in the closed range between the preview and the confirm; a booking that appeared after the preview is included in the cancel (CC-4).
- CANCEL-03-AC4. Given a closed slot, when the schedule or coach availability loads, then the slot shows Closed, cannot be booked and disappears from booking and coach availability (PRD).
- CANCEL-03-AC5. Given a slot in the closed range that is in a payment hold, when the closure is confirmed, then the hold is cancelled, the player is told, and a payment that arrives later follows PAY-03: the value goes to the wallet because the slot is closed (D48, D25).
- CANCEL-03-AC6. Given a group class session in the closed range, when the closure is confirmed, then the session is cancelled for everyone with full credit back and a message, the waitlist entries end, and the coach is told (F08 CLASS-01-AC13).
- CANCEL-03-AC7. Given a solo class in the closed range, when the closure is confirmed, then it is cancelled with full value back for the customer and the coach is told (F07).
- CANCEL-03-AC8. Given a booking in the closed range that is already played (its slot has ended), when the closure is confirmed, then it is not touched.
- CANCEL-03-AC9. Given a repeat closure (for example every Monday), when it is confirmed, then it applies to each occurrence and the preview shows every affected booking in the horizon; occurrences beyond the booking window apply as the window reaches them and cancel nothing yet.
- CANCEL-03-AC10. Given the owner wants to change opening hours or remove a court under existing bookings, when they try, then it is refused and they use a closure instead (D50).
- CANCEL-03-AC11. Given a closure is removed or shortened, when it is saved, then the slots become Open again; cancelled bookings are not restored.
- CANCEL-03-AC12. Given a package that expired before the return (the booking was reserved before expiry, D85), when a closure cancels the booking, then the credit is returned and what happens to its expiry is Q4.
- CANCEL-03-AC13. Given a closure over a Paused club, when it is created, then it works as for a Live club (the owner can still manage existing bookings, D60).
- CANCEL-03-AC14. Given a closure, when it is saved, then it records the courts, range, repeat, reason and the staff member, and is audited (PLAT-04).
- CANCEL-03-AC15. Given a closure over many bookings, when it is confirmed, then it is applied as one operation: all cancels and returns succeed or none does, and the messages follow once it is committed; a message that fails to send never undoes the cancel (the app shows it in My bookings, D9, LINE-07).
- CANCEL-03-AC16. Given a closure created while a booking is being created in the same range, when both run, then exactly one outcome stands: the booking is created before the closure and then cancelled by it, or refused because the slot is closed (QA CONC-13).
- CANCEL-03-AC17. Given Front desk and Owner only, when anyone else tries to create a closure, then the server refuses (HO Roles).

**Meets.**

- PDPA: the preview shows the affected players' names to staff only; the player message names the slot, not other players.
- No double booking: AC3, AC16 and CC-4.
- Club scope: closures per club and per court.
- TEXT: A12 text from A keys; Club closed this slot from L keys with `{court}`, `{date}`, `{time}`.

**Canvas.** H-A12-Closures (T-), L-Msg-* (no Club closed card; F10 D91), S-A01-Paused.

---

## CANCEL-04 No check in: played, no show and late cancel

**Source.** HO CANCEL-04. PRD Change log (A3 Check-in removed), Front desk rules ("A confirmed booking counts as played once its slot ends. Staff can mark a no show or late cancel from booking detail (A2) with a reason, and reverse it the same way"); Gaps A1; QA Q-14.

**Requirement.** There is no check in. A confirmed booking counts as played when its slot ends. Staff mark a no show or late cancel in A2 with a reason, and can reverse it.

**Acceptance criteria.**

- CANCEL-04-AC1. Given a confirmed booking, when its slot ends (Bangkok time), then its status becomes Played automatically; there is no check in step, no Checked in status, no late flag and no check in page or QR anywhere (Gaps A1).
- CANCEL-04-AC2. Given a booking that is Awaiting payment, Cancelled or Released, when its slot ends, then it never becomes Played.
- CANCEL-04-AC3. Given a confirmed booking whose player did not come, when staff mark No show in A2 with a reason, then the status is No show, the credit or payment is forfeited (`forfeit` row, CANCEL-01-AC10) and the reason is audited (PLAT-04). Without a reason the server refuses.
- CANCEL-04-AC4. Given a late cancel that happened outside the app (the player phoned the desk), when staff mark Late cancel in A2 with a reason, then it is treated as CANCEL-01-AC10: value is forfeited, the slot is freed if still in the future.
- CANCEL-04-AC5. Given staff reverse a No show or Late cancel, when they do it with a reason, then the status returns to Played (or the prior state) and the forfeited credit comes back by a new ledger row, not by editing the old one (F06 R1-AC5, D28); the reversal is audited.
- CANCEL-04-AC6. Given staff mark a no show before the slot has ended, when they try, then whether it is allowed is Q5 (QA Q-14).
- CANCEL-04-AC7. Given a reversal, when coach pay and a referral reward already depended on the status, then what changes is Q6.
- CANCEL-04-AC8. Given a solo class or a class seat, when the coach marks Absent in K5 (F12), then it is the attendance record for pay, and staff A2 still decides the player's forfeit; whether one drives the other is Q7.
- CANCEL-04-AC9. Given the no show timing setting (A16), when staff mark a no show, then it is read from the club's settings; its value is an empty setting until the owner sets it.
- CANCEL-04-AC10. Given front desk and owner only, when anyone else tries to mark or reverse, then the server refuses (HO Roles).
- CANCEL-04-AC11. Given the played status, when the referral reward rule reads it (the friend's first paid booking is played, F14), then it uses this status, so a booking reversed to No show does not count as played.
- CANCEL-04-AC12. Given the canvas notes about "Late after 15 minutes" and a check in QR in A01, C12 and My bookings, when F09 is built, then none is built (Gaps A1).

**Meets.**

- PDPA: the staff reason is staff only; the status is visible to the player as a chip (Played, No show) without the reason.
- No double booking: marking played or no show never changes the slot (past). A late cancel in the future frees the slot (CC-4).
- Club scope: per club.
- TEXT: status chips from P keys (Awaiting payment, Confirmed, Cancelled, No show, Played); A2 labels from A keys with the reason field (reuse A-0120 "Reason, required" where it fits).

**Canvas.** G-A02b-Booking-detail (T-), H-A02-Booking-create, H-A01-Calendar (check in leftovers are a canvas bug, Gaps A1), H-C13-My-bookings.

---

## Data covered by F09 (HO Data model, for the design step)

Booking (status: Awaiting payment, Confirmed, Played, No show, Cancelled, Released), Closure (courts, start, end, repeat, reason, staff), cancel record (who, when, outcome, reason for staff actions), returned value as F06 ledger rows with the booking reference. A job that sets Played at slot end per club and Bangkok time.

## Proposed new text keys (D51)

Proposed by the drafter; writers own the wording; numbers from the i18n role after `copy-index.csv` exists (D31). Existing keys first.

- P: outcome lines on the cancel sheet (credit returns, money goes to the wallet, wallet use returns, forfeited, credit lost after expiry), booking cancelled, cannot cancel a past booking, status chip Played.
- A: closure preview and confirm, affected bookings count, no show and late cancel reason labels, reversal, repeat closure labels.
- L: Cancellation result (returned, forfeited), Club closed this slot.

No key is added by this draft.

## Open questions

1. **Birthday entitlement on a partial cancel (CANCEL-01-AC8).** D67 restores a code use only when every hour of an order is cancelled. Does the birthday entitlement follow the same rule, or is it restored on any hour?
2. **Staff cancel for a player (CANCEL-01-AC20).** Does the 12 hour window apply when staff cancel for a player at the desk, or may staff choose a club cancel with full value (with a reason)?
3. **Cancel during a pause (CANCEL-01-AC21).** May a player cancel an existing booking while the club is Paused (existing bookings stay valid; D60 lets the owner manage them)?
4. **Package expired before a closure return (CANCEL-03-AC12).** D85 loses the credit if a booking is cancelled after expiry, but a closure is the club's doing. Is the credit returned and the package extended, or returned to an expired package?
5. **No show before the slot ends (QA Q-14).** Can staff mark a no show before the slot has ended, or only after?
6. **Reversal effects (QA Q-14).** When staff reverse a no show or late cancel, does coach pay change, and what about a referral reward already paid?
7. **Coach Absent and player forfeit (CANCEL-04-AC8).** Does the coach's Absent in K5 mark the player no show, or are they separate records?
8. **Closure repeat horizon (CANCEL-03-AC9).** How far ahead does a repeat closure cancel bookings, the booking window or without limit?
9. **Messages that fail (CANCEL-03-AC15).** For a closure of many bookings the club may hit the LINE cap: the app shows the cancel in My bookings (D9, LINE-07). Does the owner also get a list of players who could not be messaged?
