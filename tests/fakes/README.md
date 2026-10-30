# Fake Beam and fake LINE: design

Status: skeleton, type checked and smoke tested on 30 Oct 2026. Owner: QA. The fakes do not import app code. They sit **outside** the app and speak to it the way Beam and LINE do, so the real adapters are exercised.

Why fakes and not mocks: PAY-02, PAY-03, LINE-03 and LINE-04 are about what crosses the boundary (a signed callback in, a push out). A mock inside the app skips the code that matters.

## 1. Files

| File | Purpose |
|---|---|
| `clock.ts` | `Clock` interface and `FakeClock`. Default start `2026-12-07T09:00:00+07:00`. Time moves only by `advance*()` |
| `locale.ts` | Resolve `locales/en.json` and `th.json` keys with `{variables}`; find which key produced a rendered text. Tests never assert literal wording |
| `beam/types.ts` | Charges, events, signed deliveries, signing modes, `WireFormat` |
| `beam/wire.ts` | **Placeholder** signature scheme (HMAC-SHA256). Not Beam's real scheme (Q-31) |
| `beam/fake-beam.ts` | `FakeBeam`: create charge, pay, expire, deliver, retry, refund trap |
| `beam/scenarios.ts` | The five scenarios as runners, plus the catalogue of what the app must do |
| `line/types.ts` | Club channels, users, pushes, rich menu, faults |
| `line/fake-line.ts` | `FakeLine`: push recording per club and language, ID token verify, friendship, quota, rich menu, optional HTTP server |
| `line/flex.ts` | Flex inspector: texts, actions, limits, confirmed card check, text-from-locale check |
| `line/rich-menu.ts` | Six tile deep link check |
| `line/liff-stub.ts` | `window.liff` stand in for Playwright |
| `../support/parallel.ts` | `raceAll`, `repeat`, `tally` for concurrency tests |

## 2. How a test wires a fake to the app

The app will have adapters for Beam and LINE behind interfaces with a base URL setting (testability request 6). Two ways to connect, both supported:

1. **HTTP.** The test starts the fake's server (`FakeLine.serve()`; an HTTP façade for Beam is not written yet; the pattern is the same) and gives its URL to the app config. The app calls it as it would the real service.
2. **Direct.** For Beam callbacks the test passes a `DeliveryTarget`: a function that receives `{headers, rawBody}` and returns `{status}`. Use `fetch` to the app's callback route, or call the route handler in process.

```ts
const clock = new FakeClock();
const beam = new FakeBeam({ clock, merchants: { 'hunter-merchant': 'whsec_test_A', 'club-b-merchant': 'whsec_test_B' } });
const line = new FakeLine({ clock, channels: [/* one per club */] });

// 1. app creates the charge through its Beam adapter pointed at the fake; the test finds it:
const charge = beam.getCharge(chargeIdFromApp);
// 2. a scenario drives the callback:
const rec = await validPayment({ beam, clock, target: postToApp, charge });
// 3. assertions on the APP state (order, booking, ledgers, receipts) and on the fakes (pushes, refunds)
expect(line.pushes({ clubId: 'A', to: 'U1', type: 'flex' })).toHaveLength(1);
beam.assertNoRefunds();
```

## 3. Fake Beam

### 3.1 Interface

App facing: `createCharge({merchantId, orderRef, amountSatang, expiresInSeconds})`, `getCharge(id)`, `refund()` (always throws and records: **no cash refund exists**, CANCEL-02, PAY-05).
Test facing: `pay(chargeId, target, options)`, `expire(chargeId, target)`, `deliver(event, target, signingMode)`, `deliverParallel(event, target, n)`, `deliveries`, `refundAttempts`, `assertNoRefunds()`.

Rules built into the fake: amounts are positive integers of satang; each club is its own merchant with its own webhook secret (so a club A secret on a club B charge is a bad signature, RLS-A12); the fake can pay an expired charge (late payment) because real Beam behaviour is unknown (Q-02, Q-31); it retries a 5xx up to `maxAttempts`.

### 3.2 Signing modes

`correct`, `wrong-secret`, `tampered-body` (signed, then the amount is changed), `missing`, `malformed`, `stale-timestamp` (outside the replay window).

### 3.3 The five scenarios and what the app must do

The catalogue is `BEAM_SCENARIOS` in `scenarios.ts`. Expected outcomes come from the spec only; fields still open are `undecided` and name their question.

| # | Scenario | Runner | Drives | App must |
|---|---|---|---|---|
| 1 | **Valid payment** | `validPayment` | Correct signature, exact amount, inside the hold | Booking **confirmed**; order paid; one receipt (RCPT-01); one Booking confirmed Flex card in the player's language (LINE-04); hold converted. HTTP 2xx |
| 2 | **Bad signature** | `badSignature(mode)` for each of 5 modes; `signedWithOtherClubSecret` | Callback that fails verification | **Changes nothing** (PAY-02): booking and order unchanged, no ledger row, no receipt, no LINE push. Rejected with a 4xx (exact status undecided, Q-19). Hold still runs out normally |
| 3 | **Wrong amount** | `wrongAmount(variant)`: 1 satang less, 1 satang more, baht sent for satang (500 not 50000), double | Validly signed callback with a different amount | **Changes nothing** (PAY-02). Real money may have arrived: how the club and player are told is Q-19 |
| 4 | **Duplicate callback** | `duplicateCallback('sequential' or 'parallel')`, `duplicateCallbackParallelOnly(n)` | Same event id again, and n copies at the same moment | After all copies: the effect of **one** payment. One confirmation, one receipt, one card, one ledger effect. Later copies answer 2xx with no effect (Q-19c). Concurrency version is CONC-26 |
| 5 | **Late callback after hold** | `lateCallbackAfterHold(variant, {holdSeconds, beforePay})` | Clock moves past the hold, hold job runs, then a valid callback arrives | `slot-still-open`: **approved** as a normal confirmation. `slot-taken-confirmed`, `slot-held-by-other`, `solo-coach-lost` (all or nothing), `closure-created`: booking not confirmed and the **amount paid goes to the wallet** with a ledger row (PAY-03, confirmed 30 Oct). The player is told (which message, Q-20) |

Every scenario also asserts, through the test, that `beam.assertNoRefunds()` passes, that the LINE pushes match the catalogue, and that the oracle invariants of `docs/qa/concurrency-tests.md` section 2 hold.

### 3.4 What the fake does not know yet

Beam's real signature scheme and headers, retry timing, charge expiry rule, event ids, API paths (Q-31). They are isolated in `WireFormat` (`beam/wire.ts`) and a future HTTP façade. When Hunter's sandbox credentials exist (open item), a contract test runs the same scenarios 1 to 4 against Beam's sandbox and the fake and compares the app's behaviour.

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
