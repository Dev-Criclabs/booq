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
