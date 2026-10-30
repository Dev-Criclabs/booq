# F10 LINE messages and rich menu · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, round 9: the drafter's F06 and F10 requirements and the answers D83 to D99 were approved by the user. Revision 3 (30 Oct 2026) applies D91 to D99, D114, D116 and the Reviewer's findings F10-1, F10-2, F10-3, F10-6 (`docs/review/spec-consistency.md`). Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Feature: F10 LINE messages and rich menu. Depends on: F03. Requirement IDs: LINE-02 to LINE-07 (LINE-01 is F02). Wave 2.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Overview (rich menu); LINE notifications and language (message table, cap rule LINE-07); Payment checking and LINE message costs (LINE Official Account messages); Platform foundation (LINE row, LINE templates); Onboarding (steps 4 and 6, P2 step 4); Pausing a live club |
| HO | `specs/product/handoff-v1.2.md` | LINE integration (LINE-01 to LINE-07); BOOK-02; PAY-03; PLAT-03; Text and language files |
| Decisions | `docs/decisions.md` | D9, D17, D29, D32, D34, D38, D45, D54, D75, D91 to D99; round 1 (message cap) |
| Gaps | `docs/canvas-gaps.md` | A6 (rich menu Thai terms), C3, C4 |
| QA | `docs/qa/traceability.md`, `open-questions.md`, `tests/fakes/line` (branch `qa/test-strategy`) | LINE rows, Q-27 |
| Other features | F01, F02, F03, F05, F06, F08, F09, F12, F14, F15 | Triggers for each message; P1; keys |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026. Thai twins exist as T-L-Msg-Confirmed, T-L-Msg-Reminder and T-L-Msg-Waitlist; the rich menu board L-Rich-menu has none.

## Scope

In scope: the club's rich menu (six tiles, fixed deep links, labels in Thai and English, LINE-02), how every message is sent from the club's own Official Account in the player's language with fixed wording and layout (LINE-03), the Booking confirmed Flex card (LINE-04), the list of other messages and when each is sent (LINE-05), the LINE usage and token health shown in P1 (LINE-06), and the monthly message cap rules (LINE-07).

Out of scope: LINE Login, LIFF and the friend choice (F02, LINE-01), when the business events happen (the owning features decide; F10 sends), the P1 screen itself (F15), the rich menu upload step in P2 (F15 calls F10), wording (writers).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin, L- LINE boards, F1-, F2- flow copies (not repeated). Boards: L-Rich-menu, L-Msg-Confirmed (T-), L-Msg-Reminder (T-), L-Msg-Waitlist (T-), F1-01-L-Chat-Rich-menu, F1-09-Msg-Confirmed, H-P2-Step4-LINE (X keys), H-P1-Clubs (X keys). There are no boards for the other messages; they use the writers' wording on the Booking confirmed card style (D91).

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Every message is sent with the Messaging API token of the club it belongs to, from that club's Official Account (one OA, LIFF app and rich menu per club, D7). A message never goes through another club's account. Usage counts are per club.

**CC-2 Server side.** Only the server sends. Tokens are stored encrypted with an extra layer, are write only and only the last 4 characters show (D27, D34). Nothing the client sends decides a message's text or recipient.

**CC-3 PDPA.** A message holds the minimum the player needs (court or class, date, time, coach, amount, receipt number). It never holds phone number, date of birth or another player's data. The club is the controller and BOOQ the processor (PDPA-01). BOOQ staff never see message content or recipients; P1 shows counts only (LINE-06). A player can switch reminders and promotions off in Profile (C17); booking confirmations, payment results and cancellation results are service messages. The Booking reminders in LINE switch controls the 24 hour and 2 hour reminders; the Promotions in LINE switch controls the birthday discount and referral reward; every other message is always sent (D94).

**CC-4 No double booking.** Messages never reserve or release a slot. A message that offers a slot (Waitlist spot open) refers to a hold or offer owned by F08 and F03; sending it late or not at all never changes the schedule. A message sent for a state the schedule no longer holds (a released hold) is not repeated.

