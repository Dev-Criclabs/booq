# Fake Beam and fake LINE: design

Status: skeleton, type checked and smoke tested on 30 Oct 2026; Beam side rebuilt the same day on Beam's public docs. Owner: QA. The fakes do not import app code. They sit **outside** the app and speak to it the way Beam and LINE do, so the real adapters are exercised.

Why fakes and not mocks: PAY-02, PAY-03, LINE-03 and LINE-04 are about what crosses the boundary (a signed callback in, a push out). A mock inside the app skips the code that matters.

## 1. Files

| File | Purpose |
|---|---|
| `clock.ts` | `Clock` interface and `FakeClock`. Default start `2026-12-07T09:00:00+07:00`. Time moves only by `advance*()` |
| `locale.ts` | Resolve `locales/en.json` and `th.json` keys with `{variables}`; find which key produced a rendered text. Tests never assert literal wording |
| `beam/types.ts` | Charges, events, signed deliveries, signing modes, `WireFormat` |
| `beam/wire.ts` | Beam's documented signature: base64 HMAC-SHA256 over the exact body, `x-beam-event` header |
| `beam/wire.vector.ts` | The docs' test vector (body to be pasted from the docs page) |
| `beam/fake-beam.ts` | `FakeBeam`: create charge, pay, fail, deliver, redeliver, retry, HTTP façade, refund trap |
| `beam/scenarios.ts` | The five scenarios as runners, plus the catalogue of what the app must do |
| `line/types.ts` | Club channels, users, pushes, rich menu, faults |
| `line/fake-line.ts` | `FakeLine`: push recording per club and language, ID token verify, friendship, quota, rich menu, optional HTTP server |
| `line/flex.ts` | Flex inspector: texts, actions, limits, confirmed card check, text-from-locale check |
| `line/rich-menu.ts` | Six tile deep link check |
| `line/liff-stub.ts` | `window.liff` stand in for Playwright |
| `../support/parallel.ts` | `raceAll`, `repeat`, `tally` for concurrency tests |

## 2. How a test wires a fake to the app

The app will have adapters for Beam and LINE behind interfaces with a base URL setting (testability request 6). Two ways to connect, both supported:

1. **HTTP.** The test starts the fake's server (`FakeLine.serve()`, `FakeBeam.serve()`) and gives its URL to the app config. The app calls it as it would the real service.
2. **Direct.** For Beam callbacks the test passes a `DeliveryTarget`: a function that receives `{headers, rawBody}` and returns `{status}`. Use `fetch` to the app's callback route, or call the route handler in process.

```ts
const clock = new FakeClock();
const beam = new FakeBeam({ clock, merchants: { 'hunter-merchant': { apiKey: 'k1', webhookKeyBase64: keyA }, 'club-b-merchant': { apiKey: 'k2', webhookKeyBase64: keyB } } });
const line = new FakeLine({ clock, channels: [/* one per club */] });

// 1. app creates the charge through its Beam adapter pointed at the fake; the test finds it:
const charge = beam.getCharge(chargeIdFromApp); // charge.chargeId, charge.amount (satang)
// 2. a scenario drives the callback:
const rec = await validPayment({ beam, clock, target: postToApp, charge });
// 3. assertions on the APP state (order, booking, ledgers, receipts) and on the fakes (pushes, refunds)
expect(line.pushes({ clubId: 'A', to: 'U1', type: 'flex' })).toHaveLength(1);
beam.assertNoRefunds();
```

## 3. Fake Beam

Built on Beam's public docs (https://docs.beamcheckout.com, read 30 Oct 2026). In the source, **DOC** marks something the docs state and **GUESS** marks something they do not (Q-31).

### 3.1 What comes from the docs

| Item | Taken from the docs |
|---|---|
| Create a QR charge | `POST /api/v1/charges`, HTTP Basic `merchantId:apiKey`, body with `amount`, `currency: THB`, `paymentMethod.qrPromptPay.expiryTime` (ISO 8601 UTC), `referenceId`. Response `actionRequired: ENCODED_IMAGE` and `encodedImage.expiry`. Playground base `https://playground.api.beamcheckout.com`, production `https://api.beamcheckout.com` |
| Read a charge | `GET /api/v1/charges/{chargeId}` |
| Amount | Integer in the smallest unit: satang for THB (`10000` = 100.00 THB) |
| Webhook | HTTP POST to the registered URL. Body is the charge object as GET returns it. Event name in header `x-beam-event` (`charge.succeeded`, `charge.failed`) |
| Signature | Header `X-Beam-Signature` = base64 of HMAC-SHA256 over the **exact** request body bytes, using the base64 decoded webhook key. "Without formatting, otherwise the signature will not match". A test vector is in the docs (`beam/wire.vector.ts`; the full body must be pasted from the docs page to run it) |
| Retries | Any 2xx stops retrying. Other responses retry, default 10 attempts with exponential backoff |
| Idempotency | Header `x-beam-idempotency-key` on POST and PATCH, up to 255 characters, kept 12 hours |
| Refund | `POST /api/v1/refunds`. The fake answers 403 and records it; `assertNoRefunds()` fails the test (CANCEL-02, PAY-05) |
| Sandbox | The Playground environment with its own Lighthouse keys. D26: tests use the sandbox only, no in app simulate payment |

