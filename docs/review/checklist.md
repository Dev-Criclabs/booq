# Reviewer checklist for every pull request

Role: Reviewer (`docs/DEVELOPMENT-PLAN.md` section 3, role 13). The Reviewer approves or blocks with reasons. It never merges, never writes product code and never opens a pull request. It edits only `docs/review/**`.

Written 30 Oct 2026 from `CLAUDE.md`, the PRD and hand-off v1.2, and decisions D1 to D99 (`docs/decisions.md`; the brief named D1 to D80, and D81 to D99 added the approved build plan, F04 and F05 designs and the F06 and F10 answers). Where this list and a source disagree, the source wins and this list is the bug. If the spec is silent on something a PR does, the review item is a **question**, never a guess.

## How to use it

1. Open the PR. Read its task in `specs/features/F##-*/tasks.md` and the acceptance criteria (AC) of the IDs the task names.
2. Walk sections 0 to 14 in order. Mark each item **Pass**, **Block**, **Question** or **N/A (why)**.
3. A single **Block** in sections 1 to 12 stops the PR. Sections 13 and 14 are *should fix* unless noted.
4. Post the review in the format at the end (section 15). Every Block cites the rule (requirement ID, decision or CLAUDE.md line) and the file and line in the PR.

Block means the PR cannot merge. Question means the author or the Orchestrator must answer before the Reviewer can pass it. Neither the author nor the Reviewer settles a question by choosing.

---

## 0. Gate and scope (is this PR allowed to exist yet?)

| # | Check | Source |
|---|---|---|
| 0.1 | The feature's `requirements.md` (gate 1) and `design.md` (gate 2) are approved by a person on `main` or in `docs/decisions.md`. `tasks.md` exists (gate 3). A role whose feature is not approved at gates 1 and 2 writes no code | Plan s.1, s.3; CLAUDE.md "How we work" |
| 0.2 | The PR does one task (one task per run). The task is named in the PR and ticked in `tasks.md` by this PR only | CLAUDE.md step 4; build plan s.6 |
| 0.3 | The task is under a day. If the diff looks larger than a day of work or touches several tasks, ask for a split | CLAUDE.md step 3 |
| 0.4 | The PR does not need a rule change. If code needs a rule the spec lacks, the PR is blocked until the change goes PRD, then hand-off, then feature spec. Code never gets ahead of the spec | CLAUDE.md rule 5 |
| 0.5 | If code and spec disagree the author stopped and asked. Look in the PR thread for the question and the answer | CLAUDE.md "Sources of truth" |
| 0.6 | The branch is `<role>/<feature>` and is rebased on the agreed base | Plan s.3; build plan s.4 |
| 0.7 | No pull request was opened by a role that was not asked to open one (check the PR author and the thread) | Plan s.5 preamble |

## 1. Requirement IDs and traceability

| # | Check | Source |
|---|---|---|
| 1.1 | The commit messages start with the requirement IDs, for example `BOOK-03 hold slot for payment window` | CLAUDE.md step 4 |
| 1.2 | Every ID in the commits and the PR description exists in the hand-off, in the feature's `requirements.md`, or is a feature-level AC (for example `PLAT-04-AC3`). An unknown ID, or a cross-cutting `CC-n` ID that is not defined in the architecture doc, is a Block | Hand-off tables |
| 1.3 | Every changed behaviour maps to at least one AC. Code that implements behaviour with no AC is a Question (the spec is silent) | CLAUDE.md "never guess a rule" |
| 1.4 | Every AC the task names has a test that cites the AC ID. Grep the tests for each ID | Hand-off "Each acceptance check becomes at least one test" |
| 1.5 | The PR names the canvas board it builds from (H-, G-, S-, T-) for any screen. Build from hi-fi boards only; wireframes explain intent only | Hand-off "How to read the canvas" |
| 1.6 | Where the canvas and the spec disagree, the spec was built and the gap is in `docs/canvas-gaps.md`. A new gap is added to the register by the Orchestrator, not fixed by guessing | `docs/canvas-gaps.md` |

## 2. Tests were written first