**CC-5 Language files (TEXT-01 to TEXT-06).** Wording and layout are fixed in code but the text is not: LINE Flex cards read from `locales/*` by key (L keys), the same files as the screens and PDF receipts (CLAUDE.md). One key can serve several messages. Sample values become named variables with the same names in both files (`{club}`, `{court}`, `{date}`, `{time}`, `{coach}`, `{amount}`, `{receipt}`, `{minutes}`, `{days}`, `{hours}`). Club name, logo and rules fill the templates (LINE-03). Existing wording is not edited; new text gets new keys in both files, proposed by the drafter, owned by the writers (D51). Each message ships in Thai and English. Cards survive the longest Thai or English string; buttons never wrap. The P1 and P2 text is X keys, English only. Variable names are the ones in `locales/README.md` (for example `{clubName}`, `{coachName}`, `{receiptNumber}`, `{holdMinutes}`, `{cancelHours}`, `{claimMinutes}`); names used in this file are descriptive and map to them, and the writers' variables are not renamed (Reviewer F10-6).

**CC-6 Other platform rules.** All times Asia/Bangkok. Reminders count from the booking start in Bangkok time. Never invent a rule: where the spec is silent it is a question below.

---

## LINE-02 The rich menu

**Source.** HO LINE-02, BOOK-02. PRD Platform and LINE (six tiles), Change log "Navigation"; D54; Gaps A6, C4.

**Requirement.** The rich menu has 6 tiles, each a deep link to its own page: Book a court (C4), Solo classes, Group classes, Packages, My bookings, Refer a friend. The links are fixed; the owner edits each tile's label in Thai and English (D54).

**Hand-off acceptance check, kept.** Each tile opens its page directly.

**Acceptance criteria.**

