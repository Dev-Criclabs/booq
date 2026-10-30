# Decisions log

Decisions made by the user, newest first. Each is also written into the PRD change log or hand-off where it changes a rule
(`CLAUDE.md`: rule changes start in the PRD, then the hand-off, then the feature specs).

## 30 Oct 2026, round 2 (foundation, from the F01/F02/architect/DevOps questions)

| # | Decision | Feature specs affected |
|---|---|---|
| D1 | A person can hold several roles in one club (coach who also plays, owner who also coaches). Roles are a set, not a single value | F01, F02, F11, F12 |
| D2 | BOOQ staff may see aggregate counts (bookings in the last 30 days per club) and the owner's contact details. Never individual bookings, players, payments, slips, receipts, wallets or reports | F01, F15 |
| D3 | BOOQ staff sign in with email plus a second factor, separate from LINE | F01, F15 |
| D4 | Testing mode: test data is flagged, uses its own non-legal receipt numbers, and is purged at Go live so Hunter's real receipts start at 000001. Testers are the owner and named BOOQ testers. BOOQ sees pass/fail only | F01, F13, F15 |
| D5 | Hosting: Supabase, nearest region Singapore, with a data-processing agreement. **Action for the user: a Thai lawyer must confirm the cross-border transfer under PDPA.** Alternative if refused: self-host Postgres in Thailand | F01, DevOps |
| D6 | One shared BOOQ domain with the club in the URL. **Domain: the user will supply it later** | F02, F15 |
| D7 | One LINE provider per club (each club owns its LINE accounts). Key stays `(club_id, line_user_id)` | F02, F10 |
| D8 | Tennis template carries the PRD defaults: hold 15 min (choices 10/15/20), claim 30 min, no offers within 2 h, rest cap 6, group 4 to 6 players. Blank template starts empty. TBD values stay empty settings | F01, F15 |
| D9 | If the player is not a friend of the club's LINE account: do not block checkout. Show the confirmation in the app and ask them to add the account | F02, F10 |
| D10 | **Skipped for now:** consent for players under 18. Not decided; stays open, needs a Thai legal check before the consent text is final | F02 |
| D11 | Phone is typed, not verified by code in v1. Duplicate phones at one club are flagged for referral abuse | F02, F14 |
| D12 | A player with no date of birth gets Adult prices. Adults can add a date of birth voluntarily. Every change to it is audited and visible to the owner | F02, F11 |
| D13 | CSV import: owner only, all-or-nothing with an error report, no bookings imported. Imported players match on phone at first sign-in. Ledger reason `import` | F01, F11 |
| D14 | Club data export: the owner downloads it; BOOQ staff can only start it. No delete-club feature in v1 | F01, F15 |
| D15 | Onboarding specialists can take assigned clubs Draft, Testing, Live. Only a platform admin can pause or resume a club | F01, F15 |

## 30 Oct 2026, round 2b (Notion core versus PRD)

The Notion Booq Product Reference is **no longer the source of truth**. The PRD, the hand-off and `CLAUDE.md` are. Where Notion differed:

| Topic | Decision |
|---|---|
| Late payment after the hold | Goes to the wallet (PAY-03: approve if the slot is still open, otherwise wallet) |
| Cash refunds | None, anywhere. Value goes to the wallet or package credit |
| Hold length | PRD: owner picks 10, 15 or 20, default 15 |
| Booking length | Fixed 60 minutes on the hour |
| Plans | One plan for now |
| Language and dates | Thai and English; international year in both (never 2569) |
| Receipts | Numbered per club |
| Customer identity | LINE user ID is the key |
| Check-in | Removed (as in the PRD) |
| Staff sign-in | LINE for everyone in the club; BOOQ staff use email plus second factor (D3) |
| Existing Booq core | None. **Hunter is the first real build**; no code or database exists. Architect may name tables `club` and `location` from the start |

## 30 Oct 2026, round 1

| Decision | Where recorded |
|---|---|
| Late Beam payment (PAY-03): approve if the slot is still open, else wallet | PRD change log, hand-off PAY-03 |
| PDF receipt keeps the registered address; the app never shows it | PRD |
| Stack: Next.js with the LIFF SDK, Postgres/Supabase with row-level security by club ID, server jobs | PRD, plan |
| Date of birth is never locked; the player can correct it in Profile | PRD, hand-off AUTH-02 |
| A Student package already bought stays valid when the holder becomes an Adult | PRD, hand-off PKG-02 |
| Club LINE message cap behaviour | **Not decided yet** |
