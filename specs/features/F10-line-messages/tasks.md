# F10 LINE messages and rich menu · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 from the F10 design (`design.md`, drafted 30 Oct 2026; the Architect reviews it) and the approved requirements (`requirements.md`). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `LINE-07 void reminders at the 80 percent cap`. A merged migration is never edited. New text goes in `locales/pending/F10.json` (D81).

Roles: **BE-P** back end platform and LINE, **FE-P** front end player app, **FE-A** front end admin, **QA**, **Content**.

Depends on: F01 `line_connection`, `club_secret`, settings registry, T13 route wrapper, T18 grants and blind suite, T34 worker; F02 follow and unfollow route (F02 §5.4) and deep link helper; F03 `confirm_booking`; FA §5.3 to §5.6. Migration numbers 0601 to 0607, one task per file. The checks G1 to G4 (design section 12) are recorded in T01 before T08 and T10 start.

## A. Checks and tables

- [ ] **F10-T01** Check G1 to G4 against LINE's documentation and the club's Official Account (rich menu API and image limits, quota and consumption endpoints, Login `sub` equals Messaging API user id, Flex size limit for a two hour card). Record each result in design section 12. IDs: LINE-02, LINE-06, LINE-04. Role: BE-P · Deps club OA test access (parked with the user) · Size: S
  Tests first: none (a written record); a failed check goes to the orchestrator as a question before T08 or T10 starts.
- [ ] **F10-T02** Migration 0601: `message_outbox` as FA §5.3 with the design columns, unique `(club_id, dedupe_key)`, partial index on `send_at` where pending, status and `void_reason` checks. IDs: LINE-03-AC6, CC-1, CC-3. Role: BE-P · Deps F01-T12 · Size: S
  Tests first: a duplicate dedupe key is refused; `params` with a name, phone or date of birth key is refused by the enqueue check; another club's rows are not reachable.
- [ ] **F10-T03** Migration 0602: `notification_pref` (reminders default on, promotions default off, A-2). IDs: LINE-05, D94. Role: BE-P · Deps T02 · Size: S
  Tests first: defaults as stated; a player writes only their own row.
- [ ] **F10-T04** Migration 0603: `rich_menu_label` (six rows per club, tile 1 to 6) and `rich_menu` (one active row per club). IDs: LINE-02-AC1, AC2. Role: BE-P · Deps T02 · Size: S
  Tests first: a seventh tile is refused; two active rows for one club are refused; links are not stored.
- [ ] **F10-T05** Migration 0604: `platform.club_line_usage` support and `platform.config` rows for 70, 80 and 100. IDs: LINE-06, LINE-07-AC8. Role: BE-P · Deps FA §2.2 · Size: S
  Tests first: no club role can read or write the thresholds; the platform reader sees counts only.

## B. Functions and grants

- [ ] **F10-T06** Migration 0605: `app.enqueue_message`, `app.void_messages`, `app.cap_state`, `app.mark_undeliverable`. IDs: LINE-03, LINE-05, LINE-07-AC1 to AC4, D96. Role: BE-P · Deps T02 to T05 · Size: M
  Tests first: the same dedupe key enqueues once; at 80 percent no reminder row is created and queued reminders are voided with `cap` and never revived; at 100 percent on a free plan a message becomes `undeliverable`; a reminder whose hour has passed is not queued; every row of a Testing club is `is_test`.
- [ ] **F10-T07** Migration 0606 and 0607: policies and grants (the sender role, the platform reader), registry rows `reminder_hours` (Tennis template 24 and 2, D116). IDs: LINE-03, CC-2, D27. Role: BE-P · Deps T06 · Size: S
  Tests first: the blind suite shows BOOQ staff read no outbox row; only the sender role reads the LINE token; no club role can read it.

## C. Sender, rich menu, health

- [ ] **F10-T08** Task `outbox_sender` steps 1 to 4: claim with `SKIP LOCKED` per club, send time preconditions, cap gate, language at send time. IDs: LINE-03-AC1 to AC3, LINE-05, D93, D94. Role: BE-P · Deps T06, T07 · Size: M
  Tests first (fake LINE): a cancelled booking voids its reminder; a switch off voids a reminder, birthday and reward and not a confirmation; a profile language change changes a queued row; two sender processes send once.
- [ ] **F10-T09** `outbox_sender` steps 5 to 7: push with `X-Line-Retry-Key`, results (sent, 429, token failure with backoff, other errors), non friend rule. IDs: LINE-03-AC5, AC9, LINE-07-AC5, D9. Role: BE-P · Deps T08 · Size: M
  Tests first: a timeout retry carries the same retry key; a 401 writes `club_health` and sends nothing to the owner by LINE; a non friend does not block checkout or the app confirmation; a sent row counts in `club_usage_daily`.
