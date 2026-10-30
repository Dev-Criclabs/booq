# F05 Beam payments (Hunter launch) · Design

Status: **DRAFT for approval (gate 2).** Drafted 30 Oct 2026 by the Architect role from the approved F05 requirements (`requirements.md`, approved 30 Oct 2026, `docs/decisions.md` round 8) with decisions D18 to D37 and D62 to D80 applied. Nothing here is approved until a person says so. No tasks and no code follow until then.

Feature: F05 Beam payments (Hunter launch). Requirement IDs: PAY-01 to PAY-06 (PAY-07 is in F04; PAY-08 is F16 and not built for Hunter). Depends on F04. Wave 2.

Shared decisions are in `docs/architecture/foundation.md` (revision 8), cited as **FA §n**; F01 to F04 designs as **F01 §n** and so on. FA §6 already holds the callback algorithm; this file is the F05 build detail and it settles the points FA §6 left to F05.

**How Beam is described here.** Every statement about Beam is marked **STATED** (the public docs at https://docs.beamcheckout.com say it, with the page), **NOT STATED** (the docs do not say), or **GUESS Gn** (this design assumes it; each guess is listed in section 3.3 with how it is checked in the Playground). Nothing is taken from memory or from other gateways. The docs were read on 30 Oct 2026; the API reference page (`/v1/api`) did not render its schema, so create-charge fields come from the guide pages only.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| PAY-01 (payment option, key sets) | §4.1 club setup; §5.7 key sets, test and swap; §6 routes |
| PAY-02 (QR on Pay, verified callback) | §5.1 create; §5.3 callback; §5.4 apply |
| PAY-03 (payment after the hold) | §5.4; D18, D25, D37, D80 |
| PAY-04 (package bought alone) | §5.2; D74 |
| PAY-05 (no cash refunds) | §5.8 |
| PAY-06 (cash at the front desk) | §5.6; D56 |
| CC-1 to CC-6 | §10 |

## 2. What this design does not build

Slip checking, the slip popup, backup mode and A4 (PAY-08, F16, other clubs); the order and its price (F04); the hold (F03); package ledgers (F06); receipts (F13); the LINE messages themselves (F10; F05 enqueues outbox rows); cancellation (F09); the A2 and A6 screens (F11). Money goes straight to the club's own Beam merchant account, never through BOOQ.

## 3. What Beam's public docs say

### 3.1 Stated

| Topic | What the docs say (page) |
|---|---|
| Authentication | HTTP Basic, `Authorization: Basic base64(merchantId:apiKey)` (get-started/authentication). Playground and Production have different keys, hosts and webhooks, "fully isolated" (get-started/authentication, switching-to-production). Playground host `playground.api.beamcheckout.com`, production `api.beamcheckout.com` |
| Create a QR charge | `POST /api/v1/charges` with `amount` (integer, "smallest currency unit": satang for THB), `currency` `THB`, `paymentMethod { paymentMethodType: "QR_PROMPT_PAY", qrPromptPay: { expiryTime } }`, `referenceId`, `returnUrl`. The response has `chargeId`, `actionRequired: "ENCODED_IMAGE"`, `encodedImage { expiry, imageBase64Encoded, rawData }`. The create response does not say whether payment succeeded; a failed payment still returns 2xx (charges/charges-api, charges/charges) |
| Charge status | `PENDING`, `SUCCEEDED`, `FAILED`; a failed charge is final and a new charge is needed; a charge "can stay `PENDING` indefinitely" and "a very late `charge.succeeded` webhook is still possible" (charges/charges) |
| Retrieve | `GET /api/v1/charges/{chargeId}`, response holds the current `status` and `failureCode`; `GET /api/v1/charges` lists by `referenceId` with `offset` and `limit` (charges/charges-api) |
| Idempotency | Header `x-beam-idempotency-key` on POST and PATCH, up to 255 characters, kept 12 hours, 412 `IDEMPOTENCY_KEY_ERROR` on the same key with a different payload (get-started/idempotency-request, get-started/error) |
| Webhook events | `charge.succeeded`, `charge.failed` among others; event type in header `x-beam-event`; the body is the object a `GET` would return (webhook-event-types) |
| Webhook signature | Header `X-Beam-Signature`, base64 of HMAC-SHA256 over the exact raw body, key is the base64-decoded HMAC key shown in the Beam dashboard (webhook-authentication) |
| Webhook delivery | Registered in the Beam dashboard; any 2xx stops retries; otherwise "10 times with exponential backoff" (webhook-overview) |
| Sandbox | The Playground "doesn't move real money"; a QR charge there leads to a Force Charge page with a Mark as Succeeded button (test-data) |
| Rate limit and errors | 429 `TOO_MANY_REQUESTS_ERROR`, back off with jitter, no numbers; error codes listed (get-started/error) |
| Refunds | `POST /api/v1/refunds` exists. This design never calls it (PAY-05) |

### 3.2 Not stated

- Replay protection: no timestamp in the signature, no event id in the payload (the go-live checklist advises de-duplicating "by event id (or by resource id + event type)").
- The unit of `amount` in webhook payloads (create side is satang; webhook examples are bare integers).
- The default, minimum and maximum QR expiry; what Beam does to the charge when the QR expires; whether a payment after expiry is accepted.
- Retry intervals, response timeout, an IP allow-list for webhooks.
- The full create-charge schema; the result of repeating a request with the same key and the same payload; how a QR payment failure is simulated; whether a webhook can be re-sent in the Playground; registering a webhook through the API.
- Whether timestamps in responses are UTC (the F05 requirements mention it; it was not confirmed in the pages read).

### 3.3 Guesses this design makes (each is checked before the build and recorded here)

| Id | Guess | How it is checked | If wrong |
|---|---|---|---|
| G1 | Webhook `amount` is satang | Not relied on: the decision uses the lookup in G5, never the webhook body | none |
| G2 | After the QR expires Beam leaves the charge `PENDING` and may still send `charge.succeeded` later | Playground with a short expiry | Both outcomes are handled (§5.4); only the label changes |
| G3 | `expiryTime` accepts any future RFC 3339 instant and Beam enforces it | Playground with expiry minutes ahead | If Beam enforces nothing, a payment after the hold is handled as late (§5.4) |
| G4 | `referenceId` accepts our payment id (a UUID string) | Playground | Use a shorter id column |
| G5 | `GET /charges/{id}` returns `amount` (satang), `currency`, `status` and `referenceId` | Playground | The decision rule (§5.3 step 5) changes to what Beam returns |
| G6 | One HMAC key per merchant and environment signs every webhook | Playground | Store a key per webhook if Beam issues one |
| G7 | A Playground webhook reaches our endpoint and Mark as Succeeded triggers `charge.succeeded` | Playground, with the club's test webhook registered | Test callbacks by the fake Beam only |
| G8 | `x-beam-idempotency-key` is honoured on `POST /charges` and a repeat with the same body returns the original charge | Playground | We still return our stored payment on a second tap (D47), so Beam is not relied on |
| G9 | A read-only `GET /charges?limit=1` with the club's key succeeds exactly when the key is valid | Playground and a live account | Another read-only call is chosen |
| G10 | `imageBase64Encoded` is a displayable image we can store and return unchanged until expiry | Playground | Render from `rawData` |
| G11 | We can answer a callback within seconds; slow lookup does not exceed Beam's timeout | Measure | Move the lookup after a quick 200 only if Beam allows (§5.3) |
| G12 | Timestamps from Beam are UTC ISO 8601 | Playground | Convert at the edge |
| G13 | Webhook URLs registered per environment can carry a long path token | Playground | Use a header-free secret in the path elsewhere |

## 4. Data and migrations

### 4.1 Club setup (F01 supplies the tables)

`club.payment_option` (`beam` or `slip`), `payment_connection` (merchant id for each key set, `secret_last4` per secret, `active_set` derived from club status), `club_secret` with the four Beam secrets (`beam_api_key_test`, `beam_hmac_key_test`, `beam_api_key_live`, `beam_hmac_key_live`) and a `webhook_token_hash` per set (F01 §3.2, decisions D32, D34). The active set is never typed: a Testing club uses the test set, a Live or Paused club the live set. A key of one set is never used for the other environment (PAY-01-AC4).

### 4.2 Migrations

F05 uses 0401 to 0405, after F04 (0301 to 0307).

| File | Contents |
|---|---|
| `0401_payment.sql` | `payment` |
| `0402_payment_event.sql` | `payment_event`, `owner_flag` |
| `0403_functions.sql` | `app.apply_payment`, `app.credit_wrong_amount`, `app.start_payment` helpers |
| `0404_grants_policies.sql` | Policies and grants; the Beam secrets readable only by the payment adapter role |
| `0405_settings_keys.sql` | Registry rows for `package_qr_minutes`; platform config rows for `qr_expiry_margin_seconds` and reconcile settings |

### 4.3 Tables (class D)

**`payment`**: `club_id`, `id`, `order_id`, `method` (`beam`, `cash`), `status` (`pending`, `succeeded`, `failed`, `expired`, `cancelled`), `environment` (`test`, `live`), `gateway` (`beam`), `gateway_charge_id`, `amount_satang`, `qr_image` (the stored base64 image, cleared after the payment is final), `qr_expires_at`, `failure_code`, `outcome` (`applied`, `applied_late`, `wallet_late`, `wallet_duplicate`, `wallet_cancelled`, `wallet_wrong_amount`, `mismatch`, `unknown`), `cash_reason_code` (`no_banking_app`, `qr_failed_at_counter`, `other`), `cash_reason_note`, `taken_by`, `confirmed_at`, `is_test`, `created_at`. Unique `(club_id, gateway, gateway_charge_id)`; partial unique `(club_id, order_id) where method = 'beam' and status = 'pending'` (one pending charge per order, decision D72); CHECK: cash needs a reason code, and `other` needs a note (PAY-06-AC1, AC2).

**`payment_event`** (append-only): `club_id`, `id`, `gateway`, `gateway_charge_id`, `event_type`, `received_at`, `body_hash` (SHA-256 of the raw body; the body itself is not stored, decision D76 and CC-3), `signature_ok`, `looked_up_status`, `looked_up_amount_satang`, `looked_up_reference`, `outcome`, `payment_id` null, `is_test`. Unique `(club_id, gateway, gateway_charge_id, event_type)` (de-duplication, FA §6.5 step 4).

**`owner_flag`** (decision D75): `club_id`, `id`, `kind` (`wrong_amount`, `key_check_failed`), `payment_id` null, `status` (`open`, `resolved`), `created_at`, `resolved_by`, `resolved_at`, `note`. The club admin shows open flags as a banner to the owner.

Platform health alerts (bad signature, failed key check, unreachable Beam, unknown charge) are rows in `platform.club_health` (F01 §3.2): counts and kinds only, no order or player data.

## 5. Behaviour

### 5.1 Pay: create the charge (PAY-02-AC1 to AC3; decisions D47, D72, D80)

F04's Pay transaction creates the order, the hold and a `payment` row (`pending`, amount equal to the order's `money_satang`). After commit, `startPayment(payment)`:

