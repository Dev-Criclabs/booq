# F05 Beam payments (Hunter launch) · Requirements

Status: **DRAFT for approval (gate 1).** Drafted 30 Oct 2026. Nothing here is approved until a person says so. No design or code follows until then.

Feature: F05 Beam payments. Depends on: F04. Requirement IDs: PAY-01 to PAY-06 (PAY-07 is in F04, PAY-08 is F16 and not for Hunter). Wave 2.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Payments, cancellation, credits and wallet (Checkout and payment, Tax and receipts); Payment checking and LINE message costs (Option A, Beam); Platform foundation (Payments row); Customer app pages C11, C11P |
| HO | `specs/product/handoff-v1.2.md` | Payments and receipts (PAY-01 to PAY-08, RCPT-01 to RCPT-03); BOOK-03; CANCEL-02; PLAT-07; Architecture |
| Decisions | `docs/decisions.md` | D18, D24, D25, D26, D27, D32, D33, D34, D36, D37, D45, D47, D48, D56; round 1 (PAY-03) |
| Gaps | `docs/canvas-gaps.md` | A2, A3 |
| QA | `docs/qa/traceability.md`, `open-questions.md`, `tests/fakes/README.md` (branch `qa/test-strategy`) | PAY rows; Q-19 to Q-21, Q-31 |
| Beam public docs | https://docs.beamcheckout.com (read 30 Oct 2026) | See "What Beam's public docs state" below |
| Other features | F03, F04, F06, F09, F10, F11, F13 | Hold, order, ledger, cancel, messages, A2, receipts |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026; every board has a T- Thai twin.

## Scope

In scope: the club's payment option (Beam or slip checking, PAY-01), Beam keys per club and per environment, creating a PromptPay QR for the exact amount when the player pays, confirming only on a verified Beam callback (PAY-02), the rule for a payment after the hold (PAY-03), packages bought alone (PAY-04), no cash refunds (PAY-05), cash taken at the front desk (PAY-06), the C11 and C11P Beam screens and their states.

Out of scope: slip checking, the slip popup, backup mode and A4 (PAY-08, F16, other clubs), the order and price (F04), the hold (F03), ledger rows (F06), receipts (F13), the LINE messages themselves (F10), cancellation (F09).

Money always goes straight to the club's own Beam merchant account, never through BOOQ (PRD, HO Payments and receipts). Beam's fees are a club cost and not a BOOQ cost (PRD Platform foundation: Running costs).

## What Beam's public docs state (read 30 Oct 2026)

Wire details are kept out of the requirements below unless the docs state them. This list is for design and QA to check before building; it must be re-read against the club's sandbox account. QA's fake Beam uses a placeholder format until then (QA Q-31).