### 3.2 What stays a guess (Q-31)

No event id and no timestamp in the webhook (so the fake sends none; no replay protection can be tested); what an expired QR becomes (the fake leaves it PENDING, the docs say an abandoned payment can stay PENDING for good); whether a QR can still be paid after `expiryTime` (the fake allows it, because D18 and PAY-03 define a late payment as one Beam reports after the hold ends); backoff intervals (the fake uses 2, 4, 8 ... seconds on the fake clock); `failureCode` values; the idempotency response on a repeat (the fake returns the same charge); and whether a sandbox PromptPay QR can be paid by a tester at all, which decides if D26 works on 7 Dec.

### 3.3 Interface

App facing: `createCharge(merchantId, request, idempotencyKey?)`, `getCharge(id)`, `serve()` for the HTTP paths above.
Test facing: `pay(chargeId, target, options)`, `fail(...)`, `deliver(...)`, `redeliver(record)`, `deliverParallel(...)`, `webhookBody(...)`, `deliveries`, `refundAttempts`, `assertNoRefunds()`.

Signing modes: `correct`, `wrong-key` (also club A's key on a club B charge), `tampered-body` (amount changed after signing), `reformatted-body` (same JSON re-serialised with whitespace: the app must verify the raw bytes, not re-serialised JSON), `missing`, `malformed`.

### 3.4 The five scenarios and what the app must do

The catalogue is `BEAM_SCENARIOS` in `scenarios.ts`. Expected outcomes come from the spec and decisions D18 to D26.

| # | Scenario | Runner | App must |
|---|---|---|---|
| 1 | **Valid payment** | `validPayment` | Booking **confirmed**; order paid; one receipt (RCPT-01); one Booking confirmed Flex card in the player's language (LINE-04). 2xx |
| 2 | **Bad signature** | `badSignature(mode)` for 5 modes; `signedWithOtherClubKey` | **Rejected, logged and alerted** (D24); nothing else changes (PAY-02). 4xx |
| 3 | **Wrong amount** (1 satang less, 1 satang more, baht sent for satang, double) | `wrongAmount(variant)` | Validly signed, so it is accepted as a message but the booking is **not confirmed**, the order is **flagged for the owner**, and staff credit the wallet with a reason (D24). Answered with a **success status** so Beam stops retrying (D36) |
| 4 | **Duplicate callback** | `duplicateCallbackSequential`, `duplicateCallbackParallel` | **Ignored with success** (D24). After all copies: the effect of one payment. Concurrency version CONC-26 |
| 5 | **Late callback after hold** | `lateCallbackAfterHold(variant, {beforePay})` | The QR expired when the hold ended (D18). `slot-still-open`: **approved**. `slot-taken-confirmed`, `slot-held-by-other`, `solo-coach-lost` (court and coach both must be free, otherwise all of it), `closure-created`: not confirmed, **amount paid goes to the wallet**, player gets a LINE message, a receipt for the money received (accountant to confirm) (D25) |

Every scenario also asserts `beam.assertNoRefunds()`, that the LINE pushes match the catalogue, and that the oracle invariants of `docs/qa/concurrency-tests.md` section 2 hold.

## 4. Fake LINE

### 4.1 Interface

| Area | Calls | Notes |
|---|---|---|
| Setup | `new FakeLine({clock, channels, users, undeliverable})` | One channel per club: OA token, Login channel id, LIFF id. Users have a LINE app language and friend flags per club. The same `lineUserId` can be a friend of club A and club B |
| LIFF login | `issueIdToken(user, club)`, `verifyIdToken(idToken, clientId)`, `issueAccessToken`, `friendship(accessToken)`, `liffProfile` | A token for club A's Login channel is rejected for club B's channel id. This proves the app verifies the audience |
| Browser | `installLiffStub(page, config)` | Replaces `window.liff` in Playwright: `inClient` true gives silent login, false shows the Log in with LINE button once; `friendFlag` false triggers the add friend prompt (LINE-01). Calls are logged in `window.__liffCalls` |
| Push | `push(token, {to, messages})`, `pushes({clubId, to, language, type})`, `pushLog` | Records club, token used, recipient, messages, **detected language** (th, en, mixed, none), delivered flag, time |
| Flex capture | `flex.ts`: `collectTexts`, `collectActions`, `checkConfirmedCard`, `textsNotFromLocale`, `validateFlexLimits` | See 4.3 |
| Quota | `messagesUsedThisMonth(token)` | Bangkok calendar month. For LINE-06 (P1 usage counter) |
| Faults | `injectFault(token, {status, times})` | 401 on a club's token: LINE-06 alert. 500: retry behaviour (Q-27b) |
| Rich menu | `createRichMenu`, `setDefaultRichMenu`, `defaultRichMenuOf(club)`, `richMenuProblems()` | LINE-02: six tiles, six distinct deep links, all open the club's own LIFF app, Book a court opens C4 (BOOK-02) |
| HTTP | `serve(port)` | Push, ID token verify, quota, rich menu, friendship. Paths follow LINE's public API as understood on 30 Oct 2026 and carry VERIFY marks in the source |

### 4.2 Recorded per language

Each push is stored with `detectedLanguage`:

1. Count texts that match a locale key in **one** language only (templates with `{variables}` match by pattern).
2. `th` or `en` if one language wins; `mixed` if both appear (a bug, LINE-03); if no key matches (copy still draft), fall back to script detection (any Thai letter means th).

A test then asserts `line.pushes({to: 'U1'})` all equal the **profile** language of the player, and that toggling the language in Profile changes the next message. LINE-03: the language of the push is the player's BOOQ language, not necessarily the LINE app language, which is why users carry both (Q-27a).

### 4.3 Flex card capture

`checkConfirmedCard(messages, expectation)` returns a list of problems (empty = pass) for LINE-04:

- the push is within LINE limits (at most 5 messages, altText present and at most 400 characters, contents under 50 KB, bubble or carousel). VERIFY these constants against current LINE documentation;
- visible text contains the court or class, date, time, coach if any, amount paid and receipt number the test passes in (values come from the app state, formatted through the locale helper);
- two URI buttons exist, View booking and Add to calendar; View booking opens `liff.line.me/<this club's liffId>`;
- every text comes from a locale key in the card's language or is pure data (money, time, receipt number, URL). Hard coded wording is reported (TEXT-01 for LINE);
- the card language equals the expected language.

Pixel match with canvas board L-Msg-Confirmed is a manual device check (the board is not in the repo, G-04 in open questions).

### 4.4 Scenarios

| # | Scenario | Checks |
|---|---|---|
| L1 | LIFF login in LINE | `inClient: true`: no login click; ID token verified server side against the club's Login channel id; user created at that club only |
| L2 | LIFF login in a browser | `inClient: false`: Log in with LINE shown once; after `login()` the player returns to C10 with the slot kept (AUTH-01) |
| L3 | Add friend prompt | `friendFlag: false` shows the prompt; `true` does not (LINE-01) |
| L4 | Cross club token | Club A ID token presented to club B login: refused (RLS-A11) |
| L5 | Push per type | For each LINE-05 message: one push, to the right user, club token, language, at the right fake time (reminders at 24 h and 2 h, Q-27c for late bookings) |
| L6 | Language per push | Thai player gets `th`, English player `en`, never `mixed`; changing the language changes the next push |
| L7 | Booking confirmed card | `checkConfirmedCard` passes for court, solo class with coach, class seat, credit only booking (Q-25) |
| L8 | Push count per booking | About 3 to 4 per booking (PRD); counter equals `messagesUsedThisMonth` (LINE-06) |
| L9 | Token failure | `injectFault(token, {status: 401})`: P1 alert raised (LINE-06); the booking itself is not lost |
| L10 | Rich menu | `richMenuProblems` empty; tile 1 opens C4 |
| L11 | Tenancy | Club B events never use club A's token (RLS-A13) |
| L12 | Blocked or not a friend | Behaviour per Q-27b |

## 5. Limits

- The fakes prove the app's side of the contract. They do not prove LINE or Beam behave that way; sandbox and device checks do (strategy section 6).
- Real LINE rendering of Flex, LIFF in the LINE app and bank app links are manual.
- Nothing here is a product rule. Where a rule is not in the spec, the catalogue says `undecided` and names the question.
