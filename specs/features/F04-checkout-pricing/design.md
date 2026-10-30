# F04 Checkout, pricing, add-ons and promo codes · Design

Status: **Approved 30 Oct 2026** (gate 2; decision D82, with all assumptions). Drafted 30 Oct 2026 by the Architect role from the approved F04 requirements (`requirements.md`, approved 30 Oct 2026, `docs/decisions.md` round 8) with decisions D18 to D37 and D62 to D70 applied. Tasks (gate 3) are written next; a change to anything below goes through the PRD, then the hand-off, then this file.

Feature: F04 Checkout, pricing, add-ons and promo codes. Requirement IDs: PAY-07, PROMO-01, and the checkout rules R1 to R8 (local to the requirements file; the hand-off has no IDs for them). Uses COACH-02 to COACH-04 (F07 owns them) and BOOK-06. Depends on F03. Wave 2.

Shared decisions are in `docs/architecture/foundation.md` (revision 8), cited as **FA §n**; F01, F02 and F03 designs as **F01 §n**, **F02 §n**, **F03 §n**.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| R1 Price groups and the player's price | §3.2 price tables; §4.2 step 2; D62 |
| R2 Order lines and the solo class price | §4.2 step 1; §4.6 |
| R3 Add-ons | §3.2 `add_on`; §4.2; §5.3 |
| R4 Order of use and the amount due | §4.3 allocation; §3.2 `order_line` invariants; D22, D23, D68 |
| PAY-07 Nothing left to pay | §4.5 Pay flow; D64 |
| PROMO-01 Promo and referral codes | §4.4; §3.2 `promo_code`, `promo_redemption`; D65 to D70 |
| R5 Birthday discount | §4.4; `birthday_entitlement_use` |
| R6 Bundle prompt | §4.7 |
| R7 Order record and receipts | §3.2 `orders`, `order_line`; §4.5; D40, D64 |
| R8 Checkout surface states | §5.1 error codes; §9 tests |
| CC-1 to CC-6 | §10 |

## 2. What this design does not build

The hold (F03, called from §4.5), Beam and the late payment decision (F05), package products and the bundle bill (F06), the coach picker and coach availability (F07), cancel and closure (F09; F04 supplies the per-line records and the restore functions), the birthday and referral reward values and messages (F14), receipts (F13), LINE messages (F10), and the screens A9, A9b and A10 (F11, which call the owner routes in §5.3).

## 3. Data and migrations

### 3.1 Migration order

F04 uses numbers 0301 to 0307, after F03 (0201 to 0207). Rules and conventions are FA §2.1.

| File | Contents |
|---|---|
| `0301_price_tables.sql` | `price_group`, `court_price_rule`, `coach_tier`, `coach_tier_price`, `add_on` (class S, created here although FA §2.2 lists them as setup tables) |
| `0302_promo.sql` | `partner`, `promo_code`, `promo_redemption`, `birthday_entitlement_use` (class D) |
| `0303_orders_extend.sql` | New columns on F03's `orders` shell; `order_line` with allocation columns and the sum invariant |
| `0304_functions.sql` | `app.count_promo_use`, `app.restore_order_entitlements`, `app.restore_line`, the allocation constraint trigger |
| `0305_template_handlers.sql` | Template handlers (F01 `apply_template`) for price groups, court price rules, coach tiers, add-ons |
| `0306_grants_policies.sql` | Policies and grants |
| `0307_settings_keys.sql` | Registry rows for the F04 settings (birthday discount shape, F14 sets the value) |

Each table is registered in `packages/db/table-classes.ts`, `app.test_tables` (D tables) and the audit registry (FA §8.1).

### 3.2 Tables

**Setup tables (class S, visible in the BOOQ support view as "products and pricing", decision D27):**

- `price_group (club_id, id, name_th, name_en, rule jsonb, position)`. Hunter: Adult (18 and over), Student (under 18). The rule is `{min_age, max_age}`; the player's group is computed by F02's `price_group_for`, never stored on the player.
- `court_price_rule (club_id, id, price_group_id, day_type in ('any','weekday','weekend'), peak in ('any','peak','off_peak'), price_satang)`. Unique on the four key columns. Hunter has one rule per group with `any`/`any` at 50000 satang. **How "peak" is defined is not in the spec, so no peak window is built in v1** (assumption A-4): a club whose rules need `peak` or `off_peak` needs a spec decision first, and the lookup rejects a rule set that uses them until then.
- `coach_tier (club_id, id, name_th, name_en)` and `coach_tier_price (club_id, tier_id, price_group_id, price_satang null)`. A null price means "not set": Head Coach is empty (R2-AC3). F07 owns the coach and the per coach override.
- `add_on (club_id, id, name_th, name_en, price_satang null, active, position)`. Null price means not for sale (R3-AC1). The Tennis template seeds the balls add-on with exactly "Balls (Set of 3 balls)" and "ลูกเทนนิส (ชุด 3 ลูก)" (R3-AC7); a test compares the template values with the PRD strings.

