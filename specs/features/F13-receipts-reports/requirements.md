# F13 Receipts, reports and daily close · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, round 10 ("approve all"): the F13, F09, F07 and F08 drafts and the answers D118 to D121 were approved by the user. Revision 2 applies D106, D112 and D119. **Parked by the user and left open: Q4 (VAT invoice layout) and Q12 (retention).** The report formulas in R5 are a proposal for the user to approve. Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Feature: F13 Receipts, reports and daily close. Depends on: F05. Requirement IDs: RCPT-01, RCPT-02, RCPT-03, and the report rules the hand-off has no ID for (labelled R1 to R4, local to this file). Wave 3.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Tax and receipts; Payments (Checkout and payment); Coach portal and admin console (A13, A14, Front desk rules: reports); Coach rates and pay; Design and content (address never shown in the app); Data model (Receipt, Order and payment) |
| HO | `specs/product/handoff-v1.2.md` | Payments and receipts (RCPT-01 to RCPT-03, PAY-03, PAY-07); BOOK-06; Roles (Accountant); PLAT-07 |
| Decisions | `docs/decisions.md` | D4, D21, D33, D35, D37, D40, D57, D64, D74, D79, D106, D112, D119; round 1 (receipt address). D81 is the build plan, not a receipt rule: the unbroken series is RCPT-01 |
| Gaps | `docs/canvas-gaps.md` | B5, B9, C2 |
| QA | `docs/qa/traceability.md`, `open-questions.md`, `concurrency-tests.md` (branch `qa/test-strategy`) | RCPT rows; Q-23, Q-24, Q-25, Q-26; CONC-21 |
| Other features | F01, F04, F05, F06, F09, F11, F12 | Test mode, order, Beam, wallet, cancel, A13 and A14 screens, coach pay |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026. The receipts have Thai and English versions (R-Receipt-TH, R-Receipt-EN); other boards have T- twins.

## Scope

In scope: when a receipt is issued and its number (RCPT-01), what it shows and its PDF in Thai and English (RCPT-02), the daily close (RCPT-03), voiding and reprints, the receipt list and download for players (C17) and staff (A14), test receipts, and the reports on A13 with CSV export, including the coach payout report.

Out of scope: taking the payment (F05), the order and its price (F04), wallet and credit ledgers (F06), cancellation decisions (F09), the A13 and A14 screens as pages (F11, which shows what F13 produces), coach pay numbers (an empty setting set by the owner).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin, R- receipt boards. Boards: R-Receipt-TH, R-Receipt-EN, H-A14-Receipts (T-), H-A13-Reports (T-), G-A13b-Coach-payouts (T-), H-C17-Profile-receipts (T-), G-C17-Personal-details, G-C17-Privacy, H-C12-Confirmed, L-Msg-Confirmed, H-A02-Booking-create.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Receipts, their sequence, voids, daily closes and reports carry the club ID and every query filters by it. Each club has its own independent sequence and its own legal details. A request for another club's record answers 404 (D27).

**CC-2 Server side.** The server issues numbers, voids and closes. The client never sends a receipt number or a total. Roles: the Accountant reads and exports and cannot change bookings, prices or balances; only the Owner voids (PRD, HO Roles).

**CC-3 PDPA.** A receipt names the customer, so it is personal data held for the club's accounts. The Accountant sees names on receipts and reports, never phone numbers or dates of birth (D35). A player sees only their own receipts. BOOQ staff never see receipts, reports or daily closes (PLAT-02). The PDF shows the club's registered address; the app never does (round 1). On a deletion request receipts stay on record for the club's accounts and the player is anonymised where the law allows (G-C17-Privacy, F01 PDPA-01-AC4, F01 Q22). Test records are flagged and excluded everywhere (D33).

**CC-4 No double booking.** Not relevant to receipts: issuing, voiding or exporting a receipt never creates, moves or releases a booking. A void never frees a slot by itself.

