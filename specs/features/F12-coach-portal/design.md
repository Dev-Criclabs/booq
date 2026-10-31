# F12 Coach portal K1 to K6 · Design

Status: **Approved 31 Oct 2026 (gate 2, D171).** Drafted 31 Oct 2026 from the approved F12 requirements (`requirements.md`, approved 30 Oct 2026, revision 3; D1, D19, D91, D95, D115, D118 applied) and the code on `main` (F07 migrations 0801 to 0899, F08 0901 to 0915, F13 0709 and `app.my_payouts`). The Architect reviews it. A change to anything below goes through the PRD, then the hand-off, then this file. Tasks (gate 3) are in `tasks.md`. The user's answers of D171 are folded in (§11).

Feature: F12 Coach portal. Requirement IDs: CPORT-01 to CPORT-07. Depends on F07 (coach rules, availability, leave), F08 (group sessions, roster), F10 (messages), F13 (payouts). Wave 4.

Shared decisions are in `docs/architecture/foundation.md`, cited as **FA §n**; the other feature designs as **F07 §n** and so on. Most of the portal already exists as database functions and routes of F07, F08 and F13. This file names, screen by screen, which one each screen uses, and adds only what is missing: the day and week reads, the session detail, attendance, private notes, the earnings breakdown, and the coach messages for a booked, moved or cancelled class.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| CPORT-01 (K1 Today) | §5.1 `app.coach_day`; §6 `GET /coach/today` |
| CPORT-02 (K2 Schedule) | §5.2 `app.coach_schedule`; §6 `GET /coach/schedule` |
| CPORT-03 (K3 Availability) | §5.3 existing F07 `set_availability`; the rest cap is enforced by F07's `coach_check` |
| CPORT-04 (K4 Leave) | §5.4 existing F07 `request_leave`, `decide_leave` |
| CPORT-05 (K5 Session detail) | §3 tables; §5.5 detail; §5.6 attendance and notes |
| CPORT-06 (K6 Earnings) | §5.7 `app.my_earnings` on F13's figures |
| CPORT-07 (session change messages) | §5.8 triggers into F10's `session_change`; `leave_decision` already sent by F07 |
| Rules for every ID (own data only, audit, PDPA, text, 375 px) | §9 permissions; §10 cross-cutting |

## 2. What this design does not build

- The K3 and K4 screens' own screens belong to F07-T17 (it lists them); F12 builds the portal shell around them (§7) and tests that they behave as CPORT-03 and CPORT-04 say.
- The owner's side of leave (A7 approve or decline, flags) is F07; staff changing a player's no show or forfeit is F09's A2 (D118); this file only gives A2 the coach's mark to read (§5.6).
- Coach pay settings and the payout itself are F07 and F13. K6 reads them.
- Coach cards and rich menus for the coach in LINE: the message wording is the writers' (D91, Q4 no board).

## 3. Data and migrations

Migration block 1201 to 1299 (reserved for F12 by the migration plan). One task per file, rising in task order: 1201 tables, 1202 day and week reads, 1203 session detail, 1204 attendance and notes, 1205 earnings reads, 1206 coach messages, 1207 the rest cap read, 1208 anonymise handlers. Every F12 table is class D (BOOQ staff never, PLAT-02) and is registered in `packages/db/src/registry/f12.ts`; both are test tables (deleted at Go live before the coach they point at).

### 3.1 `coach_attendance` (CPORT-05)

One row per booking the coach marked: `club_id`, `booking_id` (a solo class booking, or a group seat booking), `coach_id`, `mark` (`present` or `absent`), `marked_at`, `changed_at`, `is_test`. Primary key `(club_id, booking_id)`; foreign keys composite to `booking` and `coach`. The mark is a hint: it never changes `booking.status`, never forfeits and never touches pay by itself (D118); staff read it in A2 and decide. Audit: every insert and change (PLAT-04, CPORT-05) with the old and new mark.

### 3.2 `coach_note` (CPORT-05, PDPA)

