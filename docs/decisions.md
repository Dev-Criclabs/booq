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

## 30 Oct 2026, round 12 (orchestrator, standing approval D147)

| # | Decision |
|---|---|
| D148 | BOOQ staff password sign in (Supabase Auth, needs the anon key) goes through the separate `apps/staff-invite` app (F01-T17b), so `apps/platform` holds neither the anon key nor the service-role key and SR-06 stays as written. `apps/platform` keeps the sign in rules behind an interface; the Supabase adapter is built in T17b. Security should confirm this reading of SR-06 when its chat is next answered by the user |
| D149 | `booq_app` may read `line_channel_secret` (SR-03 deviation) because the LINE webhook route in `apps/web` verifies `x-line-signature` with it. `line_channel_token` and `line_login_secret` stay worker only. Key creation and placing `SECRETS_PUBLIC_KEY` / `SECRETS_PRIVATE_KEY` in environments is a DevOps plus user action (`docs/ops/secrets.md`); key rotation procedure is still open |
| D151 | Owner invite binding (replaces the binding part of D122; Architect proposal `docs/architecture/proposal-owner-binding.md`, default without the optional one-time code): the invite is created unbound and emailed only to `club.owner_email`; the first LINE user who redeems it takes the owner role and the invite binds to them; later only that LINE user can open it. Verified by `owner_verified` (typed phone equals `club.owner_phone`); a mismatch needs a second platform admin (`confirm_owner_verified`) before Go live. `club.owner_line` stays a contact detail. Taken on the orchestrator's recommendation under the user's standing approval (D147) |
| D152 | Privacy notice and terms (orchestrator recommendation under D147; spec drafter's analysis of 30 Oct): one notice template with club fields (club name, legal name), one per language, versioned; the controller contact in the notice is the club's LINE Official Account chat (the app never shows the club's address); served at /c/{slug}/privacy and /c/{slug}/terms; the Architect designs where versions are stored and how notice_version is set. The final notice and terms wording is not written by any build role: Security supplies the content list (open question Q-15), the writers draft Thai and English, and the user, the Hunter owner and counsel approve it before testing on 7 Dec |
| D153 | Gate 2: the F06 (packages, credit, wallet), F10 (LINE messages) and F13 (receipts and reports) designs are approved as drafted by the spec drafter on 30 Oct 2026, under the user's standing approval (D147), with the Architect's review findings to be folded in as amendments. The designs' status lines change from DRAFT to Approved |
| D154 | New wallet and credit ledger reason `import_transfer` for value carried in from the club's earlier system for an unclaimed imported player: a paired movement, never cash, reported as imported value for unclaimed players (PRD change log Decisions 30 Oct (12), hand-off PKG-01; orchestrator decision under D147) |
| D155 | Gate 2: the F07 (solo classes and coaches), F08 (group classes and waitlist) and F09 (cancellation, no-show, closures) designs are approved as drafted on 30 Oct 2026 (spec/f07-design, f08-design, f09-design), with the answers in D156 to D158, under the user's standing approval (D147) |
| D156 | F07 answers: coach leave is a time range on whole hours (no leave types and no half-day length are invented); the coach price override is one nullable price per price group; the owner substitutes the coach for solo and group classes alike; F12 uses only the PRD pay model; any coach consent text is part of the D152 notice work; an empty rest_cap_hours uses the PRD's 6 |
| D157 | F08 answers: a player may be on several waitlists; a held court hour shows Join waitlist like a taken one (matches F03-T20, since a hold can end); the class drop-in price is a nullable price on the class template with no default (a club setting, never invented); a declined or expired offer is final for that entry; the offer ends at the earlier of now plus the claim time and the session start |
| D158 | F09 answers: Played is derived, not stored; no-show marking opens after the slot ends (no new setting); F06 adds wallet_return_line(order_line, reason) for one line; reversing a late cancel restores the booking and is refused when the slot has ended or is taken; a late cancel forfeits the wallet part too (PRD forfeit rule) |
| D159 | Migration rule for shared objects (found by the booking lane on F03-T30): migrations apply in number order on a fresh database, so a migration that redefines a function, constraint or view must be numbered above every migration that defined that object before it, even if that number lies outside its own feature block. The feature block is the default; this rule wins when they clash. F03-T30 (offer_ended) therefore uses 0411 (after F05's 0403 and the Architect's 0410). The Architect adds a check to check-migrations that refuses a redefinition numbered below an earlier definition |
| D160 | Platform lane answers (F01-T14, F02-T17, F01-T17b), approved as recommended under D147: (1) staff routes never assign the owner role or change an owner; invite life is the platform setting `staff_invite_ttl_hours` with no default (503 `not_configured` until a BOOQ admin sets it); deactivate sets active=false and ends sessions. (2) The LINE webhook finds its club by a stored token hash (`line_connection.webhook_token_hash`, migration 0049). BOOQ staff create or replace the LINE and Beam webhook tokens in the console support view; the plain token is shown once and only its hash is kept. (3) The D148 console sign-in adapter keeps the provider's first-step token on the server under an opaque challenge id, stored in the shared console tables (`platform.console_challenge`, migration 0051). A reset or deactivation by another admin ends all that teammate's console sessions. |

## 30 Oct 2026, round 11 (approved as recommended)

F14 and F15 requirements are approved. F15 Q10 (platform log retention) stays open and parked.

| # | Decision |
|---|---|
| D129 | The referrer is not named to the friend (F14 Q1); the canvas wording is a canvas fix |
| D130 | The reward uses the amount in force when the friend's booking is played; if it is empty then, no reward is paid (Q2) |
| D131 | The friend's booking counts only if money was paid; a cancelled booking never counts and the reward waits for the next qualifying booking (Q3) |
| D132 | The referrer is recorded at the friend's first sign in through the link, with no time limit (Q4) |
| D133 | The birthday discount applies to the whole solo class price (Q5) |
| D134 | The birthday entitlement resets each Bangkok calendar year (Q6) |
| D135 | No reward cap in v1 (Q7) |
| D136 | A friend is new when they have no earlier paid purchase (Q8) |
| D137 | The BOOQ console second factor is an authenticator app (F15 Q1) |
| D138 | If the owner has not signed in, P1 shows an alert and P3 offers a fresh invite bound to the owner's LINE ID (Q2) |
| D139 | No billing in v1; trial end and billing start are dates BOOQ keeps (Q3) |
| D140 | The club URL name is set in P2 step 1, is unique, may change in Draft or Testing and is fixed after Go live (Q4) |
| D141 | Badminton is a sport label that uses the Blank template (Q5) |
| D142 | BOOQ staff enter the Beam merchant ID, test and live keys and the signing key at setup; write-only (Q6) |
| D143 | For Hunter only the rules required for booking to work must be set to go live; empty TBD values do not block it (Q7) |
| D144 | The alert list in P1-AC5 is final for v1 (Q8) |
| D145 | Only Tennis and Blank templates are usable in v1; Padel and Pickleball are to build (Q9) |
| D146 | The F14 and F15 requirements are approved |
| D147 | **Standing approval.** The user approved that future requests and questions from the sessions are settled with the orchestrator's recommendation, and that the orchestrator tells the user what it decided. Limits that still need the user: items the user parked (consent for players under 18 and its age threshold, the VAT invoice layout, retention periods, the hosting-region legal check), repository settings only the user can change, accounts and credentials, spending, and anything that cannot be undone or changes something outside the project |

## 30 Oct 2026, round 10 (approved as recommended: "approve all")

Reviewer and Security findings and the open questions of the F07, F08, F09 and F13 drafts. The F07, F08, F09 and F13 requirements are approved. Not decided here and left open on purpose: consent for players under 18 and the age threshold (D10), the VAT invoice layout, and retention periods for receipts, closes and reports.

| # | Decision |
|---|---|
| D100 | The Go live purge removes only rows made by a tester kind. Owner, staff and coach accounts are never test rows and survive Go live (reviewer F01-1, FA Q29) |
| D101 | Audit entries are not flagged on their own; only entries about test data are purged. A setting changed in Testing keeps its audit entry after Go live (F01-2) |
| D102 | A Draft or Testing club admits the owner role and testers; the owner invite stays valid for return visits; testers get long lived invites; a club that is not live serves only a minimal sign in config (name, language, status, LIFF id) to callers who are not signed in (F01-3) |
| D103 | A guest reads only named public columns or routes, never owner contact details or merchant ids (F01-4) |
| D104 | Anonymising a deleted player replaces personal fields in audit rows with a placeholder; nothing else in an audit row can change (reviewer Q3, SR-04) |
| D105 | An imported player record is linked only after the front desk confirms the claim in A6; a sign in matching no record becomes a new player (reviewer Q4, Security Q-02, SR-05) |
| D106 | Receipt numbers run per club per Bangkok year; the prefix is set in P2 step 1 and required before Go live; a void only marks the receipt (reviewer Q5, F13 Q1, Q2, Q13) |
| D107 | While a club is Paused, the owner and staff may move, add a coach, cancel and mark no show on existing bookings; a late payment is not used to confirm a booking in a Paused club and goes to the wallet (reviewer Q6) |
| D108 | Go live checks beyond P4: the owner signed in, one completed test booking, the pay tap limit set, and the Beam key swap with its smoke test (Q7) |
| D109 | A late payment is also refused for a paused club, a closure or a deleted account; the whole value goes to the wallet (Q8) |
| D110 | Only staff (front desk, owner) override the future hours limit, with a logged reason; no running hour or same date rule is built (Q9) |
| D111 | Minimum spend stays as approved in F04 A-3; the money of a cancelled hour returns to its sources net of its discount share; an add-on belongs to the first hour of its order; a coaching top up is its own order and receipt; peak pricing is not built in v1 (Q10) |
| D112 | A duplicate payment credit gets its own receipt; the wrong amount notice reaches the player in the app and by LINE when it can be sent (Q11) |
| D113 | A paused club keeps the Beam key set of its current mode (Q12) |
| D114 | When the LINE token fails, the owner sees a banner in the admin and BOOQ sees an alert in P1; the owner edits the six rich menu labels in Settings after Go live, which re renders the image (Q13) |
| D115 | Every club person also has the Player role; the Accountant reads business and tax settings only; only the Owner marks a coach payout paid (Q14) |
| D116 | The 14 and 3 day and 24 hour and 2 hour reminder numbers are variables in the text and settings in code (Q15) |
| D117 | The PRD wording that said refunds go back by PromptPay is corrected to wallet or package credit only; CLAUDE.md now says features add text keys in `locales/pending/` (Q16, M-1, M-2) |
| D118 | F09: the birthday entitlement follows the code rule; staff may choose a club cancel with full value and a reason; a player may cancel during a pause; a package that expired before a closure return is listed on the closure screen and the owner extends it with a written reason; staff mark a no show only after the slot ends; a reversal changes coach pay by the normal rule and a paid referral reward stays paid; the coach's Absent in K5 is a hint only; repeat closures cancel across the booking window; the owner gets a list of players who could not be messaged |
| D119 | F13: no credit note when value goes to the wallet; reprints are in the player's language and staff may print either; the daily close lists money methods and shows wallet and credit use as separate non money lines; a closed day is not reopened and a later void shows on the day it is made; revenue earned is credits used at their price per credit plus single sales; occupancy is booked hours over bookable hours (open hours less closures), held hours not counted; the drafter proposes the report formulas for approval |
| D120 | F07: only approved leave hides a coach; the coach price follows the price group from the date of birth; solo credits do not apply to a coach added after booking; the court already booked is used, otherwise the lowest numbered open court; coach photo and bio are published with consent the club keeps; substitutes follow the rest rule and, if none is free, the owner cancels for full credit; a coach with future sessions cannot be deactivated; a booked session keeps its price when a tier or price changes |
| D121 | F08: sessions are generated across the booking window; a player sees classes of their own price group and those matching credits they hold; a guest sees the Adult schedule; editing a template applies to future sessions without players and a session with players keeps its details unless the owner edits it and the players are messaged with a free cancel; the spot is held for the first in line during an offer; an offer open at the 2 hour mark stands; claim is confirmed on the tap when credit or wallet covers it, and Beam payment is needed inside the claim time when money is due; no waitlist maximum; a below minimum session runs until the alert time is set |
| D122 | The owner invite is bound to the owner's LINE ID entered in P2 step 1 and is single use (Security Q-01, SR-01) |
| D123 | Resetting a BOOQ console second factor is done only by another platform admin and logged in P6 (Security Q-05) |
| D124 | Security's seven blocking findings SR-01 to SR-07 are accepted with the fixes the Security document recommends; where a fix conflicts with an approved decision the decision wins and the conflict is reported |
| D125 | For the other Security questions, Security's own recommendation in `docs/security/open-questions.md` is accepted, except D10 (under 18 consent) and the hosting question, which stay parked |
| D126 | QA covers every approved feature, not only F01 and F02: skeletons for all approved criteria, a CI check that every acceptance criterion ID appears in `tests/acceptance`, and the fake Beam measures lateness from the hold end (reviewer QA-1, QA-3) |
| D127 | The ops runbook describes two Beam key sets per club and the P4 key swap with a smoke test before Go live; the separate test LINE values are removed (reviewer OPS-1) |
| D128 | QA, DevOps and Content may push their own branches; the orchestrator merges approved work into `main` (user answer to QA, 30 Oct) |

## 30 Oct 2026, round 9 (approved as recommended)

| # | Decision |
|---|---|
| D81 | The build plan (`docs/architecture/build-plan.md`) is approved: the ordered merge, `packages/contract`, registries as fragments with `locales/pending/`, the wave and lane plan with Wave 0 done by one session. A `main` branch is created from the ordered merge. Making `main` the default branch and protecting it are repository settings for the user |
| D82 | The F04 and F05 designs are approved with their assumptions (F04 A-1 to A-9, F05 A-1 to A-6) |
| D83 | A staff adjustment can never take a balance below zero (F06 Q1) |
| D84 | A player who turns 18 keeps using the Student credits they bought, for the Student items they were bought for, until expiry (Q2) |
| D85 | A credit reserved before the package expires stays valid for that session; if the booking is cancelled after expiry, the credit is lost (Q3) |
| D86 | The package expiring message goes with the F10 boards (Q4) |
| D87 | A package bought with a booking, paid late so the booking cannot be confirmed: all of it goes to the wallet (Q5) |
| D88 | The owner extends one package at a time with a written reason; no bulk extension in v1 (Q6) |
| D89 | An empty wallet expiry setting means never; staff are warned when it is first set (Q7) |
| D90 | A pause shorter than a day moves the expiry by the exact pause length, then the expiry runs to 23:59 on the resulting day (Q8) |
| D91 | The 11 messages without boards use the writers' wording on the Confirmed card style in v1 (F10 Q1) |
| D92 | The rich menu is one image with Thai and English labels together, rendered on the server from the owner's six labels (Q2) |
| D93 | A queued message uses the language at send time (Q3) |
| D94 | Booking reminders in LINE controls the 24 hour and 2 hour reminders; Promotions in LINE controls the birthday discount and referral reward; everything else is always sent (Q4) |
| D95 | Staff and coaches have a language field, defaulting to their LINE app language (Q5) |
| D96 | A booking made less than 24 or 2 hours ahead skips the reminders already past (Q6) |
| D97 | If LINE usage cannot be read, use the last known value and alert in P1; reminders are not stopped (Q7) |
| D98 | The 70 percent banner uses the pause banner style (Q8) |
| D99 | If the owner upgrades the LINE plan mid month, LINE's own count decides (Q9) |

## 30 Oct 2026, round 8 (approved as recommended)

Approved by the user: the architect's F01 and F02 task lists and F03 design (assumptions A-1 to A-3), and the spec drafter's F04 and F05 requirements with the answers below.

| # | Decision |
|---|---|
| D59 | Group class seats do not count toward the future court hours limit (F03 A-1) |
| D60 | A paused club refuses new holds from staff as well as players; the owner can still manage existing bookings (A-2) |
| D61 | A per-player limit on repeated Pay taps exists as a platform setting; Security sets the value (A-3) |
| D62 | A player under 18 may buy Adult items (F04 Q1) |
| D63 | The server prices at Pay; if the price changed since checkout opened, the player sees the new price and confirms again (Q2) |
| D64 | A receipt is issued for a zero money order, in the same series, showing how it was paid (Q3) |
| D65 | If a code does not stack with the birthday discount, the larger discount wins (Q4) |
| D66 | A code use is counted at Pay and restored when the hold ends or the booking is cancelled 12+ hours ahead (Q5) |
| D67 | A discount is split across hours by each hour's price; cancelling one hour restores that hour's share; the code use is restored only if every hour is cancelled (Q6) |
| D68 | Minimum spend is checked on the order total before credits and wallet (Q7) |
| D69 | Amounts show as whole baht when whole, otherwise with two decimals (Q8) |
| D70 | A restored code reduces the partner redemption count (Q9) |
| D71 | A validly signed callback for an unknown charge is answered with success and flagged; a bad signature is rejected (F05 Q3) |
| D72 | If a charge fails inside the hold, a second tap creates a new charge in the same hold (Q4) |
| D73 | If a callback never arrives, the server may check Beam's charge status and confirm only when amount and reference match; recorded in the audit log (Q5) |
| D74 | The package QR time is its own setting, default 15 minutes; a payment after the order was cancelled goes to the wallet with its own receipt (Q6) |
| D75 | Alerts: wrong amount is an owner banner in the admin; bad signature, failed key check and unreachable Beam show in P1; a failed key check also reaches the owner (Q7) |
| D76 | Only the order reference is sent to Beam (Q8) |
| D77 | Wrong amount: the player sees the payment was received and the club is checking; staff credit the full amount received (including any overpayment) to the wallet (Q9) |
| D78 | Wallet reasons: refund, late_payment, wrong_amount, duplicate_payment, referral_reward, spend, return, adjust, import, and expire only if wallet expiry is set (Q10) |
| D79 | A wrong amount credit gets its own receipt (Q11) |
| D80 | The Beam QR expiry is set slightly before the hold ends; the margin is a platform setting (Q12) |
| User tasks | Beam merchant account, fees and sandbox keys (F05 Q1 and Q2) are the user's to arrange |

## 30 Oct 2026, round 7 (approved as recommended)

Approved by the user: the F01 and F02 designs (branch `architect/foundation`) and the F03, F11 and F12 requirements (branch `spec/f01-f02-requirements`).

| # | Decision |
|---|---|
| D38 | LINE friend prompt: set the LIFF add friend option to On (normal). LINE's consent screen offers the choice; C1 shows a plain note with no checkbox. LINE-01-AC6 and the C1 canvas board change (design F02 Q32 option a) |
| D39 | Players cannot book an hour that has already started; staff can for walk ins; 23:00 is the last start |
| D40 | A selection of several hours is one order with one booking per hour; one receipt per order |
| D41 | No separate limit on hours per selection; BOOK-05 governs |
| D42 | Day 30 (today plus 30) is bookable, by Bangkok calendar date |
| D43 | A staff booking awaiting payment holds the slot for the same hold time |
| D44 | The court slot waitlist follows the class waitlist rules; F08 owns it |
| D45 | Booking released is also sent to Beam clubs |
| D46 | A hold keeps its original end time if the hold setting changes |
| D47 | A second tap on Pay returns the same hold and QR |
| D48 | A closure over a held slot cancels the hold and tells the player; a later payment follows PAY-03 |
| D49 | The future hours limit counts all future hours (confirmed, bundle paid, solo class, unpaid held); staff bookings count; staff can override with a logged reason |
| D50 | Opening hours or courts cannot change under existing bookings; the owner uses a closure |
| D51 | New text keys for refusals are proposed by the drafter; writers own the wording |
| D52 | F03 reads the hold setting; F16 sets the 60 minute backup hold |
| D53 | Club admin pages for the Hunter build: A0, A1, A2, A5, A6, A7, A8, A9, A9b, A10, A12, A13, A14, A16, A17. A4 waits for F16. One ADMIN-nn ID per page |
| D54 | The A0 address toggle is removed. Six rich menu tiles with fixed links; the owner edits each label in Thai and English |
| D55 | The date of birth history is visible to the owner only |
| D56 | Cash reason codes: No banking app, QR failed at the counter, Other with a note. Cash is allowed for packages. Front desk and Owner only |
| D57 | "Value owed to customers" = unused package credit plus wallet balances, shown separately |
| D58 | A person with several roles sees the union of what the roles allow in the admin sidebar |

## 30 Oct 2026, round 6

| # | Decision |
|---|---|
| D37 | A late payment that goes to the wallet gets its own receipt for the money received (closes D25's "accountant to confirm" and QA Q-20) |
| Parked | Naming is parked by the user, to be revisited. Do not raise it until the user does |

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
