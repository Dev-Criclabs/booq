# F13 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F13-receipts-reports/requirements.md`. T04 and T10 are not built yet and are left out. The receipt tables, the numbering, the void, the PDF, the receipt routes, the daily close and reports A and B exist.

**Result: 68 criteria. 41 were already cited, 16 newly traced to lane tests, 1 new QA test, 8 still open (reasons below). No new finding.**

The lane's tests are strong: gapless numbering (rollback, 20 at once, Bangkok year, Testing series T, Go live restart), idempotent issue, a snapshot that later edits never change, void rules, close immutability, and the day boundary at 23:59 and 00:00.

Newly traced: RCPT-01-AC7, AC8, AC10, AC13; RCPT-02-AC1, AC3, AC4, AC5, AC9, AC10 (L-0061 from its key), AC12, AC13, AC14; RCPT-03-AC2, AC10; R2-AC10 (accountant sees names only).
New QA test: RCPT-02-AC7 (the balls add-on text in both languages, from the language files).

Re-traced after F13-T14 reached main (31 Oct): RCPT-03-AC7 (the close is exported as CSV and audited) and R2-AC9 (the report CSV has the same rows as the screen and is audited), both in `apps/web/src/api/reports/routes.test.ts`.

Still open:

| Criterion | Why it is open |
|---|---|
| RCPT-01-AC16 | No credit note or receipt when value goes to the wallet on a cancel: no lane test names it. Needs a QA test once the F09 cancel path is wired to the receipt port. |
| RCPT-01-AC17, R3-AC10 | Rule for test authors (do not copy canvas samples). Nothing to run; the lane tests use their own data. |
| RCPT-02-AC2 | Hunter's real legal name, tax ID and branch: club data entered at P2/P4. Check on the go live smoke list. |
| RCPT-02-AC6 | Solo class receipt with coach and court on separate lines: no receipt test builds a solo class order. |
| R2-AC12 | A check per report formula: the formulas are still a proposal awaiting approval. |
| R3-AC8, R3-AC9 | Payout read and export, no mark paid; coach sees only their own earnings (K6): the payouts and K6 routes are not built (only the `coach_pay` table is). |

## F13-T20 and T21, 31 Oct (main 43b77b0)

**T20 cross cutting suite:** `tests/acceptance/F13-cross-cutting.new.spec.ts`, 9 tests, reading the schema of a migrated database so a new table or function is seen at once. Money documents (13 tables: receipt, receipt_void, receipt_print, payment, payment_event, both ledgers, order_line, daily_close, coach payout and its adjustments, booking_cancel, package_extension) each have an enabled before row trigger against update and delete and one against truncate. Every table that holds an amount is a money document or is on a short list of settings, so a new money table must be classified on purpose. No cash refund: a payment is Beam or cash with no refunded status or refund column; a receipt is a sale or a wallet credit, no credit note (D119); no function pays, refunds or withdraws money to a person (only coach payout functions, on the owner's mark); the wallet ledger has no withdraw reason (`refund` is value credited to the wallet). Test series: receipt series and counters are per club and year, T apart from the real one; every money table has `is_test`. Mutation checked: removing the update or truncate guard on `receipt`, adding a credit note kind, or adding a refunded status each turns it red. Proved by behaviour in the lanes' tests and traced: receipts never change (`receipt-tables.test.ts`), a missing receipt port undoes the cash taking and the payment (`take-cash.test.ts`, `apply-payment.test.ts`), the first real receipt after Go live is 000001 (`issue-receipt.test.ts`).

**T21 sweep:** 68 criteria. 12 more traced by title (R1-AC1, AC2, AC5; R2-AC1, AC9; R3-AC1 to AC7), which ID matching missed because R1 to R3 repeat in F04, F06 and F07. Open (reasons): RCPT-01-AC16 (no credit note or receipt when value goes to the wallet on a cancel: the schema check shows no credit note kind exists, but no test cancels and counts receipts), RCPT-02-AC2 (Hunter's real legal data is club data entered at Go live), RCPT-02-AC6 (a solo class receipt with separate coach and court lines), R1-AC3 and R1-AC4 (receipt list CSV, test receipts out of the live list), R2-AC7 (new against returning customers), R2-AC12 (formulas awaiting approval), and the two rules for test authors (RCPT-01-AC17, R3-AC10). The F13 canvas boards (A13, A14, K6, R-Receipt-TH and EN) are not in the repo (G-04), so they could not be walked.