`club_id`, `id`, `coach_id`, `booking_id` (the session's solo booking, or null for a group session), `class_session_id` (null for a solo class), `customer_id` (null for a note on the whole session, set for a note on one player), `body` (not blank, 2000 characters at most, a technical limit and not a club setting), `created_at`, `updated_at`, `is_test`. One note per coach, session and player (unique on those columns): saving again replaces the text and the audit log keeps the old text. Notes are never shown to the player and never leave the club (CPORT rules; PDPA).

### 3.3 Reads that are functions, not tables

`app.coach_day`, `app.coach_schedule`, `app.coach_session`, `app.my_earnings`, `app.my_payout_history`, `app.my_payout_adjustments` (§5). They are `security definer`, owned by `booq_owner`, take the club from `app.club_id()` and the coach from `app.user_id()`, and read only rows of that coach. The functions return a fixed list of columns, so a customer's contact and payments are never in the answer; the table policies of F03 and F08 already keep a coach to their own rows, and the two F12 tables give the coach no grant at all, so no query reaches another coach's sessions or a player's contact (CC-1, CC-2).

## 4. Rules fixed here

| Rule | Value |
|---|---|
| Who is "the coach" of a session | solo: `booking.coach_id` (F07 substitution moves it); group: `class_session.coach_id` |
| What the coach sees of a player | display name, level and the coach's own earlier notes. Never phone, date of birth, payments, receipts or packages (HO Roles; D35) |
| What counts on K1 and K2 | solo class bookings `confirmed` (and `awaiting_payment` while held, marked as held) and group sessions `scheduled`, in Bangkok time; cancelled, released and declined never |
| Roster of a group session | live confirmed seats; a seat still held for payment is counted ("5 of 6") but not listed for marking |
| Attendance may be marked | once the session's hour has ended (CPORT-05) |
| Attendance may be changed | while the month's payout for that coach is not paid (assumption A-1: no invented number of days; a paid month is frozen by F13) |
| Notes may be written | from the start of the session, by the session's coach |
| K6 amounts | from F13's `payout_figures`; a null amount (pay not set) shows as "not set yet", never as zero (CPORT-06, Open question 2) |
| Time | every time in `Asia/Bangkok`; a day is a Bangkok day; dates are international years |

## 5. Behaviour: screen by screen

Every function raises `portal:forbidden` (`P0001`) unless the caller holds the Coach role and a `coach` row in the club. A coach of another club is not found. The coach is never an input: it is the signed-in person.

### 5.1 K1 Today (CPORT-01) · `app.coach_day(p_date date)`

Returns the coach's sessions that Bangkok day in time order: `kind` (`solo` or `group`), `booking_id` or `session_id`, `start_at`, `end_at`, `court` (the resource name), `held` (solo only: still awaiting payment), and for solo the `student` (display name and level), for group the class name, `level`, `players` (live seats) and `capacity`. Plus `count` and `hours` (the count of sessions, each is 60 minutes). It uses `booking` (type `solo_class`), `class_session`, `resource`, `app_user` (name and level of the student only). The default date is today. "Next" and "Done" are computed by the screen from `start_at` and the clock, not stored.

### 5.2 K2 Schedule (CPORT-02) · `app.coach_schedule(p_from date, p_to date)`

A week (at most 14 days, a technical bound) of the same session rows as §5.1, plus `leave` (the coach's own `coach_leave` rows overlapping the range with status, never shown to anyone else), and `blocked` (the coach's own one off `closed` availability rules, and the club's active closures, with the closure reason as the owner typed it; assumption A-5). The summary counts (solo, group, leave) are computed in the function. A session on an approved leave day is not hidden: F07 flags it for the owner (R6); the coach sees both, and the leave day shows (CPORT-02 acceptance: no session appears on leave days because F07 refuses to offer them; an old booking before the leave stays and is shown with a flag).

### 5.3 K3 Availability (CPORT-03) · existing

`GET /coach/availability` and `PUT /coach/availability` (F07-T12) call `app.set_availability`. The rest cap is not applied at save time but when the hour is offered or booked (`coach_check`, F07 §5.1 step 5): the coach's saved hours are kept as typed and the 7th hour in a row is not offered. F12 adds `GET /coach/rest-cap` (`app.coach_rest_cap()`, migration 1207, for the Coach role only, because a coach may not read the club settings) so the screen can say "at most N in a row", and a test that the 7th hour is not offered after saving (CPORT-03). F07's availability response stays the array it is.

### 5.4 K4 Leave (CPORT-04) · existing

`GET /coach/leave` and `POST /coach/leave` (F07-T12) call `app.request_leave`. The owner approves in A7 (`app.decide_leave`), which sends `leave_decision` to the coach through F10 (F07 0805, hook replaced in 0899). F12 adds only a test that an approval reaches the outbox in the coach's language and that the affected sessions appear in `coach_flagged_session`.

### 5.5 K5 Session detail (CPORT-05) · `app.coach_session(p_kind text, p_id uuid)`

`p_kind` is `solo` (the booking id) or `group` (the session id). The coach must be the session's coach, else `portal:not_found` (404). Returns the header (kind, name, court, start and end, level) and `roster`: for each live confirmed player the `booking_id`, `customer_id`, display name, `level`, the `mark` (`present`, `absent` or null), and `last_note` (this coach's most recent earlier note on that player, `body` and date, from another session). Also the session note (`body`, null when none) and `can_mark` (the hour has ended and the month is not paid) and the counts "3 of 5 marked". Players have no photo in the data (§11 A-2): the screen shows initials, as the board does.

### 5.6 Attendance and notes (CPORT-05)

- `app.mark_attendance(p_booking uuid, p_mark text)`: the booking must belong to the caller's session (solo: `booking.coach_id`; group: the seat of a session of the coach), the hour must have ended (`portal:not_ended`), the coach's payout for that Bangkok month must not be paid (`portal:month_paid`), `p_mark` is `present` or `absent` (`portal:invalid_mark`). Upserts `coach_attendance`; audited. Repeating the same mark changes nothing. It does not touch the booking, so "counts for pay as a no show" is F13's rule for what a delivered session is (a session with a played or no show booking counts, an Absent hint changes neither); a reversal later changes pay by the normal rule (D118).
- `app.save_session_note(p_kind text, p_id uuid, p_customer uuid, p_body text)`: `p_customer` null is the session note. Upsert on the unique key; blank body deletes the note; audited with old and new text. The customer must be a live seat of that session.
- Staff read: owner and front desk read `coach_attendance` and `coach_note` through policies (A2 shows the coach's mark as a hint; notes are "staff and coach only"). `GET /staff/bookings/:id/attendance` (owner, front desk) returns the mark and who marked it; the A2 screen is F09's and F11's.

### 5.7 K6 Earnings (CPORT-06) · `app.my_earnings(p_month date)`, `app.my_payout_history()`, `app.my_payout_adjustments(p_month date)`

`my_earnings` builds on F13's internal figures (the same rules as the payout the owner pays, so the coach's number and the owner's number cannot differ): month, `status` (`open` or `paid`), sessions delivered (solo, group), `base_satang`, `solo_pay_satang`, `group_pay_satang`, the coach's own rate (`solo_rate` and `group_rate`, kind and value, read from the coach's own `coach_pay` row), `flags`, `amount_satang` (null while a pay setting is unset or a rule is flagged), `adjustments_satang`, `total_satang`, `paid_at`. `my_payout_history` lists the coach's paid months, newest first (month, total, paid at). `my_payout_adjustments` lists the month's adjustments with the owner's reason (the board's "See reason"). A coach sees no other coach's rows and no club revenue; a month that has no payout row yet shows the live figures, as F13's `my_payouts` does. `app.my_payouts` (F13) stays as it is.

### 5.8 CPORT-07 messages

The outbox already carries `leave_decision` (F07 0805), `session_change` for a substitution (F07 0807) and for an edited or cancelled group session (F08 0907), all through `app.coach_message_hook` which F10's 0899 made enqueue. What is missing is the coach's message when a class is **booked, moved or cancelled** by a player or by staff. Migration 1206 adds one trigger function on `booking` (after insert or update of `status`, `start_at`, `coach_id`, and for class seats `class_session_id`): when a solo class booking becomes `confirmed` it enqueues `session_change` with `change = 'booked'` to `booking.coach_id`; when a confirmed booking's `start_at` changes, `change = 'moved'`; when it becomes `cancelled` or `late_cancelled`, `change = 'cancelled'`; the same for a confirmed group seat to the session's coach (assumption A-6: one message per seat event). Dedupe key `coach_booking:{booking}:{change}:{start epoch}`, so a retry never sends twice. No F03, F05 or F09 function is edited (no redefinition); the trigger reads the row only. The wording and language: F10 resolves the coach's language from `app_user.language`, which defaults to the LINE app language (D95), and renders the Booking confirmed card style (D91). F10's message facts must carry `change`: a follow up task for F10 (listed in `tasks.md`).

## 6. API routes

Prefix `/api/c/{slug}`. Conventions as FA §9: typed codes, no text, 404 for out of reach, club from the URL and session, `Cache-Control: no-store` on every coach route (personal data).

| Method and path | Permission | Purpose | Function |
|---|---|---|---|
| `GET /coach/today?date=` | `coach.portal` | K1 | `app.coach_day` |
| `GET /coach/schedule?from=&to=` | `coach.portal` | K2 | `app.coach_schedule` |
| `GET, PUT /coach/availability` | `coach.self` | K3 | F07 (exists) |
| `GET, POST /coach/leave` | `coach.self` | K4 | F07 (exists) |
| `GET /coach/rest-cap` | `coach.portal` | K3 cap | `app.coach_rest_cap` |
| `GET /coach/sessions/{solo\|group}/{id}` | `coach.portal` | K5 | `app.coach_session` |
| `PUT /coach/sessions/{solo\|group}/{id}/attendance` body `{mark}` (solo) or `{bookingId, mark}` (group seat) | `coach.portal` | K5 mark | `app.mark_attendance` |
| `PUT /coach/sessions/{solo\|group}/{id}/note` body `{customerId, body}` | `coach.portal` | K5 note | `app.save_session_note` |
| `GET /coach/earnings?month=` | `coach.portal` | K6 | `app.my_earnings`, `app.my_payout_adjustments` |
| `GET /coach/earnings/history` | `coach.portal` | K6 past payouts | `app.my_payout_history` |
| `GET /staff/bookings/{id}/attendance` | `attendance.read` | A2 hint | `coach_attendance` |

The kind is a literal in the path, so these never clash with F08's `GET /coach/sessions/:id/roster`, which stays for the owner's tools. New permissions in `packages/auth/src/permissions/f12.ts`: `coach.portal` (coach and owner: the matrix gives the owner every permission, but the functions require the Coach role and a coach row, so an owner who is not a coach is refused with `portal:forbidden`), `attendance.read` (owner, front desk). `coach.self` (coach, owner) stays F07's, because the owner may act for a coach there. Typed codes: `forbidden`, `not_found`, `not_ended`, `month_paid`, `invalid_mark`, `invalid_month`, `invalid_range`, `body_too_long`.

## 7. Screens and states (375 px, inside LINE)

One shell: the bottom bar Today, Schedule, Availability, Leave, Earnings (boards), the language from the coach's `app_user.language`, signed in with LINE (F02), content scrolls and buttons never wrap (Thai runs longer). Each screen has the states: loading, empty (no sessions today, no leave, no payout yet), error with retry, and offline. K1 a row per session with Next and Done derived from the clock. K2 a week with the day groups and a leave or blocked row. K5 Present and Absent buttons disabled before the hour has ended and after the month is paid, with the reason shown from a key; save keeps the screen and shows saved. K6 "not set yet" when the amount is null.

Canvas boards: `H-K1-Today`, `H-K2-Schedule`, `H-K3-Availability`, `H-K4-Leave`, `H-K5-Session-detail`, `H-K6-Earnings` and the `T-` Thai twins (`docs/orchestrator/canvas-backup/.../project/`). The spec wins over the canvas: the K1 sample "4 sessions, 4.5 hours" and the K6 and A7 freelance disagreement are not copied (requirements note, Gaps B3, B4).

## 8. State machines

`coach_attendance`: none to `present` or `absent`, and between the two while the month is not paid; there is no delete. `coach_note`: created, replaced, deleted by a blank body. A booking's own states are F03's and F09's and are never changed by F12.

## 9. Permission checks

| Permission | Guest | Player | Coach | Front desk | Accountant | Owner | BOOQ staff |
|---|---|---|---|---|---|---|---|
| K1, K2, K5, K6 (own data) | no | no | own | no | no | no (unless also a coach, then own) | no |
| Mark attendance, write notes | no | no | own sessions | no | no | no | no |
| Read attendance marks | no | no | own | yes | no | yes | no |
| Read session notes | no | no | own | yes | no | yes | no |
| Own earnings | no | no | own | no | no | no | no |

The route checks `coach.portal`; the function checks again from the context; the session must be the caller's. A person who is a coach and staff holds the union of roles (D1) and the portal still shows only their own coach rows.

## 10. How the cross-cutting rules are met

- **Club scope (CC-1):** every table has `club_id` and tenant policies; functions take the club from context; another club's id answers 404.
- **Server side (CC-2):** a coach cannot name another coach: the functions never take a coach id; the session is checked against `coach_id` inside the function.
- **PDPA (CC-3):** the coach reads a player's name and level on their own sessions only; notes are personal data about the player held by the club: no player route and no screen of the player app ever returns them, but they ARE part of that player's PDPA data export (right of access, D171) through `app.f12_export`; they are listed in the person's deletion impact and removed when the person is anonymised (`app.f12_anonymise`, registered with F01's anonymise handlers), and a coach's own notes stay as records when the coach is anonymised (F07 A-8). Attendance marks are about the booking, not free text, and are listed in the export with the booking (a mark, a date, no coach name).
- **Audit (PLAT-04):** attendance and notes through the audit trigger family; payout reads are not written.
- **No double booking (CC-4):** F12 writes no booking or occupancy.
- **Text (TEXT-01 to TEXT-06):** every string from the K keys of `locales/copy-index.csv` (K-0001 to K-0112 cover K1 to K6) and new keys in `locales/pending/F12.json`; none in code. Variables replace sample values (names, times, amounts, counts).

## 11. Assumptions to confirm (recommended defaults, D147) and open questions

| # | Assumption or question | Default taken |
|---|---|---|
| A-1 | Open question 1: attendance after the session (approved, D171) | The coach may change the mark until that month's payout is marked paid; no fixed number of days is invented. |
| A-2 | Requirement text says the roster has a photo; the data holds no player photo and the board shows initials | Initials. A photo needs a stored LINE picture and a consent decision: not built. |
| A-3 | Who reads notes | The writing coach, the owner and front desk. "Past notes" are this coach's own earlier notes on that player. |
| A-4 | Level of a player | `app_user.level` as the player set it (new, beginner, intermediate, advanced); shown as typed. |
| A-5 | "Blocked times" on K2 | The coach's one off closed rules and the club's active closures with their reason. |
| A-6 | One coach message per booked, moved or cancelled seat of a group class | Yes, one per event; the owner can ask for a daily digest later. |
| A-7 | K1 "teaching hours" | The count of that day's sessions (each 60 minutes), so four sessions say 4 hours. |
| A-8 | Pay terms on K6 | The coach sees their own rate (kind and value) beside the counts, as the board shows. |
| A-9 | Group percent pay (F13) | Settled by D170: the percentage of the full listed seat price of each seat booked; K6 shows the amount, or "not set yet" when the pay or a session's listed price is unset (F13 flags `group_pay_unset`, `group_price_unset`). |
| Q-1 | Open question 2: coach pay numbers are empty settings | K6 shows them only after the owner sets them (`amount_satang` null until then). |
| Q-2 | PDPA data access to coach notes | **Settled, D171:** coach notes about a player are personal data the club holds, so they ARE in that player's data export, and are deleted when the player is anonymised. |
| Q-3 | May the owner mark attendance for a coach who forgot? | Not built; the owner adjusts through A2 (no show) as D118 says. |

## 12. Tests (written first at the build step)

Per task, from the acceptance checks: CPORT-01 three sessions today give only the coach's own, in time order, another coach's and another club's never; CPORT-02 an approved leave day shows and no session is offered on it; CPORT-03 saving hours that would make a 7th in a row leaves the 7th hour not offered; CPORT-04 submit, approve, the coach's LINE message in their language and the flagged sessions; CPORT-05 a session that has not ended refuses a mark, a mark is saved and audited, Absent changes neither the booking nor the payout figures, a change after the month is paid is refused, a note is saved, replaced and never returned to a player, a coach cannot mark or read another coach's session, a player role gets 403; CPORT-06 the coach's figures equal the owner's payout row for the same month, a null amount stays null, no other coach's or club figures are reachable by any argument, past payouts list only paid months; CPORT-07 a confirmed, moved and cancelled solo class and a group seat each enqueue one `session_change` to the right coach once (retry safe), none for a released hold. Plus the blind and access suites for the two tables and six functions (task list), the 375 px Playwright pass for the shell, and the longest Thai string on every screen.

## 13. Spec wording to correct (for the orchestrator, PRD then hand-off then requirements)

`requirements.md` says session notes are "never shown to the player", and PDPA-01-AC6 says a player never sees staff notes. D171 puts the coach's notes about a player into that player's data export, which is a copy sent by the club on a request, not a screen. Both lines should say "never shown in the app; included in the player's data export (D171)". The F01 data export code comment (`copyFile`, "staff notes are never included") means the club staff's own notes, and stays true for them. Until the wording is changed this design follows D171.
