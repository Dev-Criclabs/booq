// F06 acceptance criteria proven by tests next to the code (written by the build lanes).
// Trace tests check that the cited test still exists. New QA tests: F06-packages-credit-wallet.new.spec.ts and F09-cancellation-closures.new.spec.ts.
// The rest stay as generated test.todo in F06-packages-credit-wallet.spec.ts, with the reason in docs/qa/f06-sweep.md.
import { traced } from './trace';

traced("F06/PKG-01-AC1", "Given any credit or wallet balance, when it is read, then it equals the sum of i", [{ file: "packages/db/src/ledgers.test.ts", has: "PKG-01-AC1" }, { file: "packages/db/src/balance-views.test.ts", has: "PKG-01-AC1" }, { file: "packages/db/src/claim-transfer.test.ts", has: "PKG-01-AC1" }]);
traced("F06/PKG-01-AC2", "Given the credit ledger, when a row is written, then its reason is one of reserv", [{ file: "packages/db/src/ledgers.test.ts", has: "PKG-01-AC2" }]);
traced("F06/PKG-01-AC3", "Given the wallet ledger, when a row is written, then its reason is one of refund", [{ file: "packages/db/src/ledgers.test.ts", has: "the credit reasons are the hand-off list; the wallet reasons are the D78 list" }]);
traced("F06/PKG-01-AC4", "Given a staff adjustment to credits or wallet, when it is saved without a writte", [{ file: "packages/db/src/credit-functions-b.test.ts", has: "PKG-01-AC4" }, { file: "packages/db/src/wallet-credit-order.test.ts", has: "PKG-01-AC4" }, { file: "packages/db/src/ledgers.test.ts", has: "PKG-01-AC4" }]);
traced("F06/PKG-01-AC5", "Given a ledger row, when anyone tries to change or delete it, then the server re", [{ file: "packages/db/src/ledgers.test.ts", has: "PKG-01-AC5" }]);
traced("F06/PKG-01-AC6", "Given any movement, when it is saved, then the ledger row and the booking, order", [{ file: "packages/db/src/ledgers.test.ts", has: "a spend names its order and line" }, { file: "packages/db/src/wallet-functions.test.ts", has: "creates a paid order of kind wallet_credit with one wallet_credit line, and the wallet row tied to both" }]);
traced("F06/PKG-01-AC7", "Given a movement would make a balance negative (spending more than the balance, ", [{ file: "packages/db/src/ledgers.test.ts", has: "PKG-01-AC7" }, { file: "packages/db/src/wallet-functions.test.ts", has: "PKG-01-AC7" }]);
traced("F06/PKG-01-AC8", "Given two requests that spend the last credit or the last wallet satang in paral", [{ file: "packages/db/src/credit-functions.test.ts", has: "PKG-01-AC8" }, { file: "packages/db/src/wallet-return-line.test.ts", has: "PKG-01-AC8" }]);
traced("F06/PKG-01-AC11", "Given a movement made in Testing, when it is saved, then it is flagged test and ", [{ file: "packages/db/src/ledgers.test.ts", has: "PKG-01-AC11" }]);
traced("F06/PKG-01-AC12", "Given a late payment, a wrong amount, a duplicate payment or a refund of value t", [{ file: "packages/db/src/payment-ports.test.ts", has: "PKG-01-AC12" }, { file: "packages/db/src/wallet-functions.test.ts", has: "PKG-01-AC12" }]);
traced("F06/PKG-02-AC1", "Given a club's package products (Hunter from the Tennis template: 10 hour bundle", [{ file: "packages/db/src/package-tables.test.ts", has: "PKG-02-AC1" }]);
traced("F06/PKG-02-AC2", "Given a purchase, when the package is created, then its expiry is calendar month", [{ file: "packages/db/src/package-functions.test.ts", has: "PKG-02-AC2" }]);
traced("F06/PKG-02-AC4", "Given a package product, when the owner changes its price or validity, then it a", [{ file: "packages/db/src/package-functions.test.ts", has: "PKG-02-AC4" }, { file: "packages/db/src/package-tables.test.ts", has: "PKG-02-AC4" }]);
traced("F06/PKG-02-AC5", "Given a Student package bought by a player under 18, when the player turns 18 or", [{ file: "packages/db/src/credit-functions.test.ts", has: "PKG-02-AC5" }]);
traced("F06/PKG-02-AC6", "Given a Student package product, when a player 18 or older tries to buy it, then", [{ file: "packages/db/src/package-functions.test.ts", has: "PKG-02-AC6" }]);
traced("F06/PKG-02-AC10", "Given a court bundle, when it is used, then its hours work at any available book", [{ file: "packages/db/src/credit-functions.test.ts", has: "PKG-02-AC10" }]);
traced("F06/PKG-03-AC3", "Given a package reaches its expiry (23:59 Bangkok on the expiry date), when the ", [{ file: "packages/db/src/credit-functions-b.test.ts", has: "PKG-03-AC3" }, { file: "packages/db/src/jobs-support.test.ts", has: "PKG-03-AC3" }, { file: "packages/db/src/balance-views.test.ts", has: "PKG-03-AC3" }]);
traced("F06/PKG-03-AC4", "Given an `expire` row, when it is written, then it is a new ledger row, not an e", [{ file: "packages/db/src/ledgers.test.ts", has: "UPDATE and DELETE fail as every role, including the owner and a superuser" }, { file: "packages/db/src/credit-functions-b.test.ts", has: "writes one row for the unreserved remainder and none for reserved credit" }]);
traced("F06/PKG-03-AC5", "Given an owner extends a package, when they save it, then a written reason is re", [{ file: "packages/db/src/package-functions.test.ts", has: "PKG-03-AC5" }]);
traced("F06/PKG-03-AC7", "Given a club is resumed after a pause, when the pause ends, then every package e", [{ file: "packages/db/src/package-functions.test.ts", has: "PKG-03-AC7" }]);
traced("F06/PKG-03-AC8", "Given credit reserved for a future booking before the package reaches its expiry", [{ file: "packages/db/src/credit-functions.test.ts", has: "PKG-03-AC8" }]);
traced("F06/PKG-03-AC9", "Given a booking made with a credit reserved before expiry, when it is cancelled ", [{ file: "packages/db/src/credit-functions.test.ts", has: "PKG-03-AC9" }]);
traced("F06/PKG-03-AC10", "Given a wallet balance expiry, when the club has set one, then `expire` rows app", [{ file: "packages/db/src/jobs-support.test.ts", has: "PKG-03-AC10" }, { file: "packages/db/src/package-functions.test.ts", has: "PKG-03-AC10" }]);
traced("F06/R1-AC1", "Given a booking that uses a package credit, when it is submitted, then a `reserv", [{ file: "packages/db/src/credit-functions.test.ts", has: "R1-AC1" }]);
traced("F06/R1-AC2", "Given a reserved credit and a booking cancelled 12 hours or more before start, w", [{ file: "packages/db/src/credit-functions.test.ts", has: "R1-AC2" }]);
traced("F06/R1-AC3", "Given a reserved credit and a session that starts, when the session slot starts,", [{ file: "packages/db/src/credit-functions-b.test.ts", has: "R1-AC3" }]);
traced("F06/R1-AC4", "Given a late cancel (under the cancel window) or a no show, when F09 or staff ma", [{ file: "packages/db/src/credit-functions-b.test.ts", has: "R1-AC4" }]);
traced("F06/R1-AC5", "Given staff reverse a no show or late cancel, when they do it, then the credit c", [{ file: "packages/db/src/credit-functions-b.test.ts", has: "R1-AC5" }]);
traced("F06/R1-AC6", "Given a mixed payment (credit, wallet and money) cancelled 12 hours or more ahea", [{ file: "packages/db/src/wallet-return-line.test.ts", has: "R1-AC6" }]);
traced("F06/R1-AC9", "Given a solo pack credit and a coach added at court checkout, when the order is ", [{ file: "packages/db/src/credit-functions.test.ts", has: "R1-AC9" }]);
traced("F06/R3-AC7", "Given a package bought together with a booking whose payment arrives late so the", [{ file: "packages/db/src/apply-payment-package.test.ts", has: "R3-AC7" }]);
traced("F06/R3-AC8", "Given the owner sells a package, when it is a Student product, then the buyer mu", [{ file: "packages/db/src/package-functions.test.ts", has: "a Student product is refused for an adult and for a buyer with no date of birth; allowed under 18" }]);