1. Load the club's active key set. If the merchant or keys are missing, refuse with `payment_unavailable`, release the hold (restore handlers run), raise the P1 alert and an owner flag of kind `key_check_failed` (PAY-01-AC7, decision D75).
2. Call `POST /api/v1/charges` with: `amount` = `amount_satang` (STATED), `currency` `THB`, `paymentMethod.qrPromptPay.expiryTime` = **the hold's end minus `qr_expiry_margin_seconds`** (decisions D18 and D80: slightly before the hold ends, so with any clock difference the QR never outlives the hold; the margin is a platform setting and its value is set by a person, nothing built into code; G3), `referenceId` = `payment.id` (G4; **only the order reference is sent, no player data**, decision D76), `returnUrl` as the club's app address (configuration), header `x-beam-idempotency-key` = `payment.id` (G8).
3. Store `gateway_charge_id`, `qr_expires_at` and the image (G10) in a second short transaction. The player sees C11: Waiting for your payment, the QR, a countdown to the hold end, save QR, no slip upload (PAY-01-AC1).
4. If Beam fails or times out, release the hold, return `payment_unavailable`, raise the P1 alert "Beam unreachable".

**Second tap (D47).** F03/F04 return the same order; while the payment is `pending` and its QR has not expired, the stored payment and image are returned and **no second charge is created** (PAY-02-AC3).

