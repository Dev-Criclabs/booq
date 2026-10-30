# Spec consistency review

Reviewer, 30 Oct 2026. Scope: requirements F01 to F06, F10 to F12; designs F01 to F05; task lists F01 to F03; QA traceability and test skeletons; DevOps and i18n branches. Read against the PRD v1.2, hand-off v1.2, `docs/decisions.md` and `docs/canvas-gaps.md`.

**Baseline.** Read from the role branches, then re-checked against `origin/main` (head 48d09b0, the ordered merge, decisions D1 to D99, D81 approving the build plan, D82 the F04 and F05 designs, D83 to D99 the F06 and F10 requirements). The checklist cites D1 to D80 as the brief said; D81 to D99 do not change any checklist item. Blocking findings below were re-read on `main` by the Reviewer. Findings not marked *verified* come from a delegated first pass (three reading agents) and are quoted with their file and line; the Reviewer re-read the ones marked blocking and spot checked others. Line numbers are on the role branches and may shift by a few lines on `main`.

**Severity.** *blocking* = building from the text would break a decision or rule, lose money or leak data, or leaves a requirement without a test at its gate. *should fix* = inconsistency or gap that will cause rework. *note* = minor.

**Rule for this file.** Where the spec is silent the finding is a **QUESTION**. The Reviewer proposes a fix but never decides it.

## Counts

| Severity | Count |
|---|---|
| Blocking | 7 |
| Should fix | 68 |
| Note | 24 |

## Blocking

### F01-1 | blocking | Go live purge deletes real owner, staff and coach accounts *(verified on main)*
- Where: `foundation.md` §2.6 line 207 (`is_test` set at insert for every `app_user`, "tester player accounts, Q29"), line 212 (purge deletes `is_test` rows); FA Q29 (line 810, still Open, recommends keeping owner, staff and coach); F01 design A-3 (a live club keeps one active owner); PLAT-07-AC1, AC3.
- Wrong: the trigger flags by club status at insert and cannot tell a tester from an owner. Anyone first signing in while the club is Testing (owner invite redeemed in Testing) is flagged and purged at Go live. The purge can also trip the "one active owner" constraint and roll Go live back.
- Fix: define which `app_user` rows are test rows (flag follows the tester kind; owner, staff and coach never `is_test`), write it into PLAT-07 (PRD, hand-off, requirement), add the test "owner invited and signed in during Testing survives Go live". **QUESTION** for the user: FA Q29.

### F01-2 | blocking | Go live purge deletes real audit history *(verified on main)*
- Where: `foundation.md` line 207 (`audit_entry` in the `is_test` list), line 212 (purge may delete test audit rows); PLAT-04-AC1, AC6; D28.
- Wrong: every audited setup change made in Testing (prices, settings, roles, key swap, support edits) is flagged test and deleted at Go live. The live prices' history is lost, though PLAT-04-AC1 requires an entry for every price or setting change and AC6 allows the purge exception only for "test flagged data".
- Fix: do not auto-flag `audit_entry`; flag only entries whose subject row is test data. Test: a setting changed in Testing still has its audit entry after Go live. Reconcile PLAT-07-AC3 wording.

### F01-3 | blocking | A returning owner or tester cannot sign in to a Draft or Testing club
- Where: F02 design §6.4 lines 135 to 142, §4.1 (LIFF endpoint `/c/{slug}`); F01 design §4.1 line 106, §7.1 line 215; F02-T10 (an owner invite adds roles only, no `club_tester` row); PRD Flow J (owner works A0 in Draft).
- Wrong: Draft and Testing clubs admit only `club_tester` users or someone redeeming an invite, and answer 404 to everyone else including `GET /public/config`, which carries the `liffId` that `liff.init` needs. An owner who redeemed the invite once is refused on later visits until the club is Testing, so A0 steps 6 to 8 (needed for Testing, PLAT-01-AC2) cannot be finished. Testers cannot start LIFF login except through the invite link.
- Fix: state the gate: owner role and testers pass; a non-live club serves a minimal sign-in config to unauthenticated callers, or the invite link is the only entry and testers get long-lived invites. Add the cases to F02-T05 tests. **QUESTION** for the user if a second tester entry rule is wanted.