**CC-5 Language files (TEXT-01 to TEXT-06).** The PDF receipt reads its text from `locales/*` by key (L keys), the same files as the screens and LINE cards (CLAUDE.md); there is no text inside the template. Sample values are named variables with the same names in both files: `{receipt}`, `{date}`, `{customer}`, `{amount}`, `{method}`, `{club}`. The legal name stays Thai on both receipts, with no English name (PRD, HO). Dates use the international year in both languages (29 ธันวาคม 2026, never 2569). Existing wording is not edited; new text gets new keys in both files, proposed by the drafter, owned by the writers (D51). Receipt, payment and privacy text must be final before testing starts on 7 Dec 2026 (HO). The A13 and A14 screens are A keys, Thai and English. Layouts survive the longest string; tables scroll; buttons never wrap.

**CC-6 Other platform rules.** All times Asia/Bangkok, including the day boundary of the daily close. Money is integer satang. Value never goes back as cash. Never invent a rule: the receipt year rule and the VAT layout are questions below.

---

## RCPT-01 Numbering, void and reprint

**Source.** HO RCPT-01. PRD Tax and receipts ("Every payment gets a receipt in an unbroken sequence such as HTC‑2027‑000001... Voiding needs the owner and a reason, numbers are never reused, and reprints are marked as copies"); D4, D37, D40, D64, D74, D79; QA Q-23, Q-25; Gaps B5.

**Requirement.** Every payment gets a receipt numbered per club in an unbroken sequence (HTC‑2027‑000001). Void needs the owner and a reason; numbers are never reused.

**Acceptance criteria.**

- RCPT-01-AC1. Given a club's first real payment after Go live, when its receipt is issued, then its number is 000001 of the club's series for that Bangkok year (D4, D106).
- RCPT-01-AC2. Given receipts issued one after another, when they are numbered, then the numbers are consecutive with no gap and no repeat, per club, and two clubs have independent sequences.
- RCPT-01-AC3. Given 20 payments confirmed in parallel, when receipts are issued, then the numbers are consecutive (QA CONC-21): the number is taken in the same transaction as the confirmation, so a confirmation that fails leaves no gap and a confirmation that succeeds always has its number.
- RCPT-01-AC4. Given an order of several hours (one order, one booking per hour), when it is confirmed, then one receipt is issued for the order (BOOK-06, D40).
- RCPT-01-AC5. Given an order confirmed with no money paid (credit, wallet or a 100 percent code), when it is confirmed, then a receipt is still issued in the same series, showing how it was paid (D64, PAY-07).
- RCPT-01-AC6. Given a late payment credited to the wallet (PAY-03), a payment after a package order was cancelled (PAY-04), a wrong amount credit or a duplicate payment credit (F05), when the value is credited, then a receipt is issued in the same series for the money received (D37, D74, D79, D112).
- RCPT-01-AC7. Given a cash payment taken by front desk (PAY-06), when it is saved, then a receipt is issued in the same series.
- RCPT-01-AC8. Given a package bought alone or with a booking, when it is confirmed, then it gets a receipt (one per order).
- RCPT-01-AC9. Given the Owner voids a receipt, when they save it with a written reason, then the receipt keeps its number and shows Void with the reason, the number is never reused, and the void is audited with the owner's name (PLAT-04). Front desk, Accountant, coach and player cannot void.
- RCPT-01-AC10. Given a void without a reason, when it is submitted, then the server refuses.
- RCPT-01-AC11. Given a reprint, when a receipt is downloaded again, then the PDF is marked as a copy and keeps the original number and date (PRD).
- RCPT-01-AC12. Given a receipt, when it is issued, then it is never edited; a correction is a void and a new receipt (append only, D28 pattern).
- RCPT-01-AC13. Given a void, when it is saved, then it only marks the receipt; nothing changes on the booking, credits or wallet (D106).
- RCPT-01-AC14. Given the format HTC‑2027‑000001, then the prefix is set in P2 step 1 and required before Go live, and the number runs per club per Bangkok year: the sequence restarts each Bangkok year and the year part is the Bangkok year of issue (D106).
- RCPT-01-AC15. Given a club in Testing, when a test payment is made, then its receipt takes a number from its own non legal test series, marked as a test on screen and in the PDF, never from the real sequence; test receipts are purged at Go live, and the first real receipt is 000001 (D4, D33, PLAT-07).
- RCPT-01-AC16. Given value goes back to the wallet on a cancel or a closure, when it is returned, then no credit note and no receipt is issued (D119); the cancel sheet and the wallet history show the movement.
- RCPT-01-AC17. Given the canvas samples (numbers out of date order, a 5 Jan bundle with expiry 9 Apr), when tests are written, then they are not copied (Gaps B5).