// Criteria the lane's tests name by ID (added 31 Oct): the trace checks the ID is still cited in those files.
traced("F06/PKG-03-AC1", "Given a package with credits left, when it is 14 days and again 3 days before it", [{ file: "packages/db/src/f06-settings.test.ts", has: "PKG-03-AC1" }, { file: "packages/domain/src/packages/settings.test.ts", has: "PKG-03-AC1" }]);

// Hand mapped to the F06 lane's tests by title (31 Oct), replacing IDs that other features' tests also use.
traced("F06/PKG-02-AC7", "Given a package product with no price set, when C9 loads, then it is not offered", [{ file: "packages/db/src/package-tables.test.ts", has: "no price means not set" }]);
traced("F06/R1-AC7", "Given a club closure (F09), when it cancels a booking, then the full value retur", [{ file: "packages/db/src/cancel-outcome.test.ts", has: "a club cancel by staff is in full whatever the time" }]);
traced("F06/R1-AC8", "Given a booking made partly by credit and the hold ends without payment, when th", [{ file: "packages/db/src/release-handler.test.ts", has: "a released hold returns every reserved credit and wallet spend once" }]);
traced("F06/R1-AC10", "Given a solo class booked through Classes with a solo pack credit, when it is co", [{ file: "packages/db/src/credit-functions.test.ts", has: "a solo credit fits any coach of its tier only" }]);
traced("F06/R2-AC1", "Given a checkout, when the wallet has a balance, then it is applied after packag", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "credit first, then the wallet, then the remainder is money" }]);
traced("F06/R2-AC3", "Given a referral reward (F14), when it is due, then a `referral_reward` row is w", [{ file: "packages/db/src/wallet-functions.test.ts", has: "writes one positive row per dedupe key for a listed reason" }]);
traced("F06/R2-AC4", "Given value returned to the wallet for a late payment, wrong amount or duplicate", [{ file: "packages/db/src/apply-payment-wallet.test.ts", has: "never confirms a late payment: the value goes to the wallet" }, { file: "packages/db/src/apply-payment-edges.test.ts", has: "sends the second amount to the wallet as duplicate_payment" }, { file: "packages/db/src/credit-wrong-amount.test.ts", has: "credits an underpayment in full" }]);
traced("F06/R2-AC5", "Given a wallet spend, when it is saved, then a `spend` row is written in the sam", [{ file: "packages/db/src/wallet-functions.test.ts", has: "spends the line’s frozen wallet part once" }]);
traced("F06/R2-AC6", "Given an `import` row from a CSV import, when it is written, then it uses the re", [{ file: "packages/db/src/wallet-functions.test.ts", has: "an unclaimed or deleted record can still receive value" }]);
traced("F06/R2-AC7", "Given the wallet, when a staff member credits or debits it, then the reason `adj", [{ file: "packages/db/src/wallet-functions.test.ts", has: "front desk and owner adjust with a written note; the row names the staff member and is audited" }]);
traced("F06/R3-AC1", "Given a player buys a package alone, when they pay, then the package is created ", [{ file: "packages/db/src/apply-payment-package.test.ts", has: "a package order without hours is granted and received" }]);
traced("F06/R3-AC2", "Given a player buys a bundle with a booking (Flow H), when they pay, then it is ", [{ file: "packages/db/src/apply-payment-package.test.ts", has: "grants the package, reserves what the order allocated, then confirms" }]);
traced("F06/R3-AC4", "Given a purchase is confirmed, when it is saved, then the package gets its expir", [{ file: "packages/db/src/package-functions.test.ts", has: "creates the package with the product snapshot and credits" }, { file: "packages/db/src/apply-payment-package.test.ts", has: "grant, reserve, receipt, message" }]);
traced("F06/R3-AC5", "Given a purchase by staff at the desk (G-A02c), when they take cash, then it fol", [{ file: "packages/db/src/take-cash.test.ts", has: "is allowed for a package order: the package is granted" }]);
traced("F06/R3-AC9", "Given a payment arrives after a package order was cancelled (a package bought al", [{ file: "packages/db/src/apply-payment-edges.test.ts", has: "a cancelled package order does the same" }]);

