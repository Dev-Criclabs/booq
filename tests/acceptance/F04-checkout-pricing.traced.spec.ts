// F04 acceptance criteria that are proven by tests next to the code (written by the build lanes).
// Each trace test checks that the cited test still exists. New tests are in F04-checkout-pricing.new.spec.ts;
// criteria neither file names stay as generated test.todo in F04-checkout-pricing.spec.ts, with the reason in docs/qa/f04-sweep.md.
import { traced } from './trace';

traced("F04/PAY-07-AC3", "Given a 100 percent promo code makes the amount due zero, when the player taps P", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "a 100 percent code confirms in the same request" }]);
traced("F04/PAY-07-AC6", "Given an order where money paid is zero (credits, wallet or a 100 percent code c", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "a 100 percent code confirms in the same request" }, { file: "packages/db/src/message-facts.test.ts", has: "a zero money order: how it was paid comes from the order" }]);
traced("F04/PROMO-01-AC6", "Given a first time only code and a player who has a paid booking already, when t", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "first time only and a player with a paid booking" }, { file: "packages/db/src/order-functions.test.ts", has: "first time only: refused" }]);
traced("F04/PROMO-01-AC8", "Given a partner code on a solo class, when it is entered, then it is not accepte", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "a partner code on a solo class" }]);
traced("F04/PROMO-01-AC10", "Given a discount on an order of several hours, when it is priced, then it is spl", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "is split across the hours by each hour price" }, { file: "packages/db/src/cancel-outcome.test.ts", has: "the promo code use is restored only when this is the last live hour" }]);
traced("F04/PROMO-01-AC14", "Given a code use is restored (release or cancel), when the partner report counts", [{ file: "packages/db/src/report-functions-b.test.ts", has: "a restored use is not counted" }]);
traced("F04/R5-AC4", "Given a player with no date of birth on file, when checkout loads, then no birth", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "does not apply to a court only order, an empty setting" }, { file: "packages/db/src/order-functions.test.ts", has: "not outside the birth month and not with no date of birth" }]);
traced("F04/R7-AC4", "Given an order created in Testing, when it is stored, then it is flagged as test", [{ file: "packages/db/src/promo-and-lines.test.ts", has: "line rows made in Testing are test rows" }, { file: "packages/db/src/promo-and-lines.test.ts", has: "redemptions made in Testing are test rows" }]);
traced("F04/R7-AC5", "Given any change of an order's status or amounts, then it is audited and ledger ", [{ file: "packages/db/src/promo-and-lines.test.ts", has: "after Pay nothing about the price changes" }]);
traced("F04/PROMO-01-AC11", "Given a referral code from a friend, when a new player enters it at checkout, then it is th", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "a referral code is the one code of the order" }]);