### F01-4 | blocking | Guests can read owner contact and merchant ids
- Where: F02 design §6.1 line 123 and F02-T06 (guest `select` on "setup-class rows of live and paused clubs"); F01 design §3.2 lines 53 to 61 (`club` holds owner name, phone, LINE, email, billing dates, tax id; `line_connection`, `payment_connection` hold merchant ids and `secret_last4`); FA §2.2 (all class S); D2.
- Wrong: class S includes those tables, so any anonymous visitor could read the owner's phone and email (D2 allows only BOOQ staff) and Beam merchant ids. The planned test ("no player data in any guest response") would pass while this leaks.
- Fix: guests read only fixed public views or routes with named columns (name, language, status, `liffId`, logo, public setup). Test that lists the columns a guest can read. Never grant a guest a whole S table.

### QA-1 | blocking | QA covers only F01 and F02
- Where: `docs/qa/traceability.md` lines 13 to 24 and `tests/acceptance/` (F01 and F02 only).
- Wrong: approved acceptance criteria F03 (77), F04 (79), F05 (56) are cited nowhere in QA; BOOK-06, WAIT-01, F04 R1 to R8, ADMIN-01 to 17, CPORT-01 to 07, F06 and F10 criteria have no row. PKG-03, LINE-05, LINE-06 and LINE-07 still say GAP though approved criteria exist. The money rules D63 to D80 have no test target at a gate. Also F01: four ACs missing from the skeleton (PLAT-02-AC12, AC13, PLAT-07-AC10, AC11).
- Fix: regenerate skeletons for every approved feature as was done for F01 and F02; refresh the summary table (it still counts 52 hand-off IDs); add a CI check that every AC ID in a `requirements.md` appears in `tests/acceptance`.

### QA-3 | blocking | Fake Beam pins the wrong late-payment boundary
- Where: `tests/fakes/beam/scenarios.ts` lines 74, 147, 148, 182; `types.ts` 24, 80; `docs/qa/concurrency-tests.md` CONC-27; `tests/fakes/README.md` line 85; D80, PAY-02-AC2. *(scenarios.ts verified on main: "D18: the QR expires exactly when the hold ends")*
- Wrong: D80 (refines D18) sets the QR to expire slightly before the hold ends, by a platform margin. The late-callback scenario measures lateness from QR expiry, so a payment between QR expiry and hold end counts as late, while PAY-02-AC2 and D25 say only a payment after the hold ends is late.
- Fix: measure lateness from hold end; add a case "paid after QR expiry but inside the hold"; the margin is a platform setting and QA must not pick a value.

### OPS-1 | blocking | Ops runbook gets the Beam key swap wrong
- Where: `docs/ops/runbooks.md` line 96 ("Swap the club's Beam and LINE keys from test to live values if they differ", a step after the purge); `plan.md` line 41 and `accounts.md` line 44 ("test LINE values ... Testing configuration"); `secrets.md` (one Beam set per club); D32, PLAT-07-AC10. *(verified on main)*
- Wrong: D32 gives each club two Beam key sets and sends test LINE messages through the club's real Official Account. The swap is a required P4 item with a smoke test, ticked before Go live. The runbook treats it as optional and after the status change, and keeps a separate "test LINE" configuration that D32 removed.
- Fix: rewrite runbook step and the secrets table for two Beam sets plus a P4 swap and smoke test before Go live; delete "test LINE values".

## Should fix: F01 and F02