// Added by trace-lane.py: criteria the lane's tests name by ID.
traced("F06/PKG-03-AC6", "Given an extension, when the reminder dates of the new expiry arrive, then remin", [{ file: "packages/db/src/package-reminders.test.ts", has: "PKG-03-AC6" }]);

// Added by trace-lane.py: criteria the lane's tests name by ID.
traced("F06/PKG-01-AC9", "Given the wallet, when a customer asks to withdraw it, then no such route exists", [{ file: "apps/web/src/api/packages/routes.test.ts", has: "PKG-01-AC9" }]);
traced("F06/PKG-01-AC10", "Given the history on C14, when the player opens it, then they see every movement", [{ file: "apps/web/src/api/packages/routes.test.ts", has: "PKG-01-AC10" }]);

// Hand mapped by title, 31 Oct (batch of F04-T14, F06-T15, F10-T13, F01 exports mount).
traced("F06/PKG-02-AC8", "Given a product the owner marks inactive, when C9 loads, then it is not offered;", [{ file: "apps/web/src/api/packages/routes.test.ts", has: "no price or inactive is not offered" }]);
traced("F06/R3-AC6", "Given a package order for a Paused club, when a player tries to buy, then the se", [{ file: "apps/web/src/api/checkout/package-pay.routes.test.ts", has: "a paused club refuses (R4-AC10)" }]);
