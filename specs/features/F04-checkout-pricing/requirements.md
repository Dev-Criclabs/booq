# F04 Checkout, pricing, add-ons and promo codes · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, round 8: the drafter's F04 and F05 requirements and the answers D59 to D80 were approved by the user. Revision 2 applies D59 to D80 and the hand-off rows PAY-02, PAY-04, PAY-07, PROMO-01, BOOK-05, PLAT-03. Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Feature: F04 Checkout, pricing, add-ons and promo codes. Depends on: F03. Requirement IDs: PAY-07, PROMO-01, and the checkout, pricing and add-on rules the hand-off has no ID for (labelled R1 to R8 below, local to this file). Also uses COACH-02, COACH-03 and COACH-04 (F07 owns them). Wave 2.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Club facts; Court booking (Add a coach at checkout); Pricing and packages; Payments, cancellation, credits and wallet (Credits and wallet, Checkout and payment); Promotions and referrals; Customer app pages C10, C10b, C10c; Platform foundation (price groups, court prices, add-ons) |
| HO | `specs/product/handoff-v1.2.md` | Business rules as requirements (PAY-07 in Payments, PROMO-01, PROMO-02, COACH-02 to COACH-04, PKG-01, PKG-02, BOOK-06); Data model (Price group, Court price rule, Add-on, Order and payment, Promo code, partner, referral) |
| Decisions | `docs/decisions.md` | D12, D21, D22, D23, D33, D35, D37, D40, D49, D62 to D70; round 1. PRD change log "Decisions 30 Oct (7)"; HO PAY-07, PROMO-01 |
| Gaps | `docs/canvas-gaps.md` | A4, A5, B-section sample warnings |
| QA | `docs/qa/traceability.md`, `open-questions.md` (branch `qa/test-strategy`) | PAY-07, PROMO-01 gaps and Q-13, Q-15, Q-17 |
| Other features | F01, F02, F03 requirements | Club scope, price group from date of birth, hold, BOOK-06 |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026; every board has a T- Thai twin.

## Scope

In scope: the order and its price (court hours, solo class lines, add-ons), the price group of the player, discounts (birthday, promo or referral code), applying package credit, wallet and money in the right order, the amount due, confirming at once when nothing is left to pay (PAY-07), and recording how each part was paid so a later cancel can return each part to its source (D21). Add-on and promo code settings and their rules.

Out of scope: the hold itself (F03), the payment screen and Beam (F05), packages, credits and wallet ledgers (F06), the coach picker and coach availability (F07), cancel and closures (F09), the birthday and referral reward values and messages (F14), receipts (F13), LINE messages (F10), A9, A9b and A10 screens (F11).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin, F1-, F2- flow copies (not repeated). Boards: H-C10-Checkout, G-C10-Add-coach-checkout, G-C10-Coach-picked, G-C10-Credit-covered, G-C10-Referral-discount, H-C10b-Checkout-solo, G-C10b-Solo-with-credit, H-C10c-Checkout-bundle-prompt, G-C03-Birthday, H-C10P-* boards (package checkout, F06), H-A09-Pricing, H-A09b-Pricing-groups, H-A10-Promotions.

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Orders, order lines, add-ons, promo codes, partners and price rules carry the club ID; every query filters by it. A promo code of club A is not valid in club B; a code lookup in another club answers "not valid", never "belongs to another club".

**CC-2 Server side.** The server computes every price, discount and amount due. The client never sends an amount; it sends choices (items, add-ons, code) and the server returns the price. Permissions are checked on the server.

**CC-3 PDPA.** An order links one customer and is a booking and payment record, visible to that player and the club's staff by role; BOOQ staff never see it (PLAT-02). Reports and exports of orders follow the Accountant rule (names, no phone or date of birth, D35). Test orders are flagged and excluded from reports (D33).

**CC-4 No double booking.** Pricing never reserves a slot. The order is built from a slot, and pressing Pay creates the hold under F03 (BOOK-03, BOOK-04). A price change or code change while the player is on checkout never releases or extends a hold. A solo class order reserves court and coach together or not at all.

