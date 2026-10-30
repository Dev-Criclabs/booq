# F13 Receipts, reports and daily close · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 from the F13 design (`design.md`, drafted 30 Oct 2026; the Architect reviews it) and the approved requirements (`requirements.md`). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `RCPT-01 issue receipt number inside the payment transaction`. A merged migration is never edited. New text goes in `locales/pending/F13.json` (D81).

Roles: **BE-C** back end commerce, **FE-P** front end player app, **FE-A** front end admin, **QA**, **Content**.

Depends on: F01 `club.receipt_prefix`, `vat_enabled`, T13 route wrapper, T18 grants and blind suite; F04 orders, lines and the zero money confirm; F05 `app.apply_payment` and `app.payment_ports` (`docs/architecture/apply-payment.md`); F06 `credit_ledger`, `wallet_ledger` and the `credit_wallet` port. Migration numbers 0701 to 0710, one task per file, rising in task order: T01 0701, T02 0702, T04 0703, T05 0704, T07 0705, T08 0706, T09 0707, T10 0709, T11 0710 (0708 is left free; the payout migration takes a late number because it waits on F07 and F12; the design's file table carries the same numbers; there is no settings file because the registry needs no new rows). Not startable until their lists exist: T10, T14 and T18 need the F07 and F12 coach pay fields (F07 and F12 task lists are not written yet). Not built: the VAT invoice layout and retention (parked); report formulas marked Proposal wait for approval (design A-7).

## A. Tables and issue

- [x] **F13-T01** Migration 0701: `receipt`, `receipt_counter`, `receipt_void` with the unique keys of design 3.1, append-only triggers (status change only by `app.void_receipt`), FORCE RLS. IDs: RCPT-01-AC1, AC9, CC-1. Role: BE-C · Deps F01-T12 · Size: M
  Tests first: update and delete fail for every role; `number`, `lines` and `total_satang` never change; a second `sale` receipt for one order is refused; another club's receipt is not reachable.
  Built (BE-P lane C, for BE-W by the orchestrator): migration `0701_receipt.sql` and `registry/f13.ts` (class D). `receipt` is a snapshot with `unique (club_id, number)`, `unique (club_id, series, seq_no)`, one `sale` receipt per order and one `wallet_credit` receipt per payment (partial unique indexes), series `2026` or `T2026` tied to `is_test` by a CHECK, and the wallet-credit kind requiring a payment. `app.receipt_guard()` refuses every update except the void mark: status issued to void, every other column equal, and only when `current_user` is `booq_owner` (the owner of the definer function `app.void_receipt`, F13-T0704 to come); delete and truncate go through `app.refuse_change` (the Go live purge may delete test rows only). `receipt_void` is append-only, one per receipt, reason not blank. `receipt_counter` has no grant for any role: only `app.issue_receipt` (0702, a definer function) writes it. FORCE RLS, a tenant policy, staff roles (owner, front desk, accountant) read the club's receipts, a player reads their own, the worker reads in the club's context; nobody has an insert, update or delete grant and BOOQ staff have nothing. Test rows are registered for the purge: `receipt_void` 257, `receipt` 258, `receipt_counter` 259 (before payment 260 and orders 300); the counter row of the T series is flagged by the status trigger and goes with them, so the real counter is untouched. Not in this task: the accountant's column limits on `customer_name_snapshot` are 0710. Open for the Architect: a receipt holds the customer's name snapshot, and `app.anonymise_user` does not touch receipts; a legal receipt normally must keep it (PDPA delete request vs tax record), which needs a decision before F13-T19.
- [ ] **F13-T02** Migration 0702: `app.issue_receipt(order, payment, kind)` with snapshot, real and test series, counter lock last, idempotent by unique keys. IDs: RCPT-01-AC1 to AC6, AC14, AC15, RCPT-02-AC11, D106, D64. Role: BE-C · Deps T01 · Size: M
  Tests first: first real receipt is 000001 of its Bangkok year and the test series leaves it untouched; a rollback leaves no gap; a repeated call returns the same id; a two hour order has one receipt; a zero money order has a receipt with no money line; a missing prefix raises `receipt:prefix_missing` for the real series only, and a Testing club with no prefix issues a `TEST` receipt without error.
  Orchestrator note (F04-T12d-db, 0319): `app.complete_zero_money_order` keeps the receipt id it got from the issue_receipt port in `orders.zero_money_receipt_id`, because no receipt table existed yet. Once `receipt` exists, keep the issue_receipt port idempotent by (order, kind) and decide whether to drop that column in a later migration.
- [ ] **F13-T03** Concurrency test CONC-21: twenty parallel confirmations in one club get consecutive numbers; two clubs have independent counters. IDs: RCPT-01-AC2, AC3. Role: QA · Deps T02 · Size: S
  Tests first: the test is the task.
- [ ] **F13-T04** Migration 0703: register `issue_receipt` in `app.payment_ports`. F13 edits no other feature's code and no merged migration. Files it may touch: `packages/db/migrations/0703_payment_port.sql` and its test. IDs: RCPT-01-AC6, R4, D37, D74, D79, D112. Role: BE-C · Deps T02, F05-T05a (ports), F06-T09 (`credit_wallet` port) · Size: S
  Tests first: `apply_payment` (F05-T05c) issues exactly one receipt of the right kind for a late payment, a duplicate and a wrong amount credit, and for a wallet credit order through the registry; an unregistered port rolls the payment back; a refund to the wallet issues none (D119).
  Callers that are not through the registry belong to their owners and are asked of the orchestrator, one task each: the zero money confirm in F04-T12d (D64, no payment id) and the cash route in F05-T07 (`app.take_cash`) call `app.issue_receipt` in their own tasks. F13 supplies the function and the test.

## B. Void, reprint, PDF

- [ ] **F13-T05** Migration 0704: `app.void_receipt` (owner only, reason required, audited, touches no booking, credit or wallet). IDs: RCPT-01-AC9, AC10, AC13, PLAT-04. Role: BE-C · Deps T01 · Size: S
  Tests first: front desk, Accountant, coach and player refused; blank reason refused; a second void refuses; no other row changes.
- [ ] **F13-T06** `renderReceipt(receipt, language, copy)` in `packages/receipts`: A4 PDF from the snapshot, all text by key, legal name, tax ID, branch and address from the club record, test mark, Copy mark. IDs: RCPT-01-AC11, AC12, RCPT-02, TEXT-01, TEXT-03. Role: BE-C · Deps T01, T19 (may start with the keys that exist and add the rest in `locales/pending/F13.json`) · Size: M
  Tests first: same snapshot gives the same content in Thai and English; reprint carries the original number and date and a Copy mark; no literal user facing string in the template (lint); dates use the international year; longest Thai line does not clip.
  Orchestrator note (F06-T04, 0505): a `wallet_credit` line stores its text key in `description_key` and the key again in `name_th`/`name_en`; render the line text from `description_key` through the language files (key `L-new.wallet_credit_line`, pending in f06.json), never from the name columns.

## C. Daily close and reports

- [ ] **F13-T07** Migration 0705: `daily_close` and `app.run_daily_close` with preview. IDs: RCPT-03, D33, D119. Role: BE-C · Deps T02, F06 ledgers · Size: M
  Tests first: refuses today and a closed day; a payment at 23:59 counts that day and one at 00:00 the next; test rows excluded; a void made later shows on the day it is made; a late payment appears in the later close; the row is immutable.
- [ ] **F13-T08** Migration 0706: report views for cash by type, package sales, online against staff, no show rate, new against returning. IDs: R2, R5, D33, D35. Role: BE-C · Deps T02 · Size: M
  Tests first: money totalled from `payment`, never from receipts; voided receipts and test rows excluded; the Accountant views carry no phone or date of birth.
- [ ] **F13-T09** Migration 0707: revenue earned, value owed (credit and wallet on separate lines, imported value on its own line), occupancy, partner report. IDs: R5, D57, D70, D119. Role: BE-C · Deps T08, F06 views · Size: M
  Tests first (decided rows only, D147 A-7): value owed lists credit and wallet apart; occupancy ignores held hours and closures; restored promo uses are not counted.
- [ ] **F13-T10** Migration 0709: `coach_payout`, `coach_payout_adjustment`, `app.compute_payout`, `app.add_payout_adjustment`, `app.mark_payout_paid`. IDs: R3, D115. Role: BE-C · Deps T07, F07 and F12 coach pay fields (not startable until those lists exist) · Size: M
  Tests first: an unset pay setting gives null and a flag, never a guess; a cancelled within policy session does not count; a substitute session pays the substitute; only the owner marks paid; adjustments need a reason.
- [ ] **F13-T11** Migration 0710: policies, grants and the Accountant column limits (the registry needs no new rows; `club.receipt_prefix` and `vat_enabled` are F01's). IDs: D35, PLAT-02, CC-1. Role: BE-C · Deps T01 to T10 · Size: S
  Tests first: the blind suite shows BOOQ staff read no receipt, close, report or payout; front desk and coach read no report.

## D. Routes

- [ ] **F13-T12** Player routes: `me/receipts` list and PDF. IDs: RCPT-02-AC8, R1. Role: BE-C · Deps T06 · Size: S
  Tests first: a player reaches only their own; PDF in the player's language; another club answers 404.
- [ ] **F13-T13** Staff routes: receipts list and search, staff PDF in either language, void. IDs: R1, RCPT-01-AC9, RCPT-02-AC8. Role: BE-C · Deps T05, T06 · Size: M
  Tests first: search by number, name and date; front desk reaches only through A6; export audited.
- [ ] **F13-T14** Staff routes: daily close run and read, reports and CSV exports, payouts. IDs: RCPT-03, R2, R3, PLAT-06-AC15. Role: BE-C · Deps T07 to T10 · Size: M
  Tests first: CSV equals the on screen query; each export writes an audit row; the Accountant reads and cannot mark a payout paid.

## E. Screens and text

- [ ] **F13-T15** Player receipts list and download (H-C17-Profile-receipts). IDs: RCPT-02-AC8. Role: FE-P · Deps T12, T19 · Size: S
  Tests first: Playwright downloads a PDF in each language; buttons do not wrap in Thai.
- [ ] **F13-T16** A14 Receipts page (H-A14-Receipts, list, search, void dialog, reprint). IDs: R1, RCPT-01-AC9. Role: FE-A · Deps T13, T19 · Size: M
  Tests first: void needs a reason; only the owner sees Void.
- [ ] **F13-T17** A13 Reports and daily close (H-A13-Reports, daily close). IDs: RCPT-03, R2. Role: FE-A · Deps T14, T19 · Size: M
  Tests first: a closed day cannot be run again; Accountant sees names, no phone.
- [ ] **F13-T18** A13b Coach payouts (G-A13b-Coach-payouts). IDs: R3. Role: FE-A · Deps T14, T19, F12 coach pay fields · Size: S
  Tests first: unset pay shows the flag; adjustments need a reason. (Board gaps B4 apply; sample data not copied.)
- [ ] **F13-T19** Pending keys `locales/pending/F13.json` (Void, Copy, Test receipt, wallet credit wording, receipt lines, daily close, reports, payouts, export), existing L keys reused first. Named variables in both languages; list for the writers. IDs: TEXT-01 to TEXT-06. Role: Content · Deps none · Size: S
  Tests first: key sets and variables match in both languages; no existing key edited.

## F. QA

- [ ] **F13-T20** Cross cutting suite: receipts never change after issue, no cash refund appears anywhere, test series isolation across Go live purge, a port failure rolls back the payment. IDs: RCPT-01, CC-3, CC-6, D33. Role: QA · Deps T04, T07 · Size: M
  Tests first: the list above.
- [ ] **F13-T21** Sweep: every RCPT-01 to RCPT-03 acceptance criterion has a named test; walk the F13 boards; file gaps with the ID. IDs: RCPT-01 to RCPT-03. Role: QA · Deps all · Size: S
  Tests first: a table of criteria to tests with none empty.

Order: T01, T02, T03, T04, T05, T06, then T07, T08, T09, then T10 once F07 and F12 have their coach pay fields, then T11 (the order of the migration numbers), the routes, the screens, then F. About 21 tasks, each under a day. The R-Receipt boards are in the canvas backup (`docs/orchestrator/canvas-backup/12ae5a85-7762-44b9-9b19-9df906c1e373/project/R-Receipt-EN.dc.html` and `R-Receipt-TH.dc.html`); T06 and T16 build from them. The spec wins over the canvas, and the receipt sample data is wrong in places (`docs/canvas-gaps.md` B5 out of date order numbers and a wrong bundle expiry, B9 address placeholder note), so none of it is copied into code or tests.