| # | Check | Source |
|---|---|---|
| 2.1 | The commit history shows the tests before the code (a test commit that fails, then the implementation), or the PR description gives the failing run | CLAUDE.md step 4 |
| 2.2 | Each test is derived from a Given, When, Then AC, and its name or comment carries the AC ID. A test that only restates the implementation is a Block | Plan s.1 |
| 2.3 | Tests run against a real Postgres for anything touching RLS, constraints, locks or ledgers; a mock of the database for those is a Block. Time comes from the controllable clock | D30 |
| 2.4 | Tests and type checks were run and passed (CI is green, or the output is pasted). A skipped, `todo` or quarantined test for an AC in scope is a Block. `test.todo` is allowed only for an AC the task does not cover | Handoff "Run the tests and type checks before ticking a task"; system rule: never skip a test to get green |
| 2.5 | Concurrency ACs (BOOK-04, promo caps, parallel Pay taps) have a parallel test, not a sequential one | Hand-off BOOK-04 |
| 2.6 | A TBD setting is set explicitly by the test fixture. No test relies on an invented default | CLAUDE.md "Never invent" |

## 3. Club ID scope (tenancy)

| # | Check | Source |
|---|---|---|
| 3.1 | Every query, view, function, job and route reads or writes through the club context (`withClubTx` or the platform transaction). No raw pool, no `service_role`, no driver import outside `packages/db` | CLAUDE.md; F01 design; `tools/lint/banned-patterns.mjs` |
| 3.2 | Every new table carries `club_id`, a `unique (club_id, id)` key, composite foreign keys that include `club_id`, forced row level security and an entry in the table-class registry | F01-T05; hand-off data model "Every record carries a club ID" |
| 3.3 | A new background job runs in a club context and cannot cross clubs | F01-T34 |
| 3.4 | A request for another club's record returns 404, not 403 and not an empty 200 with a hint | D27 |
| 3.5 | Keys that identify a person are `(club_id, line_user_id)`. A player at two clubs has two accounts | D7; hand-off User |
| 3.6 | A cross-club test exists for every new table and route (club A cannot read, change or count club B) | F01-T07 |
| 3.7 | Webhooks and callbacks are verified with the key of the club they name, never with a shared key | F05 PAY-02; D7 |

## 4. Server-side permissions and BOOQ blindness

| # | Check | Source |
|---|---|---|
| 4.1 | Every route declares its permission (or `public`) through the route wrapper. A route with no declaration, or a check done only in the front end, is a Block | CLAUDE.md "Permissions are checked on the server"; F01-T13 |
| 4.2 | Roles are a set: a person with several roles gets the union. No code assumes one role | D1, D58, ROLE-01 |
| 4.3 | Role matrix honoured: front desk cannot see revenue, coach pay, prices, rules or staff; accountant reads and exports but changes nothing; coach sees no other coach, payment or revenue; only the owner sees date of birth history | Hand-off roles table; D55 |
| 4.4 | The accountant sees names on receipts and reports, never phone numbers or dates of birth | D35 |
| 4.5 | **BOOQ platform staff** never see players, bookings, payments, slips, receipts, wallets or reports, by role grants in the database and not only by hiding screens. Aggregate counts per club and the owner's contact details are allowed; nothing finer | CLAUDE.md; D2; PLAT-02 |
| 4.6 | Support view shows setup only: courts and hours, products and pricing (with add-ons), LINE, payment connections, settings. Not staff, coaches, closures or promo codes. Live clubs are look only unless the owner has opened the 24 hour window | D27; PLAT-02 |
| 4.7 | BOOQ staff sign in by email plus a second factor, never by LINE. Club staff, coaches and players sign in with LINE | D3; ROLE-02 |
| 4.8 | Only a platform admin can pause or resume a club. An onboarding specialist works only on assigned clubs | D15 |
| 4.9 | Stored secrets (Beam, LINE) are write-only, show the last 4 characters, are encrypted in the app on top of disk encryption, and never appear in logs, responses or the support view | D27, D34 |
| 4.10 | Slips and staff notes are staff only. Nothing player-facing reads them | PDPA-01 |

## 5. No double booking