**Failed charge inside the hold (D72).** If `charge.failed` arrives (or the lookup reports `FAILED`) while the hold is running, the payment becomes `failed`, the player sees that the payment did not go through, and a second tap creates a **new payment and a new charge in the same hold**: same order, same `hold_expires_at`, expiry computed from the same hold end. Only one pending payment exists per order.

The QR is the only way to pay: there is no slip upload, and no route can confirm a booking without a verified callback or a verified lookup (PAY-01-AC9).

### 5.2 Package bought alone (PAY-04; decision D74)

No hold exists. The QR validity is the club's own setting `package_qr_minutes` (a separate setting from the hold; the Tennis template carries 15; F01 registry), so `expiryTime` = now plus that many minutes. When the time ends with no payment, a task cancels the order, sets the payment `expired`, writes no ledger rows and issues no receipt (PAY-04-AC2). A package bought with a booking uses the booking's hold and its QR expiry (PAY-04-AC4). A payment that arrives after a package order was cancelled goes to the wallet with its own receipt (D74, §5.4).

### 5.3 The callback (PAY-02-AC4 to AC15; decisions D24, D36, D71, D73, D75)

`POST /api/webhooks/beam/{webhookToken}`: FA §6.5 is the algorithm. F05 details:

- The token identifies the club **and** the key set; if that set is not the one active for the club's status (for example a test callback after Go live), the event is recorded with outcome `ignored`, an info row goes to `club_health`, and the answer is 200. Nothing else changes.
- Verification uses the stored HMAC key of that set (base64-decoded) over the raw bytes, compared in constant time (STATED: webhook-authentication). A bad signature answers 401, changes nothing, is logged and alerted in P1 (D24, D75).
- De-duplication has no event id to use (NOT STATED); the key is `(club, gateway, chargeId, x-beam-event)`. A duplicate is ignored with 200.
- A validly signed event for a charge we do not know answers 200 and raises a P1 alert; it changes nothing (decision D71).
- **Decide from the lookup, not the body.** After the signature check the server calls `GET /api/v1/charges/{chargeId}` (STATED) and applies the status and amount from that response (G5). If Beam cannot be reached, answer 500 so Beam retries (up to 10 times, STATED). This also makes the unknown webhook amount unit (G1) irrelevant.
- **Amount check.** The looked-up amount (satang) and `THB` must equal `payment.amount_satang` and the `referenceId` must equal `payment.id`. A mismatch is **validly signed, wrong amount**: the booking is not confirmed, the event is recorded with outcome `mismatch`, an owner flag of kind `wrong_amount` opens (an owner banner in the club admin, decision D75), the player sees "payment received, the club is checking" (decision D77), and the answer is **200** so Beam stops retrying (decision D36). The response never reveals the reason.
- Everything else (confirm, late, duplicate payment, cancelled order) is `applyPayment`, §5.4. A callback for an order created before a Pause is still processed (PAY-02-AC12).
- Nothing in the event record is personal: event name, charge id, order, amount, result, time, body hash (PAY-02-AC13).

