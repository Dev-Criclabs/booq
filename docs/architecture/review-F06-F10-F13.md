# Review of the F06, F10 and F13 designs (Architect)

Read against `docs/architecture/apply-payment.md` and the code on `architect/foundation` (apply_payment 0404 to 0406).
Blocking points are marked **B**; the rest are small fixes or questions.

## The payment ports (F06 4.9, F13 4.1)

- Argument lists and result types match what `app.apply_payment` calls today, in the same order: `reserve_credit_and_wallet(order) boolean`, `grant_package(order) void`, `credit_wallet(kind, customer, amount, reason, dedupe_key, payment)`, `issue_receipt(order, payment, kind) uuid`. Execution by the worker only is right: `apply_payment` runs as the worker and the ports run inside its transaction.
- **`credit_wallet` should return the order id, not the ledger row id.** The caller needs the id of the `wallet_credit` order to give to `issue_receipt`. If the port returns the ledger row id, `apply_payment` must read `wallet_ledger.order_id`, which makes F05 depend on an F06 table (F05's migrations run before F06's and the table does not exist yet). The port can do the lookup itself in one line. Please change F06 4.9 and assumption A-12 to "returns the order id". A repeat with the same dedupe key then returns the same order id. (`pay_to_wallet`, migration 0406, already treats the result as an order id.)
- **B. Package orders with a booking (F06 4.4, flows H and I).** F06 says `grant_package` runs before the booking's `credit_reserve` inside the confirm transaction. `apply_payment` today confirms first and grants afterwards, and nothing reserves the credit that covers the booked hour from the package that was just granted (at Pay time that package does not exist, so F04 cannot have reserved it). Proposed order for an order with a package line and a booking: grant, then `reserve_credit_and_wallet(order)`, then `confirm_booking`, in one sub-block; any false or refusal undoes the sub-block and the whole amount goes to the wallet (R3-AC7, D87: nothing partly created). It needs two agreements before I change the function: (1) F04's Pay stores the allocation of such a line without a package id (a marker, for example `scope.new_package_line`), and (2) F06's `reserve_credit_and_wallet` resolves the marker to the package granted by this order. Please confirm both; I will then add the step in a small migration in the F05 block.
- Idempotency and the attempt number (A-13): fine with the late reclaim. `release_hold` (expired) runs the F06 release handler first, which returns the reservations, then `reserve_credit_and_wallet` reserves again with the next attempt; if it returns false the sub-block is undone and the value goes to the wallet.
- F06 needs a missing piece for `credit_wallet`: it says it creates "an order of kind `wallet_credit` with a line of kind `wallet_credit`". Today `orders` has no `kind` column and `order_line_kind_values` (0303) allows only `court_hour`, `coach`, `add_on`, `package`. No F06 migration in 0501 to 0510 adds either. Add a migration (0502 or 0510) that adds `orders.kind` (default `sale`) and the line kind, and states how a `wallet_credit` order satisfies the "lines add up to the amounts" check (money = the amount credited, no credit and no wallet part).

## F06

- **B. Setting keys (0508).** `package_expiry_reminder_days` is already registered (F01, 0041, with its entry in `settings-registry.ts` and a Tennis template value of `[14, 3]`); inserting it again fails the migration on the primary key. `wallet_expiry_days` is a second name for the existing key `wallet_expiry_months` (unset allowed, 0041 and the registry). Use the existing names and units; 0508 then has nothing to add.
- `package_product` is described as "F04's table": F04 has no such table yet (its `0301` creates price tables and add-ons only). Say which feature creates it. If F06 does, 0501 creates it and F04's order line already carries `package_product_id` as a plain uuid that 0501 should now give a foreign key.
- Migration order: the table lists 0510 before 0509 in the middle of the list; the files must apply in number order, so 0509 (claim handler) first. Fine as long as 0510 does not depend on anything in 0509.
- The release handler `f06_release` (0505) must be registered with an `ord` after F04's (`f04_entitlements`, 10) and F05's (`f05_payment_unavailable`, 20), because it returns credit and wallet; the order does not matter functionally but keep one rule: F04 10, F05 20, F06 30, F08 and F10 above 40.
- Credit return after expiry (D85) and the reserved-credit rule at expiry (D85, PKG-03-AC8) are consistent with `credit_eligible`; no change.
- Student credit after 18 (D84, A-6) is consistent with F04's rule.

## F10

- **B. `booking_released` must skip `payment_unavailable`.** F10's catalogue enqueues it from the release handler for every reason. A failed key check or an unreachable Beam is not a release the player should read as "your booking was released"; the T04a handler `f05_payment_unavailable` already assumes F10 skips that reason (F05 shows the screen error). Add the reason to the catalogue row.
- **`apply_payment` needs a message port.** The catalogue says `booking_confirmed` (`confirmed:{order_id}`) and `late_payment` (`late:{payment_id}`) are enqueued by F05. The ports table in `apply-payment.md` has no message port. Recommended: a fifth port `enqueue_message(kind text, user uuid, params jsonb, dedupe_key text, send_at timestamptz) returns uuid`, registered by F10's `0605_functions.sql`, so a missing sender fails closed like the others. I will add it to `app.payment_ports` and to `apply_payment` (one more step after receipt) as soon as F10 confirms the signature of `enqueue_message`.
- The same applies to F06 (`package_expiring` rows at grant, 4.5): F06 builds before F10, so either F06's reminders go through the same kind of port or F10's outbox (0601, 0605) is built first. State which.
- `booking_released` uses `released:{order_id}`: a second release of the same order after a reclaim would be dropped silently by the unique key. Rare and harmless, but write it down as accepted.
- `reminder_hours` (0607) is a new setting key: it needs a row in `app.setting_keys`, an entry in `packages/domain/src/club/settings-registry.ts` (a test keeps them equal), and, for the Tennis template, a new template item (a migration inserting `setting reminder_hours [24, 2]`; 0039 is merged and clubs started earlier do not get new template settings, which is fine before launch).
- The outbox `params` rule (ids and values, never names or phone) is right; add a CHECK or a trigger that refuses keys named like personal fields, the way the platform audit detail does, so it is enforced, not promised.

## F13

- `issue_receipt` signature, idempotency and the "counter lock taken last" rule are right and match `apply_payment` (the payment is already `succeeded` when the port is called, so "an order with no confirmed payment" is not hit; for a wallet outcome the payment passed is the Beam payment, also succeeded).
- **`receipt:prefix_missing` must not apply to the test series.** In Testing the number carries the `TEST` prefix (A-2) so the club prefix is not needed, but the check as written raises for any club without a prefix. Today a Testing club may have no prefix (Draft to Testing does not require it), so every test payment would roll back. Raise only for the real series; keep the Go live requirement (D106).
- Migration block: 0701 to 0799 is allowed. `tools/check-migrations.mjs` already accepts every number from 0501 up as the block `later`, so no change is needed there. Please keep each feature inside its block by convention (F06 05xx, F10 06xx, F13 07xx).
- The daily close reads `payment.confirmed_at`: for a cancelled-then-succeeded Beam payment (outcome `wallet_cancelled`, migration 0406) the money did arrive; it appears in the close as money received and as credited to the wallet, which the design already lists ("late and wrong amount wallet credits").
- Money by method from `payment` and not from receipts (4.2): agreed.

## Open questions for the orchestrator

1. B (package with a booking): confirm the marker and the order grant, reserve, confirm with F04 and F06.
2. `credit_wallet` returns the order id: yes or no.
3. A message port for `apply_payment` and for F06's reminders: yes or no.