| # | Check | Source |
|---|---|---|
| 5.1 | A court slot and a coach slot are protected by a database uniqueness or exclusion rule, not only by application code or a check-then-insert | CLAUDE.md; BOOK-04 |
| 5.2 | Holds count as occupancy: an unpaid held slot blocks other players, staff bookings, class sessions and closures the same way | BOOK-04; D43 |
| 5.3 | A solo class reserves court and coach in one transaction, both or neither. Test the case where the court is free and the coach is taken, and the reverse | CLAUDE.md; hand-off integrity rules |
| 5.4 | The late payment path (PAY-03) re-checks the slot at the moment of approval, with the same lock as a new hold, and sends the value to the wallet if anything else holds, books or closes it. For a solo class both court and coach must be free | D25 |
| 5.5 | The coach rest rule (6 hours in a row, setting) counts solo classes, group classes, staff bookings and unpaid held hours, with no override. A free hour resets the count | D19; PRD rest rule |
| 5.6 | A second tap on Pay returns the same hold and QR and creates no second hold or charge. A failed charge inside the hold may create a new charge in the same hold | D47, D72 |
| 5.7 | Hold length is 10, 15 or 20 minutes, a club setting. An existing hold keeps its original end time if the setting changes. No 60 minute hold exists (F16 only) | D8, D46, D52; BOOK-03 |
| 5.8 | A closure over a held slot cancels the hold and tells the player; opening hours and courts cannot change under existing bookings | D48, D50; BOOK-01 |

## 6. Time and money

| # | Check | Source |
|---|---|---|
| 6.1 | Money is an integer number of satang everywhere: database column, API, code, tests. No float, no `numeric` THB, no `toFixed` arithmetic. Conversion to baht happens only at display | CLAUDE.md |
| 6.2 | Rounding is half up to the satang. A code applies to the items in its scope, and add-ons are excluded unless the code says so | D23 |
| 6.3 | Display: whole baht shows without decimals, otherwise two decimals | D69 |
| 6.4 | All times are Asia/Bangkok. No code assumes the server zone. Date logic (booking window, day 30, birthday, 18th birthday, expiry) uses the Bangkok calendar date; the tests run with the clock moved to 23:59:59 and 00:00:01 | CLAUDE.md; D42; F01-T02 |
| 6.4a | Booking is 60 minutes on the hour, 23:00 is the last start, a player cannot book an hour that has started, staff can for walk ins. No 30 or 90 minute variant anywhere | CLAUDE.md; D39; BOOK-01 |
| 6.5 | Package and wallet expiry: calendar months from the purchase date, ending 23:59 Bangkok on that date; if the day does not exist, the last day of the month. Same for pause extensions | D20 |
| 6.6 | Dates shown to people use the international year in both languages (29 ธันวาคม 2026, never 2569) | CLAUDE.md |
| 6.7 | No price, amount, percentage or time limit is written into code. Hunter's 500 baht, packages and bundle prices come from club settings or the template. A value marked TBD in the PRD is an empty setting with no default (add-on prices, Head Coach price, referral reward, friend discount, birthday discount, max future court hours, class below minimum alert time, wallet balance expiry, coach pay) | CLAUDE.md |
| 6.8 | Number rules that are decided are used as decided: Tennis template defaults hold 15 (10/15/20), claim 30, no offers within 2 h, rest cap 6, group 4 to 6 (D8). Platform settings (Pay tap limit D61, QR expiry margin D80, rate limits) have no invented value; Security or the user sets them | D8, D61, D80 |

## 7. Ledgers are append-only; value never returns as cash

| # | Check | Source |
|---|---|---|
| 7.1 | Credit and wallet balances are computed from ledger rows. There is no editable balance column, no `update` of a balance, and a balance always equals the sum of its rows | CLAUDE.md; PKG-01 |
| 7.2 | The credit ledger, wallet ledger and audit log refuse `update` and `delete` for every role, including the owner role. The only exception is the fenced Go live purge of test rows (`is_test`) and the anonymise function, each with its own test | D28; F01-T10, T27, T33 |
| 7.3 | Credit ledger reasons are exactly: reserve, return, use, forfeit, expire, adjust, import. Wallet reasons are exactly: refund, late_payment, wrong_amount, duplicate_payment, referral_reward, spend, return, adjust, import, and expire only if wallet expiry is set. A new reason is a Question | Hand-off data model; D78 |
| 7.4 | Every staff movement has a reason code and a written note, enforced by the database, and an audit entry | PKG-01; PRD "Staff adjust credits or wallet only with a reason" |
| 7.5 | Order of use at checkout: package credit, then wallet, then money (Beam or cash) | D22 |
| 7.6 | Cancellation 12 hours or more ahead: credit goes back to the package; money paid (Beam or cash) goes to the wallet; wallet use goes back to the wallet; add-ons go with the booking; a used promo code or birthday entitlement is restored. Later, or no show: forfeit. The cancel sheet states the outcome before confirming | D21; CANCEL-01, CANCEL-02 |
| 7.7 | **No cash refund exists anywhere.** Search the diff for refund, payout, withdraw, reverse charge, Beam refund API and PromptPay refund. Any of them is a Block (the PRD sentence "Refunds go back by PromptPay" is canvas gap A3 and is not a rule) | CANCEL-02, PAY-05; canvas-gaps A3 |
| 7.8 | Wallet cannot be withdrawn and has no cash-out route, even for the owner | CANCEL-02 |
| 7.9 | A Student package or credit stays valid after the holder becomes an Adult and keeps its expiry date | PKG-02; PRD |
| 7.10 | Value owed to customers = unused package credit plus wallet balances, shown separately | D57 |

