# F05 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F05-beam-payments/requirements.md`. F05 is mostly built: the payment tables, start payment, apply payment (booking and package), the late payment and reclaim rules, the Beam adapter, the webhook route and take cash exist. The package QR path, the expiry job, the status check (PAY-02-AC15) and the P2 screens do not.

**Result (updated 31 Oct after main 52a973b): 54 criteria. 44 traced to lane tests, 3 covered in F09's file (PAY-05-AC2, AC3, AC5), 2 by new QA tests (and the CONC-31 race on PAY-02-AC15), 5 still open (each with its reason below). No new finding.**

The lane's tests already use QA's fake Beam over HTTP (`webhook.test.ts`): bad signature, wrong amount, duplicate in sequence and in parallel, unknown charge, failed charge then second tap.

New QA tests (`F05-beam-payments.new.spec.ts`):

- PAY-01-AC2: neither route table (web, platform) contains a slip, backup or A4 route.
- PAY-02-AC11 (CONC-27): 25 rounds of a callback and `release_hold` on the same order at the same instant. Every round ends with the payment succeeded, the booking confirmed, the order paid and exactly one receipt. No lost money.

Still open:

| Criterion | Why it is open |
|---|---|
| PAY-01-AC3 | P2 step 5 saving the option: the screen is not built. |
| PAY-01-AC6 | Test connection: not built. The fake Beam can serve it when it is. |
| PAY-03-AC6 | The late payment message (what happened to the money): no producer yet. |
| PAY-04-AC6 | C11P screen (`{minutes}`, Time ran out): Playwright, when the screen lands. |
| PAY-06-AC6 | Cash in the daily close: F13 (T04). |
| PAY-06-AC7 | Cancelling a cash booking returns value to the wallet: F09. |

Open question still on the sandbox: Q-31 (can a tester mark a sandbox QR paid). The 7 Dec plan depends on the answer.

## Update, 31 Oct (main 52a973b)

F05-T09 reached main: the `beam_reconcile` job, the `package_order_expiry` job and migration 0415. The lane covers them (`domain/payments/jobs.test.ts`, `db/payment-jobs.test.ts`, `worker/tasks/payment-jobs.test.ts`): a paid charge with no callback is confirmed by the lookup, a wrong amount is flagged and never confirmed, a failed charge keeps the hold, Beam unreachable skips and alerts, an expired package order cancels with no ledger row or receipt, and a payment after the expiry goes to the wallet. Every criterion that a lane test names is now traced by ID. PAY-02-AC15 and PAY-04-AC2 are covered; PAY-04-AC1 is traced to the lane test that names it.

New QA test, CONC-31 (`F05-reconcile-race.new.spec.ts`): three reconcile runs at once over four paid charges give one confirmation, one receipt call and one `applied` event per charge. It passes. It was not run against a mutated job.