### 5.4 `applyPayment` (PAY-02-AC4, PAY-03; decisions D18, D25, D37, D74, D79)

As FA §6.6, in the lock order of FA §3.4, with each change guarded by `UPDATE ... WHERE status in ('pending','expired')` and a row count. The payment may be `expired` (our own label when the hold or QR time ended) and still receive a success (STATED: a very late success is possible).

| Case | Booking and order | Money |
|---|---|---|
| Success while the hold runs | `confirm_booking` (F03): confirmed, hold cleared; order `paid`; payment `succeeded`, outcome `applied`; package orders call F06's `grant_package`; receipt (F13); Booking confirmed card (F10) | none |
| Success after the hold ended, slot still open | `reclaim_order` (F03) with credits and wallet re-reserved (F06); all succeed: confirmed as above, outcome `applied_late`; same order, same amounts, no repricing (PAY-03-AC7) | none |
| Success after the hold ended, slot not open (another hold or booking, or a closure, including the one that cancelled this hold; a solo class needs court and coach both free) | Stays `released` | The whole amount to the wallet, reason `late_payment`, outcome `wallet_late`; its **own receipt** for the money received (D37); a LINE message says what happened (PAY-03-AC2 to AC4, AC6) |
| Late, slot open, but credits, wallet or code cannot be re-applied | Stays `released` | Wallet, as the row above (adopted, FA §10.1) |
| A second success for an order already paid | unchanged | The second amount to the wallet, reason `duplicate_payment`, own receipt |
| Success for a cancelled order | unchanged | Wallet, reason `late_payment`, own receipt |
| Success for a cancelled package order | unchanged | Wallet with its own receipt (decision D74) |
| Validly signed wrong amount | not confirmed | none until staff credit (§5.5) |

