# F06 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F06-packages-credit-wallet/requirements.md`. BE-W (the commerce lane) was still on its last tasks (T13, T26).

**Result: 60 criteria. 48 covered by lane tests (traced), 3 new QA tests, 0 findings in F06 itself, 9 still open (each with its reason).** One related finding is in the F09 sweep: QA-F09-1.

The commerce lane tested the ledgers well (`ledgers`: sign rules, append only for every role, the balance equals the ledger sum after random movements, the check at commit; `credit-functions`, `credit-functions-b`, `wallet-functions`, `package-functions`, `package-tables`, `balance-views`, `apply-payment-package`, `apply-payment-edges`). `F06-packages-credit-wallet.traced.spec.ts` holds a pointer test per covered criterion.

QA wrote: the expiry rule with the month end and year end cases (PKG-02-AC3, D20), the reminder days not typed into any text and held as a setting (R3-AC10), and with the F09 sweep the proof that no refund or withdraw action exists anywhere (PKG-01-AC9, CANCEL-02, PAY-05).

| Criterion | Text (cut) | Status |
|---|---|---|
| PKG-01-AC1 | Given any credit or wallet balance, when it is read, then it equals the sum of its ledger rows. No c | Covered by a lane test (traced) |
| PKG-01-AC2 | Given the credit ledger, when a row is written, then its reason is one of reserve, return, use, forf | Covered by a lane test (traced) |
| PKG-01-AC3 | Given the wallet ledger, when a row is written, then its reason is one of refund, late_payment, wron | Covered by a lane test (traced) |
| PKG-01-AC4 | Given a staff adjustment to credits or wallet, when it is saved without a written reason, then it is | Covered by a lane test (traced) |
| PKG-01-AC5 | Given a ledger row, when anyone tries to change or delete it, then the server refuses and the databa | Covered by a lane test (traced) |
| PKG-01-AC6 | Given any movement, when it is saved, then the ledger row and the booking, order or request that cau | Covered by a lane test (traced) |
| PKG-01-AC7 | Given a movement would make a balance negative (spending more than the balance, using a credit that  | Covered by a lane test (traced) |
| PKG-01-AC8 | Given two requests that spend the last credit or the last wallet satang in parallel, when they run,  | Covered by a lane test (traced) |
| PKG-01-AC9 | Given the wallet, when a customer asks to withdraw it, then no such route exists; the wallet cannot  | New QA test |
| PKG-01-AC10 | Given the history on C14, when the player opens it, then they see every movement of every credit and | Open: C14 history shows every movement with its reason in the player's language, newest first: screen. Playwright once C14 runs. The ledger and views it reads are tested (balance-views). |
| PKG-01-AC11 | Given a movement made in Testing, when it is saved, then it is flagged test and excluded from report | Covered by a lane test (traced) |
| PKG-01-AC12 | Given a late payment, a wrong amount, a duplicate payment or a refund of value to the wallet, when F | Covered by a lane test (traced) |
| PKG-02-AC1 | Given a club's package products (Hunter from the Tennis template: 10 hour bundle ฿4,500 3 months, 20 | Covered by a lane test (traced) |
| PKG-02-AC2 | Given a purchase, when the package is created, then its expiry is calendar months from the purchase  | Covered by a lane test (traced) |
| PKG-02-AC3 | Given a bundle bought on 5 Jan 2027, when it is created, then it expires 5 Apr 2027 at 23:59 (the ca | New QA test |
| PKG-02-AC4 | Given a package product, when the owner changes its price or validity, then it applies to new purcha | Covered by a lane test (traced) |
| PKG-02-AC5 | Given a Student package bought by a player under 18, when the player turns 18 or corrects their date | Covered by a lane test (traced) |
| PKG-02-AC6 | Given a Student package product, when a player 18 or older tries to buy it, then the server refuses  | Covered by a lane test (traced) |
| PKG-02-AC7 | Given a package product with no price set, when C9 loads, then it is not offered (an empty setting i | Open: A product with no price is not offered on C9: needs the C9 catalogue route. Not on main when swept. |
| PKG-02-AC8 | Given a product the owner marks inactive, when C9 loads, then it is not offered; packages already ow | Open: An inactive product is not offered on C9, owned packages keep working: same route. The "keeps working" half is covered by the credit tests (fits by type, nearest expiry). |
| PKG-02-AC9 | Given the validity and expiry shown on C9, C10P and C12P, when they are shown, then they come from t | Open: Validity and expiry shown on C9, C10P, C12P with the international year: screens. Playwright, later. The date helper is tested in packages/time. |
| PKG-02-AC10 | Given a court bundle, when it is used, then its hours work at any available booking time on either c | Covered by a lane test (traced) |
| PKG-03-AC1 | Given a package with credits left, when it is 14 days and again 3 days before its expiry date, then  | Open: The Package expiring message at 14 and 3 days, once each: the reminder job is not in apps/worker yet (only hold release, outbox sender and sweeps exist). Swept with F10. |
| PKG-03-AC2 | Given a package with no credits left, when its reminder dates arrive, then no reminder is sent. | Open: No reminder for a package with no credits left: same job. |
| PKG-03-AC3 | Given a package reaches its expiry (23:59 Bangkok on the expiry date), when the expiry job runs, the | Covered by a lane test (traced) |
| PKG-03-AC4 | Given an `expire` row, when it is written, then it is a new ledger row, not an edit of earlier rows  | Covered by a lane test (traced) |
| PKG-03-AC5 | Given an owner extends a package, when they save it, then a written reason is required, the new expi | Covered by a lane test (traced) |
| PKG-03-AC6 | Given an extension, when the reminder dates of the new expiry arrive, then reminders follow the new  | Open: Reminders follow a new expiry after an extension, earlier ones not repeated: same job. |
| PKG-03-AC7 | Given a club is resumed after a pause, when the pause ends, then every package expiry date, and the  | Covered by a lane test (traced) |
| PKG-03-AC8 | Given credit reserved for a future booking before the package reaches its expiry date, when the date | Covered by a lane test (traced) |
| PKG-03-AC9 | Given a booking made with a credit reserved before expiry, when it is cancelled after the package ex | Covered by a lane test (traced) |
| PKG-03-AC10 | Given a wallet balance expiry, when the club has set one, then `expire` rows apply to wallet balance | Covered by a lane test (traced) |
| R1-AC1 | Given a booking that uses a package credit, when it is submitted, then a `reserve` row is written fo | Covered by a lane test (traced) |
| R1-AC2 | Given a reserved credit and a booking cancelled 12 hours or more before start, when F09 cancels it,  | Covered by a lane test (traced) |
| R1-AC3 | Given a reserved credit and a session that starts, when the session slot starts, then a `use` row is | Covered by a lane test (traced) |
| R1-AC4 | Given a late cancel (under the cancel window) or a no show, when F09 or staff mark it, then a `forfe | Covered by a lane test (traced) |
| R1-AC5 | Given staff reverse a no show or late cancel, when they do it, then the credit comes back by a new r | Covered by a lane test (traced) |
| R1-AC6 | Given a mixed payment (credit, wallet and money) cancelled 12 hours or more ahead, when F09 returns  | Covered by a lane test (traced) |
| R1-AC7 | Given a club closure (F09), when it cancels a booking, then the full value returns whatever the time | Covered by a lane test (traced) |
| R1-AC8 | Given a booking made partly by credit and the hold ends without payment, when the hold is released,  | Covered by a lane test (traced) |
| R1-AC9 | Given a solo pack credit and a coach added at court checkout, when the order is priced, then no `res | Covered by a lane test (traced) |
| R1-AC10 | Given a solo class booked through Classes with a solo pack credit, when it is confirmed, then the cr | Open: A solo pack credit covers the coaching line only and the court is paid by hour, wallet or money (COACH-04): F07 flow. Swept with F07. |
| R2-AC1 | Given a checkout, when the wallet has a balance, then it is applied after package credit and before  | Covered by a lane test (traced) |
| R2-AC2 | Given the wallet balance on C14 and the checkout, when it is shown, then it is shown in baht (whole  | Covered by a lane test (traced) |
| R2-AC3 | Given a referral reward (F14), when it is due, then a `referral_reward` row is written for the amoun | Covered by a lane test (traced) |
| R2-AC4 | Given value returned to the wallet for a late payment, wrong amount or duplicate payment, when it is | Covered by a lane test (traced) |
| R2-AC5 | Given a wallet spend, when it is saved, then a `spend` row is written in the same transaction as the | Covered by a lane test (traced) |
| R2-AC6 | Given an `import` row from a CSV import, when it is written, then it uses the reason `import` with t | Covered by a lane test (traced) |
| R2-AC7 | Given the wallet, when a staff member credits or debits it, then the reason `adjust`, a written reas | Covered by a lane test (traced) |
| R2-AC8 | Given "value owed to customers" in reports, when it is computed, then it is unused package credit pl | Covered by a lane test (traced) |
| R3-AC1 | Given a player buys a package alone, when they pay, then the package is created only after the Beam  | Covered by a lane test (traced) |
| R3-AC2 | Given a player buys a bundle with a booking (Flow H), when they pay, then it is one order and one bi | Covered by a lane test (traced) |
| R3-AC3 | Given a player buys a group pack from the class screen (Flow I), when they pay, then the pack is cre | Covered by a lane test (traced) |
| R3-AC4 | Given a purchase is confirmed, when it is saved, then the package gets its expiry (PKG-02-AC2), a re | Covered by a lane test (traced) |
| R3-AC5 | Given a purchase by staff at the desk (G-A02c), when they take cash, then it follows PAY-06 and crea | Covered by a lane test (traced) |
| R3-AC6 | Given a package order for a Paused club, when a player tries to buy, then the server refuses (F01 PL | Covered by a lane test (traced) |
| R3-AC7 | Given a package bought together with a booking whose payment arrives late so the booking cannot be c | Covered by a lane test (traced) |
| R3-AC8 | Given the owner sells a package, when it is a Student product, then the buyer must be under 18 (PKG- | Covered by a lane test (traced) |
| R3-AC9 | Given a payment arrives after a package order was cancelled (a package bought alone whose QR time en | Covered by a lane test (traced) |
| R3-AC10 | Given the reminder days (14 and 3), the cancel window and the hold time, when text or settings use t | New QA test |

## Correction, 31 Oct

Criteria R1 to R8 repeat in F04, F06, F07 and F13. The first F06 trace matched them by ID, so 17 of them pointed at another feature's lane test (a coach, report or checkout test that also cites its own R1-AC1). Those links were wrong. They are removed and the F06 criteria are mapped by hand to the real wallet, credit and package tests. The same filter (by feature path) was applied to F04, F07 and F13. The open list is now these nine:

| Criterion | Why it is open |
|---|---|
| PKG-01-AC10, PKG-02-AC9, R2-AC2 | C14 history, validity text on C9/C10P/C12P and the wallet amount in baht: screens (Playwright). |
| PKG-02-AC8 | An inactive product is not offered on C9: the product list route is not built. |
| PKG-03-AC2, PKG-03-AC6 | No reminder for a used up package, and reminders follow the new date after an extension: the package expiring producer (LINE-05-AC7) is not built. |
| R2-AC8 | Value owed to customers in reports (credit plus wallet): report formula awaiting approval (F13 R2-AC12). |
| R3-AC3 | Group pack bought from the class screen: the flow is not built. |
| R3-AC6 | A package order for a Paused club is refused: no test names it; QA will add one against the pay route. |

## Update, 31 Oct (main d709178)

F06-T15 player package routes (0518): PKG-02-AC8 (an inactive or unpriced product is not offered) and R3-AC6 (a paused club refuses a package purchase) are now traced. PAY-04-AC1 is covered by `package-pay.routes.test.ts`. Open: PKG-01-AC10, PKG-02-AC9, PKG-03-AC2, PKG-03-AC6, R2-AC2, R2-AC8, R3-AC3.

## F06-T22, T23, T24, 31 Oct (main 43b77b0)

**T22 property and concurrency:** `F06-wallet-property.new.spec.ts`: five seeded runs of eight batches of four parallel wallet credits, spends and returns each; after every batch the ledger sum equals what was credited less what was spent and is never negative, and a spend may fail only for want of balance. Mutation checked: removing the wallet lock turns two seeds red, removing the balance check turns all five red. Already proved by the lane and traced by title: two parallel spends of the last baht (`wallet-functions.test.ts`), two parallel reserves of the last credit (`credit-functions.test.ts`), 20 parallel grants of one order (`package-functions.test.ts`), reserve, release and reclaim cycles (`credit-functions.test.ts` attempt 2).

**T23 append-only and blind:** `F06-blind-and-append-only.new.spec.ts`: the platform role has no privilege of any kind on a customer bound F06 table (the product price list is setup, class S, and BOOQ staff may read it in a Draft or Testing club); it may execute no wallet, credit or package function; the app and worker roles have no write grant on the ledgers or the extension log; the wallet functions the app role may call are only the staff adjustment and the two pay time helpers, and a new wallet function must be listed. Update and delete on both ledgers as every role: `ledgers.test.ts`; trigger inventory including `package_extension`: `F13-cross-cutting.new.spec.ts`. Mutation checked: a grant to the platform role, or a grant on `wallet_spend` to the app role, turns it red. A withdraw or refund route does not exist: route inventory in `F09-cancellation-closures.new.spec.ts` and the function scan above.

**T24 sweep:** 60 criteria, 51 with a test, 9 open as listed above (screens, the package expiring reminder producer, the owed to customers report formula, the group pack flow).
