# F04 Checkout, pricing, add-ons and promo codes · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 by the Architect role from the approved design (`design.md`, approved 30 Oct 2026, decision D82). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs. Rules R1 to R8 are local to `requirements.md`.

Roles: **BE-C** back end commerce, **FE-P** front end player app, **FE-A** front end admin, **Arch**, **QA**, **Content**.

Depends on: F01 T06 (club), T10 and T11 (audit), T12 (people), T26 (test flag); F02 T13 (`price_group_for`); F03 T01 to T14 (orders shell, `reserve_court`, `confirm_booking`, release handlers). F06 supplies the credit and wallet functions the allocation calls; until it exists those calls go through an interface with a fake.

Migration numbers are 0301 to 0399. Amounts are integer satang; nothing here invents a price, a window or a setting (design 10).

## A. Tables

- [x] **F04-T01** Migration 0301: `price_group`, `court_price_rule`, `coach_tier`, `coach_tier_price`, `add_on` (class S, composite keys, unique rule key, null price means not set). IDs: R1, R2-AC3, R3-AC1, CC-1. Role: Arch · Deps F01-T06 · Size: S
  Tests first: one rule per group, day type and peak; a null coach tier price and a null add-on price are allowed and mean "not for sale"; another club's price group cannot be referenced; the S tables hold no personal column.
  - Built (Architect): `0301_price_tables.sql`; class S; read by the club's people, written by the owner; audited. Null price = not for sale. Peak and off-peak are allowed in the table and rejected by the lookup (A-4).
- [x] **F04-T02** Migration 0302: `partner`, `promo_code`, `promo_redemption`, `birthday_entitlement_use` (class D). IDs: PROMO-01-AC1, AC7, R5-AC3, decisions D66, D70. Role: Arch · Deps T01 · Size: M
  Tests first: `code_upper` unique per club and matched in upper case; one redemption row per order; a restored row stays and does not count; the birthday entitlement is unique per customer, year and kind while `used`; a code row is invisible to BOOQ staff.
  - Built (Architect): `0302_promo.sql`; `partner`, `promo_code` (code_upper, constraints on value, scope, dates, caps), `promo_redemption` (one per order; restored rows stay), `birthday_entitlement_use` (once per kind and year while used). Registered for the test flag (purge order 250). Codes are looked up only through the definer functions of T04; a player reads none.
- [x] **F04-T03** Migration 0303: the frozen price columns on `orders`, and `order_line` with the allocation columns, the two CHECKs and the deferred sum invariant. IDs: R4-AC4, R7-AC1, AC2, decisions D23, D40. Role: Arch · Deps F03-T01, T01 · Size: M
  Tests first: `net = unit - discount` and `net = credit + wallet + money` per line; the order columns equal the sums of their lines at commit; a negative amount is refused; the stored lines do not change when a price rule changes; a line cannot point at another club's booking.
  - Built (Architect): `0303_orders_extend.sql`. Orders gain the frozen amounts, null until Pay (`priced_at`; an unpriced order is never free: T04 makes it need payment). `order_line` with the two CHECKs and the booking, add-on and package links (D111), append-only. Deferred constraint triggers: a priced order's amounts equal the sums over its lines at commit, and a priced order's price never changes (status still does). Lines are test rows in Testing and go at Go live before bookings and orders (purge order 150).
- [x] **F04-T04** Migration 0304: `app.order_needs_payment` replaced by the frozen amount due; `app.restore_order_entitlements` registered in `app.release_handlers`; `app.restore_line`; `app.count_promo_use` under the promo row lock. IDs: PAY-07-AC1, PROMO-01-AC7, decisions D64, D66, D67. Role: Arch · Deps T02, T03, F03-T06, F03-T10 · Size: M
  Tests first: an order with money due 0 does not need payment and one with more than 0 does; the last use of a capped code goes to exactly one of two parallel callers; a released hold restores the code use and the birthday entitlement; cancelling one hour of two keeps the use, cancelling both restores it.
  - Built (Architect): `0304_order_functions.sql`. `app.order_needs_payment` (unpriced: true; priced: `money_satang > 0`; F05 adds the cash record). Pay writes the frozen amounts on the order **before** `reserve_court`, then inserts the lines after the bookings exist (the sum check is deferred to commit), so a zero money order takes no hold and is confirmed in the claim. `app.count_promo_use(code, order)` (under the code row lock; errors `promo:code_not_valid`, `code_expired`, `code_used_up`, `code_first_booking_only`, `one_code_per_order`, `order_not_found`), `app.use_birthday_entitlement(kind, order)` (birth month in Bangkok, once per kind and year; `birthday:not_entitled`, `already_used`), `app.restore_order_entitlements(order, reason)` registered as release handler `f04_entitlements` (order 10), `app.restore_line(line, reason)` for F09 (call after the booking status is set; restores the code and birthday only when every hour is cancelled or released; a late cancellation never restores). Scope, audience, minimum spend and value stay in the engine.
- [ ] **F04-T05** Migration 0306: read policies and grants for the new tables, S table grants for BOOQ staff on the price tables only (support view), registry entries, tenant and blind suites extended. IDs: CC-1, PLAT-02-AC1, PDPA-01-AC1. Role: Arch · Deps T04, F01-T18 · Size: S
  Tests first: club A cannot read club B's prices, codes or orders; `booq_platform` reads the price tables of an assigned club and nothing of `orders`, `order_line`, `promo_code`, `promo_redemption`, `partner`.