**CC-5 Language files (TEXT-01 to TEXT-06).** All text comes from `locales/*` by key. Sample values (names, prices, times, counts, codes) become named variables with the same names in both files: `{amount}`, `{code}`, `{court}`, `{date}`, `{time}`, `{coach}`, `{hours}`, `{minutes}`. Prices and rules that are club settings are variables, never typed (Gaps A5: the fixed 15 minutes, 12 hours and 30 minutes in C9c, C10P, C11 and C16 text). Existing wording is not edited; new text gets new keys in both files and goes to the writers; the drafter proposes the keys (D51). The add-on is shown as "Balls (Set of 3 balls)" in English and "ลูกเทนนิส (ชุด 3 ลูก)" in Thai on every screen and receipt. Layouts survive the longest Thai or English string; buttons never wrap; the order summary scrolls.

**CC-6 Other platform rules.** All times Asia/Bangkok. Money is integer satang everywhere; the display shows baht. Never invent a price, amount or setting: add-on prices, the Head Coach price, the birthday discount and the referral amounts are empty club settings (hand-off open items). Bookings are 60 minutes on the hour.

---

## R1 Price groups and the player's price

**Source.** PRD Club facts, Pricing and packages, Platform foundation (Price groups, Court prices); HO Data model (Price group, Court price rule); D12; F02 AUTH-02.

**Requirement.** Each club has price groups (Hunter: Adult 18 and over, Student under 18, worked out from the date of birth on file). A player with no date of birth gets Adult prices (D12). Court prices come from price rules by weekday or weekend and off peak or peak; Hunter uses one price, ฿500 for every day and hour, and the same for Adult and Student.

**Acceptance criteria.**

- R1-AC1. Given a player with a date of birth that makes them under 18 today, when checkout prices an item, then the Student price applies. On the 18th birthday (Asia/Bangkok date) it becomes the Adult price.
- R1-AC2. Given a player with no date of birth on file, when a price depends on the price group, then Adult applies (D12).
- R1-AC3. Given a player corrects their date of birth in Profile, when the next checkout runs, then it uses the new value; an order already paid keeps its price (F02 AUTH-02-AC20).
- R1-AC4. Given the club's court price rules, when a court hour is priced, then the server looks up the rule by weekday or weekend and off peak or peak and the player's price group; Hunter's single rule gives ฿500 (50000 satang) for every hour for both groups.
- R1-AC5. Given a court price rule that is missing for an hour, when a player tries to book it, then the server refuses and the hour is not offered (no invented price).
- R1-AC6. Given a Student item (a package, class or price sold only to under 18) and a player who is 18 or older, when they try to buy it, then the server refuses (PRD "Student packages can only be bought by customers under 18").
- R1-AC7. Given a player under 18, when they buy an Adult item, then it is allowed (D62, HO PROMO-01). Only Student items are closed to players 18 or older (R1-AC6).

**Meets.** PDPA: price group uses the date of birth only to decide the group; the date is not shown to the Accountant (D35). No double booking: not relevant. Club scope: price groups and rules are per club. TEXT: price lines use P keys with `{amount}`.

**Canvas.** H-A09b-Pricing-groups (T-), H-C10-Checkout (T-).

---

## R2 Order lines and the solo class price

**Source.** PRD Court booking (Add a coach at checkout), Solo classes and coach rules, Pricing and packages; HO COACH-02, COACH-03, COACH-04, BOOK-06; D40.

**Requirement.** An order has lines: court hours (one booking per hour, BOOK-06), a coach line when a coach is picked, and add-ons. A solo class is priced as the coach's price for the player's price group plus the court price (Hunter: coach ฿800 plus court ฿500 for an Adult with a Coach tier, so ฿1,300; Student ฿700 plus ฿500, so ฿1,200). The coach and court lines are shown and priced separately. The Head Coach price is an empty setting.

**Acceptance criteria.**

- R2-AC1. Given an Adult with a Coach tier coach picked at court checkout, when the order is priced, then it is a solo class: court 50000 satang plus coach 80000 satang, total 130000 (COACH-02).
- R2-AC2. Given a Student with a Coach tier coach, when priced, then coach 70000 plus court 50000 satang, total 120000 (PRD Pricing and packages).
- R2-AC3. Given a tier or coach with no price set (Head Coach is empty), when a coach of that tier is offered, then the card shows no price and the coach cannot be picked until the owner sets the price. No default is used.
- R2-AC4. Given a coach picked at court checkout, when the player has solo pack credits, then the full coaching price is charged and the pack credits are not used (COACH-03). Credits apply only through Classes, then Solo classes.
- R2-AC5. Given a solo class booked through Classes with a solo pack credit, when priced, then the coach line is covered by the credit and the court line (50000 satang) is still due, payable with a bundle hour, wallet or money (COACH-04).
- R2-AC6. Given a coach becomes unavailable before the player pays, when checkout refreshes, then the coach line disappears and the player is asked to pick again; the court only booking stays available (PRD Court booking).
- R2-AC7. Given a two hour selection, when priced, then each hour is its own line and booking, and the order total is the sum (BOOK-06, D40).
- R2-AC8. Given an order that is a solo class, when it is submitted, then court and coach are reserved together or neither (BOOK-04, F07).
- R2-AC9. Given a player taps Add a coach after booking (from C12), when it is priced, then only the coaching portion is charged (PRD Court booking; F07 owns the flow).