**Meets.**

- PDPA: CC-3; the number and PDF hold the customer's name only as the legal receipt needs.
- No double booking: not relevant (CC-4).
- Club scope: the series is per club (AC2).
- TEXT: receipt labels from L keys with `{receipt}`; Void and Copy markings are keys in both languages.

**Canvas.** R-Receipt-TH, R-Receipt-EN, H-A14-Receipts (T-), H-C17-Profile-receipts (T-).

---

## RCPT-02 Receipt content and the PDF

**Source.** HO RCPT-02. PRD Tax and receipts; Change log "Business" (legal name); round 1 (registered address on the PDF only); Gaps B9.

**Requirement.** The receipt shows บริษัท ทีที รีครีเอชั่น จำกัด, tax ID 0135569018041, head office, the registered address, customer, items, discounts, method and total. Non VAT by default, with a VAT invoice switch.

**Hand-off acceptance check, kept.** Both PDF receipts match R-Receipt-TH and R-Receipt-EN.

**Acceptance criteria.**

- RCPT-02-AC1. Given a receipt PDF in Thai or English, when it is produced, then it shows the club's legal name (Thai on both, no English name), tax ID, branch (head office, สำนักงานใหญ่), the registered address, the customer name, items, discounts, payment method and total (hand-off check; PRD).
- RCPT-02-AC2. Given Hunter, when its receipt is produced, then it shows บริษัท ทีที รีครีเอชั่น จำกัด, tax ID 0135569018041, head office, and 1128/1 ถนนเลียบคลองรังสิต ตำบลประชาธิปัตย์ อำเภอธัญบุรี จังหวัดปทุมธานี 12130, taken from the club's settings, not from code (HO).
- RCPT-02-AC3. Given the PDF, then the registered address is on it and the app never shows the address anywhere (round 1, PRD Content).
- RCPT-02-AC4. Given an order paid by a mix of methods, when the receipt is produced, then it lists each method and amount (credit, wallet, Beam, cash), the discounts (promo code, birthday) and the add-ons, with the total in baht (whole baht when whole, two decimals otherwise, D69).
- RCPT-02-AC5. Given VAT is off (the default), when a receipt is produced, then it is a non VAT receipt; when the owner switches VAT tax invoices on in Settings (A16), then receipts follow the VAT layout from then on (Q4).
- RCPT-02-AC6. Given a solo class, when its receipt is produced, then the coach and court lines are shown separately as at checkout (F04 R2).
- RCPT-02-AC7. Given the balls add-on, when it is on a receipt, then it reads "Balls (Set of 3 balls)" in English and "ลูกเทนนิส (ชุด 3 ลูก)" in Thai.
- RCPT-02-AC8. Given a player in Profile (C17), when they open Receipts, then they see their own receipts newest first with a PDF button; a reprint is in the player's language, and staff may print either language (D119).
- RCPT-02-AC9. Given a receipt page size, then it is A4 (HO Screen inventory).
- RCPT-02-AC10. Given the note "Issued automatically. No signature required." (L-0061), when the PDF is produced, then it appears from its key.
- RCPT-02-AC11. Given a receipt for a wallet credit (late payment, wrong amount), when it is produced, then it states what it is for in words from keys (money received and credited to the wallet).
- RCPT-02-AC12. Given a PDF in the player's browser or in LINE, when it is downloaded, then it opens as a file the player can save; it is served only to its owner (CC-3).
- RCPT-02-AC13. Given a test receipt, when produced, then it carries a clear test mark (RCPT-01-AC15).
- RCPT-02-AC14. Given the canvas note that address and branch are placeholders, when the receipt is built, then the real values are used (Gaps B9).

**Meets.**

- PDPA: AC12; only the customer's name appears, never phone or date of birth.
- No double booking: not relevant.
- Club scope: legal details per club from setup (P2 step 1).
- TEXT: every label from L keys; the legal name and address are club settings, not keys.