The wallet credit, its order of kind `wallet_credit`, the receipt and the ledger row are created in one transaction with `dedupe_key` `late_payment:{payment_id}`, so a repeated callback cannot repeat them (FA §2.4). The slot check runs inside the booking transaction with the uniqueness rule, so two late payments for one slot cannot both be approved and a late payment cannot take a slot from a player who now holds it (PAY-03-AC5). Wallet reasons follow decision D78.

### 5.5 Wrong amount: staff make the player whole (decisions D24, D77, D79)

`POST /payments/{id}/wallet-credit` (front desk, owner; reason text required): in one transaction, credit the **full amount Beam reports received, including any overpayment**, to the wallet with reason `wrong_amount`, create the order of kind `wallet_credit` and its own receipt (D79), set the payment outcome `wallet_wrong_amount`, resolve the owner flag, and write the audit entry with who and why. It is a wallet credit, never a refund to Beam (PAY-05-AC4).

### 5.6 Cash at the front desk (PAY-06; decision D56)

`POST /staff/orders/{id}/cash` (permission `payment.cash`: front desk and owner only): reason code `no_banking_app`, `qr_failed_at_counter` or `other` with a note, enforced by the table CHECK and by the route (AC1, AC2, AC5). It creates a `payment` of method `cash`, confirms the order through `confirm_booking`, issues a receipt (F13), audits the reason code (AC3) and is allowed for packages (AC4). If the booking was awaiting payment with a Beam charge pending, the pending payment is cancelled first (a late Beam payment then follows the wallet rule). The daily close totals cash separately (F13). A cash order cancelled 12 hours or more ahead returns value to the wallet, not as cash (AC7).

### 5.7 Key sets, test connection and the key swap (PAY-01; decisions D26, D32, D75)

- **Test connection** (P2 step 5, `POST /clubs/{id}/connections/beam/test { set: 'test' }`): a read-only authenticated call `GET /api/v1/charges?limit=1` with the test set against the Playground host (G9). Pass or fail only, no player data (AC6).
- **Key swap smoke test** (a required item on the P4 launch checklist, decision D32): the same read-only call with the **live** set against the production host, plus a self-check that a body signed with the stored live HMAC key verifies. It moves no money (F01 assumption A-23). Go live is refused until the live set is stored, the test set is no longer the active one, and this passes.
- No in-app "simulate payment" exists in any status (decision D26). A tester pays with Beam's Playground and the Force Charge page (G7); QA's fake Beam drives the automated tests.
- A failed key check at Pay time raises the P1 alert and reaches the owner as a flag (decision D75).

### 5.8 No cash refunds (PAY-05)

The gateway interface (FA §6.3) has no refund method. A lint fails the build if a call to `/refunds` or a method with "refund" appears in `packages/payments`, a test double fails if one is attempted, and a route inventory test (QA CANCEL-02) fails if any route refunds money or withdraws the wallet. Every return of value (cancel, closure, failed payment, wrong amount, late payment) is a wallet credit or package credit. The Option A text "Refunds go back by PromptPay" is not built (Gaps A3).

### 5.9 Slip routes (PAY-01-AC2)