**Meets.** PDPA: order lines name the coach and customer; coach sees only their own sessions (F12). No double booking: see CC-4 and AC8. Club scope: tiers, coach prices and court prices per club. TEXT: coach line and court line labels from P keys with `{coach}` and `{amount}`.

**Canvas.** H-C10-Checkout, G-C10-Add-coach-checkout, G-C10-Coach-picked, H-C10b-Checkout-solo, G-C10b-Solo-with-credit, G-C12-Add-coach, F1-08-C10-Coach-picked.

---

## R3 Add-ons

**Source.** PRD Checkout and payment ("add ons (racket, balls sold as a set of 3, towel, water; prices TBD)"), Platform foundation (Add-ons: each club keeps its own list); HO Data model (Add-on).

**Requirement.** Each club keeps its own add-on list (name in Thai and English, price, active). Hunter's list is racket, Balls (Set of 3 balls), towel and water. Add-on prices are empty settings. Add-ons collapse into one row on checkout.

**Acceptance criteria.**

- R3-AC1. Given an add-on with no price set, when checkout loads, then it is not offered for sale (an empty setting is not free).
- R3-AC2. Given an active add-on with a price, when the player adds it, then it is a line in the order at that price in satang; the server computes the total.
- R3-AC3. Given several add-ons, when checkout shows them, then they collapse into one row that expands to the lines.
- R3-AC4. Given an add-on is inactive, when checkout loads, then it is not offered; an existing paid order keeps it.
- R3-AC5. Given add-ons in an order, when a code applies, then add-ons are excluded from the code's discount unless the code says it applies to them (D23).
- R3-AC6. Given a booking is cancelled 12 hours or more ahead, when F09 returns value, then its add-ons return with the booking (D21); F04 records add-on lines against the booking they belong to so this works.
- R3-AC7. Given the add-on name for balls, when it is shown anywhere, then the English is "Balls (Set of 3 balls)" and the Thai is "ลูกเทนนิส (ชุด 3 ลูก)" on every screen and receipt.
- R3-AC8. Given the owner edits add-ons in A9b, when they save, then it is audited (PLAT-04) and the change applies to new orders only.

**Meets.** PDPA: not relevant (no personal data). No double booking: add-ons have no stock or slot; they never block a booking. Club scope: per club list. TEXT: add-on names are Thai and English fields typed by the club; the balls name is fixed by the PRD.

**Canvas.** H-C10-Checkout, H-A09b-Pricing-groups (add-ons card), T- twins.

---

## R4 Order of use and the amount due

**Source.** PRD Credits and wallet, Checkout and payment; D22, D23; QA Q-15, Q-17.

**Requirement.** At checkout the server applies, in this order: package credit, then wallet, then money (Beam or cash) (D22). The PRD wording "wallet is spent first" is clarified to "before money". Amounts are integer satang. Percentage discounts round half up to the satang (D23).

**Acceptance criteria.**

