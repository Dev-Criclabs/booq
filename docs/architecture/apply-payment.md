# `app.apply_payment`: states, order of checks and the F06 and F13 ports (Architect)

F05 design 5.4 lists the cases. This note fixes how the database does them, in the three migrations of F05-T05a, b and c, and the interfaces to F06 (credit, wallet, packages) and F13 (receipts) which do not exist yet. Nothing here changes a rule; where the design leaves a choice, the recommended default is written down (D147).

## Entry point and who may call
`app.apply_payment(p_payment uuid, p_received_satang integer) returns jsonb`. SECURITY DEFINER, the club from `app.club_id()`, executable by `booq_worker` only (the webhook and the lookup run as the worker; `confirm_booking` and `reclaim_order` already insist on that). The amount and the reference have been checked by the caller (T08b); a wrong amount never reaches here (design 5.5). The result is `{outcome, order_status}` where outcome is one of the `payment_outcome_values` of migration 0401.

## Order of checks (lock order of FA 3.4: order, then bookings, then payment)
1. Lock the order row, then the payment row. A payment of another club or order mismatch: `payment:not_found`.
2. Payment already `succeeded`: return its stored outcome (a repeated callback changes nothing; the `late_payment:{payment}` dedupe key makes the wallet path safe too).
3. Payment `cancelled` by cash (T05c): it still receives money. Mark it `succeeded`, outcome `wallet_cancelled`, and send the received amount to the wallet (PAY-06, D74 guard). The order is not touched.
4. Order already `paid` (a second success): outcome `wallet_duplicate`, amount to the wallet, reason `duplicate_payment`.
5. Order `cancelled` (or a cancelled package order): outcome `wallet_cancelled`, wallet, reason `late_payment`.
6. Order `open` or `released`, bookings:
   - hold still running: `confirm_booking`; on `true` outcome `applied`.
   - hold ended and the club is Paused, or the customer's account is deleted (anonymised): outcome `wallet_late`, wallet, reason `late_payment` (D107, D109).
   - hold ended otherwise: `reclaim_order`; `slot_unavailable` (or any refusal) gives `wallet_late`. On success re-apply what the release gave up, in this order, inside one sub-block so a failure undoes all of it: `app.reapply_order_entitlements` (F04-T19, code and birthday), then the F06 port `reserve_credit_and_wallet` (credits and wallet re-reserved). Any `ok: false` or refusal rolls the sub-block back (the booking returns to `released`) and the outcome is `wallet_late`. Success gives `applied_late`, the same order, the same amounts, no repricing (PAY-03-AC7).
7. After `applied` or `applied_late`: order `paid`, payment `succeeded` with `confirmed_at`, QR cleared, package orders call the F06 port `grant_package`, the F13 port `issue_receipt`.
8. A wallet outcome: payment `succeeded` (the money did arrive), outcome as above, QR cleared, then in the same transaction the F06 port `credit_wallet` (reason, dedupe key `late_payment:{payment}`, order of kind `wallet_credit`) and the F13 port `issue_receipt` for the money received (D37).

The booking transitions and the wallet credit are one transaction: either the whole case happens or none of it.

## Ports to F06 and F13
Until F06 and F13 exist, `apply_payment` calls them through one registry, `app.payment_ports (port text primary key, handler regprocedure)`, filled by the migration of the feature that owns the port (the same pattern as `app.release_handlers`). A port that is not registered **raises `payment:port_missing:{port}`** and rolls the whole call back: a payment is never confirmed or credited with a step silently skipped. Tests register fakes. The ports and their signatures, which F06 and F13 implement:

| Port | Signature | Owner |
|---|---|---|
| `reserve_credit_and_wallet` | `(order uuid) returns boolean`: re-reserve the credits and wallet the order's frozen amounts name; false when it cannot | F06 |
| `grant_package` | `(order uuid) returns void`: create the customer's package from a paid package order | F06 |
| `credit_wallet` | `(order_kind text, customer uuid, amount_satang integer, reason text, dedupe_key text, payment uuid) returns uuid`: a wallet ledger movement and the `wallet_credit` order; the same dedupe key returns the same movement | F06 |
| `issue_receipt` | `(order uuid, payment uuid, kind text) returns uuid`: the receipt for money received (`kind` is `order` or `wallet_credit`) | F13 |

If the F06 or F13 designs name these differently, only the registry rows and this table change.

## Tests (per migration)
- T05a: success with the hold running; success after the hold with the slot open (booking back to confirmed, code and birthday re-applied, credits re-reserved through the fake); repeated callback is a no-op; port missing raises and leaves the payment pending.
- T05b: slot taken by another hold, booking or closure; solo class with only one of court and coach free; code or birthday cannot be re-applied; credits cannot be re-reserved; all give the wallet with the dedupe key, the receipt, and exactly one wallet movement when called twice.
- T05c: second success for a paid order; success for a cancelled order and a cancelled package order; Paused club; deleted account; success on a payment that cash cancelled.

## Open point for the orchestrator
The status of an order for a wallet outcome stays as it is (`released` or `cancelled`); only the payment records the outcome. If the PRD wants the order marked differently, say so before T05a.
