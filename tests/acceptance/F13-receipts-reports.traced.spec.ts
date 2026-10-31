// F13 acceptance criteria that are proven by tests next to the code (written by the build lanes).
// Each trace test checks that the cited test still exists. New tests are in F13-receipts-reports.new.spec.ts;
// criteria neither file names stay as generated test.todo in F13-receipts-reports.spec.ts, with the reason in docs/qa/f13-sweep.md.
import { traced } from './trace';

traced("F13/RCPT-01-AC7", "Given a cash payment taken by front desk (PAY-06), when it is saved, then a rece", [{ file: "packages/db/src/take-cash.test.ts", has: "confirms the booking, marks the order paid, records the cash payment, issues the receipt" }]);
traced("F13/RCPT-01-AC8", "Given a package bought alone or with a booking, when it is confirmed, then it ge", [{ file: "packages/db/src/apply-payment.test.ts", has: "a package order (no hour to confirm)" }]);
traced("F13/RCPT-01-AC10", "Given a void without a reason, when it is submitted, then the server refuses.", [{ file: "packages/db/src/void-receipt.test.ts", has: "a missing, blank or too short reason is refused" }]);
traced("F13/RCPT-01-AC13", "Given a void, when it is saved, then it only marks the receipt; nothing changes ", [{ file: "packages/db/src/void-receipt.test.ts", has: "only marks the receipt" }]);
traced("F13/RCPT-02-AC1", "Given a receipt PDF in Thai or English, when it is produced, then it shows the c", [{ file: "packages/receipts/src/model.test.ts", has: "the legal name, tax id, branch and address come from the club record" }]);
traced("F13/RCPT-02-AC3", "Given the PDF, then the registered address is on it and the app never shows the ", [{ file: "packages/receipts/src/model.test.ts", has: "the legal name, tax id, branch and address come from the club record" }]);
traced("F13/RCPT-02-AC4", "Given an order paid by a mix of methods, when the receipt is produced, then it l", [{ file: "packages/receipts/src/model.test.ts", has: "lists the lines in order with unit price and amount" }, { file: "packages/receipts/src/model.test.ts", has: "cash is labelled cash" }]);
traced("F13/RCPT-02-AC5", "Given VAT is off (the default), when a receipt is produced, then it is a non VAT", [{ file: "packages/receipts/src/model.test.ts", has: "a non VAT club says it is not a tax invoice" }]);
traced("F13/RCPT-02-AC9", "Given a receipt page size, then it is A4 (HO Screen inventory).", [{ file: "packages/receipts/src/pdf.test.ts", has: "draws one A4 page" }]);
traced("F13/RCPT-02-AC10", "Given the note \"Issued automatically. No signature required.\" (L-0061), when the", [{ file: "packages/receipts/src/model.test.ts", has: "dict.en['L-0061']" }]);
traced("F13/RCPT-02-AC12", "Given a PDF in the player's browser or in LINE, when it is downloaded, then it o", [{ file: "apps/web/src/api/receipts/routes.test.ts", has: "another player" }]);
traced("F13/RCPT-02-AC13", "Given a test receipt, when produced, then it carries a clear test mark (RCPT-01-", [{ file: "packages/receipts/src/model.test.ts", has: "a test receipt is marked as a test" }]);
traced("F13/RCPT-02-AC14", "Given the canvas note that address and branch are placeholders, when the receipt", [{ file: "packages/receipts/src/model.test.ts", has: "the legal name, tax id, branch and address come from the club record" }]);
traced("F13/RCPT-03-AC2", "Given the day boundary, then it is Bangkok midnight (the club closes at 24:00); ", [{ file: "packages/db/src/daily-close.test.ts", has: "23:59 is in the day and 00:00 is in the next" }]);
traced("F13/RCPT-03-AC10", "Given a closed day, then it is not reopened (D119); a payment reported late, or ", [{ file: "packages/db/src/daily-close.test.ts", has: "a void made on a later day shows on the day it is made" }, { file: "packages/db/src/daily-close.test.ts", has: "a payment reported after a close belongs to the day it is made" }]);
traced("F13/R2-AC10", "Given the Accountant, when they read a report that lists customers, then it show", [{ file: "packages/db/src/report-functions-a.test.ts", has: "the accountant gets the same numbers and nothing personal" }]);
traced("F13/RCPT-03-AC7", "Given a close, when it is exported, then it is a CSV or PDF for the club and the", [{ file: "apps/web/src/api/reports/routes.test.ts", has: "previews an open day, runs a finished day once, then reads and exports it" }]);
traced("F13/R2-AC9", "Given every report, when it is exported, then it is a CSV for the club with the ", [{ file: "apps/web/src/api/reports/routes.test.ts", has: "the CSV is the same rows as the screen and is audited (R2-AC9)" }]);