## 8. Payments, receipts and Beam

| # | Check | Source |
|---|---|---|
| 8.1 | A booking is confirmed only on Beam's validly signed callback (or the status check under D73 where amount and reference match, written to the audit log). Nothing else confirms a Beam booking, and there is no "simulate payment" in the app | PAY-02; D26, D73 |
| 8.2 | Callback handling: bad signature rejected, logged, alerted. Validly signed with the wrong amount: nothing confirms, recorded, owner banner, success returned. Validly signed for an unknown charge: success and flagged. Duplicate: ignored with success | D24, D36, D71, D75 |
| 8.3 | Signature is checked on the raw body, in constant time, with the club's own key | PAY-02 |
| 8.4 | Wrong amount: staff credit the full amount received (including overpayment) to the wallet, reason `wrong_amount`, with its own receipt | D77, D78, D79 |
| 8.5 | Late payment after the hold: approve if the slot is still open, otherwise wallet, reason `late_payment`, with its own receipt for the money received | PAY-03; D25, D37 |
| 8.6 | The QR expiry is set slightly before the hold ends by a platform-setting margin (D80, which refines D18) | D80 |
| 8.7 | Only the order reference is sent to Beam: no name, phone, date of birth or LINE ID | D76 |
| 8.8 | Each club has two key sets, test and live. A club in Testing uses the test set, and the launch check fails while the test set is active. Test payments use Beam sandbox only | D32, D26 |
| 8.9 | Receipt: per club, unbroken sequence (HTC‑2027‑000001), numbers never reused, void needs the owner and a reason, reprints marked as copies. A receipt is issued for a zero money order in the same series. Test mode uses its own non legal series and Go live starts real receipts at 000001 | RCPT-01; D4, D64 |
| 8.10 | The PDF receipt shows the registered address; the app never shows the club's address anywhere | PRD open questions; D54 |
| 8.11 | The server prices at Pay. If the price changed since checkout opened, the player sees the new price and confirms again before anything is held or charged | D63 |
| 8.12 | Promo: one code per order; counted at Pay, restored when the hold ends or a booking is cancelled 12+ hours ahead; discount split across hours by each hour's price; minimum spend checked before credits and wallet; larger discount wins if the code does not stack with the birthday discount | D65 to D70; PROMO-01 |
| 8.13 | Slip checking, backup mode, A4 and 60 minute holds are F16 and not built for Hunter | PAY-08; D52, D53 |

## 9. Text and language (TEXT-01 to TEXT-06)

| # | Check | Source |
|---|---|---|
| 9.1 | **No hard-coded user-facing text** in screens, LINE messages, Flex cards, PDF receipts or error messages. Run `node tools/i18n/lint-hardcoded-text.mjs` (on the `i18n/text-variables` branch) and read the diff for strings the lint may miss (template literals, `aria-label`, `title`, `alt`, `placeholder`, enum values shown to people, error `message` fields). Error responses carry codes; the front end maps codes to keys | TEXT-01 |
| 9.2 | Keys come from `locales/copy-index.csv`, looked up by screen. One key serves several screens; text is never copied into a new key | CLAUDE.md; TEXT-02 |
| 9.3 | **The existing wording of a key is unchanged.** Diff `locales/*.json` for edited values of existing keys (`git diff` on lines that are not additions). Any edit of an existing key's wording by a non-Content role is a Block | TEXT-04 |
| 9.4 | New text has a new key in both `en.json` and `th.json`, with the same prefix and numbering rules (P, A, K, L, X), and is listed in the task for the writers. D81 approves `locales/pending/<feature>.json` for feature roles while `CLAUDE.md` still says to add both locale files; accept either until the Orchestrator aligns them (spec-consistency M-2) | TEXT-04; D51 |
| 9.5 | **Variables are identical across en and th**: every `{name}` in the English value appears in the Thai value of the same key, with no extra or missing name, and no sample values (names, dates, times, prices, counts) are left in the text | TEXT-03 |
| 9.6 | The platform console (X keys) is English only. Player app, club admin, coach portal, LINE messages and receipts have both languages | TEXT-05 |
| 9.7 | LINE Flex cards and PDF receipts read the same locale files; no text inside templates | CLAUDE.md |
| 9.8 | Layout survives the longest string in either language: Thai is longer and taller; buttons never wrap; content scrolls. The PR shows a test or screenshot with the longest string | TEXT-06 |
| 9.9 | Fixed numbers in player copy (15 minutes, 12 hours, 30 minutes) are variables fed from settings (canvas gap A5) | `docs/canvas-gaps.md` A5 |
| 9.10 | Starting language follows the LINE app; Profile has the toggle; messages go in the player's language | PRD; F02 |