**Club data (class D):**

- **`orders`** (shell from F03) gains: `price_group_snapshot`, `subtotal_satang`, `discount_satang`, `total_satang` (after discounts), `credit_value_satang`, `wallet_satang`, `money_satang` (= amount due), `promo_code_id`, `birthday_entitlement`, `quote_hash`, `priced_at`. Invariant (constraint trigger, deferred): `total_satang = credit_value_satang + wallet_satang + money_satang`, and each of these equals the sum over its lines.
- **`order_line (club_id, id, order_id, position, kind, booking_id null, add_on_id null, package_product_id null, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang, credit_package_id null, credit_units, credit_value_satang, wallet_satang, money_satang, scope jsonb)`**. `kind` is `court_hour`, `coach`, `add_on` or `package` (F06). A court hour or coach line links its `booking_id` so F09 can return value hour by hour (D21, D40). CHECK: `net_satang = unit_price_satang - discount_satang` and `net_satang = credit_value_satang + wallet_satang + money_satang`. All amounts are integer satang and non-negative. Names are copied in at Pay, so a later price or name change never changes a paid or held order (R7-AC2). **An add-on line links the booking of the first hour of its order (decision D111).**
- **`partner (club_id, id, name, type, contact)`**.
- **`promo_code (club_id, id, code_upper unique per club, kind in ('percent','fixed'), value_bp_or_satang, applies_to text[] , includes_add_ons bool, audience in ('adult','student','any'), starts_on, ends_on, first_time_only, total_cap null, per_customer_cap null, min_spend_satang null, stackable_with_birthday, partner_id null, active)`**. Codes are matched case-insensitively. `applies_to` uses the line kinds plus `solo_class`, `package`, `group_class`.
- **`promo_redemption (club_id, id, code_id, order_id, customer_id, status in ('counted','restored'), counted_at, restored_at, restore_reason)`**, unique `(club_id, order_id)` (one code per order, PROMO-01-AC1). A restored row stays for history and no longer counts (decision D70).
- **`birthday_entitlement_use (club_id, customer_id, year, kind in ('package','solo_class'), order_id, status in ('used','restored'))`**, unique `(club_id, customer_id, year, kind)` where status is `used`.

Indexes lead with `club_id`: `promo_redemption (club_id, code_id, status)`, `(club_id, customer_id, code_id, status)`; `order_line (club_id, order_id, position)` and `(club_id, booking_id)`.

## 4. Behaviour

### 4.1 The pricing engine

