# F13 Receipts, reports and daily close · Design

Status: **Approved 30 Oct 2026 (gate 2, D153).** Drafted 30 Oct 2026 from the approved F13 requirements (`requirements.md`, approved 30 Oct 2026, decisions D106, D112, D119 applied; Q4 VAT layout and Q12 retention are parked). The Architect's review findings of 30 Oct 2026 are folded in. A change to anything below goes through the PRD, then the hand-off, then this file. Tasks (gate 3) follow approval.

Feature: F13 Receipts, reports and daily close. Requirement IDs: RCPT-01, RCPT-02, RCPT-03 and the local rules R1 to R5 of the requirements. Depends on F05. Wave 3.

Shared decisions are in `docs/architecture/foundation.md`, cited as **FA §n**; F01 to F06 designs as **F01 §n** and so on. FA §2.4 already fixes the gap free counter, the per year series, void, the `wallet_credit` order and the rule that money is totalled from `payment`. `docs/architecture/apply-payment.md` fixes the port `issue_receipt` that this feature must register. This file adds the receipt record, the issue function, the PDF, the daily close, the reports and the coach payouts.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| RCPT-01 (numbering, void, reprint, test series) | §3.1, §3.2; §4.1 `issue_receipt`; §4.3 void; §4.4 reprint |
| RCPT-02 (content, PDF, language, VAT flag, player list) | §3.1 snapshot; §4.5 PDF; §5 routes |
| RCPT-03 (daily close) | §3.3; §4.6 |
| R1 (A14 list, search, export) | §5 routes |
| R2, R5 (reports and proposed formulas) | §4.7 |
| R3 (coach payouts) | §3.4; §4.8 |
| R4 (events that issue a receipt) | §4.1 callers |
| CC-1 to CC-6 | §10 |

## 2. What this design does not build

Taking payment (F05), the order and price (F04), the ledgers (F06), cancellation (F09), the A13 and A14 pages as screens (F11, which calls the routes here), the VAT invoice layout (parked, Q4), retention periods (parked, Q12). A refund of value to the wallet issues no receipt (D119).

## 3. Data and migrations

F13 uses the number block 0701 to 0799 (assumption A-1; the build plan names blocks only up to F06 and F10 took 0601 to 0699 in its draft).

| File | Contents |
|---|---|
| `0701_receipt.sql` | `receipt`, `receipt_counter` (FA §2.4), `receipt_void`; append-only triggers; unique indexes |
| `0702_issue_receipt.sql` | `app.issue_receipt` and its helpers; test series handling |
| `0703_payment_port.sql` | Registers the F13 port in `app.payment_ports` (§4.1) |
| `0704_void_receipt.sql` | `app.void_receipt` (§4.3) |
| `0705_daily_close.sql` | `daily_close` and `app.run_daily_close` |
| `0706_coach_payout.sql` | `coach_payout`, `coach_payout_adjustment` and the payout functions |
| `0707_report_views_a.sql` | Report views: cash by type, package sales, online against staff, no show rate, new against returning |
| `0708_report_views_b.sql` | Report views: revenue earned, value owed, occupancy, partner report |
| `0709_grants_policies.sql` | Policies and grants; the accountant column limits (D35). No new settings rows: `receipt_prefix` is `club.receipt_prefix` from P2 step 1 and `vat_enabled` is F01; a CHECK that Go live needs the prefix (D106) is F01's checklist item |

### 3.1 `receipt` (class D)

