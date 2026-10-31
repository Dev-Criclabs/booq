# F10 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F10-line-messages/requirements.md`. F10 is partly built: the message catalogue, the builder, the outbox, the sender, the cap rules and the reminder queue exist; the rich menu uploader, the usage reader for P1 and most producers owned by other features do not.

**Result: 63 criteria. 39 covered by lane tests (traced; some only in part, noted), 1 new QA test, 1 finding (also a QA test), 22 still open (each with its reason).**

The lane's tests are good and already use QA's fakes (`checkConfirmedCard`, `textsNotFromLocale`, `validateFlexLimits`, the fake LINE push). They cover: every one of the 20 kinds renders in Thai and English as one card within LINE's limits, the sender (one send per row, own club's token, SKIP LOCKED, retry key, 401 health, 429, non friend, Testing club counts toward the cap, language changes while a row waits), the outbox (dedupe, no text column, no personal keys in params), the notification switches and the cap states at 70, 80 and 100 percent.

Findings:

| # | Severity | What is wrong |
|---|---|---|
| QA-F10-1 | 3 | `locales/en.json` and `th.json` L-0021 ("See you in 2 hours" / "เจอกันในอีก 2 ชั่วโมง") type the number of hours. The builder uses it as the 2 hour reminder title. D116 and LINE-05-AC16: reminder numbers are variables in the text, never typed in a key. The 24 hour reminder does it right (`L-new.msg_reminder_title_hours` with `{hours}`). Fix: the TEXT-03 variable pass on L-0021 (same key, `{hours}` in both languages) and the builder passes the hours. Owner: Content role, then the F10 lane | Fixed on main 31 Oct.

Also worth the orchestrator's attention (not a QA finding, a wiring gap): the platform console's default owner notifier is `outboxNotConnected`, so the owner message on pause (LINE-05-AC14, PLAT-03-AC1) fails until it is wired to the F10 outbox.