- [ ] **F10-T10** `packages/line` Flex templates and text builder for every kind in the catalogue (design 5.4 and 5.6), reading keys and variables from `locales/*`. IDs: LINE-04-AC1 to AC4, LINE-05, TEXT-01, TEXT-03. Role: BE-P · Deps T01 (G4), Content pending keys · Size: M
  Tests first: each kind renders in Thai and English with no text in the template; a two hour order lists both hours with one receipt number; a zero money order shows the zero money receipt (D64); the Testing receipt number shows for a Testing club; no template contains a literal user facing string (lint).
- [ ] **F10-T11** `renderRichMenu(labels, club) -> png` pure function with DM Sans and Noto Sans Thai, hashes for no-op detection. IDs: LINE-02-AC2, AC3, D92. Role: BE-P · Deps T01 (G1) · Size: M
  Tests first: same labels give the same bytes; the longest Thai and English labels fit their tile; both scripts share a baseline.
- [ ] **F10-T12** `buildRichMenu(club)`: create, upload, set default, then supersede and delete the old menu; failure keeps the old one and marks `failed`; audit entry. IDs: LINE-02-AC1, AC4, AC8, PLAT-04. Role: BE-P · Deps T04, T11 · Size: M
  Tests first: six areas with six distinct links and tile 1 equal to C4; a failed upload leaves the old menu default; the club stays Draft after a failure; each call writes an audit row.
- [ ] **F10-T13** Jobs `line_usage_sync` and `line_health`: quota and consumption, last known value fallback with P1 alert, the daily token check, the `owner_cap_paid_over` message once a month. IDs: LINE-06, LINE-07-AC1 to AC6, D97, D99, D114. Role: BE-P · Deps T05, T09 · Size: M
  Tests first (fake LINE quota): the seven cap tests of FA §5.6; a failed read keeps the last value and alerts without stopping reminders; an upgrade mid month follows the new limit.

## D. Routes

- [ ] **F10-T14** Player routes `GET` and `PUT /me/notification-prefs`. IDs: LINE-05, D94. Role: BE-P · Deps T03, F01 T13 · Size: S
  Tests first: only the two switches are writable; confirmations stay always sent.
- [ ] **F10-T15** Owner routes `GET /staff/line/status`, `GET` and `PUT /staff/rich-menu/labels` (a save re-renders and re-uploads, D114). IDs: LINE-02, LINE-06, D114. Role: BE-P · Deps T12, T13 · Size: M
  Tests first: only the owner reaches them; a label save calls the build once; the token is never returned.
- [ ] **F10-T16** Platform routes: rich menu upload and Redo, connection test, `line-usage` (admin and assigned specialist, audited). IDs: LINE-02-AC8, LINE-06, PLAT-04. Role: BE-P · Deps T12, T13 · Size: M
  Tests first: an unassigned specialist gets 404; the response holds counts and health only; each call is audited.
- [ ] **F10-T17** Guard test: no route or page edits a message's text or layout. IDs: LINE-03-AC4. Role: QA · Deps T14 to T16 · Size: S
  Tests first: the test lists every route and page and fails if one edits a message.

## E. Screens and text

- [ ] **F10-T18** Notification switches on the player Profile (H-C17-Profile-receipts). IDs: LINE-05, D94. Role: FE-P · Deps T14 · Size: S
  Tests first: Playwright toggles each switch; longest Thai label does not wrap the control.
- [ ] **F10-T19** Club admin banners (cap alert in the pause banner style, token failure) and rich menu labels form in A16 and A0. IDs: LINE-02, LINE-06, LINE-07-AC1, D98, D114. Role: FE-A · Deps T15 · Size: M
  Tests first: banner shows at 70 percent and on token failure for the owner only; saving a label shows the build result and a failure message.
- [ ] **F10-T20** Pending keys `locales/pending/F10.json`: six tile labels, owner cap and pause messages, late payment and wrong amount, coach and front desk messages where no key fits, the two admin banners, the P1 alerts. Named variables in both languages; list for the writers. IDs: TEXT-01 to TEXT-06. Role: Content · Deps none · Size: S
  Tests first: key sets match in both languages for non X keys; variables match; no existing key is edited.

## F. QA

- [ ] **F10-T21** Cross cutting suite: outbox holds no personal text, a Testing club's messages count to the cap and are flagged, each kind sent once by its dedupe key, a message failure never rolls back the booking. IDs: LINE-03, LINE-05, CC-3, CC-4, D32. Role: QA · Deps T09, T10 · Size: M
  Tests first: the list above against the fake LINE.
- [ ] **F10-T22** Sweep: every LINE-02 to LINE-07 acceptance criterion has a named test; walk the F10 canvas boards; file gaps with the ID. IDs: LINE-02 to LINE-07. Role: QA · Deps all · Size: S
  Tests first: a table of criteria to tests with none empty.

Order: T01 to T05 first (T01 can run alongside), then T06, T07, then T08, T09, T10, T11 in parallel where deps allow, T12, T13, the routes, the screens, then F. About 22 tasks, each under a day.