## 10. Audit

| # | Check | Source |
|---|---|---|
| 10.1 | Every change to a booking, balance, price or setting writes an audit entry in the same transaction, naming actor, time, record, old value, new value and reason. A failing audit write rolls the change back | PLAT-04 |
| 10.2 | Every staff action and every platform action is audited. Platform actions also write to the P6 log, naming the BOOQ staff member | PLAT-04; D2 |
| 10.3 | Status changes, pauses, role changes, date of birth changes (old and new, visible to the owner only), cash payments with reason code, no show or late cancel marks and their reversal, code and price edits, CSV import, export start, support window, Beam status check by D73 and the key swap all have an audit entry | PLAT-04; D12, D13, D14, D56 |
| 10.4 | The audit table is registered in the audited-tables registry and has its trigger; the audit log is append-only | D28; F01-T10, T11 |
| 10.5 | Audit JSON does not hold secrets, tokens or full card/bank data, and is redacted on anonymise | PDPA-01; D34 |

## 11. PDPA and privacy

| # | Check | Source |
|---|---|---|
| 11.1 | The club is the data controller and BOOQ the processor. Consent is recorded at first sign in with the notice version and language | PDPA-01 |
| 11.2 | Copy or delete on request works; deletion anonymises, keeps receipts, and is refused with a future confirmed booking | PDPA-01; F01-T33 |
| 11.3 | Logs and error reports contain no tokens, ID tokens, access tokens or phone numbers | F02-T03 |
| 11.4 | Phone is typed, not verified by code; duplicate phones at one club are flagged, not blocked | D11 |
| 11.5 | Under 18 consent text is not final (D10, still open): the PR does not decide it, and the screen has no invented wording | D10 |
| 11.6 | No data leaves the club context through exports, reports or analytics. Test records are excluded from every report and count | D33 |
| 11.7 | Hosting and transfer questions (D5, Thai lawyer) are deferred by the user: the PR neither raises them nor changes the hosting choice | D5 update |

## 12. No decision of an OPEN question

The PR must not settle any of these. If it needs one, the right outcome is a Question to the Orchestrator.

| Open item | Where | Rule for the PR |
|---|---|---|
| Consent for players under 18 | D10 | No invented consent text or age gate beyond the Student/Adult price group |
| Naming (Store/Branch vs Club/Location) | D-parked | Do not raise. Use `club` and `location` as the architect named them |
| Effect of a corrected date of birth on already held Student packages | canvas-gaps C | Packages stay valid (PKG-02); no further rule |
| Whether "owed to customers" includes wallets | D57 closed it: yes, shown separately | Show both, separately |
| Behaviour at a club's LINE message cap beyond LINE-07 | Plan s.4 | Follow LINE-07 only; the 100% free plan cases are as written |
| Whether a late payment to the wallet gets a receipt | Closed by D37 | Own receipt |
| Beam merchant account, sandbox keys, fees; the club's LINE OA plan | D80 "User tasks" | The user arranges these; code reads them as settings |
| Pay tap limit value, QR expiry margin | D61, D80 | Platform settings with no invented default |
| Slip checking provider | PRD open | Not built for Hunter |
| Coach pay numbers, add-on prices, Head Coach price, referral and birthday amounts, max future hours, wallet expiry, class below minimum time | Hand-off open items | Empty settings with no default |
| Rich menu labels | canvas-gaps C; D54 | The owner edits each label in Thai and English; no default invented beyond the writers' keys |