**Canvas.** R-Receipt-TH, R-Receipt-EN (in the repo in the canvas backup, `docs/orchestrator/canvas-backup/12ae5a85-7762-44b9-9b19-9df906c1e373/project/R-Receipt-EN.dc.html and R-Receipt-TH.dc.html`; the spec wins over the canvas and the sample data is not copied, `docs/canvas-gaps.md` B5 and B9), H-C17-Profile-receipts.

---

## RCPT-03 Daily close

**Source.** HO RCPT-03. PRD Tax and receipts ("A daily close summary totals each payment method for matching against the bank"), A14; QA Q-26.

**Requirement.** A daily close totals each payment method for matching against the bank.

**Acceptance criteria.**

- RCPT-03-AC1. Given a Bangkok day, when the Owner or Accountant runs the daily close in A14, then it totals each payment method received that day (Beam, cash, and the others per Q7), in satang, from receipts of that day.
- RCPT-03-AC2. Given the day boundary, then it is Bangkok midnight (the club closes at 24:00); a payment at 23:59 is in that day and one at 00:00 is in the next.
- RCPT-03-AC3. Given a void on a receipt, when the daily close is run, then the voided receipt is shown as void and not counted in the totals, and a void made on a later day shows on the day it is made (D119).
- RCPT-03-AC4. Given test receipts, when the close is run, then they are excluded (D33).
- RCPT-03-AC5. Given late payment and wrong amount wallet credits, when the close is run, then the money received is counted in the method it arrived by (Beam), and listed as credited to the wallet (D37, D79).
- RCPT-03-AC6. Given an order paid by credit or wallet only, when the close is run, then no money is counted; the close lists money methods (Beam, cash) and shows wallet use and credit use as separate non money lines (D119).
- RCPT-03-AC7. Given a close, when it is exported, then it is a CSV or PDF for the club and the export is audited (F01 PLAT-06-AC15).
- RCPT-03-AC8. Given an Accountant, when they run the close, then they see totals and receipt numbers and customer names, no phone numbers or dates of birth (D35).
- RCPT-03-AC9. Given a closed day, when a receipt is later issued for it (a payment reported late), then it belongs to the day it was issued, not the earlier day (the sequence is by issue time).
- RCPT-03-AC10. Given a closed day, then it is not reopened (D119); a payment reported late, or a void, belongs to the day it is made.

**Meets.** PDPA: CC-3. No double booking: not relevant. Club scope: per club and day. TEXT: A14 text from A keys with `{date}` and `{amount}`.

**Canvas.** H-A14-Receipts (daily close, T-).

---

## R1 Receipt list, search and export (A14)

**Source.** PRD A14 ("List and search, PDF, void with reason, daily close, exports"); roles Owner and Accountant.

**Acceptance criteria.**

- R1-AC1. Given the Owner or Accountant in A14, when they search by receipt number, customer name or date, then matching receipts of the club are listed, newest first.
- R1-AC2. Given a receipt in the list, when it is opened, then its PDF shows and a void action shows for the Owner only.
- R1-AC3. Given the list, when it is exported, then it is a CSV for the club, audited, with names but no phone numbers or dates of birth for the Accountant (D35).
- R1-AC4. Given test receipts, when the list loads, then they are excluded from the live list and appear only in test mode views (D33).
- R1-AC5. Given front desk, when they open A14, then they cannot (A14 is Owner and Accountant); a direct request is refused. Front desk reaches a customer's receipts through A6 (F11).

**Meets.** PDPA: CC-3. No double booking: not relevant. Club scope: per club. TEXT: A keys.

**Canvas.** H-A14-Receipts (T-), H-A06-Customer-profile.

---

## R2 Reports (A13)

**Source.** PRD Front desk rules (Reports), A13; D33, D35, D57; QA (reports need acceptance checks); Gaps C2.

**Requirement.** The reports cover cash received by type, revenue earned against package sales, value still owed to customers, occupancy heatmap per court, online against staff bookings and no show rate, new against returning customers, promotion and partner performance, and coach payouts. Every report exports to CSV.

**Acceptance criteria.**