- **F01-5** F01 design §5.2 and §6: the status, pause, resume, invite and tester functions are SECURITY INVOKER (line 97) but `booq_platform` has no grant on the D tables they write and no update right on `club.status`. They fail as designed, or the platform role needs grants that break platform blindness (PLAT-02-AC1). Fix: make them SECURITY DEFINER with a fixed search path and in-function role and assignment checks, list them in the definer review file, give BOOQ a masked view of `club_tester`. Test each platform write as the real role.
- **F01-6** `app.anonymise_user` edits audit rows (design §7.7 line 250; F01-T33 "redacts audit JSON") against D28 append-only and PLAT-04-AC6 (only the Go live purge is an exception). REQ1 Q13 is still open and FA Q27 says "Adopted" with no D number. **QUESTION** for the user: allow this as a second named exception, or pseudonymise through a join.
- **F01-7** PDPA-01-AC4 says history is deleted and unused credit and wallet "are lost", but the design keeps booking rows and writes no ledger movement for the loss. Ledgers are append-only. Fix: say which rows are anonymised or deleted and which ledger row records the lost balance (D78 has no wallet "forfeit").
- **F01-8** Settings registry marks `booking_window_days`, `cancel_window_hours`, `package_qr_minutes`, `vat_enabled`, `package_expiry_reminder_days`, `hold_minutes` "unset not allowed", yet the Tennis template list (PLAT-05-AC15) gives values only for hold, claim, no offers, rest cap and group size. A Tennis club would start with those missing. Blank intentionally leaves `hold_minutes` unset (PLAT-05-AC8), contradicting the column. Fix: add PRD and decision values (30 days, 12 hours, D74 15 minutes, 14 and 3 days) to PLAT-05-AC15 first; split "may be empty at Go live" from "starts empty on Blank".
- **F01-9** F01 tasks name no ID for PLAT-02-AC12, AC13, PLAT-04-AC7, AC8 (the owner audit read route `GET /audit`), PLAT-04-AC10, PLAT-07-AC2, AC9, AC10, AC11, ROLE-01-AC3, AC4, ROLE-02-AC6, PDPA-01-AC8, AC10 to AC12. Platform routes with no task: team and P6 (`/team`, `/audit-log`), `/templates`, club list, testers, launch run. The T37 sweep cannot hold them. Fix: add or extend tasks; name a feature owner where the AC belongs elsewhere (PLAT-07-AC2 test receipt series may be F13).
- **F01-10** Build plan lanes omit F01-T08 (settings registry) and F01-T14 (role and staff routes), which F01-T24 and F02-T10 depend on. Dependency line misses T27b needs T16, T12 needs T10 and T11, T32 needs T34. Fix: add them to lanes A and B and to the dependency line.
- **F01-11** Migration numbers: lane A builds 0005 (audit) before 0003 (people) and 0004 is in another lane, which the CI "out of order number" rule rejects. Design §3.1 puts the secrets tables in 0002 while T06 does not list them and T09 makes them separately; RLS and grants are in 0008 in the design but in each task in the plan. Fix: one number per task and one table-to-migration map.
- **F01-12** Over a day or bundled: F01-T23 (setup sections 1 to 5, two connection tests, invites), T33 (copy, delete, anonymise, staff routes), T13 (matrix, wrapper, build check), T18 (grants, policies, blind suite), T24, T37 sweep, F02-T09, F02-T25 sweep. Fix: split; make the sweeps one per ID family.
- **F01-13** PLAT-05-AC13 (template prices equal the PRD offer) is assigned to F01-T24 but T24's test says F04 and F06 register the price handlers, which do not exist in Wave 1. Same for PLAT-06-AC3, AC4 (needs F06 import handler) and PLAT-03-AC7 (F06 pause handler). Fix: name the closing task in F04 and F06 and track it in T37.
- **F01-14** Design §4.1 says the Draft to Testing steps 1 to 8 are listed in §9.3, but §9.3 lists Go live checks. The Go live list adds checks no decision states ("owner signed in", "one successful test booking", "no open launch failure", pay tap limit set). REQ1 Q1, Q5, Q7 still show "Blocking approval" on an approved file. Fix: add the steps 1 to 8 list; record the approved assumptions as D numbers or mark which checks are not yet approved; update the open questions. **QUESTION** for the user: which Go live checks beyond P4.
- **F01-15** `bump_usage()` refuses test activity, so `line_messages_sent` omits test sends, but D32 says test LINE messages count toward the cap. The own-count fallback is built on that counter and under-counts during the 7 Dec test. Fix: keep two counters or count test sends for LINE only.
- **F01-16** Role matrix differs: F01 design gives the accountant `settings.read` and not front desk; FA §4.3 gives front desk and accountant read on prices, promos, settings, staff; the spec says A16 and A17 are owner only and lists no read right. Fix: one matrix naming each readable setting group, or remove the right. **QUESTION** for the user.
- **F01-17** `claim_occupancy` refuses when the club is Paused (FA §3.3), and moving a booking or Add a coach uses the same path. D60 and PLAT-03-AC4 say the owner can still "manage existing bookings". Which owner actions (move, add coach, cancel, no show) are allowed while paused is not written. **QUESTION** for the user.
- **F01-18** FA §10.1 Q8 adopts a receipt series that resets each Bangkok year. Not in the decisions log. Launch is 29 Dec 2026, so the first real receipts would be HTC-2026-000001 and 2027 restarts two days later; RCPT-01 says one unbroken sequence and PLAT-07-AC3 says "starts at 000001" without a year. **QUESTION** for the user: one continuous number per club or a yearly reset.
- **F01-19** F01 design line 5 still calls ROLE-01, ROLE-02 and PLAT-07 "proposed" though the hand-off has them; FA says "Nothing here is approved (revision 8)" while the approved designs cite it as authority; REQ1 line 5 says D1 to D31. Fix: update the status lines and say which FA sections the approved designs inherit.
- **F01-20** `user_consent` and `club_tester` are built in F01-T12 and F02-T09, but design A-4 says the PRD and hand-off data model must change first, and REQ1 Q20 is open. No gate waits for that change (code ahead of spec, CLAUDE.md rule 5). Fix: add a "PRD and hand-off updated" gate to those tasks.
- **F01-21** D13 and PLAT-06-AC7 require imported players to be matched on phone at first sign in. F02's design and tasks never do it, so C2 creates a duplicate player and the imported credit stays unreachable. Matching on an unverified typed phone (D11) also lets a stranger claim someone's imported credit and wallet. **QUESTION** for the user (money risk): how are unmatched, double-matched and unverified phones handled (staff confirm, claim link)? Reviewer does not choose.
- **F01-23** (moved from notes) Specific numbers are chosen where the spec is silent: 30 minute idle, 24 hour link, 30 minute pending, 12 hour session, name length 1 to 100. Labelled assumptions, but F02 §7.2 says lifetimes are platform config "with no code default" and then assumes 12 hours; `support_session_idle_minutes`, the D61 tap limit and the D80 margin are not listed as config keys. Fix: put every number in `platform.config` or the settings registry with no code default, list all keys once, record approved values in decisions.
- **F02-1** F02-T00 (user id parity: Login `sub` equals Messaging `userId`) decides the player key, but no F02 task depends on it (T01 depends only on F01-T12). Fix: add "Deps F02-T00" to T01, T07, T09, T17 and state the fallback.
- **F02-2** F02 task header omits F01-T09, T14, T18, T34 that individual tasks list; T14 is scheduled nowhere (see F01-10).
- **F02-3** No task names LINE-01-AC12 (LINE display name is not the full name), AUTH-01-AC4 (slot taken before return; needs an F03 task) or AUTH-02-AC9 (pending by design D10; keep tracked with an owner).
- **F02-4** An owner, front desk or coach invited without the Player role has no `player` permission, so `PUT /me/profile` is refused for them, though ROLE-01-AC4 assumes staff can book as players and AUTH-02-AC4 says "role Player". **QUESTION**: does every club person get the Player role? Then name the permission `me.profile`.