// Criteria the lane's tests name by ID (added 31 Oct): the trace checks the ID is still cited in those files.
traced("F04/R1-AC1", "Given a player with a date of birth that makes them under 18 today, when checkou", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R1-AC1" }]);
traced("F04/R1-AC2", "Given a player with no date of birth on file, when a price depends on the price ", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R1-AC2" }]);
traced("F04/R1-AC3", "Given a player corrects their date of birth in Profile, when the next checkout r", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R1-AC3" }]);
traced("F04/R1-AC4", "Given the club's court price rules, when a court hour is priced, then the server", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R1-AC4" }]);
traced("F04/R1-AC5", "Given a court price rule that is missing for an hour, when a player tries to boo", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R1-AC5" }, { file: "apps/web/src/api/checkout/routes.test.ts", has: "R1-AC5" }]);
traced("F04/R2-AC1", "Given an Adult with a Coach tier coach picked at court checkout, when the order ", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R2-AC1" }]);
traced("F04/R2-AC2", "Given a Student with a Coach tier coach, when priced, then coach 70000 plus cour", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R2-AC2" }]);
traced("F04/R2-AC3", "Given a tier or coach with no price set (Head Coach is empty), when a coach of t", [{ file: "packages/db/src/price-tables.test.ts", has: "R2-AC3" }]);
traced("F04/R2-AC4", "Given a coach picked at court checkout, when the player has solo pack credits, t", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R2-AC4" }]);
traced("F04/R2-AC5", "Given a solo class booked through Classes with a solo pack credit, when priced, ", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R2-AC5" }]);
traced("F04/R2-AC7", "Given a two hour selection, when priced, then each hour is its own line and book", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R2-AC7" }]);
traced("F04/R2-AC8", "Given an order that is a solo class, when it is submitted, then court and coach ", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R2-AC8" }]);
traced("F04/R3-AC1", "Given an add-on with no price set, when checkout loads, then it is not offered f", [{ file: "packages/db/src/price-tables.test.ts", has: "R3-AC1" }]);
traced("F04/R3-AC4", "Given an add-on is inactive, when checkout loads, then it is not offered; an exi", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R3-AC4" }]);
traced("F04/R3-AC5", "Given add-ons in an order, when a code applies, then add-ons are excluded from t", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "R3-AC5" }]);
traced("F04/R3-AC6", "Given a booking is cancelled 12 hours or more ahead, when F09 returns value, the", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "R3-AC6" }]);
traced("F04/R4-AC1", "Given a player with package credit that fits the item, a wallet balance and an a", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R4-AC1" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "R4-AC1" }]);
traced("F04/R4-AC2", "Given a credit that fits only part of an order (for example a solo pack credit c", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R4-AC2" }]);
traced("F04/R4-AC3", "Given the wallet balance is larger than the remaining amount, when it is applied", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R4-AC3" }]);
traced("F04/R4-AC4", "Given a percentage discount on a price that gives a fraction of a satang, when i", [{ file: "packages/db/src/promo-and-lines.test.ts", has: "R4-AC4" }, { file: "packages/db/src/order-write-functions.test.ts", has: "R4-AC4" }]);
traced("F04/R4-AC5", "Given the checkout summary, when it shows, then it lists the item, add-ons, birt", [{ file: "apps/web/src/api/checkout/routes.test.ts", has: "R4-AC5" }]);
traced("F04/R4-AC6", "Given the player has a package credit of the wrong type or customer type (a Stud", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R4-AC6" }]);
traced("F04/R4-AC8", "Given the order is submitted, when the allocation is stored, then each line reco", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "R4-AC8" }]);
traced("F04/R4-AC9", "Given the player taps Pay, when the server prices the order, then it uses the pr", [{ file: "packages/db/src/promo-and-lines.test.ts", has: "R4-AC9" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "R4-AC9" }, { file: "apps/web/src/api/checkout/pay.routes.test.ts", has: "R4-AC9" }]);
traced("F04/R4-AC10", "Given a Paused club, when a player starts checkout, then the server refuses (F01", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "R4-AC10" }, { file: "apps/web/src/api/checkout/routes.test.ts", has: "R4-AC10" }]);
traced("F04/PAY-07-AC1", "Given an amount due of zero after credits and wallet, when the player taps Pay, ", [{ file: "packages/db/src/order-functions.test.ts", has: "PAY-07-AC1" }, { file: "packages/db/src/complete-zero-money-order.test.ts", has: "PAY-07-AC1" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "PAY-07-AC1" }]);
traced("F04/PAY-07-AC2", "Given the same, when the order is confirmed, then the slot is still reserved und", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "PAY-07-AC2" }]);
traced("F04/PAY-07-AC4", "Given the order confirms, when it is saved, then the Booking confirmed LINE card", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "PAY-07-AC4" }]);
traced("F04/PAY-07-AC5", "Given the credit or wallet rows and the booking, when any step fails, then none ", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "PAY-07-AC5" }]);
traced("F04/PROMO-01-AC1", "Given a code is applied, when a second code is entered, then the second is refus", [{ file: "packages/db/src/promo-and-lines.test.ts", has: "PROMO-01-AC1" }]);
traced("F04/PROMO-01-AC2", "Given a code that is stackable with the birthday discount and a player entitled ", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "PROMO-01-AC2" }]);
traced("F04/PROMO-01-AC3", "Given a code with a percentage discount, when priced, then the discount is calcu", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "PROMO-01-AC3" }]);
traced("F04/PROMO-01-AC4", "Given a code with a fixed THB discount larger than the price of the items in sco", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "PROMO-01-AC4" }]);
traced("F04/PROMO-01-AC5", "Given a code outside its dates, for the wrong audience (Adult or Student), for i", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "PROMO-01-AC5" }]);
traced("F04/PROMO-01-AC7", "Given a total cap or a per customer cap, when two players (or one player twice) ", [{ file: "packages/db/src/order-functions.test.ts", has: "PROMO-01-AC7" }, { file: "packages/db/src/reapply-entitlements.test.ts", has: "PROMO-01-AC7" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "PROMO-01-AC7" }]);
traced("F04/PROMO-01-AC9", "Given a code of another club, or one that does not exist, when it is entered, th", [{ file: "apps/web/src/api/checkout/routes.test.ts", has: "PROMO-01-AC9" }]);
traced("F04/PROMO-01-AC13", "Given a promo discount makes the amount due zero, when the player pays, then PAY", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "PROMO-01-AC13" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "PROMO-01-AC13" }]);
traced("F04/R5-AC1", "Given a player with a date of birth on file, in their birth month, with the disc", [{ file: "packages/db/src/price-settings.test.ts", has: "R5-AC1" }]);
traced("F04/R5-AC2", "Given the discount value is empty, when checkout loads, then no birthday discoun", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "R5-AC2" }]);
traced("F04/R5-AC3", "Given the player has already used the entitlement for that type this year, when ", [{ file: "packages/db/src/promo-and-lines.test.ts", has: "R5-AC3" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "R5-AC3" }]);
traced("F04/R5-AC5", "Given a booking that used the entitlement is cancelled 12 hours or more ahead, w", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "R5-AC5" }]);
traced("F04/R5-AC6", "Given a code that does not stack with the birthday discount, when the order is p", [{ file: "packages/domain/src/checkout/discounts.test.ts", has: "R5-AC6" }]);
traced("F04/R7-AC1", "Given an order is created, when it is saved, then it stores its lines (one booki", [{ file: "packages/db/src/promo-and-lines.test.ts", has: "R7-AC1" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "R7-AC1" }]);
traced("F04/R7-AC2", "Given the price shown at checkout, when the player taps Pay, then the order snap", [{ file: "packages/db/src/promo-and-lines.test.ts", has: "R7-AC2" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "R7-AC2" }, { file: "apps/web/src/api/checkout/pay.routes.test.ts", has: "R7-AC2" }]);
traced("F04/R7-AC3", "Given an order, when it is confirmed, then one receipt is issued for the order (", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "R7-AC3" }]);
traced("F04/R7-AC6", "Given an order is released or cancelled before payment, when the hold ends, then", [{ file: "packages/db/src/order-functions.test.ts", has: "R7-AC6" }, { file: "packages/domain/src/checkout/pay.test.ts", has: "R7-AC6" }]);
traced("F04/R8-AC1", "Given a slot is taken between selection and Pay, when the player taps Pay, then ", [{ file: "packages/domain/src/checkout/pay.test.ts", has: "R8-AC1" }, { file: "apps/web/src/api/checkout/pay.routes.test.ts", has: "R8-AC1" }]);
traced("F04/R8-AC4", "Given a guest reaches checkout, when they have not signed in, then sign in runs ", [{ file: "apps/web/src/api/checkout/pay.routes.test.ts", has: "R8-AC4" }, { file: "apps/web/src/api/checkout/routes.test.ts", has: "R8-AC4" }]);