- R4-AC1. Given a player with package credit that fits the item, a wallet balance and an amount left, when checkout prices the order, then credit is used first, then the wallet, then the remainder is the amount due by money (D22).
- R4-AC2. Given a credit that fits only part of an order (for example a solo pack credit covers the coaching line only), when it is applied, then it covers that line only and the rest follows the same order (R2-AC5).
- R4-AC3. Given the wallet balance is larger than the remaining amount, when it is applied, then only the remaining amount is taken and the rest stays in the wallet.
- R4-AC4. Given a percentage discount on a price that gives a fraction of a satang, when it is calculated, then it rounds half up to the satang (D23); the sum of line amounts equals the order total exactly.
- R4-AC5. Given the checkout summary, when it shows, then it lists the item, add-ons, birthday discount, promo or referral code, credits applied, wallet applied and amount due, with the cancellation policy line (PRD C10) using the club's cancel window as `{hours}`.
- R4-AC6. Given the player has a package credit of the wrong type or customer type (a Student credit for an Adult item), when checkout prices the order, then the credit is not applied.
- R4-AC7. Given credits or wallet are applied, when the order is submitted, then the credit and wallet movements are written as ledger rows (reserve for credit, a wallet use row) by F06 in the same transaction as the order, and no balance is an editable number (PKG-01, D28).
- R4-AC8. Given the order is submitted, when the allocation is stored, then each line records how much was paid by credit, by wallet and by money, so a later cancel returns package credit to the package, money paid to the wallet and wallet use to the wallet (D21).
- R4-AC9. Given the player taps Pay, when the server prices the order, then it uses the prices at that moment (D63, HO PAY-07). If the price changed since checkout opened, the player sees the new price and must confirm again; nothing is held or charged until they do. Two requests that change the same order at once are resolved the same way: the order the server holds at Pay is the one priced.
- R4-AC11. Given any amount shown to the player, when it is whole baht, then it shows without decimals (฿1,300); otherwise it shows two decimals (฿1,299.50). Storage stays integer satang (D69).
- R4-AC10. Given a Paused club, when a player starts checkout, then the server refuses (F01 PLAT-03-AC4).

**Meets.** PDPA: wallet and credit amounts are the player's own data. No double booking: applying credit does not hold a slot; the hold comes from F03. Club scope: credits and wallet belong to one club. TEXT: summary lines from P keys with `{amount}`, `{hours}`.

**Canvas.** H-C10-Checkout, G-C10-Credit-covered, F2-07-C10-Credit-covered, G-C10b-Solo-with-credit.

---

## PAY-07 Nothing left to pay confirms at once

**Source.** HO PAY-07. PRD Checkout and payment ("Nothing left to pay confirms at once").

**Requirement.** Nothing left to pay (credits or wallet cover it) confirms at once with no QR.

**Acceptance criteria.**

- PAY-07-AC1. Given an amount due of zero after credits and wallet, when the player taps Pay, then the booking is confirmed in the same request with no Beam charge and no QR.
- PAY-07-AC2. Given the same, when the order is confirmed, then the slot is still reserved under the uniqueness rule (BOOK-04): a taken slot refuses the order and nothing is used up.
- PAY-07-AC3. Given a 100 percent promo code makes the amount due zero, when the player taps Pay, then the order confirms the same way with no Beam charge.
- PAY-07-AC4. Given the order confirms, when it is saved, then the Booking confirmed LINE card is sent (LINE-04, F10), and the booking is Confirmed with its credit and wallet rows written in the same transaction.
- PAY-07-AC5. Given the credit or wallet rows and the booking, when any step fails, then none is saved (all or nothing).
- PAY-07-AC6. Given an order where money paid is zero (credits, wallet or a 100 percent code covered it), when it is confirmed, then a receipt is still issued in the same numbered series, showing how it was paid (credit, wallet), and the LINE card shows that receipt number (D64, HO PAY-07, RCPT-01).

**Meets.** PDPA: not relevant beyond CC-3. No double booking: AC2 and the same transaction. Club scope: per club. TEXT: the confirmation text from P and L keys; no payment text shown.

**Canvas.** G-C10-Credit-covered (T-), F2-07-C10-Credit-covered, H-C12-Confirmed.

---

## PROMO-01 Promo and referral codes

**Source.** HO PROMO-01, PROMO-02. PRD Promotions and referrals, Checkout (C10 code field); D21, D23; Gaps A4.

**Requirement.** One promo code per order. The owner decides per code whether it stacks with the birthday discount. Codes carry code text, percentage or fixed THB discount, what they apply to, audience and dates, and optional limits: first time only, total cap, per customer cap, minimum spend. Each partner business has its own codes. The referral code uses the same single code field.

**Acceptance criteria.**

