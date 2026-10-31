# F05 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F05-beam-payments/requirements.md`. F05 is mostly built: the payment tables, start payment, apply payment (booking and package), the late payment and reclaim rules, the Beam adapter, the webhook route and take cash exist. The package QR path, the expiry job, the status check (PAY-02-AC15) and the P2 screens do not.

**Result: 54 criteria. 21 covered by lane tests (traced, PAY-05-AC1 among them), 2 new QA tests, 3 covered in F09's file (PAY-05-AC2, AC3, AC5), 9 still open (each with its reason below). No new finding.**

The lane's tests already use QA's fake Beam over HTTP (`webhook.test.ts`): bad signature, wrong amount, duplicate in sequence and in parallel, unknown charge, failed charge then second tap.

New QA tests (`F05-beam-payments.new.spec.ts`):

- PAY-01-AC2: neither route table (web, platform) contains a slip, backup or A4 route.
- PAY-02-AC11 (CONC-27): 25 rounds of a callback and `release_hold` on the same order at the same instant. Every round ends with the payment succeeded, the booking confirmed, the order paid and exactly one receipt. No lost money.

Still open:

| Criterion | Why it is open |
|---|---|
| PAY-01-AC3 | P2 step 5 saving the option: the screen is not built. |
| PAY-01-AC6 | Test connection: not built. The fake Beam can serve it when it is. |
| PAY-02-AC15 | Status check when a callback never arrives (D73): the reconcile job is not built. The fake has `callbackNeverArrives` ready. |
| PAY-03-AC6 | The late payment message (what happened to the money): no producer yet. |
| PAY-04-AC1 | Package only QR with its own validity setting: the package QR path is not built. |
| PAY-04-AC2 | QR time out cancels the package order with no ledger rows or receipt: the expiry job is not built. |
| PAY-04-AC6 | C11P screen (`{minutes}`, Time ran out): Playwright, when the screen lands. |
| PAY-06-AC6 | Cash in the daily close: F13 (T04). |
| PAY-06-AC7 | Cancelling a cash booking returns value to the wallet: F09. |

Open question still on the sandbox: Q-31 (can a tester mark a sandbox QR paid). The 7 Dec plan depends on the answer.