## Should fix: F03, F04, F05 (designs and F03 tasks)

F04 and F05 have no `tasks.md`; the plan puts tasks after design approval (D82 approved the designs), so that is not a defect, but the F04 and F05 task lists are the next gate.

- **F05-1** (downgraded from blocking by the Reviewer) `applyPayment` is guarded by `status in ('pending','expired')`, cash replaces a pending Beam payment by setting it `cancelled`, and `cancelled` is final (F05 design lines 136, 157, 205). The design states the intent in line 157 ("a late Beam payment then follows the wallet rule") and line 145, but no code path accepts a success on a `cancelled` payment, so the money would be received and never credited, against PAY-04-AC5 and PAY-03. Fix before F05 tasks: let `applyPayment` accept `cancelled`, routed by order state (paid: `duplicate_payment`; cancelled: `late_payment`), or never set the Beam row `cancelled`. Test: cash confirm, then Beam success on the old QR, wallet credited once with its own receipt.
- **F03-1** `reclaim_order` re-inserts occupancy rows without first releasing overlapping expired holds, which only `reserve_court` does. A late payment can wrongly go to the wallet depending on job lag (D25: an expired hold is not a hold). Fix: run the same release inside `reclaim_order`; test with the job stopped.
- **F03-2** Nothing re-counts the promo code use or birthday entitlement when a late payment reclaims an order whose entitlements were restored at hold end (D66). A capped code can be over-redeemed. F05 line 143 also adds a refusal reason beyond PAY-03-AC1 and D25 ("approve if the slot is still open"). Fix: one `reapply_order_entitlements` in F04 called by `reclaim_order`. **QUESTION** for the user: may a late payment be refused for a reason other than the slot?
- **F03-3** Three staff routes can confirm a booking (F03 `POST /staff/bookings` with `confirm_now`, F04 staff quote and pay, F05 cash). The F03 route has no price, order lines, payment row or receipt (PAY-06-AC3, CC-2). Fix: delete `confirm_now` or make it a wrapper over F04's staff pay.
- **F03-4** The design answers an open question: `booking.limit.override` for "front desk and owner" (BOOK-05-AC9 says "Which roles may override is Q1", D49 says "staff"). A-8 (coach request refused until F07) is a behaviour rule not in any requirement. Fix: parameterise and keep Q1 open.
- **F03-5** A new Go live gate `pay_tap_limit_set` is invented (design A-11, F03-T12). D61 says only that the limit exists as a platform setting. Counting a staff tap against the staff member is also unstated. Fix: remove from T12 or ask the user.
- **F03-6** A-6 (a player leaving C11 releases the hold) is in no requirement; the QR stays payable and a late payment may then book the slot the player gave up. F05's refusal path releases the hold with a reason not in F03's enum and would trigger a "Booking released" message to a player who only saw "try again". F05 registers no release handler to mark the payment expired. Fix: take A-6 to the user or drop it; add a silent release reason; register the F05 handler.
- **F03-7** F03 tasks: WAIT-01-AC1, AC2 in no task; BOOK-05-AC9, BOOK-01-AC8 and several BOOK-03 ACs unnamed; T18 lists itself as a dependency; T21 cites "ROLE-AC4"; T20 says seven states, design says six; F04 follow-up `court_hour_priced` (R1-AC5) is not in T20; T24, T27, T28 look over a day. Fix: add the IDs and a WAIT-01 task, correct the typos, split T24 and T28.
- **F03-8** A-10 counts the running hour toward the future-hours limit and requires all hours of a selection on one Bangkok date; neither is in D41 or BOOK-01. A club open past midnight could not book 23:00 to 01:00. **QUESTION** for the user.
- **F04-1** F04 A-4 rejects peak and off-peak rule sets, while the approved R1-AC4 names them as price inputs and "peak" is undefined. **QUESTION** for the user: how is peak defined? Until answered keep the columns and do not reject.
- **F04-2** Minimum spend (A-3) uses the total before any discount, while the design's `total_satang` is after discounts and D68 says "order total". Also A-1 (first time only = no confirmed or late-cancelled booking vs "paid booking"), A-2 (tie goes to the code), stacking computed after the birthday discount, are unstated by the decisions. **QUESTION** for the user.
- **F04-3** The design reads D67 "that hour's share restored" as "the money parts of that hour, net of discount, return" and restores the code use when "the last live line" is cancelled, while D67 says "every hour". Mixed cancel (one hour 12h+, one forfeited) is undefined. **QUESTION** for the user.
- **F04-4** F04 creates the order after `reserve_court`; F03's booking needs the order first and `reserve_court` also inserts an `orders` row. Fix: F04 inserts the full order and passes its id; `reserve_court` never inserts an order.
- **F04-5** Add-on lines have `booking_id null`, so F09 cannot return them with a cancelled booking (R3-AC6, D21); in a multi-hour order the owning hour is undefined. **QUESTION** for the user: first hour, split or per hour? No test covers R3-AC6.
- **F04-6** A second Pay tap matches "the identical selection (court, hours, coach)" and skips the quote hash, so a changed add-on, code or bundle silently returns the old order and old amounts (D47 versus D63). Fix: define "same intent" as the same quote hash.
- **F04-7** The quote hash includes credits and wallet, so a wallet or credit change returns `price_changed` with no price change; hashed fields are not listed. Fix: list them; **QUESTION** whether such a change forces re-confirm (D63 speaks only of price).
- **F04-8** Add a coach after booking creates a second order on one booking (a second receipt, unstated); F03 offers F07 no `add_coach_to_booking` function, so the coach has no uniqueness protection. **QUESTION** for the user: coaching top-up its own order and receipt?
- **F05-2** The signed callback body amount is never compared, only the follow-up lookup amount, against PAY-02-AC6; a lookup 404 is not mapped to "unknown charge" (D71). Fix: compare both; any disagreement is `mismatch`.
- **F05-3** The event row is de-duplicated before the lookup; if the lookup fails (500) Beam's retry looks like a duplicate and is dropped with 200. Fix: write the event row in the same transaction as the outcome; roll back on lookup failure.
- **F05-4** The design builds an own receipt for `duplicate_payment`; PAY-02-AC17 leaves it as Q1 and D37 and D79 cover only late and wrong-amount payments. **QUESTION** for the user (F05 Q1).
- **F05-5** Nothing says what happens when the D80 QR margin is unset or larger than the hold. Fix: Pay refuses with `payment_unavailable` and a P1 alert while it is unset; validate margin < hold. Same for the reconcile window and the pay tap limit.
- **F05-6** The design puts a Paused club on live keys; requirements say nothing about Paused, so a Testing club that was paused would use live keys with test data. **QUESTION**: pause only a Live club, or keep the previous set.