`club_id`, `id`, `order_id`, `payment_id` null (null for an order paid with no money, D64), `kind` (`sale`, `wallet_credit`), `series` text (Bangkok year of issue as `2026`; the test series is `T2026`), `seq_no integer`, `number text` (`{prefix}-{year}-{000001}`; test numbers carry the prefix `TEST`, assumption A-2), `status` (`issued`, `void`), `issued_at timestamptz`, `vat_flag boolean` (the club's switch at issue time), `customer_id`, `customer_name_snapshot text` (the name at issue time; the Accountant sees it, D35), `lines jsonb` (the snapshot: items, add-ons, discounts, methods and amounts in satang, built from the order lines and payments at issue time so later edits never change a receipt), `total_satang`, `is_test`, `created_at`. `unique (club_id, number)`; `unique (club_id, series, seq_no)`; `unique (club_id, order_id, kind)` for `sale` (one receipt per order, D40) and `unique (club_id, payment_id)` for `wallet_credit` (one per payment).

`receipt_void` (append-only): `club_id`, `id`, `receipt_id`, `reason`, `voided_by`, `voided_at`. A void sets `receipt.status = void` through the function only; the number, the lines and the total never change (D106; a void only marks the receipt, nothing else changes).

`receipt_counter` as FA §2.4: `(club_id, series, last_no)`.

Receipts and voids are append-only: `revoke update, delete, truncate` from application roles except the status change made by `app.void_receipt` (a definer function; a trigger rejects any other change); FORCE RLS; a CI test as FA §2.3.

### 3.2 Series and the test series (D4, D33, D106)

A real receipt takes `series = Bangkok year of issue` from `app.now()` (FA §7), restarting each Bangkok year; the prefix is `club.receipt_prefix`. A club in Testing issues into the series `T{year}` with `is_test` true, a number format that is plainly not a legal receipt, and marked as a test on screen and in the PDF; these rows are removed by the Go live purge (F01 §3) and the real counter is untouched, so the first real receipt is 000001 of its year (RCPT-01-AC1, AC15).

### 3.3 `daily_close` (class D)

`club_id`, `day date` (Bangkok), `run_by`, `run_at`, `totals jsonb` (money by method, the non money lines for credit use and wallet use, counts, voids made that day), `receipt_count`. `unique (club_id, day)`; append-only; **a closed day is not reopened** (D119), so there is at most one row per day and it is immutable.

### 3.4 Coach payouts (class D, owner only)

`coach_payout`: `club_id`, `id`, `coach_id`, `month date`, `sessions_delivered`, `amount_satang` null (null when a pay setting is unset, flagged), `status` (`open`, `paid`), `paid_by`, `paid_at`. `unique (club_id, coach_id, month)`. `coach_payout_adjustment` (append-only): `club_id`, `id`, `payout_id`, `delta_satang`, `reason`, `staff_id`, `created_at` (reason required). The pay model fields (monthly base, per session solo and group, fixed or percentage of the coaching portion) are on the coach (F07, F12); they are empty settings until the owner sets them.

## 4. Functions and queries

### 4.1 `issue_receipt` and its port

`app.issue_receipt(p_order uuid, p_payment uuid, p_kind text) returns uuid` is registered in `app.payment_ports` as `issue_receipt` by migration `0703_payment_port.sql` (contract: `docs/architecture/apply-payment.md`; an unregistered port rolls the payment back). It runs `SECURITY DEFINER`, takes the club from `app.club_id()`, is executable by `booq_worker` (the payment path) and `booq_app` for the staff cash path (F05 PAY-06).

- `p_kind` is `order` (stored as receipt `kind sale`) or `wallet_credit`. For `wallet_credit` the order is the order of kind `wallet_credit` F06's port created (its id is `wallet_ledger.order_id`), the payment is the Beam payment, the receipt states the money received and credited to the wallet (RCPT-02-AC11).
- **In one transaction**, with the counter lock taken **last** in the lock order of FA §3.4: build the snapshot from the order, its lines and payments; take the series (real or test, §3.2); `insert into receipt_counter ... on conflict (club_id, series) do update set last_no = receipt_counter.last_no + 1 returning last_no`; insert the receipt. A rollback undoes both, so a failed confirmation leaves no gap and a confirmed one always has its number (RCPT-01-AC2, AC3).
- **Idempotent:** if the unique key already holds a receipt for the order (or the payment for a wallet credit), return its id and write nothing; a repeated callback changes nothing.
- **Callers (the events of R4):** `apply_payment` after `applied` and `applied_late` (kind `order`), after a wallet outcome (kind `wallet_credit`, D37, D74, D79, D112), and after a staff wrong amount credit; F04's zero money confirm (D64, no payment id); F05's cash route; `grant_package` orders as part of the same paid order. A refund to the wallet on a cancel or closure calls nothing (D119).
- **Refusals:** an order of another club, an order with no confirmed payment and not zero money, or a missing `club.receipt_prefix` **for the real series** raises (`receipt:prefix_missing`), which rolls the payment back rather than issue a number with no prefix. The test series (a club in Testing) uses the `TEST` prefix and needs no club prefix, so a Testing club without one never fails here (Architect review of 30 Oct); Go live is blocked on the prefix so the raise does not occur in Live (D106).

### 4.2 Money by method (FA §2.4)

Money received by method is totalled from `payment` (status `succeeded`, method `beam` or `cash`, `is_test` false), **never by adding up receipts**, because a later booking paid from a wallet balance is itself a receipted order and adding both would count the money twice. Receipts carry the methods for display; reports and the close read `payment` and the ledgers.

### 4.3 Void (RCPT-01-AC9, AC10, AC13)

`app.void_receipt(p_receipt uuid, p_reason text)`: owner only (`receipt.void`), reason required and not blank, receipt `issued`; inserts `receipt_void` and sets `status void`; audited (PLAT-04). It touches no booking, credit or wallet row. Front desk, Accountant, coach and player cannot call it (the function checks the role; the route checks it too).

### 4.4 Reprint (RCPT-01-AC11, RCPT-02-AC8)

A reprint renders the same snapshot with a Copy mark and the original number and date; it writes nothing. A player's download uses the player's language; staff may choose Thai or English (D119).

### 4.5 PDF (RCPT-02)

Generated on demand from the stored snapshot by `renderReceipt(receipt, language, copy: boolean) -> pdf` in `packages/receipts`, A4. All text comes from `locales/*` by key with the named variables of `locales/README.md` (`{receiptNumber}`, `{date}`, `{amount}`, `{clubName}` and so on); there is no text in the template, and the PDF and the LINE card share keys (CLAUDE.md). The legal name, tax ID, branch and registered address come from the club record, not from keys; the legal name stays Thai on both PDFs with no English name (HO); dates use the international year in both languages; the balls add-on name comes from the add-on's own Thai and English fields. A test receipt carries the test mark. The VAT layout is parked (Q4): when `vat_flag` is true the PDF follows a layout the accountant supplies, and until then the non VAT layout is the only one built (assumption A-3). The PDF is not stored; the same snapshot always renders the same document, so nothing is lost if a file is not kept (retention is parked, Q12).

### 4.6 Daily close (RCPT-03)

`app.run_daily_close(p_day date)` (owner, accountant): refuses a day that is today or later (a day closes after it ends in Bangkok time) and a day already closed; computes, for payments whose `confirmed_at` falls in the Bangkok day, the money by method, the non money lines (credit use from `credit_ledger` `use` rows priced per credit, wallet use from `spend` rows), the late and wrong amount wallet credits listed as credited to the wallet (D37, D79), the voids made that day shown as void and not counted (a void made on a later day shows on the day it is made, D119), and the counts; excludes test rows (D33); inserts the `daily_close` row; audited. A payment reported after a close belongs to the day it is made and appears in that later day's close (RCPT-03-AC9). Preview of an open day is a read only query that writes nothing.

### 4.7 Reports (R2, R5; formulas are proposals until the user approves, D119 fixes two)

Each report is a SQL view or a function `app.report_*(from date, to date)` over `payment`, `receipt`, `booking`, `occupancy`, `credit_ledger`, `wallet_ledger`, `promo_redemption`, always filtered by `club_id`, `is_test = false` and excluding voided receipts. Dates are Bangkok dates. The Accountant reads the views that expose the customer name and not the phone or date of birth (D35): the views simply do not select those columns.

| Report | Query basis (R5 of the requirements) |
|---|---|
| Cash received by type | `payment` money by method in the range |
| Package sales | `payment` for package orders |
| Revenue earned (D119) | credits used in the range (`credit_ledger` `use` rows) at the package's price per credit, plus single sales (court hour, solo, group single) |
| Value owed (D57) | unused package credit at price per credit plus `wallet_balance`, two separate lines, at the end of the range; imported value for unclaimed players on its own line (F06 A-10) |
| Occupancy (D119) | booked hours over bookable hours (open hours less `closure` occupancy) per court by weekday and hour; held hours not counted |
| Online against staff | `booking.source` counts |
| No show rate | no show over played plus no show |
| New against returning | first paid booking date of each customer in the range |
| Partner report | `promo_redemption` by partner: redemptions (restored uses not counted, D70), revenue, new customers, repeat within 30 and 60 days |
| Coach payouts | §4.8 |

Every report has a CSV export route that runs the same query, audited as an export (F01 PLAT-06-AC15). Test mode records are excluded everywhere (D33).

### 4.8 Coach payouts (R3)

`app.compute_payout(p_coach uuid, p_month date)` (owner, accountant read): counts sessions delivered in the month, where a session counts when the customer attended or was a no show and a session cancelled within policy does not count (PRD); the amount owed is the owner's pay settings applied to the delivered sessions, with a percentage applying to the coaching portion only (F04 line split); an unset pay setting makes `amount_satang` null and flags the row, never a guess. A substitute session pays the coach who delivered it (F07). `app.add_payout_adjustment` (owner; reason required; append-only). `app.mark_payout_paid(p_payout)` (owner only, D115; the Accountant reads and exports and cannot): sets `paid`, records who and when, and is audited; a correction is an adjustment in the next period.

## 5. API routes

Conventions as FA §9: typed codes, no text, 404 for out of reach; amounts in satang.

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /api/c/{slug}/me/receipts` | own | The player's receipts, newest first (C17) |
| `GET /api/c/{slug}/me/receipts/{id}/pdf?lang=` | own | PDF in the player's language, marked Copy when not the first view |
| `GET /api/c/{slug}/staff/receipts?q=&from=&to=` | owner, accountant | A14 list and search by number, name, date |
| `GET /api/c/{slug}/staff/receipts/{id}/pdf?lang=th\|en` | owner, accountant, front desk (own customer's via A6) | Staff reprint in either language |
| `POST /api/c/{slug}/staff/receipts/{id}/void` | `receipt.void` (owner) | §4.3 |
| `POST /api/c/{slug}/staff/daily-close`, `GET .../daily-close?day=` | owner, accountant | §4.6 run, read |
| `GET /api/c/{slug}/staff/reports/{name}?from=&to=` and `.csv` | owner, accountant (names, never phone or date of birth) | §4.7 |
| `GET /api/c/{slug}/staff/payouts?month=`, `POST .../adjustments`, `POST .../{id}/paid` | owner (read: accountant) | §4.8 |

Receipts are issued only by the functions above, never by a public route. No route lets a front desk or coach read reports (R2-AC11, R1-AC5).

## 6. State machines

`receipt`: `issued` to `void` (final). `daily_close`: created once per day (immutable). `coach_payout`: `open` to `paid` (final). Counters only move forward.

## 7. Permission checks

| Permission | Player | Coach | Front desk | Accountant | Owner | BOOQ staff |
|---|---|---|---|---|---|---|
| Read own receipts and PDF | yes | yes | yes | yes | yes | no |
| Read any receipt (A14) | no | no | via A6 | yes (name, no phone or DOB) | yes | no |
| Void | no | no | no | no | yes | no |
| Daily close run and read | no | no | no | yes | yes | no |
| Reports and exports | no | no | no | yes (names only) | yes | no |
| Payouts read | no | own only (K6, F12) | no | read and export | yes | no |
| Mark payout paid, add adjustment | no | no | no | no | yes | no |

Every club person also holds the Player role (D115), so a coach or staff member reads their own receipts as a player. BOOQ staff never read receipts, closes, reports or payouts (PLAT-02); the Accountant's views carry no phone or date of birth (D35).

## 8. Concurrency and failure

Twenty parallel confirmations in one club get consecutive numbers (CONC-21): the counter row lock serialises issuance and is taken last; a rollback loses no number; two clubs have independent counters. A repeated callback returns the same receipt by the unique keys. A port failure (prefix missing, order mismatch) raises and rolls the whole payment back; a payment is never confirmed with no receipt. Two voids race: the second finds `void` and refuses.

## 9. Jobs

None. Receipts, closes and payouts are produced by calls; reports are queries. Housekeeping of old rows is parked with retention (Q12).

## 10. How the cross-cutting rules are met

- **Club ID scope (CC-1):** every table has `club_id`, composite foreign keys, policies by `app.club_id()`; each club has its own counter and prefix; another club's record answers 404.
- **Server side (CC-2):** the functions issue, void and close; the client never sends a number or a total; the Accountant and owner rights are checked inside.
- **PDPA (CC-3):** receipts hold the customer's name only; reports show names without phone or date of birth (D35); BOOQ staff see none of it; test rows are flagged and excluded; on a deletion request receipts stay on record and what the name becomes is open with the legal answer (F01 Q22, assumption A-4).
- **No double booking (CC-4):** a receipt, void or close never creates, moves or releases a booking.
- **TEXT (CC-5):** every receipt and A13 and A14 label by key with the variables of `locales/README.md`; new keys in `locales/pending/F13.json` (D81); the PDF and the LINE card share keys.
- **Other (CC-6):** Bangkok time for the series, the issue time and the daily boundary; integer satang; no cash refund (a receipt is never a refund); no default values in code.

## 11. Tests (written first at the build step)

First real receipt after Go live is 000001 of its year and the test series never touches it (RCPT-01-AC1, AC15); 20 parallel confirmations give consecutive numbers and a failed confirmation leaves no gap (AC2, AC3, CONC-21); a two hour order has one receipt (AC4); a zero money order has a receipt with no money line (AC5); a late payment, duplicate payment and wrong amount credit each get their own receipt and exactly one (AC6, D37, D79, D112); void keeps the number, needs the owner and a reason, and changes nothing else (AC9, AC10, AC13); a reprint is marked Copy and renders the same snapshot (AC11, AC12); the year restarts the series at the Bangkok year boundary (AC14, D106); a refund to the wallet issues no receipt (AC16, D119); the daily close counts a payment at 23:59 in its day and one at 00:00 in the next, refuses today, refuses a second close, excludes test rows, and shows a later void on the day it is made (RCPT-03); the Accountant's reports carry no phone or date of birth (D35); coach payouts: an unset pay setting yields null and a flag, only the owner marks paid (R3); money by method is totalled from payments, not receipts (§4.2); the PDF has the Thai legal name on both languages and the registered address, and the app shows no address (RCPT-02-AC1 to AC3).

## 12. Text keys and canvas boards

New keys in `locales/pending/F13.json`: Void, Copy of receipt, Test receipt, the wallet credit receipt wording, receipt lines for credit, wallet and each method, daily close labels and totals, void reason, report titles and labels, payout labels, export confirmation; writers own the wording (D51). Existing L keys first (for example L-0061).

Boards: R-Receipt-TH, R-Receipt-EN, H-A14-Receipts, H-A13-Reports, G-A13b-Coach-payouts, H-C17-Profile-receipts and the T- twins; G-C17-Privacy for what stays on record. The R-Receipt boards are in the canvas backup (`docs/orchestrator/canvas-backup/12ae5a85-7762-44b9-9b19-9df906c1e373/project/R-Receipt-EN.dc.html and R-Receipt-TH.dc.html`); the spec wins over the canvas and the sample data is not copied (`docs/canvas-gaps.md` B5, B9).

## 13. Assumptions to confirm (recommended defaults, D147)

| # | Assumption | Basis |
|---|---|---|
| A-1 | Migration block 0701 to 0799 for F13 | Build plan blocks (F10 0601 to 0699 in its draft) |
| A-2 | Test receipt numbers use the prefix `TEST` in the `T{year}` series and never look like a legal number | D4; format not decided |
| A-3 | Until the VAT layout is supplied (parked) only the non VAT layout is built; `vat_flag` is stored so earlier receipts are not affected when it is turned on | Q4 parked |
| A-4 | The customer name snapshot stays on the receipt after a deletion request until the legal answer says otherwise; the name is replaced by a placeholder only if counsel requires it | F01 Q22, G-C17-Privacy |
| A-5 | `issue_receipt` takes `kind` `order` or `wallet_credit` and stores `sale` or `wallet_credit`; the port's third argument is that kind | `apply-payment.md` |
| A-6 | A daily close is run after the Bangkok day ends and is one row per day | D119 (not reopened) |
| A-7 | The report formulas marked Proposal in the requirements are built as written once approved; until then only the decided rows (D57, D119) are tested | Requirements R5 |

## 14. Open items

The VAT invoice layout and retention periods are parked by the user. The report formulas marked Proposal in R5 of the requirements await approval. None block the build of the receipt, the void, the close and the decided reports.