Also block any PR that quietly picks an answer in a code comment, a constant, a migration default, a test fixture presented as a default, or a locale string that states a rule.

## 13. Lane: edits only inside the author's folders

Compare the PR's changed files with `docs/review/lanes.md`. Any file outside the author's lane is a Block unless the PR is a small, explicitly requested change to the folder's owner and the owner (or the Orchestrator) approved it in the PR. In particular:

| # | Check |
|---|---|
| 13.1 | Nobody except the Orchestrator edits `docs/decisions.md`, the PRD or the hand-off. Designs cite decisions; they never edit them |
| 13.2 | A spec drafter edits only `requirements.md`; the architect edits `design.md` and `tasks.md`. Neither edits the other's file |
| 13.3 | Wording of an existing locale key, `copy-index.csv` and `tools/i18n` belong to Content |
| 13.4 | `tests/**`, `docs/qa/**` and the fakes belong to QA. A product PR may add unit tests beside its code, but not edit `tests/fakes` or the acceptance skeleton |
| 13.5 | `.github/**`, `infra/**`, `docs/ops/**` belong to DevOps |
| 13.6 | `docs/review/**` belongs to the Reviewer; `docs/**` other than the above belongs to its named owner |
| 13.7 | Migration files stay in the author's number block (F01 0001 to 0099, F02 0101 to 0199, F03 0201 to 0299, F04 0301 to 0399, F05 0401 to 0499, F06 from 0501). A merged migration is never edited; a fix is a new migration |
| 13.8 | Registries are one fragment file per feature; a PR does not edit another feature's fragment |

## 14. Removed features: not built, not stubbed, not hidden behind a flag

Search the diff, migrations, routes, locale keys, rich menu, LINE messages and admin navigation for each of these. Any hit is a Block.

| Removed | What to search for |
|---|---|
| **A3 Check-in** and any **check-in QR** | `check-in`, `checkin`, `check_in`, `late flag`, "Late after 15", a QR on the confirmation, My bookings or a LINE card. A booking counts as played when its slot ends (CANCEL-04). Staff mark no show or late cancel in A2 with a reason and can reverse it |
| **A11 Gift vouchers** | `gift`, `voucher`, A11 route or menu item |
| **A15 Messages editor** | any admin screen or route that edits LINE message wording or layout. LINE wording is fixed in code and locale files (LINE-03) |
| **An everyday slip review queue** | a list of pending slips to approve day to day. A4 Backup slip check exists only for F16, only while checking is down, and is not built for Hunter |
| Also not in v1 | family or guardian accounts, student ID upload, waivers, shared family packages, membership tiers, recurring weekly bookings, trial class and assessment, bill splitting, progress tracking, free influencer bookings, shift cash counts, events, tournaments, card payments, court lighting control, delete-club |

## 15. Reporting format

```
PR: <title / link>        Task: F##-T##        IDs: ...
Verdict: APPROVE | BLOCK | QUESTIONS
Blocks:     1. <check no.> <what, file:line, rule cited>
Questions:  1. <what is silent in the spec, who decides>
Should fix: 1. ...
Passed: sections ...      N/A: sections ... (why)
Tests: <what was run, result>        Lane check: <folders touched vs lane>
```

The Reviewer re-reviews after each push and does not approve on a promise to fix later. The Reviewer never merges.

## 16. Quick commands

```
# changed files and lane check
git diff --name-only origin/<base>...HEAD
# user-facing text and key wording
node tools/i18n/lint-hardcoded-text.mjs
git diff -U0 origin/<base>...HEAD -- locales/ | grep '^-' | grep -v '^---'     # edited or removed existing keys
# static rules
node tools/lint/banned-patterns.mjs        # service_role, raw pg outside packages/db
grep -rniE "check[-_ ]?in|gift|voucher|refund|withdraw|payout" <changed paths>
grep -rnE "toFixed|parseFloat|Number\(.*(amount|price)|numeric\(" <changed paths>   # money as satang
grep -rnE "new Date\(|Date\.now\(|toLocale|Intl\.DateTimeFormat" <changed paths>   # time via packages/time only
grep -rnE "\b(update|delete)\b.*(credit_ledger|wallet_ledger|audit_entry)" <changed paths>
```

These greps find candidates only. The Reviewer reads the code; a clean grep is not a pass.