- PROMO-01-AC1. Given a code is applied, when a second code is entered, then the second is refused; one code per order.
- PROMO-01-AC2. Given a code that is stackable with the birthday discount and a player entitled to the birthday discount, when the order is priced, then both apply. Given a code that is not stackable, then the one giving the larger discount applies and the other is not used up (D65, HO PROMO-01).
- PROMO-01-AC3. Given a code with a percentage discount, when priced, then the discount is calculated on the items in the code's scope only and rounds half up to the satang; add-ons are excluded unless the code says so (D23).
- PROMO-01-AC4. Given a code with a fixed THB discount larger than the price of the items in scope, when priced, then the discount is capped at that price (never a negative price).
- PROMO-01-AC5. Given a code outside its dates, for the wrong audience (Adult or Student), for items outside its scope, or whose minimum spend is not met, when it is entered, then it is refused with a reason. Minimum spend is checked on the order total before credits and wallet are applied (D68).
- PROMO-01-AC6. Given a first time only code and a player who has a paid booking already, when the code is entered, then it is refused.
- PROMO-01-AC7. Given a total cap or a per customer cap, when two players (or one player twice) use the code in parallel at the last use, then exactly one succeeds (QA CONC-23). A use is counted at Pay and restored when the hold ends without payment or the booking is cancelled 12 hours or more ahead (D66, HO PROMO-01).
- PROMO-01-AC8. Given a partner code on a solo class, when it is entered, then it is not accepted: partner codes on solo classes are parked for later (Gaps A4). The PARTNER100 example on the C10b canvas board is a canvas bug.
- PROMO-01-AC9. Given a code of another club, or one that does not exist, when it is entered, then the answer is the same "code not valid" (CC-1).
- PROMO-01-AC10. Given a discount on an order of several hours, when it is priced, then it is split across the hours by each hour's price (D67). Given one hour is cancelled 12 hours or more ahead, then that hour's share of the discount is restored; the code use is restored only when every hour of the order is cancelled (D67, D21). F04 records the share per hour and which order used which code.
- PROMO-01-AC11. Given a referral code from a friend, when a new player enters it at checkout, then it is the one code of the order and gives the friend discount (an empty setting until the owner sets it); a player cannot use their own referral code (blocked by LINE ID and phone, PROMO-02, F14).
- PROMO-01-AC14. Given a code use is restored (release or cancel), when the partner report counts redemptions, then the restored use is no longer counted (D70).
- PROMO-01-AC12. Given the owner creates or edits a code, when it is saved, then it is audited (PLAT-04) and a change applies to new orders only.
- PROMO-01-AC13. Given a promo discount makes the amount due zero, when the player pays, then PAY-07 applies.

**Meets.** PDPA: a partner code report counts redemptions and new customers without exposing player names beyond what the owner already sees (F11). No double booking: not relevant. Club scope: codes, caps and partners are per club. TEXT: code error reasons are P keys (new keys); the PARTNER100 sample is a variable `{code}`.

**Canvas.** H-C10-Checkout, G-C10-Referral-discount, H-A10-Promotions (T-), H-C10b-Checkout-solo (Gaps A4), G-C03-Birthday.

---

## R5 Birthday discount at checkout

**Source.** PRD Promotions and referrals ("Birthday month discount (TBD) applies automatically to one package and one solo class, once each per year"), C3 banner; D12, D21. F14 owns the amount and the message.

**Requirement.** The birthday discount applies automatically at checkout to one package and one solo class in the birthday month, once each per year. The discount value is an empty setting.

**Acceptance criteria.**

- R5-AC1. Given a player with a date of birth on file, in their birth month, with the discount value set, when they price a package or a solo class, then the discount applies automatically and shows as a line.
- R5-AC2. Given the discount value is empty, when checkout loads, then no birthday discount shows.
- R5-AC3. Given the player has already used the entitlement for that type this year, when checkout loads, then it does not apply again.
- R5-AC4. Given a player with no date of birth on file, when checkout loads, then no birthday discount applies (D12; adults may add a date of birth voluntarily).
- R5-AC5. Given a booking that used the entitlement is cancelled 12 hours or more ahead, when F09 returns value, then the entitlement is restored (D21).
- R5-AC6. Given a code that does not stack with the birthday discount, when the order is priced, then the larger discount wins (D65); the birthday entitlement is used only if it is the discount that applies.

**Meets.** PDPA: the date of birth is used for the month check only. No double booking: not relevant. Club scope: per club and player. TEXT: banner and line text from P keys with `{amount}`.

**Canvas.** G-C03-Birthday (T-), H-C10-Checkout.

---

## R6 Bundle prompt on court checkout

**Source.** PRD Customer app pages (C10c, "A bundle prompt on C10 when a player with no court hours pays full price"), Key flows H.

**Requirement.** When a player with no court hours pays full price on court checkout, checkout offers the 10 hour bundle with one hour used now. F06 owns the bundle, its price and the one bill (C10P).

**Acceptance criteria.**