## Should fix: F06, F10, F11, F12, QA, DevOps, i18n

- **QA-2** `docs/qa/open-questions.md` header says "Updated after D18 to D31"; about 15 questions are answered but shown open (Q-01 D47, Q-03 D39, Q-04 D42, Q-05 D49 and D59, Q-06 D44, Q-12 D78, Q-16 D48, Q-21 D74, Q-22 D56, Q-25 D64, D37, D79, Q-27 D45, G-02 D53, G-03 D31, Q-31 D80 and D73). Fix: move to Answered with the D number.
- **QA-4** The Beam oracle lacks D71 to D79: unknown charge, failed charge then second tap (D72), status check (D73), wrong amount player and owner outcomes (D75, D77), `wrong_amount` credit and its receipt (D79), `duplicate_payment`, package QR late payment (D74). **QUESTION**: is the wrong-amount player notice in the app only or also a LINE message (D77 versus LINE-05-AC13)?
- **QA-5** CONC-07 allows "a clean conflict" (D47: same hold and QR) and CONC-13 allows "P1 wins" over a closure on a held slot (D48: hold cancelled). Tighten to the decided outcome.
- **QA-6** F02 skeleton LINE-01-AC6 still describes the friend checkbox that D38 removed. A test written from it would assert a UI that must not exist.
- **QA-7** Ten F01 skeletons carry pre-approval AC text (PLAT-02-AC7, AC8, PLAT-03-AC4, AC7, PLAT-04-AC6, PLAT-06-AC13, PLAT-07-AC7, AC9, PDPA-01-AC9, AC10), against the file's claim "Criteria text is the spec's". Regenerate from the approved files.
- **QA-8** `test-strategy.md` line 217 plans "fake Beam payments" in the production test window; D26 allows Beam sandbox only there. Split sandbox cases (production) from fake-driven cases (staging).
- **F10-1** LINE-03-AC9, LINE-05-AC14 and LINE-06-AC4 say the owner is told when the LINE token fails, citing D75, which covers Beam alerts only; the message would go through the failed OA. **QUESTION** for the user: is the owner told, and by which channel? Until then keep LINE-06-AC4 to the P1 alert.
- **F10-2** LINE-02-AC10 has the owner edit tile labels after Go live, but A0 (ADMIN-02) shows only until Live and ADMIN-16 has no labels. Only three label keys exist and D54 needs six (new keys, listed for the writers). **QUESTION**: where are labels edited after Live?
- **F10-3** The 70 percent cap banner in the club admin (LINE-07-AC1, PRD line 428) is not owned by ADMIN-01 (lists only the Paused banner). Fix: add it to ADMIN-01.
- **F10-6** The specs name variables that do not exist in the locale files (`{club}`, `{coach}`, `{receipt}`, `{minutes}`, `{credits}`, `{days}` versus `{clubName}`, `{coachName}`, `{receiptNumber}`, `{claimMinutes}`). Fix: point the spec at `locales/README.md` names; do not rename the writers' variables.
- **F06-1** PKG-03-AC7 moves only package expiry on a pause; PRD and PLAT-03 say package and wallet expiry. Extend to the wallet expiry setting when set.
- **F06-2** No AC for a package paid after its order was cancelled (D74: `late_payment` wallet row and its own receipt) in F06 R3. Add it.
- **F06-4** F06 CC-5 and F10 CC-5 say reminder days and hours are variables; the i18n role kept 14 and 3 days and 24 h and 2 h as typed numbers ("fixed in the PRD"). Decide once and align. **QUESTION** for the Orchestrator.
- **OPS-2** `accounts.md` needs Hunter's real OA and LIFF on 21 Dec, but D32 sends the 7 Dec test through the real OA and the free plan stops at 300 messages. Move the dates before 4 Dec.
- **OPS-3** `plan.md` section 1 says the 7 Dec test is on staging with fake slips; D16 says production with Hunter in Testing, and Hunter has no slips (F16). Section 2 of the same file is right.
- **OPS-4** Ops alerts at 80 and 95 percent and calls the cap behaviour undecided; LINE-07 and D17 decided 70 and 80 percent. Align.
- **OPS-5** `accounts.md` row 16 lists the Thai lawyer for the user, who deferred it (D5 update: do not raise it). Keep only the record in `plan.md`.
- **OPS-6** `secrets.md` leaves the encryption method open; D34 decides an app-level extra layer.
- **OPS-8** CI runs `locale:audit` and `text:check`, while the i18n tools document `i18n:audit` and `i18n:lint`. With `CI_STRICT` off a missing script is a notice, so the hard-coded text lint is skipped silently. `check-wording.mjs` (TEXT-04) runs nowhere. Fix: one script contract, run `check-wording` against the base branch, turn strict on when F01 lands.
- **I18N-1** `decisions.mjs` and `writer-questions.md` still list the three-versus-six rich menu labels as open (D54 decided six). Remove the question; add the three missing keys in both files, listed for the writers.