Pricing is a pure function `priceOrder(input) -> quote` in `packages/domain/pricing`: no database access, no clock. The route loads the inputs inside a transaction (rules, prices, the player's group, eligible credits, wallet balance, code and entitlements) and passes them in. Everything is integer satang; a percentage is integer basis points; **rounding is half up to the satang** (decision D23): `discount = (price * bp + 5000) div 10000`. The function is covered by property tests (§9).

### 4.2 Building the quote

1. **Lines.**
   - Court hour lines: one per hour in the selection, with `booking` created at Pay (BOOK-06). The price is the single `court_price_rule` that matches the hour's Bangkok weekday or weekend and the player's group; no rule means the hour is **not offered and the request is refused** (R1-AC5; F03's schedule asks `app.court_hour_priced()` so the hour is hidden, see Follow-ups).
   - Coach line: when a coach is picked, one line at `coach_tier_price` for the player's group (or the coach's override from F07). An unset price means the coach cannot be picked (R2-AC3). A coach picked at court checkout never uses solo pack credits (`coach_source = 'checkout'`, COACH-03); through Classes (`coach_source = 'classes'`) the credit may cover the coach line and the court line stays due (COACH-04, R2-AC5).
   - Add-on lines: only active add-ons with a price (R3-AC1, AC4); the client sends choices, never amounts (CC-2); several add-ons collapse into one row in the UI only.
2. **Price group (R1, decision D62).** Computed from F02's `price_group_for(dob, today in Bangkok)`; no date of birth gives Adult (D12). A Student item (package, class or price sold only to under 18) is refused for a player 18 or over; an **Adult item may be bought by a player under 18** (D62).
3. **Discounts (§4.4).**
4. **Allocation (§4.3).**
5. **Total, amount due, cancellation line.** The summary lists the item, add-ons, birthday discount, code, credits, wallet and amount due, with the club's cancel window as `{hours}` (R4-AC5). The quote carries a `quote_hash`, the SHA-256 of its canonical JSON.

### 4.3 Order of use and allocation (R4, decisions D22, D23)

After discounts, each line has a `net_satang`. Allocation is deterministic:

1. **Package credit first.** For each line in position order, ask F06 for an eligible credit of the right type, tier and audience (a Student credit does not apply to an Adult item, R4-AC6). A credit covers the **whole net of the line it fits** (a bundle hour covers a court hour line; a solo pack credit covers the coach line only, R4-AC2); `credit_units` is 1 and `credit_value_satang` is the net it covered.
2. **Then the wallet.** The remaining net, in line order, is paid from the wallet up to the balance (R4-AC3); a line can be part wallet, part money.
3. **Then money** (Beam or cash): the remainder, `money_satang`.

Each line stores its three parts so a later cancel can return package credit to the package, money paid (Beam or cash) to the wallet, and wallet use to the wallet (R4-AC8, D21). The sum of line amounts equals the order total exactly (R4-AC4); the database enforces it with the constraint trigger.

### 4.4 Discounts: birthday entitlement and the one code (PROMO-01, R5)

- **One code per order** (PROMO-01-AC1); the referral code from a friend uses the same field and is resolved by F14's `resolveReferral(code, customer)`, which blocks the player's own code by LINE ID and phone (PROMO-01-AC11). A code of another club and one that does not exist return the same `code_not_valid` (AC9).
- **Scope.** A code discounts only lines in its `applies_to`; **add-ons are excluded unless `includes_add_ons`** (decision D23, R3-AC5). A partner code (`partner_id` set) is refused when the order contains a coach line, `code_not_for_solo_class` (AC8, Gaps A4).
- **Value.** Percent: per in-scope line, half up. Fixed: capped at the in-scope total (AC4) and split across the in-scope lines **by each line's price** (decision D67) using the largest-remainder method so the shares are whole satang and sum exactly (assumption A-6).
- **Checks, each returning a typed reason** (AC5, AC6): dates, audience, scope, **minimum spend, checked on the order total before credits and wallet** (decision D68, assumption A-3: the total of all lines before any discount), first time only (the customer has no confirmed, no-show or late-cancelled booking; assumption A-1), caps.
- **Counting (decision D66).** A code use is counted **at Pay**, inside the Pay transaction, after locking the `promo_code` row (FA §3.4 step 2b): total cap, per customer cap and first-time rules are checked against `promo_redemption` rows with status `counted`. Two players taking the last use in parallel: exactly one succeeds (AC7). A use is **restored** when the hold ends (`release_handlers`) or the booking is cancelled 12 hours or more ahead (F09), by setting the row to `restored`.
- **Several hours (decision D67).** The code's discount is stored as a share on each hour's line. Cancelling one hour returns that hour's money parts to their sources (F09 uses the line's stored parts, so the share is already netted in); the **code use is restored only when every hour of the order is cancelled**. A restored use reduces the partner redemption count (decision D70), since reports count `counted` rows only.
- **Birthday discount (R5).** Applies automatically, once each per calendar year, to one package and one solo class in the player's birth month, when the setting `birthday_discount` (`{kind, value}`, F14 sets it) is not empty and a date of birth is on file (R5-AC1 to AC4). Use is recorded in `birthday_entitlement_use`; it is restored with the booking on a 12+ hour cancel (R5-AC5).
- **Stacking (decision D65, PROMO-01-AC2).** If the code is `stackable_with_birthday`, both apply (the code discount is computed on the amounts after the birthday discount). If it is not, the engine computes both options and **the larger discount wins**; on a tie the code wins (assumption A-2).
- **Percent versus fixed total.** The order discount never exceeds the price of the items in scope.

### 4.5 The Pay flow (one transaction)

`POST /checkout/pay` (needs a signed in person; guests are sent to sign in and return with the choice kept, R8-AC4):

