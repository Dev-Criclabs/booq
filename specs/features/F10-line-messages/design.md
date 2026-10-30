# F10 LINE messages and rich menu · Design

Status: **DRAFT for approval (gate 2).** Drafted 30 Oct 2026 from the approved F10 requirements (`requirements.md`, approved 30 Oct 2026, decisions D91 to D99, D114, D116 and the Reviewer's findings applied). The Architect reviews it. A change to anything below goes through the PRD, then the hand-off, then this file. Tasks (gate 3) follow approval.

Feature: F10 LINE messages and rich menu. Requirement IDs: LINE-02 to LINE-07 (LINE-01 is F02). Depends on F03. Wave 2.

Shared decisions are in `docs/architecture/foundation.md`, cited as **FA §n**; the F01 to F05 designs as **F01 §n** and so on. FA §5.3 (outbox), §5.4 (jobs) and §5.6 (the message cap) already fix the outbox, the sender rules and the cap algorithm; F02 §5.4 holds the LINE webhook that records follows. This file adds the message catalogue, the rich menu build, the owner and platform surfaces, and settles what FA left to F10.

**How LINE is described here.** Statements about LINE are marked **STATED** where FA cites LINE's public documentation, and **GUESS Gn** where this design assumes a detail that must be checked against LINE's docs before the build (listed in §12). Nothing is taken from memory without a mark.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| LINE-02 (rich menu: six tiles, fixed links, owner labels, image) | §4.2 tables; §5.5 build; §6 routes |
| LINE-03 (push from the club's OA, language at send time, no editor, friend, token failure) | §5.1 to §5.3; §5.7 |
| LINE-04 (Booking confirmed card) | §5.4 catalogue; §5.6 Flex |
| LINE-05 (the other messages and their times) | §5.4 catalogue; §8 jobs |
| LINE-06 (usage and token health in P1) | §5.8; §6 |
| LINE-07 (the monthly cap) | §5.9 (FA §5.6 applied) |
| CC-1 to CC-6 | §11 |

## 2. What this design does not build

LINE Login and the friend prompt (F02); when business events happen (the owning feature enqueues; F10 sends); the P1 page and P2 step 4 screens (F15); the A16 settings page (F11); wording (writers); receipts (F13). The slip message "Slip needs re upload" belongs to F16 and is not built.

## 3. Shared pieces this design relies on

`message_outbox` (FA §5.3), `app_user.line_friend` and the follow and unfollow route (F02 §5.4), `line_connection` and `club_secret` (F01), `platform.club_usage_daily`, `platform.club_line_usage`, `platform.club_health`, `platform.config` (FA §2.2), the job runner (FA §5.2) and `app.now()` (FA §5.5).

## 4. Data and migrations

F10 uses the number block 0601 to 0699 (assumption A-1; the build plan names blocks up to F06).

| File | Contents |
|---|---|
| `0601_outbox.sql` | `message_outbox` as FA §5.3 with the columns of §4.1; indexes; status CHECK |
| `0602_notification_pref.sql` | `notification_pref` (C17 switches) |
| `0603_rich_menu.sql` | `rich_menu_label`, `rich_menu` |
| `0604_line_usage.sql` | `platform.club_line_usage` and sync support (FA §5.6), `platform.config` rows for 70, 80 and 100 |
| `0605_functions.sql` | `app.enqueue_message`, `app.void_messages`, `app.cap_state`, `app.mark_undeliverable` |
| `0606_grants_policies.sql` | Policies and grants; the sender role and the platform reader |
| `0607_settings_keys.sql` | Registry row `reminder_hours` (list, Tennis template 24 and 2, D116); the cap thresholds are in `platform.config` from 0604 |

### 4.1 Tables

**`message_outbox`** (class D; FA §5.3): `club_id`, `id`, `user_id` (recipient, may be a player, coach, staff member or owner), `kind` (the catalogue key of §5.4), `params jsonb` (ids and values, never names, phone numbers or dates of birth), `dedupe_key`, `send_at`, `status` (`pending`, `sent`, `void`, `failed`, `undeliverable`), `void_reason` (`cancelled`, `moved`, `cap`, `switch_off`, `no_credits`, `superseded`), `attempts`, `last_error`, `retry_key uuid`, `sent_at`, `is_test`, `created_at`. Unique `(club_id, dedupe_key)`. Partial index `(send_at) where status = 'pending'`. The row doubles as the message log of LINE-03-AC6: type, club, recipient reference, time and result; it holds no text (CC-3).

**`notification_pref`** (D): `club_id`, `user_id`, `reminders boolean default true`, `promotions boolean default false` (C17 canvas default; the default is Q1). Controls exactly the messages of D94.

**`rich_menu_label`** (S, owner edits): `club_id`, `tile smallint check (tile between 1 and 6)`, `label_th`, `label_en`. Six rows per club. The links are not stored: they are fixed in code (D54).

**`rich_menu`** (S): `club_id`, `id`, `line_rich_menu_id` null, `image_sha256`, `labels_hash`, `status` (`building`, `active`, `failed`, `superseded`), `error`, `rendered_at`, `uploaded_at`. One `active` row per club.

**`platform.club_line_usage`** and **`platform.club_health`**: exactly FA §2.2 and §5.6.

## 5. Behaviour

### 5.1 Enqueue (the only way a message is created)

`app.enqueue_message(kind, user, params, dedupe_key, send_at)` inserts one outbox row in the caller's transaction. Business code never calls LINE. Idempotent by `unique (club_id, dedupe_key)`. Reminder rows are created only when the cap state is below `reminders_stopped` and the hour has not already passed (D96); every row is `is_test` from the club's status trigger (D4, D32).

### 5.2 Sender

A task `outbox_sender` (every 30 seconds, FA §5.4) claims due rows with `FOR UPDATE SKIP LOCKED` in `withClubTx` for the row's club, so it obeys RLS. For each row, in order:

1. **Preconditions at send time** (the catalogue column of §5.4): a cancelled or moved booking voids reminders (`void_reason cancelled` or `moved`); a package with no credits left skips its reminder (`no_credits`); the player's switch (D94) off voids a reminder, birthday or referral message (`switch_off`).
2. **Cap gate** (§5.9): a reminder at `reminders_stopped` or worse is voided (`cap`) and never revived.
3. **Language at send time** (D93): the recipient's `language` (player, or the staff and coach language field defaulting to their LINE app language, D95); when unset, the LINE app language at sign in (F02 AUTH-02-AC25).
4. **Build** the text or the Flex card from `locales/*` by key with the named variables of `locales/README.md` (`{clubName}`, `{coachName}`, `{receiptNumber}`, `{claimMinutes}`, `{cancelHours}` and so on); the club's name and logo fill the template (§5.6).
5. **Push** with the club's token (`club_secret`, read only by the sender role) and `X-Line-Retry-Key = retry_key` so a retry after a timeout cannot double send (FA §5.3, STATED there).
6. **Result:** success sets `sent`; LINE 429 or a free plan at `over_limit` sets `undeliverable` with `last_error cap`, takes the §5.9 free-plan path and never blocks the booking; a token failure (401 class) sets `failed`, writes `platform.club_health` and the owner banner (§5.8), and the row is retried with backoff for the number of attempts in platform config; any other error retries with backoff then `failed`.
7. **Not a friend** (D9, FA §5.3): LINE answers HTTP 200 and the player simply does not receive it, so friend status cannot be learnt from a failed push. `app_user.line_friend` comes from the follow and unfollow route and from the LIFF friendship check at sign in (F02). When `line_friend` is false the row is still sent (the status can be stale) but the app shows the confirmation in My bookings and on the confirmation screen (D9, LINE-07-AC5), which the app does for every confirmation anyway.

A sent row increments `platform.club_usage_daily` (messages count, no content). The sender never reads a message back after sending.

### 5.3 Language of queued messages

The language is read at send time from the recipient row, not stored on the outbox (D93). A change in Profile while a row waits changes the language of that row.

### 5.4 Message catalogue (LINE-04, LINE-05, owner messages)

`Cap` is `R` for the two reminders (dropped at 80 percent) and `A` for always (sent at 80 percent; on a free plan at 100 percent they become undeliverable, §5.9). `Switch` is the C17 switch of D94. Card style is the Booking confirmed card style for every message without its own board (D91).

| `kind` | Recipient | Enqueued by (feature, event) | `send_at` | `dedupe_key` | Send time precondition | Switch | Cap |
|---|---|---|---|---|---|---|---|
| `booking_confirmed` | Player | F03 `confirm_booking`, F04 PAY-07, F05 late approval | now | `confirmed:{order_id}` | order confirmed | none | A |
| `booking_released` | Player | F03 `release_hold` handler (Beam clubs too, D45) | now | `released:{order_id}` | still released | none | A |
| `reminder_24h`, `reminder_2h` | Player | F03 confirm and move, hours from setting `reminder_hours` (D116) | start minus N h | `reminder:{booking_id}:{start_at}:{N}` | booking still confirmed at that start | reminders | R |
| `cancellation_result` | Player | F09 cancel | now | `cancel:{booking_id}:{version}` | none | none | A |
| `club_closed_slot` | Player | F09 closure | now | `closure:{closure_id}:{booking_id}` | none | none | A |
| `coach_changed` | Player | F07 substitution | now | `coach_changed:{booking_id}:{coach_id}` | none | none | A |
| `waitlist_offer` | Player | F08 offer | now | `offer:{entry_id}:{offer_no}` | offer still open | none | A (free plan at 100: passes on) |
| `package_expiring` | Player | F06 grant, extension, pause (days from setting, D116) | expiry minus N d | `package_expiring:{package_id}:{expires_at}:{N}` | credits left | none | A (D29) |
| `birthday_discount` | Player | F14 monthly job, 09:00 Bangkok on the 1st | that moment | `birthday:{user_id}:{year}` | value set, date of birth on file | promotions | A |
| `referral_reward` | Referrer | F14 on reward | now | `reward:{referral_id}` | none | promotions | A |
| `session_change` | Coach | F07, F09 booking, move, cancel of their solo or class | now | `session:{booking_id}:{version}:{coach_id}` | none | none | A |
| `leave_decision` | Coach | F12 A7 decision | now | `leave:{request_id}:{status}` | none | none | A |
| `class_below_minimum` | Front desk | F08 job at alert time | alert time | `below_min:{session_id}` | still below minimum | none | A |
| `late_payment`, `wrong_amount` | Player | F05 `apply_payment` | now | `late:{payment_id}` | none | none | A |
| `owner_paused`, `owner_cap_paid_over` | Owner | F01 pause; cap job | now | `paused:{club}:{pause_id}`, `cap_paid_over:{month}` | none | none | A |

Not messages: the token failure and key check failure (a banner and a P1 alert, §5.8, D114, D75) and the wrong amount owner notice (a banner, D75). The wrong amount player notice reaches the player in the app and by `wrong_amount` when it can be sent (D112).

### 5.5 Rich menu (LINE-02, D54, D92, D114)

- **Content.** Six tiles with fixed links (LINE-02-AC1): Book a court (C4), Solo classes, Group classes, Packages, My bookings, Refer a friend. Links are `https://liff.line.me/{liffId}/...` style deep links built by F02's deep link helper with the club in the URL (D6, F02 §3); they cannot be edited (D54).
- **Labels.** Six rows in `rich_menu_label`, Thai and English, edited by the owner in Settings (A16) after Go live and in A0 before (D114). Defaults come from L keys using the Thai terms คอร์ต, คลาสเดี่ยว, คลาสกลุ่ม, รายชื่อรอ, วอลเล็ต, เครดิต, not the canvas's เรียนเดี่ยว and เรียนกลุ่ม (Gaps A6). Six new label keys are needed (D54): `locales/pending/F10.json`.
- **One image, both languages (D92).** The server renders one image with the Thai and English labels together for each tile, from the six rows, using the fonts of the design system (DM Sans, Noto Sans Thai) so both scripts sit on one baseline. Rendering is a pure function `renderRichMenu(labels, club) -> png` in `packages/line`; the same labels produce the same bytes, so `image_sha256` and `labels_hash` detect a no-op rebuild.
- **Build and upload.** A function `buildRichMenu(club)`: create the rich menu object with six tap areas and the six links, upload the image, set it as the default for the club's Official Account, then mark the previous menu `superseded` and delete it at LINE. The order makes a failure leave the old menu working (LINE-02-AC8): the new menu is created first and only made default after the upload succeeds. Called by P2 step 4 Upload (F15), by a label change in A16 (re-renders, D114) and by the Redo action. Each call and its result is audited (PLAT-04) and a platform call is also in P6.
- **Failures.** A failed build sets `rich_menu.status failed` with the reason, keeps the old `active` menu, shows the failure in P2 step 4 or the A16 save response, and the club stays Draft until it works (LINE-02-AC8).
- **Paused club.** The tiles stay; their pages open in the paused state (LINE-02-AC7).
- **STATED or GUESS.** The LINE Messaging API has rich menu create, image upload, set default and delete calls, and an image size and file size limit; the exact values (a full size menu of 2500 by 1686 pixels, a size limit of 1 MB, formats PNG or JPEG) are **G1** and are checked against LINE's docs before the build.

### 5.6 Flex cards and text

Cards are built by templates in `packages/line` from `locales/*` keys and the club's name and logo. No text sits in a template (TEXT-01, CLAUDE.md). The Booking confirmed card holds court or class, date, time, coach if any, amount paid, receipt number, and the buttons View booking and Add to calendar (LINE-04-AC1). A zero money order shows the zero money receipt number and how it was paid (D64); a two hour selection shows one card listing its hours with one receipt number (BOOK-06); a late payment approval sends the same card; a Testing club's card carries the test receipt number (PLAT-07). Amounts show as whole baht or two decimals (D69). Card and PDF receipt share keys. The 11 messages without boards use the writers' wording on the same card style (D91). View booking opens that booking with the club in the URL; Add to calendar carries the Bangkok time (F02 deep link helper).

### 5.7 Token failure and club health (LINE-06, D114, D75)

A 401 class answer on any LINE call, or the daily health check (`GET` of the bot's quota with the token), writes `platform.club_health (check = 'line_token', status = 'failed')`. P1 reads it (BOOQ, setup and health only); the club admin banner reads it through the policy `club_id = app.club_id()` and shows to the owner (D114). The owner is not told by LINE because the message would use the failed account (LINE-03-AC9, D114). The alert clears when a send or test succeeds.

### 5.8 Usage and the P1 numbers (LINE-06)

`line_usage_sync` (every 10 minutes per club, FA §5.4) fills `platform.club_line_usage` from LINE's quota and consumption endpoints (STATED in FA §5.6; "totalUsage" is approximate), with fallback to our own count and a health alert when LINE cannot be read (D97: use the last known value, alert in P1, do not stop reminders). The plan kind and limit come from `line_connection` (set in P2 step 4). P1 shows used, limit, percent and state as numbers only.

### 5.9 The cap (LINE-07, FA §5.6)

`app.cap_state(club)` derives `normal`, `alert` (70 percent), `reminders_stopped` (80), `over_limit` (100) from `used/limit` and `platform.config` (70, 80 and 100 are platform constants, not club settings, LINE-07-AC8). The sender and enqueuers behave as FA §5.6 steps 1 to 6: at 70 percent the P1 alert and the club admin banner in the pause banner style (D98); at 80 percent no reminder is queued and queued ones are voided (`cap`), never revived (LINE-07-AC2); other messages go; at 100 percent on a paid plan everything goes and the owner gets one `owner_cap_paid_over` per month; on the free plan an unsendable message is `undeliverable` (`cap`), the app shows the confirmation in My bookings and on the confirmation screen, and `waitlist_advance` passes the offer to the next person (LINE-07-AC5, AC6). When the owner upgrades mid month, LINE's own count decides and the state follows the new limit (D99). Bookings, payments and Beam callbacks never read the cap.

### 5.10 Preferences (C17)

The two switches write `notification_pref` through `PUT /me/notification-prefs`. They control only the messages of D94; booking confirmations, payment results and cancellation results are always sent (CC-3).

## 6. API routes

Conventions as FA §9: typed codes, 404 for out of reach, secrets never returned.

| Method and path | Permission | Purpose |
|---|---|---|
| `POST /api/webhooks/line/{token}` | none (signature) | F02 §5.4 handles `follow` and `unfollow`; F10 adds nothing the route must act on beyond ignoring other events |
| `GET /api/c/{slug}/me/notification-prefs`, `PUT` same | own | The two C17 switches |
| `GET /api/c/{slug}/staff/line/status` | owner | State, percent, plan, and token health for the club admin banners |
| `GET /api/c/{slug}/staff/rich-menu`, `PUT /api/c/{slug}/staff/rich-menu/labels` | owner | Read and edit the six labels (re-renders and re-uploads on save, D114) |
| `POST /api/platform/clubs/{id}/line/rich-menu/upload` | admin, assigned specialist | P2 step 4 Upload and Redo; audited in P6 |
| `POST /api/platform/clubs/{id}/connections/line/test` | admin, assigned specialist | Tests of F01 §5.x (tokens, LIFF, login channel); health only |
| `GET /api/platform/clubs/{id}/line-usage` | admin, assigned specialist | Counts and state for P1 and P3 |

There is no route that edits a message's text or layout (LINE-03-AC4); a test lists every route and page and fails if one does.

## 7. State machines

`message_outbox`: `pending` to `sent`, `void`, `failed` or `undeliverable`; `failed` and `void` are final; `pending` may return to `pending` on a retry. `rich_menu`: `building` to `active` or `failed`; `active` to `superseded`. The cap state is derived, never stored as an editable fact.

## 8. Jobs

| Job | Source of truth | Side effect | Cadence |
|---|---|---|---|
| `outbox_sender` | `send_at <= now()` and `pending` | §5.2 | 30 seconds |
| `line_usage_sync` | per club, LINE quota and consumption | `platform.club_line_usage`, alert, banner, owner message at 100 percent paid | 10 minutes |
| `line_health` | per club | `platform.club_health` | daily |
| `housekeeping` | old `sent` and `void` rows | purge after the retention period (parked, Q2) | daily |

Reminder and expiry rows are created by the owning features' transactions, not by a job here (FA §5.4). `birthday_discount_message` is F14's monthly job calling `enqueue_message`.

## 9. Permission checks

| Permission | Player | Coach | Front desk | Accountant | Owner | BOOQ staff |
|---|---|---|---|---|---|---|
| Receive messages | yes | yes | yes | yes | yes | no |
| Own switches | yes | yes | yes | yes | yes | no |
| Rich menu labels | no | no | no | no | yes | no (platform setup only) |
| LINE status and banners | no | no | no | no | yes | counts and health only |
| Read outbox rows | no | no | no | no | no | no (never; counts only) |
| Edit a message's text | no one | no one | no one | no one | no one | no one |

Row policies follow FA §4.3. The sender role reads `club_secret` for the LINE token through `app.read_secret`; BOOQ staff can write a token and see its last four characters only (D27).

## 10. Concurrency and failure

Unique `(club_id, dedupe_key)` makes enqueue idempotent; `X-Line-Retry-Key` makes a resend idempotent at LINE; a status guard under the row lock makes two sender processes safe; a cap check at queue and at send time makes a voided reminder permanent. A sender crash leaves rows `pending` and the next tick resumes. A message failure never rolls back the booking or payment that enqueued it (the row was committed with the business transaction; sending is later).

## 11. How the cross-cutting rules are met

- **Club ID scope (CC-1):** every row and call carries the club; the sender uses that club's token and OA; usage is per club.
- **Server side (CC-2):** only the sender calls LINE; tokens are encrypted with the extra layer, write only, last four shown (D27, D34); the client decides nothing about text or recipients.
- **PDPA (CC-3):** outbox `params` hold ids and values, never names, phone or date of birth; the log holds type, time and result only; BOOQ staff see counts and health only; the Profile switches control promotions.
- **No double booking (CC-4):** messages never reserve or release a slot; a waitlist offer message refers to an offer owned by F08; a voided or undeliverable offer passes on and leaves no stuck slot.
- **TEXT (CC-5):** all text by key with the variables of `locales/README.md`; the six label keys and the new message keys go in `locales/pending/F10.json` (D81); Flex cards and PDF receipts share keys; reminder and expiry numbers are settings in code and variables in text (D116).
- **Other (CC-6):** Bangkok time for reminders and the monthly counter; no message editor anywhere.

## 12. Assumptions to confirm (recommended defaults, D147) and what to check

| # | Assumption | Basis |
|---|---|---|
| A-1 | Migration block 0601 to 0699 for F10 | Build plan blocks |
| A-2 | `notification_pref.promotions` defaults to off and `reminders` to on (the C17 canvas default); consent for promotional messages is an explicit opt in | C17 canvas, PDPA |
| A-3 | The sender retries a token failure a fixed number of times with backoff (platform config), then `failed` | FA §5.3 |
| A-4 | The rich menu is built once per club and shared by every player (one image, D92); no per user menus | D92 |
| A-5 | The message log is the outbox table; its rows are kept for a retention period set when legal input is available (parked) | PDPA, parked retention |
| A-6 | A LIFF friendship check at sign in keeps `line_friend` fresh; stale values never block sending | FA §5.3, F02 |

To check before the build (**G1**): the rich menu API (create, upload image, set default, delete) and its image limits; **G2**: that the quota and consumption endpoints return what FA §5.6 assumes for the club's account; **G3**: that Login `sub` equals the Messaging API user id under one provider (FA Q33, the F02 setup task); **G4**: the Flex Message size limits for the Booking confirmed card with a two hour order. Each is checked with the club's Official Account and recorded here.

## 13. Tests (written first at the build step)

Fake LINE with a settable quota and consumption (D30): the seven cap tests of FA §5.6; a confirmation at 80 percent is sent and no reminder row exists; a reminder queued at 79 and due at 80 is voided and never revived; each message kind sent once with its dedupe key (LINE-05); language at send time changes when the profile changes (D93); a switch off voids a reminder, birthday and reward and not a confirmation (D94); the rich menu has six areas and six distinct links with tile 1 equal to C4, a failed upload leaves the old menu (LINE-02); a label save re-renders (D114); no message editor route or page exists (LINE-03-AC4); a token failure raises the P1 alert and the owner banner and sends no LINE message to the owner (D114); a non friend does not block checkout (D9); a Testing club's messages count toward the cap and are flagged test (D32); the outbox holds no personal text (CC-3).

## 14. Text keys and canvas boards

New keys in `locales/pending/F10.json`: six tile labels, the owner cap and pause messages, the late payment and wrong amount messages, the coach and front desk messages if no key fits, the A cap banner (pause banner style), the A token failure banner, the X P1 alerts; writers own the wording (D51).

Boards: L-Rich-menu (T- none; the Thai terms are corrected by Gaps A6), L-Msg-Confirmed, L-Msg-Reminder, L-Msg-Waitlist and their T- twins, F1-01-L-Chat-Rich-menu, F1-09-Msg-Confirmed, H-P2-Step4-LINE, H-P1-Clubs, H-P3-Club-alert, H-P3b-Support-view, H-A0-Setup-checklist, H-A16-Settings, S-A01-Paused (banner style), H-C17-Profile-receipts (switches).

## 15. Open items

1. **Default of the Promotions switch (A-2).** Recommended default: off until the player opts in. The orchestrator confirms or amends.
2. **Message log retention (A-5).** Parked with the other retention periods; none is deleted until decided.