## Reviewer's own findings

- **M-1 | should fix | Source documents contradict each other.** (a) PRD Option A line 648 still says "Refunds go back by PromptPay" (canvas gap A3, against CANCEL-02 and PAY-05); the PRD change log row "Decisions 30 Oct (4)" still says the Beam QR expires with the hold (D80 refines it); an older change log row says A3 Check-in is "an optional arrivals list" (later rows remove A3). (b) `docs/decisions.md` round 5 still shows an "Open" row on the late-payment wallet receipt that D37 closed; D17 still says "Confirm if package-expiring should be dropped" though D29 settled it; D18 is not annotated as refined by D80. (c) `docs/DEVELOPMENT-PLAN.md` section 4 and `docs/canvas-gaps.md` C4 and C5 still list as open the rich menu labels, the A0 address toggle and "owed to customers" that D54 and D57 settled. Fix (Orchestrator, PRD first): amend each line; a reader following the PRD alone would build a cash refund path.
- **M-2 | should fix | `locales/pending/` conflicts with CLAUDE.md.** D81 approved `locales/pending/<feature>.json` for new keys, but `CLAUDE.md` still says to add the new key to both locale files and list it in the task, and the lint, copy index and `check-wording` read only `locales/*.json`. Until CLAUDE.md and the i18n tools say the same, a feature PR that does either is correct by one source and wrong by the other. Fix: Orchestrator updates `CLAUDE.md`; Content makes the tools read the pending folder.
- **M-3 | should fix | Hunter numbers typed into task tests.** F01-T24's test says "court 50000 satang" for the Tennis template. ฿500 is in the PRD and the template may carry it, but D8 lists the template defaults without the price. The test should read the value from the template file, not the literal.
- **M-4 | should fix | Task sizes are declared, not measured.** About 15 tasks labelled M bundle separable work (F01-12, F03-7). The Reviewer will block any PR that visibly covers more than one task.
- **M-5 | note | Role names.** Task lists and the approved build plan use BE-B, BE-C, FE-A, FE-D; `DEVELOPMENT-PLAN.md` section 3 uses numbered roles. `docs/review/lanes.md` maps them.