// Added by trace-lane.py: criteria the lane's tests name by ID.
traced("F04/R1-AC7", "Given a player under 18, when they buy an Adult item, then it is allowed (D62, H", [{ file: "packages/domain/src/checkout/pricing.test.ts", has: "R1-AC7" }]);
traced("F04/R3-AC7", "Given the add-on name for balls, when it is shown anywhere, then the English is ", [{ file: "packages/db/src/price-template.test.ts", has: "R3-AC7" }]);

// Added by trace-lane.py: criteria the lane's tests name by ID.
traced("F04/R1-AC6", "Given a Student item (a package, class or price sold only to under 18) and a pla", [{ file: "packages/domain/src/checkout/package.test.ts", has: "R1-AC6" }, { file: "apps/web/src/api/checkout/package-pay.routes.test.ts", has: "R1-AC6" }]);

// Added by trace-lane.py: criteria the lane's tests name by ID.
traced("F04/PROMO-01-AC12", "Given the owner creates or edits a code, when it is saved, then it is audited (P", [{ file: "apps/web/src/api/admin/setup-data.routes.test.ts", has: "PROMO-01-AC12" }]);

// Hand mapped by title, 31 Oct (batch of F04-T14, F06-T15, F10-T13, F01 exports mount).
traced("F04/R3-AC8", "Given the owner edits add-ons in A9b, when they save, then it is audited (PLAT-0", [{ file: "apps/web/src/api/admin/setup-data.routes.test.ts", has: "an add-on with no price is saved with null, not a default (ADMIN-10)" }]);
traced("F04/PROMO-01-AC12", "Given the owner creates or edits a code, when it is saved, then it is audited (P", [{ file: "apps/web/src/api/admin/setup-data.routes.test.ts", has: "the stacking choice is audited (PROMO-01-AC12)" }]);

// Added by trace-lane.py: criteria the lane's tests name by ID.
traced("F04/R6-AC1", "Given a player with no court hour credit and a full price court order, when chec", [{ file: "apps/web/src/api/checkout/bundle-offer.routes.test.ts", has: "R6-AC1" }]);
traced("F04/R6-AC2", "Given the player declines, when they continue, then checkout is the full price o", [{ file: "apps/web/src/api/checkout/bundle-offer.routes.test.ts", has: "R6-AC2" }]);
traced("F04/R6-AC4", "Given a player who already has court hours, when checkout loads, then no prompt ", [{ file: "apps/web/src/api/checkout/bundle-offer.routes.test.ts", has: "R6-AC4" }]);