- Charges: a charge is created with `POST /api/v1/charges`. For QR PromptPay the request carries an `expiryTime` (ISO 8601), the `amount`, `currency` and a `referenceId`; the response gives an encoded QR image and an `encodedImage.expiry`. (https://docs.beamcheckout.com/charges/charges-api)
- Status: `PENDING`, `SUCCEEDED`, `FAILED`; the last two are final. A failed charge cannot be retried, a new charge is needed. A pending charge can stay pending indefinitely, so the docs advise your own timeout. (https://docs.beamcheckout.com/charges/charges)
- Amounts are in the smallest currency unit: for THB that is satang (`10000` is 100.00 THB). (https://docs.beamcheckout.com/get-started/convention)
- Webhooks: HTTP POST, event name in the `x-beam-event` header, events include `charge.succeeded` and `charge.failed`. Any 2xx stops retries; other responses count as failure; by default Beam tries 10 times with exponential backoff, intervals not stated. (https://docs.beamcheckout.com/webhook-overview, https://docs.beamcheckout.com/webhook-event-types)
- Signature: header `X-Beam-Signature`, base64 of an HMAC with SHA-256 over the exact raw JSON body, with a key from Lighthouse (Developers, Webhooks). (https://docs.beamcheckout.com/webhook-authentication, https://docs.beamcheckout.com/playground)
- Not stated in the docs: timestamp or replay protection, receiver side deduplication, exact backoff intervals, key prefixes for test against live.
- Environments: a Playground (sandbox) endpoint and a production endpoint exist; "API keys in Playground and Production are different and cannot be used interchangeably"; Playground moves no real money. The docs do not call them test and live keys. (https://docs.beamcheckout.com/, https://docs.beamcheckout.com/get-started/authentication)
- Requests may carry an idempotency key header (`x-beam-idempotency-key`), kept 12 hours. (https://docs.beamcheckout.com/get-started/idempotency-request)
- Refunds exist (`POST /api/v1/refunds`) but BOOQ must never call them (CANCEL-02, PAY-05).
- Not fetched: payment link create fields, test data page, refund lifecycle pages, error and rate limit pages.

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin, F1-, F2- flow copies (not repeated). Boards for F05 (Beam only): H-C11-Beam (T-), G-C11P-Beam-package (T-), H-C11P-Pay-package (T-), F1-06-C11-Beam, F2-04-C11P-Beam-package, S-C11-Time-ran-out (T-), H-P2-Step5-Payments (P2 step 5, T- none, X keys), H-C12-Confirmed, H-C12P-Hours-added. Slip boards (H-C11-PromptPay, H-C11b-Checking-slip, S-C11-Checking-delayed, S-C11b-Rejected, H-P2-Step5b-Payments-slip, F1b-*) belong to F16 and are not built here (Gaps A2).

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Every payment, charge, callback event and Beam key set carries a club ID. Each club has its own Beam merchant account and keys. A callback is verified with the key of the club it belongs to, and never confirms an order of another club.

**CC-2 Server side.** Only the server talks to Beam and only the server confirms a booking. The client never confirms payment. Beam keys never leave the server and are never sent to a browser.

**CC-3 PDPA.** The payment record holds the order, amount, method and Beam references. No player name, phone, date of birth or LINE ID is sent to Beam beyond what Beam requires (what Beam requires is Q8). Stored keys are encrypted with an extra layer in the app (D34) and are write only: only the last 4 characters ever show (D27). Payment records are staff only by role; BOOQ staff never see them (PLAT-02); test payments are flagged and excluded from reports (D33).

**CC-4 No double booking.** A payment never reserves a slot. The hold (F03) does. A payment confirms the booking only through the same uniqueness rule: a late payment is approved only if the slot is still open (PAY-03, D25). A callback and a hold expiry at the same instant give exactly one outcome (BOOK-04-AC8).

**CC-5 Language files (TEXT-01 to TEXT-06).** All C11 and C11P text, messages and errors come from `locales/*` by key, Thai and English. Numbers that are club settings are variables (`{minutes}` for the hold or QR time, `{amount}`), never typed (Gaps A5). Existing wording is not edited; new text gets new keys in both files, proposed by the drafter, owned by the writers (D51). Layouts survive the longest string; buttons never wrap. The platform console (P2 step 5) is English only (X keys).

**CC-6 Other platform rules.** All times Asia/Bangkok; Beam timestamps are converted at the edge. Money is integer satang and equals Beam's unit exactly, so the compared amount is an exact integer match. Value never goes back as cash: refunds are wallet or package credit only.

---

## PAY-01 The club's payment option and its Beam setup

**Source.** HO PAY-01. PRD Platform foundation (Payments), P2 step 5, Payment checking (Decision 29 Oct 2026); D26, D27, D32, D34.

**Requirement.** Each club picks one payment option in P2 step 5: Beam, or PromptPay with slip checking. Hunter's club record says Beam; C11 shows the Beam screen. Each club holds two sets of Beam keys, test and live.

**Hand-off acceptance check, kept.** Hunter's club record says Beam; C11 shows the Beam screen.

**Acceptance criteria.**

- PAY-01-AC1. Given a club record with payment option Beam, when a player reaches payment, then C11 shows the Beam screen: Waiting for your payment, the QR for the exact amount, a countdown to the end of the hold, save QR, and no slip upload.
- PAY-01-AC2. Given a Beam club, when any slip route, slip popup or A4 is requested, then the server answers 404; a Beam club has none of them (ADMIN-05).
- PAY-01-AC3. Given the platform console, when BOOQ staff set the option in P2 step 5, then it is saved on the club, audited in P6, and switching it changes no screen code (HO Architecture). A club on slip checking is F16.
- PAY-01-AC4. Given a club, when its Beam keys are stored, then there are two sets, test and live; a club in Testing uses the test set and a Live club uses the live set (D32). A key of one set is never used for the other environment.
- PAY-01-AC5. Given the P4 launch checklist, when a club goes Live, then swapping to the live key set is a required item with a smoke test, and Go live is refused until it passes (D32, F01 PLAT-07-AC10).
- PAY-01-AC6. Given the P2 step 5 Test connection, when BOOQ staff press it, then the test charges a sandbox call with the test set and shows pass or fail only; no player data is involved.
- PAY-01-AC7. Given the club's Beam merchant account is missing or its keys fail, when a player taps Pay, then the order is refused with a try again message, nothing is held that cannot be paid, and an alert shows in P1 (the alert text and place are Q7). Hunter's Beam merchant account and confirmed fees are open for setup, not for code (HO).
- PAY-01-AC8. Given a stored key, when anyone views it, then only the last 4 characters show and it can only be replaced (D27, D34).
- PAY-01-AC9. Given test mode, when a test payment is made, then it uses Beam's sandbox only. There is no in app "simulate payment" action in any status (D26); no route can confirm a booking without a valid signed callback.
- PAY-01-AC10. Given a Beam club, when a player is paid back for a cancel or a closure, then nothing is sent to Beam: refunds are wallet or credit (PAY-05). The Option A wording "Refunds go back by PromptPay" in P2 step 5 and the PRD cost section is wrong and is not built (Gaps A3).

**Meets.**

- PDPA: keys are secrets, encrypted, write only; no player identity needed by Beam beyond what Q8 decides.
- No double booking: not relevant; the option does not touch slots.
- Club scope: payment option and key sets per club.
- TEXT: P2 step 5 is X keys, English only; C11 text is P keys, Thai and English, with `{amount}` and `{minutes}`.

**Canvas.** H-C11-Beam (T-), F1-06-C11-Beam, H-P2-Step5-Payments, H-P4-Launch, S-C11-Time-ran-out.

---

## PAY-02 Create the QR on Pay, confirm only on a verified callback

**Source.** HO PAY-02. PRD Checkout and payment (Clubs on Beam); D18, D24, D36; QA Q-19.

**Requirement.** Beam: create a QR for the exact amount when the player taps Pay; confirm the booking only on Beam's verified callback. A callback with a bad signature or the wrong amount changes nothing.

**Hand-off acceptance check, kept.** A callback with a bad signature or wrong amount changes nothing.

**Acceptance criteria.**

- PAY-02-AC1. Given a signed in player taps Pay with an amount due, when the order and hold are created (F03 BOOK-03), then the server creates one Beam charge for that order for exactly the amount due in satang, with the club's keys for its environment, and the player sees its QR on C11.
- PAY-02-AC2. Given the QR, when it is created, then it expires exactly when the hold ends, so a payment of that QR after the hold ends is a late payment (D18, PAY-03).
- PAY-02-AC3. Given a second tap on Pay for the same order, when the request arrives, then the server returns the same hold and the same QR and creates no second charge (D47).
- PAY-02-AC4. Given a callback with a valid signature for a charge that succeeded and an amount equal to the order's amount due in satang, when it arrives before the hold ends, then the booking is confirmed, the hold becomes the booking, the order is Confirmed, and the receipt and the Booking confirmed LINE card follow (F13, F10).
- PAY-02-AC5. Given a callback with a bad signature, when it arrives, then it is rejected with an error status, logged and alerted, and changes nothing: no order, booking, ledger, receipt, LINE message or audit state (D24).
- PAY-02-AC6. Given a validly signed callback whose amount is not equal to the order's amount due, when it arrives, then the booking is not confirmed, the event is recorded and flagged for the owner, and the callback gets a success status so Beam stops retrying (D36, refines D24). Staff credit the player's wallet with the money received, with a reason, in A6 (D24). Who sees the flag and what the player sees is Q7 and Q9.
- PAY-02-AC7. Given a duplicate callback for a charge already processed, when it arrives, then it is ignored with a success status and changes nothing (D24); parallel duplicates give exactly one confirmation and one receipt.
- PAY-02-AC8. Given a callback for a charge that fails, when it arrives, then the order stays awaiting payment until the hold ends, the player sees that the payment did not go through, and nothing is confirmed. Whether the player can try again within the hold (a failed charge cannot be retried) is Q4.
- PAY-02-AC9. Given a callback for a charge that does not match any order, or an order of another club, when it arrives, then it is rejected and changes nothing. The response status for an unknown charge is Q3.
- PAY-02-AC10. Given the callback endpoint, when it is called, then the club is identified from the request and the signature is checked with that club's key before any content is trusted; the raw body is verified before parsing (the docs sign the exact raw body).
- PAY-02-AC11. Given a callback and a hold expiry at the same instant, when both run, then exactly one outcome stands: confirmed, or released with the late payment rule (BOOK-04-AC8).
- PAY-02-AC12. Given a callback arrives for an order created before a pause, when the club is Paused, then it is still processed (a started payment is not refused by the pause; confirms with F01 Q12).
- PAY-02-AC13. Given the callback is delivered, when it is stored, then the event is recorded (event name, charge reference, order, amount, result, time) without card or personal data, append only (D28).
- PAY-02-AC14. Given a payment of a test order, when the callback arrives, then it comes from Beam's sandbox and the order is flagged test and excluded from reports (D26, D33).
- PAY-02-AC15. Given a failed delivery to our endpoint (our server errors), when Beam retries, then repeated deliveries are safe because of AC7. What happens if every retry fails and the payment is never reported is Q5.

**Meets.**

- PDPA: the callback stores no personal data beyond the order reference. The raw body is not kept longer than the event record needs.
- No double booking: AC3, AC7, AC11 and CC-4; a confirmation never makes a second booking on one slot.
- Club scope: AC9, AC10.
- TEXT: C11 state text (Waiting for your payment, payment did not go through, Time ran out) from P keys, Thai and English.

**Canvas.** H-C11-Beam (T-), S-C11-Time-ran-out (T-), H-C12-Confirmed (T-), F1-06-C11-Beam.

---

## PAY-03 A payment after the hold ends

**Source.** HO PAY-03 (confirmed 30 Oct 2026). PRD Checkout and payment, Open questions (settled); D18, D25, D37, D48; QA Q-20.

**Requirement.** Beam payment after the hold ends: approve if the slot is still open, else put the value in the wallet. The wallet credit gets its own receipt for the money received.

**Acceptance criteria.**

- PAY-03-AC1. Given a payment that Beam reports after the hold ended, when the slot is still open (no other hold, no booking and no closure on it), then the booking is approved and confirmed, with a receipt and the Booking confirmed card (D25).
- PAY-03-AC2. Given such a payment and the slot is held, booked or closed (a closure, including one that cancelled this hold, D48), when it is reported, then the value is credited to the player's wallet, nothing is booked, and the player gets a LINE message (D25).
- PAY-03-AC3. Given a solo class, when its late payment arrives, then court and coach must both be free for it to be approved; if either is not, all of it goes to the wallet and nothing is partly booked (D25).
- PAY-03-AC4. Given a late payment credited to the wallet, when it is saved, then the wallet credit equals the money paid, is a ledger row with a reason, and gets its own receipt for the money received (D37, F13).
- PAY-03-AC5. Given the slot check, when it runs, then it runs inside the booking transaction with the uniqueness rule, so two late payments for one slot cannot both be approved and a late payment cannot take a slot from a player who now holds it.
- PAY-03-AC6. Given a hold that was released, when the player is told, then they already got Booking released when the hold ended (D45); the late payment message says what happened to the money (approved or wallet).
- PAY-03-AC7. Given the order that was released, when a late payment is approved, then the same order and amounts are used; it is not repriced.
- PAY-03-AC8. Given a late payment arrives for a package order that was cancelled, when it is reported, then what happens is Q6.

**Meets.**

- PDPA: wallet credit and receipt are the player's records, club staff by role.
- No double booking: AC1, AC3, AC5 (the rule is the whole point).
- Club scope: per club wallet; the credit goes to the player's account at that club only.
- TEXT: the late payment messages and wallet credit text are new L and P keys (proposed, D51), Thai and English; the wallet reason name for this credit is Q10.

**Canvas.** S-C11-Time-ran-out (T-), H-C14-Credits-wallet (T-), L-Msg-* (no board for the late payment message; Q10).

---

## PAY-04 Package bought alone

**Source.** HO PAY-04. PRD C11P and C11bP ("Nothing is held, the QR is valid 15 minutes, then the order is cancelled and nothing is charged").

**Requirement.** A package bought alone: nothing is held, the QR is valid [15] minutes, then the order is cancelled and nothing is charged. A package bought together with a booking uses the booking's hold (F03).

**Acceptance criteria.**

- PAY-04-AC1. Given a player buys a package alone, when they pay, then no slot hold exists and a QR is created for the exact amount with a validity of the club's package order setting (Hunter 15 minutes).
- PAY-04-AC2. Given the QR validity ends without payment, when it ends, then the order is cancelled and nothing is charged or credited; no ledger rows and no receipt exist.
- PAY-04-AC3. Given a payment arrives while the QR is valid, when the callback is verified (PAY-02), then the package is added with its credits, expiry and receipt (F06, F13).
- PAY-04-AC4. Given a package bought with a booking, when the player pays, then the booking's hold governs and the QR expires with it (BOOK-03, D18).
- PAY-04-AC5. Given a payment arrives after a package order was cancelled, when it is reported, then the value goes to the wallet and gets its own receipt (consistent with PAY-03, D37); whether this is right is Q6.
- PAY-04-AC6. Given C11P, when it shows, then it states the QR time as a variable `{minutes}` and shows Time ran out when the QR has expired.
- PAY-04-AC7. Given the package order setting (Hunter 15), when it is a separate setting or the hold setting, then which of the two it is, is Q6.

**Meets.** PDPA: not beyond CC-3. No double booking: a package alone has no slot; nothing can double book. Club scope: per club. TEXT: C11P text with `{minutes}`; fixed "15 minutes" in canvas text is a canvas bug (Gaps A5).

**Canvas.** H-C11P-Pay-package (T-), G-C11P-Beam-package (T-), F2-04-C11P-Beam-package, H-C12P-Hours-added.

---

## PAY-05 No cash refunds

**Source.** HO PAY-05, CANCEL-02. PRD Payments (Value never comes back as cash); Gaps A3.

**Requirement.** Refunds never go back as cash. Wallet or credit only.

**Acceptance criteria.**

- PAY-05-AC1. Given any cancel, closure, failed payment or wrong amount, when value is returned, then it is returned as wallet balance or package credit and never as money to the player's bank or Beam.
- PAY-05-AC2. Given the whole system, when its routes, buttons and admin actions are listed, then none refunds money or withdraws the wallet (route inventory test; QA CANCEL-02).
- PAY-05-AC3. Given the Beam client in the app, when it is built, then it has no refund call at all; a test double fails if a refund is attempted.
- PAY-05-AC4. Given a validly signed wrong amount callback (PAY-02-AC6), when staff make the player whole, then it is a wallet credit with a reason, not a refund to Beam.
- PAY-05-AC5. Given the P2 step 5 text and the PRD cost section saying refunds go back by PromptPay, when F05 is built, then that text is not built (Gaps A3).

**Meets.** PDPA: not relevant. No double booking: not relevant. Club scope: per club wallet. TEXT: the cancel and wallet texts say wallet or credit (F09 keys).

**Canvas.** H-P2-Step5-Payments (Option A text is a canvas bug), H-C13b-Cancel-sheet.

---

## PAY-06 Cash at the front desk

**Source.** HO PAY-06. PRD Checkout and payment ("Front desk can take cash with a reason code, since the policy is QR first"); D56. F11 builds the A2 screen (ADMIN-04).

**Requirement.** Front desk can take cash in A2 with a reason code.

**Acceptance criteria.**

- PAY-06-AC1. Given staff in A2, when they take cash without a reason code, then the server refuses.
- PAY-06-AC2. Given the reason codes are No banking app, QR failed at the counter, and Other with a note, when staff pick Other without a note, then the server refuses (D56).
- PAY-06-AC3. Given cash, when it is taken, then the order method is cash, a receipt is issued, and the entry is audited (PLAT-04) with the reason code.
- PAY-06-AC4. Given a package sale at the desk, when staff take cash, then it is allowed (D56).
- PAY-06-AC5. Given a player, a coach or an accountant, when they try to take cash, then the server refuses; only Front desk and Owner can (D56).
- PAY-06-AC6. Given a cash payment, when the daily close runs, then it is totalled as cash (F13).
- PAY-06-AC7. Given a cash order, when it is cancelled 12 hours or more ahead, then the value goes to the wallet, not as cash (D21, PAY-05).

**Meets.** PDPA: staff only. No double booking: a cash booking is created under the same uniqueness rule and, if awaiting payment, holds the slot for the hold time (D43). Club scope: per club. TEXT: reason code labels are A keys, Thai and English.

**Canvas.** H-A02-Booking-create (T-), G-A02b-Booking-detail, F3-02-A02-Booking-create.

---

## Proposed new text keys (D51)

Proposed by the drafter; writers own the wording; numbers from the i18n role after `copy-index.csv` exists (D31). Existing keys first.

- P: payment did not go through (failed charge), Beam unavailable try again, late payment approved, late payment credited to wallet, wrong amount held for the club, C11P QR time as `{minutes}`.
- L: late payment messages (approved and wallet).
- A: wrong amount flag for the owner, cash reason code labels (A2).
- X: P1 alert for Beam failures, Beam connection test results, key swap checklist item.

No key is added by this draft.

## Open questions

Numbered so the person approving can answer by number.

1. **Hunter's Beam merchant account and fees.** Account, sandbox keys, the webhook signing key and Beam's confirmed fees are open for setup, not code (HO). When will the sandbox be ready for the design step?
2. **Beam's wire details.** The docs state the items listed above. Payment link fields, test data and the refund lifecycle were not read. Confirm the docs and the sandbox before the design step (QA Q-31).
3. **Callback for an unknown charge (PAY-02-AC9).** Reject with an error status (Beam retries up to 10 times) or answer success and flag it?
4. **Failed charge inside the hold (PAY-02-AC8).** A failed charge cannot be retried, a new one is needed. D47 says a second tap on Pay returns the same QR. Should a second tap after a failed charge create a new charge within the same hold?
5. **A payment never reported.** If Beam cannot deliver the callback (all retries fail), the player has paid but we never know. May the server ask Beam for the charge status as a safety net (the docs describe polling), and who reconciles? Is polling allowed to confirm a booking, or only to alert?
6. **Package orders (PAY-04).** Is the 15 minute package QR time the same setting as the hold (10, 15 or 20) or its own? What happens to a payment that arrives after the package order was cancelled (wallet, as PAY-03, or refused)? (QA Q-21.)
7. **Alerts and flags.** Where do the bad signature alert, the wrong amount flag, the failed key check and the unreachable Beam alert show (P1, an owner banner, a LINE message to the owner) and who is told?
8. **Data sent to Beam.** The docs show a reference id and a return URL. Does Beam need any customer detail, and may we send none beyond the order reference?
9. **Wrong amount (PAY-02-AC6).** What does the player see while staff credit the wallet (a message, nothing)? How long should staff take? Is an overpayment also credited in full?
10. **Wallet reasons (PAY-03-AC4).** The ledger lists wallet reasons only as booking or referral. What are the reason names for a late payment credit, a wrong amount credit and a cancel credit (QA Q-12)? And the wording of the late payment messages (new keys, writers).
11. **Receipts for wallet credits.** D37 says a late payment that goes to the wallet gets its own receipt. Does a wrong amount credit from staff get one too?
12. **Clock and expiry.** Beam's docs say timestamps are UTC. The QR expiry equals the hold end (D18); how is a clock difference between us and Beam handled so the QR never outlives the hold by a second?