- R6-AC1. Given a player with no court hour credit and a full price court order, when checkout loads, then the bundle prompt shows with the bundle's price from the club's products (empty means no prompt).
- R6-AC2. Given the player declines, when they continue, then checkout is the full price order unchanged.
- R6-AC3. Given the player accepts, when they continue, then the order becomes the bundle purchase plus the booking, handled as one bill by F06 (C10P) with the hold from F03.
- R6-AC4. Given a player who already has court hours, when checkout loads, then no prompt shows.

**Meets.** PDPA: not relevant. No double booking: accepting does not release the slot; one hold covers the booking. Club scope: per club. TEXT: prompt text from P keys with `{amount}` and `{hours}`.

**Canvas.** H-C10c-Checkout-bundle-prompt (T-), H-C10P-Bundle-plus-booking.

---

## R7 Order record and receipts

**Source.** HO Data model (Order and payment), BOOK-06, RCPT-01; D21, D33, D37, D40.

**Requirement.** An order holds items, add-ons, discounts, amount due, method (Beam, cash, credit, wallet), status and the allocation of each part. A selection of hours is one order, one receipt per order (D40).

**Acceptance criteria.**

- R7-AC1. Given an order is created, when it is saved, then it stores its lines (one booking per hour), discounts, the code and birthday entitlement used, and the credit, wallet and money parts per line, all in satang.
- R7-AC2. Given the price shown at checkout, when the player taps Pay, then the order snapshot is stored with those prices; a later change to club prices does not change a paid or held order.
- R7-AC3. Given an order, when it is confirmed, then one receipt is issued for the order (F13), including the wallet part and credit part as methods.
- R7-AC4. Given an order created in Testing, when it is stored, then it is flagged as test and excluded from reports and the receipt series (PLAT-07, D33).
- R7-AC5. Given any change of an order's status or amounts, then it is audited and ledger rows are append only (PLAT-04, D28).
- R7-AC6. Given an order is released or cancelled before payment, when the hold ends, then credit and wallet parts reserved for it are returned by ledger rows (F06) and nothing is charged.

**Meets.** PDPA: order data is staff only by role; the Accountant sees names, not phone or date of birth (D35). No double booking: one order, each hour its own row under BOOK-04. Club scope: orders carry the club ID. TEXT: status chips from P keys (Awaiting payment, Confirmed, Cancelled, No show).

**Canvas.** H-C13-My-bookings, H-C12-Confirmed, R-Receipt-TH and R-Receipt-EN (F13).

---

## R8 Checkout surface states

**Source.** PRD Layout and states, C10, C10b; Gaps A5.

**Requirement.** Checkout shows its states clearly and survives long text.

**Acceptance criteria.**

- R8-AC1. Given a slot is taken between selection and Pay, when the player taps Pay, then the order is refused with the slot unavailable message and nothing is charged (BOOK-04-AC4).
- R8-AC2. Given the network drops, when checkout loads or Pay is tapped, then the offline error shows with Try again (P-0327, P-0328) and nothing is booked or charged.
- R8-AC3. Given the longest Thai or English string for a line or code error, when checkout renders at 375 px, then buttons do not wrap and the summary scrolls (TEXT-06).
- R8-AC4. Given a guest reaches checkout, when they have not signed in, then sign in runs first and they return to checkout with the choice kept (F02 AUTH-01).
- R8-AC5. Given the coach picker shows coaches for the exact hour, when the hour changes, then the list updates live and a coach who no longer works that hour disappears (COACH-01; F07 owns the rule).

**Meets.** PDPA: not relevant. No double booking: R8-AC1. Club scope: per club. TEXT: all from keys.

**Canvas.** H-C10-Checkout, S-Error-Offline, F1-05-C10-Checkout.

---

## Proposed new text keys (D51)

The drafter proposes keys; the writers own the wording. Numbers come from the i18n role after `copy-index.csv` exists (D31). Existing keys are reused first.

- Code errors: code not valid, expired, wrong audience, outside its scope, below minimum spend, first booking only, used up, one code per order, partner code not for solo classes.
- Add-on not available (no price), student item not available to a player 18 or over, coach price not set, price changed since you looked (if Q2 says so).
- Summary lines that need variables replacing fixed numbers (Gaps A5).

No key is added by this draft.

## Open questions

All 9 earlier questions are answered by D62 to D70 and removed. None remain. Items outside this feature that touch it: the birthday discount and referral amounts are empty settings until the owner sets them (F14), and wording of new keys belongs to the writers (D51).
