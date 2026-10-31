# F12 Coach portal K1 to K6 · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, round 7: the F03, F11 and F12 requirements and the answers D38 to D58 were approved by the user. The IDs CPORT-01 to CPORT-07 are now in the hand-off ("Club admin and coach portal requirement IDs"). Revision 3 (30 Oct 2026) removes the answered and parked items and applies D91, D95, D115, D118 and the Reviewer's finding F12-1 (`docs/review/spec-consistency.md`). Changes after approval go PRD, then hand-off, then this file.

Feature: F12 Coach portal. Depends on: F07. Wave 4.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Users, roles (Coach row); Solo classes and coach rules (rest rule, pay, substitutions); Coach portal table K1 to K6; Key flows G |
| HO | `specs/product/handoff-v1.2.md` | Screen inventory (Coach portal row); Roles; COACH-01 |
| Decisions | `docs/decisions.md` | D1, D19, D28, D58. HO "Club admin and coach portal requirement IDs" |
| Gaps | `docs/canvas-gaps.md` | B3, B4 |

The spec wins over the canvas. Boards are H-K1 to H-K6 (T- twins exist).

## Rules that apply to every CPORT ID

- Coach portal is mobile at 375 px, inside LINE, signed in with LINE. A coach sees only their own data: not other coaches' schedules, customer payments or club revenue (HO Roles). A person who is also a player or staff holds a set of roles (D1), and every club person also holds the Player role (D115) and the Coach role adds nothing beyond its own rights.
- Club ID scope, server side permissions, audit on changes (PLAT-04), PDPA (session notes are staff and coach only, never shown in the app; included in the player's data export, D171), Thai and English from K keys (TEXT-01 to TEXT-06).
- Rest rule: a coach teaches at most 6 hours in a row (setting, default 6); "in a row" means back to back hours, unpaid held hours count, a group class counts until cancelled (D19).
- All bookings are 60 minutes on the hour.

## IDs

| ID | Page | Requirement | Acceptance check (Given, When, Then) | Rule owned elsewhere | Canvas |
|---|---|---|---|---|---|
| CPORT-01 | K1 Today | Sessions in time order with time, court, solo or group, students and level | Given a coach with three sessions today, when they open Today, then they see only their own, in time order | COACH-01 | H-K1-Today |
| CPORT-02 | K2 Schedule | Week view of solo and group classes, leave and blocked times | Given a coach with approved leave, when they open Schedule, then the leave days show and no session appears on them | COACH-01 | H-K2-Schedule |
| CPORT-03 | K3 Availability | Weekly rules by day, one off open or closed times, with the 6 hour rest cap applied | Given a coach sets availability that would make a 7th hour in a row, when they save, then the 7th hour is not offered for booking | COACH-01, D19 | H-K3-Availability |
| CPORT-04 | K4 Leave | Request form (dates, full or half day, type, note) and a list with status; the owner approves in A7 | Given a coach submits leave, when the owner approves, then the coach gets a LINE message and affected sessions are flagged | ADMIN-08, LINE-05 | H-K4-Leave |
| CPORT-05 | K5 Session detail | Roster with photo, level and past notes; mark Present or Absent; private note | Given a session that has ended, when the coach marks a player Absent, then it is saved, audited, and counts for pay as a no show; it is a hint shown to staff and does not by itself mark the player's no show or forfeit, which staff decide in A2 (D118) | CANCEL-04, coach pay | H-K5-Session-detail |
| CPORT-06 | K6 Earnings | This month's delivered sessions and amount owed, and past payouts; counts sessions attended or no show, not cancels within policy | Given a coach, when they open Earnings, then they see only their own sessions and amounts and no other coach's or club revenue | PRD Coach rates and pay | H-K6-Earnings |
| CPORT-07 | Session change messages | A coach gets a LINE message when a solo or group class is booked, moved or cancelled, and when leave is approved or declined | Given a player books a solo class with a coach, then that coach gets one LINE message in their language, taken from the coach's language field, which defaults to their LINE app language (D95); the message uses the writers' wording on the Booking confirmed card style (D91) | LINE-05 | L-Msg-* (no coach card board, Q4) |

## Open questions

D118 settles that the coach's Absent is a hint only and that a reversal changes coach pay by the normal rule; D91 settles the coach message look. Two remain:

1. **Attendance after the fact.** Can a coach change Present or Absent after the session has ended, and for how long?
2. **Coach pay numbers** are empty settings (hand-off open items); K6 shows them only after the owner sets them.

Note for testers: K1 shows four sessions but says 4.5 teaching hours; K6 and A7 disagree on who is freelance (Gaps B3, B4). Do not copy those samples.