## Notes

Condensed; each is minor and the fix is a one-line edit by the owner.

| Id | Note |
|---|---|
| F01-22 | FA says the club is never read from the URL, then uses the slug for guests. State once: public routes use the slug, signed-in routes the session club, mismatch is 404. |
| F02-5 | The friend flag is a client claim (`POST /me/line-friend`) against CC-2; never skip a push because of it. |
| F02-6 | `active` (and `display_name`, `line_friend`) is added in both F01 and F02 migrations. |
| F02-7 | Typed error codes have no HTTP status table (REQ2 check says 401; designs say a code, or 404 for role refusals). |
| F02-8 | PLAT-04-AC1 says every audit entry holds a reason; the design leaves `reason` nullable. |
| F03-9 | Exclusion constraints key on resource and coach, not `club_id` (works through the composite FK; add `club_id with =`). |
| F03-10 | F03 design status lines and migration range (0201 to 0206 vs seven files) are stale. |
| F03-11 | A late payment in a Paused club re-creates a confirmed booking; PAY-02-AC12 depends on open F01 Q12. Until answered send it to the wallet (QUESTION). |
| F04-9 | Largest-remainder split of a fixed discount and per-line rounding are not named in the spec. |
| F04-10 | The `payment` row insert sits between F04's Pay transaction and F05's `startPayment`; a hold with no charge needs a defined second-tap path. |
| F05-7 | Add the outbox row and the receipt number on the LINE card to the PAY-07 test line. |
| QA-9 | Traceability PKG-01 row omits the `import` reason. |
| QA-10 | PRD "Refunds go back by PromptPay" still waits for a PRD edit (see M-1). |
| F10-4 | LINE-05-AC15 states as a rule what Q6 says is silent; do not let a test treat it as decided. |
| F10-5 | LINE-07-AC3 lists nine messages that still send at 80 percent; the hand-off says every other message. Add that sentence. |
| F06-3 | PKG-01-AC7 sentence about an `adjust` exception is untestable; reword (D83 now settles the negative balance case). |
| F11-1 | F11 says "one question remains" and lists two. |
| F11-2 | May the Accountant press Mark paid in ADMIN-14? QUESTION. |
| F11-3 | ADMIN-03 and ADMIN-11 state Hunter's courts and prices as if platform rules. |
| F12-1 | F12 "Proposed IDs" heading on an approved file; CPORT-07 needs the language field (D95). |
| OPS-7 | Runbook baseline for bad signatures hides alerts D75 wants each time; the 20 minute no-callback alert is an ops default, not a rule. |
| OPS-9 | Duplicate "4 Dec" rows; production restore drill dated before real data. |
| I18N-2 | "7th hour" is typed in K-0069 and A-0346 while the rest cap is a setting (default 6). Leave open for the writers. |

