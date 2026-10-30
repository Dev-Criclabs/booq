# Decisions log

Decisions made by the user, newest first. Each is also written into the PRD change log or hand-off where it changes a rule
(`CLAUDE.md`: rule changes start in the PRD, then the hand-off, then the feature specs).

## 30 Oct 2026, round 5 (approved as recommended)

| # | Decision |
|---|---|
| D32 | Each club holds two sets of Beam keys, test and live. Testing status uses the test set. Swapping to the live set at Go live is a required item on the P4 launch checklist, with a smoke test. Test LINE messages go through the real Official Account and count toward the monthly cap |
| D33 | Test-flagged records are excluded everywhere: reports, daily close, receipts lists and platform counts. They show only in test-mode views |
| D34 | Personal data is encrypted in transit (TLS) and at rest (the host's standard disk encryption). Stored secrets such as Beam and LINE keys get an extra layer of encryption in the app |
| D35 | The Accountant sees names on receipts and reports, not phone numbers or dates of birth |
| D36 | A validly signed Beam callback with the wrong amount: record it, flag it for the owner, return a success status so Beam stops retrying (refines D24) |
| Open | Whether a late payment that goes to the wallet gets its own receipt is with the accountant |

## 30 Oct 2026, round 4 (approved as recommended)

F01 and F02 requirements were approved by the user on 30 Oct 2026 (branch `spec/f01-f02-requirements`).

| # | Decision |
|---|---|
| D18 | The Beam QR expires exactly when the hold ends. A "late payment" (PAY-03) is a payment Beam reports after that |
| D19 | Rest rule: "in a row" means back-to-back hours; a free hour in between resets the count. Unpaid held hours count. A group class counts until it is cancelled |
| D20 | Expiry: calendar months from the purchase date, ending 23:59 Asia/Bangkok on that day; if the day does not exist, the last day of the month. Same for pause extensions |
| D21 | Cancel 12+ hours ahead on a mixed payment: package credit returns to the package; money paid (Beam or cash) goes to the wallet; wallet use returns to the wallet; add-ons return with the booking; a used promo code or birthday entitlement is restored. Late cancel or no show forfeits |
| D22 | Order of use at checkout: package credit, then wallet, then money (Beam or cash). PRD wording "wallet is spent first" is clarified to "before money" |
| D23 | Money rounding: half up to the satang. A code applies to items in its scope; add-ons are excluded unless the code says so |
| D24 | Beam callbacks: bad signature is rejected, logged and alerted. A validly signed callback with the wrong amount does not confirm the booking, is flagged for the owner, and staff credit the wallet with a reason. A duplicate callback is ignored with success |
| D25 | Late payment "slot still open" = no other hold, booking or closure. A solo class needs court and coach both free, otherwise all of it goes to the wallet. The player gets a LINE message. A receipt is issued for money received (accountant to confirm) |
| D26 | Test payments use Beam sandbox only. No in-app "simulate payment" |
| D27 | BOOQ "setup only" view = courts and hours, products and pricing (with add-ons), LINE, payment connections, settings. Not staff, coaches, closures or promo codes. Paused clubs are look-only unless the owner allows changes. A request for another club's record returns 404. Stored secrets are write-only (last 4 characters shown) |
| D28 | The audit log and the credit and wallet ledgers are append-only |
| D29 | The package-expiring message keeps sending at 80% of the LINE cap (LINE-07) |
| D30 | Test tools accepted: Vitest, Playwright, a real Postgres in tests, a controllable clock |
| D31 | `locales/copy-index.csv` is generated from the canvas by the i18n role (read only) |

## 30 Oct 2026, round 3

| # | Decision |
|---|---|
| D16 | The 7 Dec test runs on **production** with Hunter in Testing status (test data flagged, purged at Go live). Staging is for development and QA only |
| D17 | LINE message cap (LINE-07): alert at 70%, reminders stop at 80%, booking and payment never blocked, thresholds platform wide. Birthday, referral reward and package-expiring messages are kept over reminders. Confirm if package-expiring should instead be dropped with reminders |
| D5 (update) | The Thai-lawyer check on hosting is **deferred by the user**. Do not raise it with the user until they bring it up. The hosting choice in D5 stands for now |

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