- R2-AC1. Given a date range, when the Owner or Accountant opens the A13 dashboard, then they see the reports below for that range, for their club only.
- R2-AC2. Given cash received by type, then it totals money received by method (Beam, cash) from receipts in the range, excluding voids and test records (D33).
- R2-AC3. Given revenue earned against package sales, then package sales are the money received for packages in the range, and revenue earned is credits used at their price per credit plus single sales (D119).
- R2-AC4. Given value still owed to customers, then it is unused package credit plus wallet balances, shown separately (D57), as of the end of the range.
- R2-AC5. Given the occupancy heatmap, then it shows booked hours over bookable hours (open hours less closures) per court by day and hour; held hours are not counted, and test records and cancelled bookings are excluded (D119).
- R2-AC6. Given online against staff bookings and the no show rate, then bookings are split by source (online or staff created) and the no show rate is no shows over played plus no show bookings.
- R2-AC7. Given new against returning, then a customer is new in the range when their first paid booking falls in it.
- R2-AC8. Given promotion and partner performance, then the partner report shows redemptions, revenue, new customers and repeat bookings within 30 and 60 days; a restored code reduces the redemption count (PRD, D70).
- R2-AC9. Given every report, when it is exported, then it is a CSV for the club with the same filters, audited (PLAT-04).
- R2-AC10. Given the Accountant, when they read a report that lists customers, then it shows names, never phone numbers or dates of birth (D35).
- R2-AC11. Given front desk or a coach, when they request any report, then the server refuses (A13 is Owner and Accountant; coach pay is the coach's own earnings in K6).
- R2-AC12. Given every report, then each has an acceptance check from its formula; the formulas are in R5 as a proposal awaiting the user's approval, with D119 fixing revenue earned and occupancy.

**Meets.** PDPA: CC-3; aggregate reports show counts and amounts, lists show names only. No double booking: not relevant. Club scope: per club. TEXT: report titles and labels from A keys, Thai and English; named variables for dates and amounts.

**Canvas.** H-A13-Reports (T-).

---

## R3 Coach payouts

**Source.** PRD Coach rates and pay ("Monthly payout report shows sessions delivered, amount owed and adjustments with reasons. The owner marks it paid"), A13, K6; Gaps B4.

**Requirement.** A monthly payout report per coach shows sessions delivered, amount owed and adjustments with reasons. The owner marks it paid.

**Acceptance criteria.**

- R3-AC1. Given a month, when the Owner opens coach payouts, then each coach shows sessions delivered, the amount owed and adjustments with reasons.
- R3-AC2. Given the pay model (an optional monthly base, plus a per session amount for solo classes, fixed or a percentage of the coaching portion, and for group classes; freelancers have no base), when the amount owed is calculated, then the owner's pay settings are used; they are empty until the owner sets them (hand-off open items), and an empty setting means that part is not calculated and is flagged, never invented.
- R3-AC3. Given a session, when it counts for pay, then the customer attended or was a no show; sessions cancelled within policy do not count (PRD).
- R3-AC4. Given the coaching portion, when a percentage applies, then it applies to the coaching portion only, not the court fee (PRD).
- R3-AC5. Given a substitution, when pay is calculated, then pay goes to the coach who delivered the session (F07 R4).
- R3-AC6. Given an adjustment, when the Owner adds it, then a written reason is required and it is audited.
- R3-AC7. Given the Owner marks a payout paid, when they save it, then it is recorded with who and when and cannot be edited later (append only); a correction is a new adjustment in the next period.
- R3-AC8. Given an Accountant, when they open payouts, then they may read and export but not mark paid; front desk cannot see them (HO Roles).
- R3-AC9. Given a coach, when they open K6, then they see only their own earnings (F12).
- R3-AC10. Given the canvas samples in K6 and A07 that disagree on who is freelance, when tests are written, then they are not copied (Gaps B4).

**Meets.** PDPA: pay is personal data of the coach; visible to the coach, the Owner and the Accountant only. No double booking: not relevant. Club scope: per club. TEXT: A and K keys.

**Canvas.** G-A13b-Coach-payouts (T-), H-K6-Earnings.

---

## R4 Which events issue a receipt (summary for design)

This list is drawn from the criteria above so design can check it; it adds no rule.

| Event | Receipt | Source |
|---|---|---|
| Court booking, solo class or class seat paid with money | One per order | RCPT-01-AC4, BOOK-06 |
| Order paid by credit, wallet or a 100 percent code | One per order, no money line | RCPT-01-AC5, D64 |
| Package bought alone or with a booking | One per order | RCPT-01-AC8 |
| Cash taken at the desk | One per payment | RCPT-01-AC7 |
| Late payment credited to the wallet, payment after a package order was cancelled, wrong amount credit | One for the money received | RCPT-01-AC6, D37, D74, D79 |
| Duplicate payment credited to the wallet | Not decided | F05 Q1 |
| Refund of value to the wallet on cancel or closure | Not decided | Q3 |
| Test payment in Testing | Test series, purged at Go live | RCPT-01-AC15 |

---

## R5 Proposed report formulas (for the user to approve)

Proposed by the drafter so each report has a testable formula. Rows marked "decided" come from D119 or the PRD; the rest are proposals and not rules until approved. All ranges are Bangkok dates, club scoped, excluding test records and voided receipts (D33).

| Report | Formula | Status |
|---|---|---|
| Cash received by type | Sum of money received by method (Beam, cash) on receipts issued in the range | Proposal (PRD "cash received by type") |
| Package sales | Money received for package orders in the range | Proposal |
| Revenue earned | Credits used in the range at their price per credit, plus single sales (court hour, solo or group single) in the range | Decided (D119) |
| Value still owed to customers | Unused package credit (credits left times price per credit) plus wallet balances, shown separately, at the end of the range | Decided (D57) |
| Occupancy heatmap | Booked hours over bookable hours (open hours less closures) per court by weekday and hour; held hours not counted | Decided (D119) |
| Online against staff bookings | Count of bookings by source in the range (online, staff created) | Proposal |
| No show rate | No show bookings over played plus no show bookings in the range | Proposal |
| New against returning | A customer is new in the range when their first paid booking falls in it; otherwise returning | Proposal |
| Partner report | Per partner: redemptions (restored uses not counted, D70), revenue from orders using its codes, new customers, repeat bookings within 30 and 60 days of their first | Proposal (PRD names the measures) |
| Coach payouts | Per coach and month: sessions delivered (attended or no show), amount owed from the owner's pay settings, adjustments with reasons (R3) | Proposal, pay numbers empty until set |

## Data covered by F13 (HO Data model, for the design step)

Receipt (club, number in the club's series, order, issued at, VAT flag, void reason and who, copy marks), Order and payment (F04), daily close (club, Bangkok day, totals by method, run by, run at), report exports (audit entries). Coach payout record (coach, month, sessions delivered, amount, adjustments with reasons, paid at, paid by).

## Proposed new text keys (D51)

Proposed by the drafter; writers own the wording; numbers from the i18n role after `copy-index.csv` exists (D31). Existing L keys first (for example L-0061).

- L: Void, Copy of receipt, Test receipt, wallet credit receipt wording, receipt lines for credit, wallet and each method.
- A: daily close labels and totals, void reason, report titles and labels, payout labels, export confirmation.

No key is added by this draft.

## Open questions

Answered by D106, D112 and D119 and removed: what a void does, the receipt year, credit notes, reprint language, daily close methods, reopening a day, revenue earned, occupancy, the receipt prefix and duplicate payment receipts. **Parked by the user, still open, not to be decided here:**

1. **VAT invoice layout (Q4, RCPT-02-AC5).** The PRD gives a switch to VAT tax invoices but no layout (VAT amount, seller details, tax invoice title). Who supplies it, and are earlier receipts affected when the switch is turned on? Parked.
2. **Retention (Q12).** How long are receipts, closes and reports kept, and how are receipts of a deleted player handled (F01 Q13, Q22)? Parked.

Still open and not parked:

3. **Canvas boards for the receipt (QA RCPT-02).** Settled: the R-Receipt boards are in the repo in the canvas backup (`docs/orchestrator/canvas-backup/12ae5a85-7762-44b9-9b19-9df906c1e373/project/R-Receipt-EN.dc.html and R-Receipt-TH.dc.html`), so the comparison can be tested. The spec wins over the canvas; the sample data (numbers, dates, expiry) is not copied (`docs/canvas-gaps.md` B5, B9).
4. **Report formulas (R5).** The rows marked Proposal need the user's approval (D119 invited this proposal).