1. **Gate.** Club status (a Paused club refuses new holds from everyone, F03 §4.2; decision D60), feature switches, and the limit on repeated Pay taps (F03 §4.8).
2. **Reprice (decision D63).** Recompute the quote from current prices. If its hash differs from the `quote_hash` the client sent, the server creates **nothing**, returns `price_changed` with the new quote, and the player confirms again. The price is fixed from the moment Pay succeeds (R4-AC9, R7-AC2).
3. **Transaction**, in the lock order of FA §3.4: customer advisory lock; coach; wallet account and eligible packages; the `promo_code` row; then `reserve_court` (F03) which creates the bookings and holds; then the `orders` and `order_line` rows; reserve the credit and wallet movements through F06's functions (ledger rows tied to the order, never a number); count the code use; record the birthday entitlement.
4. **Zero money (PAY-07, decision D64).** If `money_satang = 0`, confirm in the same transaction through `confirm_booking` (F03): no Beam charge, no QR, the hold is not visible. A taken slot refuses the whole order and nothing is used up (AC2). A zero money order still gets a receipt in the same series, showing how it was paid (F13). A 100 percent code makes the money part zero and follows the same path (AC3). Any failed step rolls everything back (AC5).
5. **Money due.** Otherwise the order is `open` with the hold from F03; after commit F05 creates the Beam charge for `money_satang` and the player sees C11. If the Beam call fails the hold is released and every restore handler runs.
6. **Second tap.** F03's lookup returns the same order and hold; F05 returns the same payment and QR (decision D47). The quote hash is not re-evaluated for a repeat of the same intent.

Response: `{ orderId, holdExpiresAt | null, payment | null, confirmed }`.

### 4.6 Solo class from court checkout and after booking

A coach picked on C10 turns the selected hour into a solo class: the order has the court line and a coach line, and F03 holds court and coach together (F03 §4.2 step 9, R2-AC8). The coach picker and its rules are F07's; F04 only prices. "Add a coach" after booking (C12, R2-AC9) is an F07 flow that calls `priceOrder` for the coaching portion only and creates a second order on the existing booking.

### 4.7 Bundle prompt (R6)

When the player has no court hour credit, the order is a full price court order, and F06's court bundle product has a price, the quote carries `bundleOffer { productId, price, hoursUsedNow: 1 }` (R6-AC1, AC4). Declining changes nothing (AC2). Accepting sends `withBundle: productId` to Pay; F06 adds the package line and the credit that covers one hour, handled as one bill (C10P) under the same hold (AC3). The package line is part of this order; F06's design owns its fields.

### 4.8 Order status and restores

Order status: `open` (hold running or awaiting payment), `paid`, `released` (hold ended), `cancelled` (F09). Amounts never change after Pay. Hooks:

- `app.restore_order_entitlements(order, reason)`: registered in `app.release_handlers` (F03 §4.5); restores the code use, the birthday entitlement, and tells F06 to return reserved credit and wallet (R7-AC6).
- `app.restore_line(line)`: for F09, returns nothing itself but reports the line's stored parts; the code use is restored when the last live line of the order is cancelled (decision D67).

## 5. API routes (prefix `/api/c/{slug}`)

Conventions as FA §9: typed codes, no text; no club id in bodies; the client sends choices, never amounts (CC-2); 404 for out of reach; `Idempotency-Key` on Pay.

### 5.1 Player

| Method and path | Permission | Purpose |
|---|---|---|
| `POST /checkout/quote` | needs a person | Body: selection (court, hours, coach, `coach_source`), add-ons, code. Returns the priced quote with lines, discounts, credits, wallet, amount due, `quote_hash`, optional `bundleOffer`, or typed errors |
| `POST /checkout/pay` | needs a person | §4.5 |
| `GET /orders/{id}` | own, staff | The stored snapshot for C12 and receipts |

Typed codes: `sign_in_required`, `price_changed`, `price_not_set`, `add_on_not_for_sale`, `student_item_not_allowed`, `coach_price_not_set`, `code_not_valid`, `code_expired`, `code_wrong_audience`, `code_out_of_scope`, `code_below_minimum`, `code_first_booking_only`, `code_used_up`, `one_code_per_order`, `code_not_for_solo_class`, `club_paused`, `too_many_attempts`, and the F03 codes. Each maps to a locale key (§11).

### 5.2 Staff