## Questions that need a decision (not the Reviewer's to settle)

| # | Question | Finding |
|---|---|---|
| 1 | Which `app_user` rows does the Go live purge remove (FA Q29)? | F01-1 |
| 2 | How do a returning owner and tester sign in to a Draft or Testing club? | F01-3 |
| 3 | May `anonymise_user` rewrite audit rows, or is another way used? | F01-6 |
| 4 | Imported player matching on an unverified phone: who confirms, what happens when nothing matches? | F01-21 |
| 5 | Receipt numbers: one continuous series per club or a yearly reset? | F01-18 |
| 6 | Which owner actions work while a club is Paused (move, add coach, cancel, no show)? And may a late payment confirm a booking in a Paused club? | F01-17, F03-11 |
| 7 | Which Go live checks beyond P4 does the user approve (owner signed in, one test booking, pay tap limit set)? | F01-14, F03-5 |
| 8 | May a late payment be refused for a reason other than the slot being taken? | F03-2 |
| 9 | Who may override the future-hours limit? Are the running hour and same-date rules wanted? | F03-4, F03-8 |
| 10 | How is "peak" priced? What does minimum spend measure? What does "that hour's share restored" mean in money, and what happens on a mixed cancel? Which hour owns an add-on? Is a coaching top-up its own order and receipt? | F04-1, F04-2, F04-3, F04-5, F04-8 |
| 11 | Does `duplicate_payment` get its own receipt (F05 Q1)? Is the wrong-amount player notice in app only or also LINE? | F05-4, QA-4 |
| 12 | Which keys does a paused club use? | F05-6 |
| 13 | Is the owner told when the LINE token fails, and by what channel? Where are rich menu labels edited after Live? | F10-1, F10-2 |
| 14 | Does every club person get the Player role? Does the accountant or front desk read settings? May the Accountant mark a payout paid? | F02-4, F01-16, F11-2 |
| 15 | Are 14 and 3 day and 24 h and 2 h reminder numbers fixed constants typed in the writers' text, or variables? | F06-4 |
| 16 | Can the PRD, decisions log and plan lines in M-1 be amended? | M-1 |

## Checked and consistent

F11 page IDs ADMIN-01 to 17 match D53 and the hand-off table one for one, with A3, A11 and A15 absent. F06 ledger reasons match the hand-off and D78; the F06 expiry rule matches D20, order of use D22, "value owed" D57, append-only D28. F10 LINE-07 matches PRD and D17 and D29. `en.json` and `th.json`: no variable mismatch, no X key in Thai, no changed wording of an existing key against the base. The no-double-booking design holds: one `occupancy` row per hour with two exclusion constraints, a solo class claims court and coach in one row or not at all; integer satang, half-up rounding, Bangkok dates and club ID scope are consistent across F03, F04 and F05. F05 applies D71 to D80; F04 applies D62 to D70.
