// F05 acceptance criteria that are proven by tests next to the code (written by the build lanes).
// Each trace test checks that the cited test still exists. New tests are in F05-beam-payments.new.spec.ts;
// criteria neither file names stay as generated test.todo in F05-beam-payments.spec.ts, with the reason in docs/qa/f05-sweep.md.
import { traced } from './trace';

traced("F05/PAY-01-AC5", "Given the P4 launch checklist, when a club goes Live, then swapping to the live ", [{ file: "packages/db/src/go-live.test.ts", has: "fails while the live key set is not in place" }]);
traced("F05/PAY-01-AC8", "Given a stored key, when anyone views it, then only the last 4 characters show a", [{ file: "tests/rls/secrets.spec.ts", has: "only the last four characters" }]);
traced("F05/PAY-02-AC7", "Given a duplicate callback for a charge already processed, when it arrives, then", [{ file: "apps/web/src/api/payments/webhook.test.ts", has: "parallel duplicates give one record" }]);
traced("F05/PAY-02-AC8", "Given a callback for a charge that fails, when it arrives, then the order stays ", [{ file: "apps/web/src/api/payments/webhook.test.ts", has: "a failed charge fails the payment" }]);
traced("F05/PAY-02-AC13", "Given the callback is delivered, when it is stored, then the event is recorded (", [{ file: "packages/db/src/payment-tables.test.ts", has: "de-duplicated by charge and event" }]);
traced("F05/PAY-02-AC14", "Given a payment of a test order, when the callback arrives, then it comes from B", [{ file: "packages/db/src/start-payment.test.ts", has: "a Testing club uses the test set" }]);
traced("F05/PAY-02-AC16", "Given an order is created and its charge, when the request goes to Beam, then on", [{ file: "packages/beam/src/adapter.test.ts", has: "sends only the order reference" }]);
traced("F05/PAY-02-AC17", "Given a second successful payment for an order already Confirmed (a different ch", [{ file: "packages/db/src/apply-payment-edges.test.ts", has: "sends the second amount to the wallet as duplicate_payment" }]);
traced("F05/PAY-03-AC2", "Given such a payment and the slot is held, booked or closed (a closure, includin", [{ file: "packages/db/src/apply-payment-edges.test.ts", has: "never gets the booking back from a late payment" }, { file: "packages/db/src/reclaim-order.test.ts", has: "a slot held by another player" }]);
traced("F05/PAY-03-AC3", "Given a solo class, when its late payment arrives, then court and coach must bot", [{ file: "packages/db/src/reclaim-order.test.ts", has: "a solo class with the coach busy" }]);
traced("F05/PAY-03-AC4", "Given a late payment credited to the wallet, when it is saved, then the wallet c", [{ file: "packages/db/src/apply-payment-edges.test.ts", has: "goes to the wallet as wallet_cancelled" }]);
traced("F05/PAY-03-AC5", "Given the slot check, when it runs, then it runs inside the booking transaction ", [{ file: "packages/db/src/reclaim-order.test.ts", has: "two reclaims in parallel" }]);
traced("F05/PAY-03-AC8", "Given a late payment arrives for a package order that was cancelled, when it is ", [{ file: "packages/db/src/apply-payment-edges.test.ts", has: "a cancelled package order does the same" }]);
traced("F05/PAY-04-AC5", "Given a payment arrives after a package order was cancelled, when it is reported", [{ file: "packages/db/src/apply-payment-edges.test.ts", has: "a cancelled package order does the same" }]);
traced("F05/PAY-04-AC3", "Given a payment arrives while the QR is valid, when the callback is verified (PA", [{ file: "packages/db/src/apply-payment.test.ts", has: "a package order (no hour to confirm)" }]);
traced("F05/PAY-04-AC4", "Given a package bought with a booking, when the player pays, then the booking's ", [{ file: "packages/db/src/apply-payment-package.test.ts", has: "grants the package, reserves what" }]);
traced("F05/PAY-05-AC1", "Given any cancel, closure, failed payment or wrong amount, when value is returne", [{ file: "packages/db/src/credit-wrong-amount.test.ts", has: "credits an underpayment in full" }]);
traced("F05/PAY-06-AC2", "Given the reason codes are No banking app, QR failed at the counter, and Other w", [{ file: "packages/db/src/take-cash.test.ts", has: "reason code and note rules" }]);
traced("F05/PAY-06-AC3", "Given cash, when it is taken, then the order method is cash, a receipt is issued", [{ file: "packages/db/src/take-cash.test.ts", has: "audits the reason code" }]);
traced("F05/PAY-06-AC4", "Given a package sale at the desk, when staff take cash, then it is allowed (D56)", [{ file: "packages/db/src/take-cash.test.ts", has: "is allowed for a package order" }]);
traced("F05/PAY-06-AC5", "Given a player, a coach or an accountant, when they try to take cash, then the s", [{ file: "packages/db/src/take-cash.test.ts", has: "only front desk and owner" }]);