Staff bookings (A2) call the same pricing with `source = staff`: `POST /staff/orders/quote` and `POST /staff/orders/pay`, permission `booking.create.staff` (front desk, owner). Cash and its reason code are F05's PAY-06 and are applied at `pay` when the staff member chooses cash.

### 5.3 Owner setup (screens A9, A9b, A10 are F11)

`GET/POST/PUT` on `/setup/price-groups`, `/setup/court-prices`, `/setup/coach-tier-prices`, `/setup/add-ons`, `/setup/partners`, `/setup/promo-codes`. Permission `pricing.write` (owner only; read for front desk where needed to take bookings and for the accountant to read). Every write is audited (R3-AC8, PROMO-01-AC12) and **applies to new orders only**; deleting a price used by a held or paid order is not possible (the lines hold copies). Settings used here (birthday discount, cancel window) come from F01's registry.

## 6. Jobs

None of its own. Hold expiry and its restores run through F03's `hold_release` and `release_handlers`.

## 7. State machines

Order: `open` to `paid` or `released`; `paid` to `cancelled` (F09); the allocation and prices are fixed at `open`. Code use: `counted` to `restored`. Birthday entitlement: `used` to `restored`.

## 8. Permission checks

| Permission | Guest | Player | Coach | Front desk | Accountant | Owner |
|---|---|---|---|---|---|---|
| quote and pay | sign in first | yes | yes (as a player) | yes (as a player) | yes (as a player) | yes (as a player) |
| `orders.read.own` | | yes | yes | yes | yes | yes |
| `orders.read.all` | | | | yes | names only (D35) | yes |
| `pricing.read` | | | | yes | yes | yes |
| `pricing.write` | | | | | | yes |
| staff quote and pay | | | | yes | | yes |

Staff booking as a player pays as a player (ROLE-01-AC4). Row policies follow FA §4.3. BOOQ staff see the S tables (courts and pricing, add-ons, price groups) in the support view and never `orders`, `order_line`, `promo_redemption` or `partner` redemptions (promo codes and partners are not in the setup view, decision D27).

## 9. Tests (written first at the build step)

| Test | Covers |
|---|---|
| Adult with a Coach tier coach: court 50000 + coach 80000 = 130000; Student: 70000 + 50000 = 120000 | R2-AC1, AC2 |
| Head Coach with no price cannot be picked; add-on with no price is not offered | R2-AC3, R3-AC1 |
| Coach from court checkout charges the full coaching price even with solo credits; through Classes the credit covers the coach line and the court is due | R2-AC4, AC5, COACH-03, COACH-04 |
| Two hour selection: two court lines and bookings, total is the sum | R2-AC7, BOOK-06 |
| Under 18 buys an Adult item; 18 or over buying a Student item is refused; no date of birth is Adult | R1-AC2, AC6, AC7, D62 |
| No price rule for an hour: refused and not offered | R1-AC5 |
| Order of use: credit, then wallet, then money; wallet larger than the rest takes only the rest; a wrong audience credit is not applied | R4-AC1 to AC3, AC6, D22 |
| Property test: for random prices, percentages (rounded half up), fixed codes, credits and wallets, the sum of lines equals the order total and equals credit plus wallet plus money, always | R4-AC4, D23 |
| Code: one per order; expired, wrong audience, out of scope, below minimum, first time only, used up each give the right typed reason; another club's code looks the same as a missing code | PROMO-01-AC1, AC5, AC6, AC9 |
| Add-ons excluded from a code unless it says so; fixed code capped at in-scope total | R3-AC5, PROMO-01-AC3, AC4 |
| Partner code on a solo class refused | PROMO-01-AC8 |
| Stackable code plus birthday: both; non stackable: the larger wins, tie to the code | PROMO-01-AC2, D65 |
| Two players take the last use of a capped code in parallel: exactly one | PROMO-01-AC7 |
| A code use is counted at Pay and restored when the hold ends, and on a 12+ hour cancel; with two hours, cancelling one keeps the code used, cancelling both restores it; the partner count drops | D66, D67, D70 |
| Birthday entitlement once per kind per year; restored with the booking; no date of birth or empty value gives none | R5 |
| Minimum spend uses the total before credits and wallet | D68 |
| Price changed after checkout opened: nothing created, `price_changed` with the new quote, a second confirm succeeds | D63 |
| Zero money order confirms at once with no Beam call; a taken slot refuses and nothing is used; a 100 percent code confirms; failure rolls back all | PAY-07-AC1 to AC5 |
| Zero money order has a receipt in the real series (Testing: the test series) showing how paid | D64, R7-AC3, AC4 |
| Order snapshot unchanged after prices and names change | R7-AC2 |
| Test orders flagged and excluded from reports | R7-AC4, D33 |
| Money display: whole baht when whole, two decimals otherwise | D69 |
| Paused club refuses Pay; a taken slot at Pay refuses and charges nothing; offline shows P-0327/P-0328 | R4-AC10, R8-AC1, AC2 |
| Static: no hard coded text, no amount accepted from the client | CC-2, CC-5 |