No slip route, slip popup or A4 route is registered for a Beam club; any request answers 404 (F16 will add them behind the club's payment option).

### 5.10 Reconcile (decision D73)

If a callback never arrives, the `beam_reconcile` task (FA §5.4, about every five minutes) looks at `pending` and recently `expired` Beam payments (a window of recent hours; the length is a platform setting, no value invented here), calls `GET /charges/{id}`, and applies the result through the **same** `applyPayment`, **confirming only when the status is succeeded and the amount and the reference match**; the audit entry records "confirmed by lookup" (D73). A mismatch raises the `wrong_amount` flag. Nothing is refunded.

### 5.11 Alerts (decision D75)

| Event | Where it shows |
|---|---|
| Wrong amount | Owner banner in the club admin (owner flag); the player sees "received, the club is checking" |
| Bad signature | P1 alert (counts, no body) |
| Failed key check, unreachable Beam | P1 alert; a failed key check also reaches the owner |
| Unknown charge | P1 alert |

## 6. API routes

Conventions as FA §9: typed codes, no text; 404 for out of reach; secrets never returned.

| Method and path | Permission | Purpose |
|---|---|---|
| `POST /api/webhooks/beam/{token}` | none (signature) | §5.3 |
| `GET /api/c/{slug}/payments/{id}` | own, staff | State for C11: `waiting`, `confirmed`, `failed`, `expired`, `checking` (wrong amount); QR image and expiry while waiting. The client polls it at a short interval (the value is a UI choice, not in the spec, GUESS) until final |
| `POST /api/c/{slug}/staff/orders/{id}/cash` | `payment.cash` (front desk, owner) | §5.6 |
| `POST /api/c/{slug}/payments/{id}/wallet-credit` | `wallet.adjust` (front desk, owner) | §5.5 |
| `GET /api/c/{slug}/owner-flags`, `POST .../{id}/resolve` | owner | Open flags and resolving them |
| `POST /api/platform/clubs/{id}/connections/beam/test` | admin, assigned specialist | §5.7 |
| `PUT /api/platform/clubs/{id}/setup/payments` | admin, assigned specialist | Payment option, merchant ids, key sets (write-only), webhook tokens; audited in P6 (PAY-01-AC3) |

Pay itself is F04's `POST /checkout/pay`, which calls `startPayment`.

## 7. State machines

`payment`: `pending` to `succeeded`, `failed`, `expired` or `cancelled`; `expired` to `succeeded` is allowed (a late success); `failed` and `cancelled` are final. The booking and order states are F03's and F04's. `owner_flag`: `open` to `resolved`.

## 8. Permission checks

| Permission | Player | Coach | Front desk | Accountant | Owner | BOOQ staff |
|---|---|---|---|---|---|---|
| Read own payment state | yes | yes | yes | yes | yes | no |
| `payment.cash` | no | no | yes | no | yes | no |
| `wallet.adjust` | no | no | yes | no | yes | no |
| Read payments | own | no | yes | names only (D35) | yes | no |
| Owner flags | no | no | no | no | yes | no |
| Beam keys (write only), test, swap | no | no | no | no | no | admin, assigned specialist |

BOOQ staff may set and test the Beam connection (setup data, decision D27) and never read payments. Row policies follow FA §4.3. The Beam secrets are readable only by the payment adapter role (`app.read_secret`, F01 §6.3).

## 9. Jobs

`beam_reconcile` (§5.10); `package_order_expiry` (cancels package-only orders whose QR time has ended, §5.2); housekeeping clears `qr_image` from final payments. The hold itself is F03's `hold_release`; its restore handlers cover credit, wallet and code use.

## 10. How the cross-cutting rules are met

- **Club ID scope (CC-1):** each club has its own merchant, keys and webhook token; the callback is verified with that club's key and finds payments only by club and charge id; a callback never confirms another club's order.
- **Server side (CC-2):** only the server talks to Beam and confirms; keys never reach a browser; the client cannot confirm.
- **PDPA (CC-3):** Beam receives only the order reference (D76) and the amount; no name, phone, date of birth or LINE id. Keys are encrypted with the extra layer and write only, last four shown (D27, D34). Event records hold a body hash, not the body. Payment data is staff by role; BOOQ staff never see it; test payments are flagged and excluded from reports (D33).
- **No double booking (CC-4):** a payment never reserves a slot; confirm and reclaim run through the F03 functions and the uniqueness rule; callback and expiry at the same instant give one outcome (FA T10).
- **TEXT (CC-5):** all C11 and C11P text by key with `{amount}` and `{minutes}`; the fixed "15 minutes" lines become variables (Gaps A5); the platform console step is English only (X keys).
- **Other (CC-6):** Bangkok time with Beam instants converted at the edge (G12); money is integer satang equal to Beam's unit; value never returns as cash.

## 11. Tests (written first at the build step)

QA's fake Beam signs bodies exactly as §3.1 states (base64 HMAC-SHA256 with a base64-decoded key) and serves the lookup endpoint. Playground checks are listed per guess in §3.3.

| Test | Covers |
|---|---|
| Hunter's club record says Beam; C11 shows the Beam screen with a QR for the exact amount, a countdown, no slip upload; every slip route answers 404 | PAY-01-AC1, AC2 |
| Two key sets: Testing uses test, Live uses live; a callback on the inactive set's URL changes nothing; Go live refused until the swap check passes; keys are ciphertext in the table and only the last four show | PAY-01-AC4, AC5, AC8, D32 |
| Test connection reports pass or fail only; a missing key at Pay refuses with `payment_unavailable`, releases the hold, raises the P1 alert and an owner flag | PAY-01-AC6, AC7, D75 |
| QR `expiryTime` equals the hold end minus the margin; the margin comes from the platform setting; no value is in code | PAY-02-AC2, D80 |
| Second tap returns the same QR and creates no second charge; after a failed charge a second tap creates a new charge inside the same hold | PAY-02-AC3, D47, D72 |
| Valid callback, right amount, inside the hold: confirmed once, one receipt, one card; parallel duplicates give one of each | PAY-02-AC4, AC7 |
| Bad signature: 401, nothing changes, P1 alert; a replayed old callback does nothing because the lookup decides | PAY-02-AC5, AC10, D24 |
| Valid signature, wrong amount (under and over): not confirmed, flag opens, answer 200, the player sees "checking"; staff credit the full amount received; own receipt; flag resolves | PAY-02-AC6, D36, D77, D79 |
| Unknown charge: 200, flagged, nothing changes; another club's charge never matches | PAY-02-AC9, D71 |
| Callback and hold expiry at the same instant: one outcome | PAY-02-AC11, FA T10 |
| Late payment: slot open reclaims; slot taken, held or closed goes to the wallet with its own receipt and a message; solo class needs both free; two late payments for one slot cannot both be approved | PAY-03-AC1 to AC5, D25, D37 |
| Late payment after a closure that cancelled the hold goes to the wallet | PAY-03-AC2, D48 |
| Callback never arrives: reconcile confirms only when status, amount and reference match, audited as by lookup; mismatch flags | D73 |
| Package alone: no hold, QR for `package_qr_minutes`, order cancelled at the end with no ledger rows; payment after cancel goes to the wallet with a receipt | PAY-04, D74 |
| No refund method or route exists; the test double fails on a refund attempt | PAY-05 |
| Cash: reason code and note rules; only front desk and owner; allowed for packages; audited; receipt; cancel returns wallet | PAY-06, D56 |
| Static: no hard-coded text; keys never in logs or responses; only the order reference reaches Beam | CC-2, CC-3, CC-5, D76 |

## 12. Text keys and canvas boards

**Existing keys:** P-0327, P-0328, P-0442; the rest by lookup from `copy-index.csv` (D31).

**New keys proposed by the drafter (D51; writers own the wording):**
- P: payment did not go through; Beam unavailable, try again; payment received, the club is checking (wrong amount); late payment approved; late payment credited to your wallet; C11P QR time as `{minutes}`.
- L: late payment approved; late payment credited to the wallet.
- A: wrong amount banner for the owner; cash reason code labels (No banking app, QR failed at the counter, Other); the wallet credit action and reason prompt.
- X: P1 alerts for Beam failures; Beam connection test result; key swap checklist item.

**Canvas boards used:** H-C11-Beam, G-C11P-Beam-package, H-C11P-Pay-package, F1-06-C11-Beam, F2-04-C11P-Beam-package, S-C11-Time-ran-out, H-P2-Step5-Payments, H-P4-Launch, H-C12-Confirmed, H-C12P-Hours-added, H-C14-Credits-wallet, H-A02-Booking-create and G-A02b (cash), and the T- twins except X pages. The slip boards (H-C11-PromptPay, H-C11b, S-C11-Checking-delayed, S-C11b-Rejected, H-P2-Step5b, F1b-*) are F16 and are not built (Gaps A2).

## 13. Assumptions to confirm on approval

| Id | Assumption |
|---|---|
| A-1 | The C11 client polls `GET /payments/{id}` at a short interval until the state is final; push is not used in v1 |
| A-2 | The reconcile window and the margin are platform settings whose values a person sets; nothing is built into code |
| A-3 | `expired` is our label; Beam has no expired status, and a success on an expired payment is applied by the late rules |
| A-4 | The lookup, not the webhook body, decides the amount and status (FA §6.5), at the cost of one API call per callback |
| A-5 | A cash order replaces a pending Beam payment on the same order |
| A-6 | The owner banner for a wrong amount stays until staff resolve it |

## 14. Open items for setup (not code)

Hunter's Beam merchant account, the Playground and production API keys, the HMAC keys, registering the club's webhook URLs in Beam's dashboard for each environment, and Beam's confirmed fees (HO open items). The Playground checks G1 to G13 are done by DevOps with the club's test keys before the F05 build starts, and the answers are written back into section 3.3.