- LINE-02-AC1. Given a club's rich menu, when it is built, then it has exactly 6 tiles with 6 distinct deep links: C4 Book a court, Solo classes, Group classes, Packages, My bookings, Refer a friend (the pages that each tile opens, not Home).
- LINE-02-AC2. Given the Book a court tile, when it is tapped, then C4 opens directly (BOOK-02).
- LINE-02-AC3. Given any tile, when it is tapped, then its page opens with the club in the URL (D6, F02 AUTH-01-AC14); a tile for a page that needs a person starts sign in first (F02 AUTH-01-AC10).
- LINE-02-AC4. Given the owner edits a tile label in A0 step 6, when they save it, then each label is stored in Thai and English; the links cannot be edited (D54).
- LINE-02-AC5. Given the labels, when the menu is uploaded or redone (P2 step 4 Upload), then the club's own labels appear and the menu is the club's own rich menu on its own Official Account (LINE templates use the club's name, logo and rules).
- LINE-02-AC6. Given the Thai terms, when the menu labels default, then they use คอร์ต, คลาสเดี่ยว, คลาสกลุ่ม, รายชื่อรอ, วอลเล็ต, เครดิต where they apply, not เรียนเดี่ยว or เรียนกลุ่ม (HO Language; Gaps A6: L-Rich-menu is wrong).
- LINE-02-AC7. Given a Paused club, when a tile is tapped, then the page opens in its paused state; the tiles are not removed (PLAT-03).
- LINE-02-AC8. Given the menu is uploaded, when it fails, then P2 shows the failure (a Test step) and the club stays in Draft until it works; a stale menu keeps working.
- LINE-02-AC9. Given the rich menu, when it is built, then it is one image with Thai and English labels together, rendered on the server from the owner's six labels, and one menu serves every player (D92).
- LINE-02-AC10. Given the owner edits a tile label after Go live, when it is saved in Settings (A16), then the image is rendered again for the club and the change is audited (D114, PLAT-04). Six label keys are needed (D54): new keys in both files, listed for the writers.

**Meets.**

- PDPA: the menu holds no personal data.
- No double booking: not relevant.
- Club scope: one menu per club, uploaded with that club's token.
- TEXT: tile labels are club typed Thai and English fields with defaults from L keys; A0 text is A keys, Thai and English.

**Canvas.** L-Rich-menu (T- none; canvas bug on the Thai terms, Gaps A6), F1-01-L-Chat-Rich-menu, H-A0-Setup-checklist (labels), H-P2-Step4-LINE.

---

## LINE-03 How messages are sent

**Source.** HO LINE-03. PRD LINE notifications and language, Platform foundation (LINE templates); D9, D32, D45.

**Requirement.** Messages are push messages from the club's OA in the player's language, with fixed Thai and English wording in code. Templates fill in the club's name, logo and rules. There is no message editor in the admin.

**Hand-off acceptance check, kept.** No message editor in the admin.

**Acceptance criteria.**

- LINE-03-AC1. Given any message, when it is sent, then it is sent with the club's own token from the club's own Official Account (CC-1), to the LINE user ID of the player at that club.
- LINE-03-AC2. Given a player, when a message is sent, then it is in the player's language on their record (Thai or English); when none is set, it is the LINE app language at sign in (F02 AUTH-02-AC25). A queued message uses the language at send time, not at event time (D93).
- LINE-03-AC3. Given a message, when it is built, then its text comes from the language files by key and its layout is fixed in code; the club's name, logo and rule values (hours, days, minutes) fill the template.
- LINE-03-AC4. Given the admin, when its pages are listed, then there is no page, route or button to edit a message (A15 is removed; E2E check).
- LINE-03-AC5. Given a player who is not a friend of the club's Official Account or has blocked it, when a message is sent, then LINE refuses it, the send is recorded as undeliverable, nothing is blocked, and the app shows the confirmation and asks them to add the account (D9, F02 LINE-01-AC8). The message is not retried in a loop.
- LINE-03-AC6. Given a message was sent, when it is recorded, then a log row notes message type, club, recipient reference, time and result, with no message text beyond the type, for usage and support; the log is not visible to BOOQ staff beyond counts (CC-3).
- LINE-03-AC7. Given the same event, when the job runs twice or a retry happens, then the player gets the message once (each message has a dedupe key such as booking and type).
- LINE-03-AC8. Given a club in Testing, when a message is sent, then it goes through the club's real Official Account to the testers and counts toward the monthly cap (D32); it is flagged test in the log and excluded from reports (D33).
- LINE-03-AC9. Given a club's Messaging API token fails, when a send is tried, then the send fails safely, nothing else breaks, BOOQ sees an alert in P1 and the owner sees a banner in the club admin (D114, LINE-06). The owner is not told through LINE, because the message would go through the failed Official Account.
- LINE-03-AC10. Given a message goes to staff or a coach, when it is sent, then it is sent in their language: staff and coaches have a language field that defaults to their LINE app language (D95).
- LINE-03-AC11. Given a message for a Paused club, when the event is a reminder or a cancellation result of an existing booking, then it is still sent (PLAT-03: existing bookings and reminders stay).

**Meets.**

- PDPA: AC3, AC6 and CC-3; consent for promotional messages follows the Profile switch.
- No double booking: CC-4.
- Club scope: AC1, AC7.
- TEXT: all message text is L keys; the admin has no editor so wording changes go through the developer (PRD).

**Canvas.** L-Msg-Confirmed (T-), L-Msg-Reminder (T-), L-Msg-Waitlist (T-), S-Error-Offline.

---

## LINE-04 Booking confirmed card

**Source.** HO LINE-04. PRD LINE notifications (first row), Change log "LINE" (rich card made explicit); D45; F04 PAY-07-AC6.

**Requirement.** Booking confirmed is a Flex Message rich card sent the moment a booking confirms: court or class, date, time, coach, amount paid, receipt number, View booking and Add to calendar.

**Hand-off acceptance check, kept.** Matches L-Msg-Confirmed.

**Acceptance criteria.**

- LINE-04-AC1. Given a booking is confirmed (a verified payment, credit used or nothing to pay), when it is saved, then the card is sent at once with court or class, date, time, coach if any, amount paid, receipt number, and the buttons View booking and Add to calendar.
- LINE-04-AC2. Given a booking paid wholly by credit or wallet, when the card is sent, then it shows the receipt number of the zero money receipt and how it was paid (F04 PAY-07-AC6, D64).
- LINE-04-AC3. Given a two hour selection (one order, one booking per hour), when it is confirmed, then one card is sent for the order listing its hours, with one receipt number (BOOK-06).
- LINE-04-AC4. Given View booking, when it is tapped, then it opens that booking in My bookings with the club in the URL; Add to calendar adds an event with the booking time in Asia/Bangkok.
- LINE-04-AC5. Given a late payment that is approved (PAY-03), when it is confirmed, then the same card is sent.
- LINE-04-AC6. Given a player who is not a friend, when the card cannot be sent, then the confirmation shows in My bookings and on the confirmation screen (D9, LINE-07-AC5).
- LINE-04-AC7. Given the card, when it is rendered in Thai or English, then every line comes from L keys with the named variables, and amounts show as whole baht or two decimals (D69).
- LINE-04-AC8. Given a card for a Testing club, when it is sent, then it carries no real receipt number (test series, PLAT-07).
- LINE-04-AC9. Given the card for a solo class, when it is sent, then it names the coach and the court.

**Meets.** PDPA: no phone or date of birth; the receipt number is the club's own. No double booking: sent only after a booking is confirmed under BOOK-04. Club scope: club name and logo from that club. TEXT: L keys; card and PDF receipt share keys.

**Canvas.** L-Msg-Confirmed (T-), F1-09-Msg-Confirmed. QA notes the visual match is checked by hand.

---

## LINE-05 The other messages

**Source.** HO LINE-05. PRD LINE notifications (message table); D9, D17, D29, D45, D75; PLAT-03; F01 PLAT-03.

**Requirement.** Other messages are sent to the people and at the times below. F10 sends; the owning feature raises the event. A message that belongs to F16 only (Slip needs re upload) is not built here.

**Acceptance criteria.**

- LINE-05-AC1. Given a booking and the player's Booking reminders in LINE switch on, when it is 24 hours and again 2 hours before start, then the player gets a Reminder, once each, in their language. A booking cancelled before then gets none. With the switch off, no reminder is sent (D94).
- LINE-05-AC2. Given a hold ends without payment, when it is released, then the player gets Booking released, in a Beam club too (D45).
- LINE-05-AC3. Given a player cancels, when the cancel is saved, then they get Cancellation result stating whether value came back (F09, D21).
- LINE-05-AC4. Given staff close a slot with bookings (A12), when they confirm, then each affected player gets Club closed this slot with full credit back (F09).
- LINE-05-AC5. Given a substitute coach is assigned, when it is saved, then the customer gets Coach changed naming the new coach (F07, F12).
- LINE-05-AC6. Given a spot opens for the first in line (F08), when the offer is made, then they get Waitlist spot open with the claim time (club setting) as `{minutes}`.
- LINE-05-AC7. Given a package, when it is 14 days and 3 days before expiry, then the player gets Package expiring (F06 PKG-03).
- LINE-05-AC8. Given the first day of a player's birth month, a birthday discount set (F14) and the player's Promotions in LINE switch on, when the day arrives, then they get Birthday discount; no discount value set, or the switch off, means no message (D94).
- LINE-05-AC9. Given a referral reward is earned (the friend's first booking played, F14) and the referrer's Promotions in LINE switch is on, when it lands, then the referrer gets Referral reward earned; the reward itself is still paid when the switch is off (D94).
- LINE-05-AC10. Given a solo or group class is booked, moved or cancelled, when it is saved, then the coach gets New or changed session (F12 CPORT-07).
- LINE-05-AC11. Given the owner decides a leave request, when it is saved, then the coach gets Leave approved or declined (F12 CPORT-04).
- LINE-05-AC12. Given a class is below its minimum a set time before start, when the time arrives, then front desk gets Class below minimum (F08).
- LINE-05-AC13. Given a late payment (PAY-03) or a wrong amount (F05), when it is handled, then the player gets a message saying what happened to the money. The messages that have no board use the writers' wording on the Booking confirmed card style in v1 (D91).
- LINE-05-AC14. Given the owner's pause or a cap level, when it happens, then the owner gets a message (PLAT-03-AC1, LINE-07-AC4). A failed key check or token failure is a banner and a P1 alert, not a LINE message (D114, D75).
- LINE-05-AC15. Given a booking made less than 24 hours or 2 hours before start, when it is confirmed, then the reminders already past are skipped (D96).
- LINE-05-AC16. Given the reminder hours (24 and 2) and the package expiry days (14 and 3), when text or settings use them, then the numbers are variables in the text and settings in code, never typed in a key (D116).

**Meets.** PDPA: each message goes to its own recipient only. No double booking: a Waitlist spot message refers to an offer, not a hold, until it is claimed. Club scope: per club token. TEXT: one L key set per message in Thai and English; named variables replace sample values.

**Canvas.** L-Msg-Reminder (T-), L-Msg-Waitlist (T-); no boards for the others (D91).

---

## LINE-06 Usage and token health in P1

**Source.** HO LINE-06. PRD Running many clubs ("Usage numbers per club, including LINE messages this month"); D75.

**Requirement.** P1 shows LINE messages used this month per club against its plan, and alerts when the Messaging API token fails.

**Acceptance criteria.**

- LINE-06-AC1. Given each club, when P1 loads, then it shows the messages used this month against the club's plan limit, as numbers only.
- LINE-06-AC2. Given the usage, when it is read, then it comes from LINE's own count for the club's Official Account (PRD LINE-07: "reads each club's monthly usage from LINE"), and the plan limit is the club's LINE plan (set in setup).
- LINE-06-AC3. Given the month changes at Bangkok midnight on the first, when it does, then the counter starts again.
- LINE-06-AC4. Given a club's Messaging API token fails (a send or a health check fails), when it is detected, then P1 shows an alert for that club and the owner sees a banner in the club admin (D114).
- LINE-06-AC5. Given P1, when BOOQ staff look at a club, then they see counts and health only, never message content or recipients (PLAT-02, CC-3).
- LINE-06-AC6. Given a club on the free plan or a paid plan, when its limit is shown, then the plan is shown (the cap rules differ at 100 percent, LINE-07).
- LINE-06-AC7. Given test messages through the real Official Account (D32), when usage is shown, then they are included, because LINE counts them toward the cap.

**Meets.** PDPA: counts only. No double booking: not relevant. Club scope: per club. TEXT: P1 text is X keys, English only.

**Canvas.** H-P1-Clubs (X keys), H-P3-Club-alert, H-P3b-Support-view (shows the Messaging API connection failing).

---

## LINE-07 The monthly message cap

**Source.** HO LINE-07 (30 Oct 2026). PRD LINE message cap; D17, D29, D32.

**Requirement.** At 70 percent of the plan's monthly limit show an alert in P1 and a banner in the club admin; at 80 percent stop sending the 24 hour and 2 hour reminders and keep every other message; at 100 percent on a paid plan keep sending and tell the owner, on the free plan show the confirmation in the app and pass unsendable waitlist offers on. Bookings and payments are never blocked. The thresholds are the same for every club and are not club settings.

**Hand-off acceptance check, kept.** Given a club at 80% of its limit, when a booking is confirmed, then the confirmation is sent and no reminder is queued.

**Acceptance criteria.**

- LINE-07-AC1. Given a club's usage reaches 70 percent of its monthly limit, when it does, then P1 shows an alert and the club admin shows a banner in the pause banner style asking the owner to upgrade the LINE plan (D98).
- LINE-07-AC2. Given a club at 80 percent or more, when a booking is confirmed, then the confirmation is sent and no 24 hour or 2 hour reminder is queued; reminders skipped are not sent later, even if the cap clears (hand-off check, PRD).
- LINE-07-AC3. Given a club at 80 percent or more, when any of these events happens, then the message is still sent: booking confirmed, booking released, cancellation result, waitlist offer, club closed this slot, coach changed, package expiring (D29), birthday discount and referral reward (D17).
- LINE-07-AC4. Given a club at 100 percent on a paid plan, when messages are due, then everything keeps sending and the owner is told that LINE bills the club for extra messages.
- LINE-07-AC5. Given a club at 100 percent on the free plan, when a confirmation cannot be sent, then the confirmation shows in My bookings and on the confirmation screen, and the booking and payment go ahead.
- LINE-07-AC6. Given a waitlist offer that cannot be sent on the free plan at 100 percent, when the send fails, then the offer passes to the next person in line (F08).
- LINE-07-AC7. Given a booking or payment, when the cap is reached, then it is never blocked.
- LINE-07-AC8. Given the thresholds 70 and 80 percent, when the code reads them, then they are platform wide constants of the product, not club settings, and are not editable by a club owner.
- LINE-07-AC9. Given the usage is read from LINE, when LINE does not answer, then the check uses the last known value and P1 shows an alert; reminders are not stopped (D97).
- LINE-07-AC10. Given the owner upgrades the LINE plan mid month, when the limit changes, then LINE's own count decides the usage and the alerts and the reminder stop follow the new percentage (D99); a reminder already skipped is not sent.

**Meets.** PDPA: counts only. No double booking: a waitlist offer that cannot be sent passes on, never leaving the slot stuck. Club scope: per club usage and plan. TEXT: the P1 alert and A banner text are X and A keys (banner in Thai and English); the owner message is an L key.

**Canvas.** H-P1-Clubs (alert), club admin banner (pause banner style, D98).

---

## Data covered by F10 (for the design step)

Per club: LINE provider, OA, Login channel, LIFF app, Messaging API token (encrypted, write only), rich menu id and tile labels (Thai and English), plan and monthly limit. A message log (type, club, recipient reference, time, result, dedupe key, test flag). Per player: language, reminder and promotion switches (Profile). Scheduled reminder and expiry jobs per club.

## Proposed new text keys (D51)

Proposed by the drafter; writers own the wording; numbers from the i18n role after `copy-index.csv` exists (D31). Existing L keys first (L-0006 and others, found by `copy-index.csv`).

- L: late payment approved, late payment credited to the wallet, wrong amount received and being checked, owner messages (paused, key check failed, cap at 70 percent, cap over 100 percent on a paid plan), coach and front desk message texts if no key fits.
- A: cap banner in the club admin ("asking the owner to upgrade the LINE plan").
- X: P1 cap alert, token failure alert.

No key is added by this draft.

## Open questions

All 9 earlier questions are answered by D91 to D99 and removed. None remain.