| Criterion | Text (cut) | Status |
|---|---|---|
| LINE-02-AC1 | Given a club's rich menu, when it is built, then it has exactly 6 tiles with 6 distinct deep links:  | Covered by a lane test (traced) |
| LINE-02-AC2 | Given the Book a court tile, when it is tapped, then C4 opens directly (BOOK-02). | Covered by a lane test (traced) |
| LINE-02-AC3 | Given any tile, when it is tapped, then its page opens with the club in the URL (D6, F02 AUTH-01-AC1 | Open: Rich menu tile links with the club in the URL: the rich menu builder and uploader are not in packages/line yet (only the label tables exist). |
| LINE-02-AC4 | Given the owner edits a tile label in A0 step 6, when they save it, then each label is stored in Tha | Covered by a lane test (traced); partial: labels and fixed links; the A0 screen is separate |
| LINE-02-AC5 | Given the labels, when the menu is uploaded or redone (P2 step 4 Upload), then the club's own labels | Open: Upload with the club's own labels on its own Official Account: uploader not built. |
| LINE-02-AC6 | Given the Thai terms, when the menu labels default, then they use คอร์ต, คลาสเดี่ยว, คลาสกลุ่ม, รายช | Open: Default Thai terms on the labels: the default labels come from the language files, but the rich menu renderer is not built; check when it exists. |
| LINE-02-AC7 | Given a Paused club, when a tile is tapped, then the page opens in its paused state; the tiles are n | Open: Paused club tile opens the paused page: screen (Playwright). |
| LINE-02-AC8 | Given the menu is uploaded, when it fails, then P2 shows the failure (a Test step) and the club stay | Open: Failed upload shown in P2, club stays Draft: uploader and P2 screen not built. |
| LINE-02-AC9 | Given the rich menu, when it is built, then it is one image with Thai and English labels together, r | Open: One server rendered image with both languages, one menu for every player: renderer not built. The fake LINE has createRichMenu and richMenuProblems ready. |
| LINE-02-AC10 | Given the owner edits a tile label after Go live, when it is saved in Settings (A16), then the image | Covered by a lane test (traced) |
| LINE-03-AC1 | Given any message, when it is sent, then it is sent with the club's own token from the club's own Of | Covered by a lane test (traced) |
| LINE-03-AC2 | Given a player, when a message is sent, then it is in the player's language on their record (Thai or | Covered by a lane test (traced) |
| LINE-03-AC3 | Given a message, when it is built, then its text comes from the language files by key and its layout | Covered by a lane test (traced) |
| LINE-03-AC4 | Given the admin, when its pages are listed, then there is no page, route or button to edit a message | New QA test |
| LINE-03-AC5 | Given a player who is not a friend of the club's Official Account or has blocked it, when a message  | Covered by a lane test (traced) |
| LINE-03-AC6 | Given a message was sent, when it is recorded, then a log row notes message type, club, recipient re | Covered by a lane test (traced) |
| LINE-03-AC7 | Given the same event, when the job runs twice or a retry happens, then the player gets the message o | Covered by a lane test (traced) |
| LINE-03-AC8 | Given a club in Testing, when a message is sent, then it goes through the club's real Official Accou | Covered by a lane test (traced) |
| LINE-03-AC9 | Given a club's Messaging API token fails, when a send is tried, then the send fails safely, nothing  | Covered by a lane test (traced) |
| LINE-03-AC10 | Given a message goes to staff or a coach, when it is sent, then it is sent in their language: staff  | Covered by a lane test (traced); partial: one language field per person, staff and coaches included |
| LINE-03-AC11 | Paused club: reminders and cancellation results still sent | Covered by a lane test (traced): `line-outbox-sender.test.ts` |
| LINE-04-AC1 | Given a booking is confirmed (a verified payment, credit used or nothing to pay), when it is saved,  | Covered by a lane test (traced) |
| LINE-04-AC2 | Given a booking paid wholly by credit or wallet, when the card is sent, then it shows the receipt nu | Covered by a lane test (traced) |
| LINE-04-AC3 | Given a two hour selection (one order, one booking per hour), when it is confirmed, then one card is | Covered by a lane test (traced) |
| LINE-04-AC4 | Given View booking, when it is tapped, then it opens that booking in My bookings with the club in th | Open: View booking opens that booking with the club in the URL; Add to calendar uses Bangkok time: the real link maker and the calendar target are injected in the builder test and are not on main yet. |
| LINE-04-AC5 | Given a late payment that is approved (PAY-03), when it is confirmed, then the same card is sent. | Open: The same card for an approved late payment: F05 apply_payment calls enqueue_message; the late approval path is traced in F05 (apply-payment-edges). Swept with F05. |
| LINE-04-AC6 | Given a player who is not a friend, when the card cannot be sent, then the confirmation shows in My  | Covered by a lane test (traced); partial: the sender half; the confirmation shown in the app is a screen |
| LINE-04-AC7 | Given the card, when it is rendered in Thai or English, then every line comes from L keys with the n | Covered by a lane test (traced) |
| LINE-04-AC8 | Given a card for a Testing club, when it is sent, then it carries no real receipt number (test serie | Covered by a lane test (traced) |
| LINE-04-AC9 | Given the card for a solo class, when it is sent, then it names the coach and the court. | Covered by a lane test (traced); partial: coach is tested; the court line comes from the same facts as every card |
| LINE-05-AC1 | Given a booking and the player's Booking reminders in LINE switch on, when it is 24 hours and again  | Covered by a lane test (traced) |
| LINE-05-AC2 | Given a hold ends without payment, when it is released, then the player gets Booking released, in a  | Covered by a lane test (traced) |
| LINE-05-AC3 | Given a player cancels, when the cancel is saved, then they get Cancellation result stating whether  | Open: Cancellation result at cancel: producer is F09 (BE-B, in progress). Swept with F09. |
| LINE-05-AC4 | Given staff close a slot with bookings (A12), when they confirm, then each affected player gets Club | Open: Club closed this slot at closure: F09. Swept with F09. |
| LINE-05-AC5 | Given a substitute coach is assigned, when it is saved, then the customer gets Coach changed naming  | Open: Coach changed at substitution: F07 calls a hook that F10 must replace (app.coach_message_hook is a no-op until then). Swept with F07. |
| LINE-05-AC6 | Given a spot opens for the first in line (F08), when the offer is made, then they get Waitlist spot  | Open: Waitlist spot open: F08. Swept with F08. |
| LINE-05-AC7 | Given a package, when it is 14 days and 3 days before expiry, then the player gets Package expiring  | Open: Package expiring at 14 and 3 days: the builder, the catalogue and the sender (no credits left skips) exist, but nothing queues the message at those dates yet. Producer not built (F06 PKG-03-AC1). |
| LINE-05-AC8 | Given the first day of a player's birth month, a birthday discount set (F14) and the player's Promot | Covered by a lane test (traced); partial: the switch rule; the producer is F14, not built |
| LINE-05-AC9 | Given a referral reward is earned (the friend's first booking played, F14) and the referrer's Promot | Covered by a lane test (traced); partial: the switch rule; the producer is F14, not built |
| LINE-05-AC10 | Given a solo or group class is booked, moved or cancelled, when it is saved, then the coach gets New | Open: Coach gets New or changed session: F12 CPORT-07 producer. Swept with F12. |
| LINE-05-AC11 | Given the owner decides a leave request, when it is saved, then the coach gets Leave approved or dec | Open: Coach gets Leave approved or declined: F12 CPORT-04. Swept with F12. |
| LINE-05-AC12 | Given a class is below its minimum a set time before start, when the time arrives, then front desk g | Open: Front desk gets Class below minimum: F08 alert job. Swept with F08. |
| LINE-05-AC13 | Given a late payment (PAY-03) or a wrong amount (F05), when it is handled, then the player gets a me | Open: Late payment and wrong amount messages: the kinds render (builder test), the triggers are F05 handlers. Swept with F05. |
| LINE-05-AC14 | Given the owner's pause or a cap level, when it happens, then the owner gets a message (PLAT-03-AC1, | Open: Owner message on pause and cap level: the platform console still uses outboxNotConnected (apps/platform/src/server/context.ts) as the default notifier, so a pause notice fails and is counted. Wiring to the F10 outbox is open. |
| LINE-05-AC15 | Given a booking made less than 24 hours or 2 hours before start, when it is confirmed, then the remi | Covered by a lane test (traced) |
| LINE-05-AC16 | Given the reminder hours (24 and 2) and the package expiry days (14 and 3), when text or settings us | **Finding QA-F10-1** (it.fails) |
| LINE-06-AC1 | Given each club, when P1 loads, then it shows the messages used this month against the club's plan l | Open: P1 shows messages used this month against the plan limit: P1 screen/route and the usage reader not built (club_usage_daily is filled by the sender). |
| LINE-06-AC2 | Given the usage, when it is read, then it comes from LINE's own count for the club's Official Accoun | Open: Usage comes from LINE's own count (quota consumption API): reader not built. The fake LINE has quota/consumption ready. |
| LINE-06-AC3 | Given the month changes at Bangkok midnight on the first, when it does, then the counter starts agai | Covered by a lane test (traced); partial: the month key; the display is P1 |
| LINE-06-AC4 | Given a club's Messaging API token fails (a send or a health check fails), when it is detected, then | Covered by a lane test (traced); partial: detection and storage; the P1 alert and the owner banner are screens |
| LINE-06-AC5 | Given P1, when BOOQ staff look at a club, then they see counts and health only, never message conten | Covered by a lane test (traced) |
| LINE-06-AC6 | Given a club on the free plan or a paid plan, when its limit is shown, then the plan is shown (the c | Open: Plan shown with the limit: P1 screen. |
| LINE-06-AC7 | Given test messages through the real Official Account (D32), when usage is shown, then they are incl | Covered by a lane test (traced) |
| LINE-07-AC1 | Given a club's usage reaches 70 percent of its monthly limit, when it does, then P1 shows an alert a | Covered by a lane test (traced) |
| LINE-07-AC2 | Given a club at 80 percent or more, when a booking is confirmed, then the confirmation is sent and n | Covered by a lane test (traced) |
| LINE-07-AC3 | Given a club at 80 percent or more, when any of these events happens, then the message is still sent | Covered by a lane test (traced); partial: confirmation kept; the other kept kinds share the same rule |
| LINE-07-AC4 | Given a club at 100 percent on a paid plan, when messages are due, then everything keeps sending and | Covered by a lane test (traced); partial: paid plan keeps sending; the owner notice kind exists in the builder |
| LINE-07-AC5 | Given a club at 100 percent on the free plan, when a confirmation cannot be sent, then the confirmat | Covered by a lane test (traced) |
| LINE-07-AC6 | Given a waitlist offer that cannot be sent on the free plan at 100 percent, when the send fails, the | Covered by a lane test (traced); partial: the undeliverable half; the waitlist hand-over to the next person is F08 |
| LINE-07-AC7 | Given a booking or payment, when the cap is reached, then it is never blocked. | Covered by a lane test (traced); partial: enqueue never raises at the cap, so a booking or payment is not blocked by it |
| LINE-07-AC8 | Given the thresholds 70 and 80 percent, when the code reads them, then they are platform wide consta | Covered by a lane test (traced) |
| LINE-07-AC9 | Given the usage is read from LINE, when LINE does not answer, then the check uses the last known val | Covered by a lane test (traced) |
| LINE-07-AC10 | Given the owner upgrades the LINE plan mid month, when the limit changes, then LINE's own count deci | Covered by a lane test (traced) |