- [ ] **F04-T06** Migration 0307 and the template handlers (migration 0305): settings registry rows for the birthday discount shape; `apply_template` handlers for price groups, court price rules, coach tiers and add-ons (the Tennis template carries Hunter's values as data, the Blank template none). IDs: R5-AC1, R3-AC7, PLAT-05-AC7. Role: Arch · Deps T01, F01-T23 · Size: S
  Tests first: the Tennis add-on name equals the PRD string exactly in both languages; the Blank template creates no price; a later template edit changes no existing club.

## B. Pricing engine (pure code)

- [ ] **F04-T07** `priceOrder` in `packages/domain/pricing`: lines, price group, rounding half up, discounts, allocation, `quote_hash`. No database, no clock. IDs: R1 to R4, D22, D23, D62, D68. Role: BE-C · Deps none · Size: M
  Tests first: the worked examples of design 9 (Adult 50000 + coach 80000 = 130000; Student 70000 + 50000 = 120000); a property test that the lines always sum to the order total and to credit + wallet + money; half-up rounding; no rule means the hour is refused.
- [ ] **F04-T08** Promo and birthday rules in the engine: scope, add-ons excluded unless included, fixed code capped and split by price with largest remainder, minimum spend on the pre-credit total, stacking and "the larger wins, tie to the code". IDs: PROMO-01-AC2 to AC6, AC8, R5, D65, D67, D68. Role: BE-C · Deps T07 · Size: M
  Tests first: each typed refusal reason; partner code on a solo class refused; stackable code plus birthday gives both; not stackable gives the larger; fixed shares sum exactly.
- [ ] **F04-T09** Money formatter (whole baht when whole, two decimals otherwise) in `packages/i18n`. IDs: D69, CC-5. Role: Content/BE-C · Deps none · Size: S
  Tests first: 50000 satang is "500", 50050 is "500.50", Thai and English, Gregorian dates untouched.

## C. Routes and the Pay flow

- [ ] **F04-T10** Loader and `POST /checkout/quote`: reads rules, prices, the player's group, eligible credits, wallet balance, code and entitlements in one transaction and calls the engine; typed errors; no amount accepted from the client. IDs: R1 to R4, R8, CC-2. Role: BE-C · Deps T07, T08, T01, T02 · Size: M
  Tests first: the client sends choices only; another club's code answers as a missing code; an unset coach price cannot be picked.
- [ ] **F04-T11** `POST /checkout/pay`: gate, reprice and `price_changed`, the lock order of FA 3.4, `reserve_court`, order and lines, credit and wallet reservation through F06 (interface), code count, birthday record; the zero money path through `confirm_booking`. IDs: PAY-07, R4-AC9, R7, D63, D64. Role: BE-C · Deps T04, T10, F03-T08, F03-T13 · Size: L
  Tests first: a changed price creates nothing and returns the new quote; zero money confirms in the same transaction with no charge; a taken slot refuses and nothing is used up; a 100 percent code follows the zero path; any failed step rolls everything back; the second tap returns the same order.
- [ ] **F04-T12** `GET /orders/{id}` and the staff routes `POST /staff/orders/quote` and `/pay`. IDs: R7-AC2, ROLE-01-AC4, CC-2. Role: BE-C · Deps T11 · Size: S
  Tests first: own or staff only; the snapshot is unchanged after prices and names change; staff booking as a player pays as a player.
- [ ] **F04-T13** Owner setup routes `/setup/price-groups`, `/court-prices`, `/coach-tier-prices`, `/add-ons`, `/partners`, `/promo-codes`, audited, new orders only. IDs: R3-AC8, PROMO-01-AC12. Role: BE-C · Deps T05 · Size: M
  Tests first: owner only; a price in use by a held or paid order cannot be deleted; every write has an audit entry with old and new values.
- [ ] **F04-T14** Bundle prompt in the quote (R6) once F06's court bundle product exists. IDs: R6-AC1 to AC4. Role: BE-C · Deps T10, F06 · Size: S
  Tests first: offered only without court credit on a full price order and when the product has a price; declining changes nothing.

## D. Screens

- [ ] **F04-T15** C10 Checkout summary and C10P bundle bill from the hi-fi boards, all text by key. IDs: R4-AC5, R6, R8. Role: FE-P · Deps T10, `packages/contract` schema · Size: M
- [ ] **F04-T16** C11 handoff and the checkout error and offline states (P-0327, P-0328, P-0442). IDs: R8-AC1 to AC4. Role: FE-P · Deps T11 · Size: S
- [ ] **F04-T17** A9, A9b, A10 setup screens (F11 owns the shell). IDs: R3-AC8, PROMO-01-AC12. Role: FE-A · Deps T13 · Size: M

## E. Sweep

- [ ] **F04-T18** Acceptance sweep: every acceptance criterion of `requirements.md` has a test, no hard-coded text, no client amount, test orders excluded from reports. IDs: CC-2, CC-5, D33. Role: QA · Deps T11 to T13 · Size: S