## 10. How the cross-cutting rules are met

- **Club ID scope (CC-1):** every table carries `club_id` with composite keys; a code lookup is by `(club_id, code_upper)` and answers the same for missing and foreign codes.
- **Server side (CC-2):** the client sends choices only; the server computes everything, the quote hash binds the price shown to the price charged.
- **PDPA (CC-3):** orders are staff-by-role data; the Accountant sees names only (D35); BOOQ staff have no grant on order tables; the date of birth is used only to pick the group and the birthday month.
- **No double booking (CC-4):** pricing never reserves; Pay calls `reserve_court`; a price or code change never touches a hold; solo class court and coach are held together.
- **TEXT (CC-5):** all text by key with named variables `{amount}`, `{code}`, `{court}`, `{date}`, `{time}`, `{coach}`, `{hours}`, `{minutes}`; money is formatted by the shared formatter (D69); the fixed numbers in the canvas lines become variables (Gaps A5).
- **Other (CC-6):** satang everywhere; Bangkok dates for the weekday rule, the age and the birthday month; no price, amount or setting invented (empty settings stay empty).

## 11. Text keys and canvas boards

**Existing keys:** P-0327, P-0328 (offline), P-0442 (paused). The rest by lookup from `copy-index.csv` (D31).

**New keys proposed by the drafter (D51; writers own the wording; numbers assigned by the content role):**
- Code errors: not valid, expired, wrong audience, outside its scope, below minimum spend (`{amount}`), first booking only, used up, one code per order, partner code not for solo classes.
- Add-on not available, student item not available to a player 18 or over, coach price not set, "the price changed since you looked" with the new amount (`{amount}`), payment unavailable.
- Summary lines that replace the fixed numbers (Gaps A5).

**Canvas boards used:** H-C10-Checkout, G-C10-Add-coach-checkout, G-C10-Coach-picked, G-C10-Credit-covered, G-C10-Referral-discount, H-C10b-Checkout-solo, G-C10b-Solo-with-credit, H-C10c-Checkout-bundle-prompt, G-C03-Birthday, H-C10P-* (F06), H-C12-Confirmed, S-Error-Offline, H-A09-Pricing, H-A09b-Pricing-groups, H-A10-Promotions and the T- twins. Gaps used: A4 (PARTNER100 on C10b is a canvas bug), A5.

## 12. Assumptions to confirm on approval

| Id | Assumption |
|---|---|
| A-1 | "First time only" means the player has no booking with status confirmed, no show or late cancelled (released and cancelled do not count) |
| A-2 | On a tie between the birthday discount and a non stackable code, the code wins |
| A-3 | Minimum spend is checked on the total of all lines before any discount, credit or wallet |
| A-4 | Peak and off peak pricing is not built in v1 (the spec does not define peak); Hunter's rule is `any`/`any` |
| A-5 | The price group is evaluated at the Bangkok date of Pay |
| A-6 | A fixed code discount is split across in-scope lines by the largest-remainder method |
| A-7 | "Cancelling one hour restores that hour's share" (D67) is read as: the money parts of that hour, already net of its discount share, return to their sources; the code use itself is restored only when every hour is cancelled |
| A-8 | The zero money receipt is issued by F13 at confirmation, in the real series, with methods credit and wallet shown |
| A-9 | The quote hash is the SHA-256 of the canonical quote JSON and is not a secret |

## 13. Follow-ups owned by other features

- **F03:** the schedule route (`GET /schedule`, F03-T20) must call `app.court_hour_priced()` so an hour with no price rule is not offered (R1-AC5); add this to F03-T20 when the tasks are next edited.
- **F06:** eligible credits function, credit and wallet reserve functions, bundle line, release handler.
- **F07:** coach price lookup and override, coach source flag.
- **F09:** use the stored line parts for returns and call `restore_line`.
- **F13:** receipts for zero money orders and test series.
- **F14:** referral resolver and the birthday discount value.
