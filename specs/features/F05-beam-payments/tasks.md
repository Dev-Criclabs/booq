# F05 Beam payments (QR), late payments and cash · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 by the Architect role from the approved design (`design.md`, approved 30 Oct 2026). Rules for every task (CLAUDE.md): one task per run; tests from the acceptance criteria first; type checks before ticking; the commit message starts with the requirement IDs. The design lists 13 guesses about Beam (3.3, G1 to G13); the Playground checks are tasks G, and the build never depends on a guess that has not been checked or is not handled both ways.

Roles: **BE-C**, **FE-P**, **FE-A**, **DevOps** (accounts and keys), **Arch**, **QA**.

Depends on: F01 T09 (connections and secrets), T18, T34 (worker); F03 T13, T14 (`confirm_booking`, `reclaim_order`); F04 T04 and T11 (orders, Pay); F06 (wallet and package ledgers; interface plus fake until then); F13 (receipt; interface plus fake). Migration numbers 0401 to 0499.

## A. Tables

- [ ] **F05-T01** Migrations 0401 and 0402: `payment`, `payment_event` (append-only, no body stored), `owner_flag`, with the unique keys, the cash reason CHECKs and the partial unique "one pending Beam charge per order". IDs: PAY-02, PAY-06-AC1, AC2, decisions D72, D76. Role: Arch · Deps F04-T03, F01-T26 · Size: M
  Tests first: a second pending Beam payment for an order is refused and a new one after `failed` is allowed; cash needs a reason code and `other` a note; a duplicate `(club, gateway, charge, event)` is refused; `payment_event` cannot be updated or deleted; no personal column.
- [ ] **F05-T02** Migration 0404: policies and grants; the Beam secrets are read only through `app.read_secret` (F01-T09); registry, tenant and blind suites extended. IDs: CC-1, PLAT-02-AC1, PDPA-01-AC1. Role: Arch · Deps T01, F01-T09 · Size: S
  Tests first: club A cannot read club B's payments; `booq_platform` has no privilege on any payment table; the accountant reads payments with names only through the view.

## B. Adapter and money movements

- [ ] **F05-T03** `packages/payments`: the gateway interface (create charge, get charge, nothing that refunds), the Beam adapter (Basic auth, `x-beam-idempotency-key`, `expiryTime`), key set chosen from the club status, the fake for tests. IDs: PAY-01-AC4, PAY-05, PAY-02-AC2, decisions D32, D80. Role: BE-C · Deps F01-T09 · Size: M
  Tests first: a Testing club uses the test set and a Live club the live set, never crossed; the interface has no refund method and the double fails if one is attempted; `expiryTime` is the hold end minus the configured margin, with no value in code; keys never reach a log.
- [ ] **F05-T04** `startPayment`: charge creation after the Pay commit, second tap returns the stored QR, a new charge after `failed` inside the same hold, `payment_unavailable` releases the hold and raises the flag. IDs: PAY-02-AC1 to AC3, PAY-01-AC7, decisions D47, D72, D75. Role: BE-C · Deps T01, T03, F04-T11 · Size: M
  Tests first: second tap creates no second charge; a failed charge then a tap creates a new payment in the same hold; Beam down releases the hold and restores credit, wallet and code.
- [ ] **F05-T05** `app.apply_payment` (definer, FA 6.6): confirm, reclaim, wallet for late, duplicate, cancelled, paused, deleted; each guarded `UPDATE … WHERE status in (…)`; the wallet credit, its order, receipt and ledger row in one transaction with the dedupe key. IDs: PAY-02-AC4, PAY-03, decisions D18, D25, D37, D74, D79. Role: Arch/BE-C · Deps T01, F03-T13, F03-T14, F06 (interface), F13 (interface) · Size: L
  Tests first: every row of the design 5.4 table; two late payments for one slot cannot both be approved; a repeated callback repeats nothing; a payment and a hold expiring at the same instant give one outcome.
- [ ] **F05-T06** `app.credit_wrong_amount` and the owner flag: staff credit the full amount received, own receipt, flag resolves. IDs: PAY-02-AC6, decisions D24, D77, D79. Role: BE-C · Deps T05 · Size: S
  Tests first: under and over payments are credited in full; front desk and owner only; the flag opens on a mismatch and resolves.
- [ ] **F05-T07** Cash at the front desk. IDs: PAY-06, decision D56. Role: BE-C · Deps T05 · Size: S
  Tests first: reason code and note rules; only front desk and owner; allowed for packages; audited; a receipt; a later cancel returns to the wallet.

## C. Callback, reconcile, jobs

- [ ] **F05-T08** `POST /api/webhooks/beam/{token}`: token to club and key set, constant-time HMAC over the raw body, dedupe on charge and event, decide from `GET /charges/{id}`, 200 for unknown charge and ignored set, 401 for a bad signature, 500 when Beam cannot be reached. IDs: PAY-02-AC5 to AC15, decisions D24, D36, D71, D73. Role: BE-C · Deps T03, T05 · Size: L
  Tests first: bad signature changes nothing and alerts; a replayed old callback does nothing; a wrong amount opens a flag and answers 200; an unknown charge answers 200 and alerts; another club's charge never matches; parallel duplicates give one confirmation.
- [ ] **F05-T09** Worker tasks `beam_reconcile`, `package_order_expiry`, and the `qr_image` clean-up. IDs: decisions D73, D74. Role: BE-C · Deps T08, F01-T34 · Size: M
  Tests first: reconcile confirms only when status, amount and reference all match, audited as by lookup; a package-only order is cancelled at the end of its QR time with no ledger rows; final payments lose their image.
- [ ] **F05-T10** Alerts and `platform.club_health` rows (counts and kinds only). IDs: decision D75. Role: Arch/BE-C · Deps T08 · Size: S
  Tests first: bad signature, failed key check, unreachable Beam and unknown charge each add a row with no order or player data.

## D. Setup and screens

- [ ] **F05-T11** Platform routes: payment setup (merchant ids, key sets write-only, webhook tokens shown once), test connection (pass or fail), the key swap check before Go live. IDs: PAY-01-AC3, AC5, AC6, AC8, decisions D26, D32. Role: BE-P · Deps F01-T09 platform grants, T03 · Size: M
  Tests first: write-only keys; the test returns pass or fail only; Go live refused until the swap check passes; every change in P6.
- [ ] **F05-T12** C11 payment screen from the hi-fi boards (QR, countdown, save QR, checking, failed, expired) and the owner flag banner. IDs: PAY-01-AC1, AC2, PAY-02. Role: FE-P/FE-A · Deps T04, T06 · Size: M

## E. Playground checks and sweep

- [ ] **F05-T13** G1 to G13 against the Beam Playground (DevOps account and keys, the user's action), recorded in `design.md` 3.3. IDs: design 3.3. Role: DevOps with BE-C · Deps account · Size: S
- [ ] **F05-T14** Acceptance sweep. IDs: CC-2, CC-3, CC-5. Role: QA · Deps T08, T09 · Size: S
