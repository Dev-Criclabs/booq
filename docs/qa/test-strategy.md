# BOOQ test strategy

Owner: QA role. Branch `qa/test-strategy`. Status: **draft for approval**. Written 30 Oct 2026, updated the same day for the user's decisions D1 to D31 (`docs/decisions.md`).

Sources: `CLAUDE.md`, `specs/product/prd-v1.2.md`, `specs/product/handoff-v1.2.md`, `docs/DEVELOPMENT-PLAN.md`, `docs/canvas-gaps.md`.
Companion files in this folder:

| File | What it holds |
|---|---|
| `traceability.md` | Every hand-off requirement ID mapped to feature, acceptance check, test level. Gaps flagged |
| `concurrency-tests.md` | BOOK-04 and related race-condition test designs |
| `rls-test-plan.md` | Row level security plan: club A vs club B, BOOQ staff vs club data |
| `open-questions.md` | Places where the spec is silent. QA does not guess; the product owner decides |
| `../../tests/fakes/README.md` | Design of the fake Beam and fake LINE |

Rules this strategy follows from `CLAUDE.md`: tests are written first from the acceptance criteria; QA edits only `tests/**` and `docs/qa/**`; QA files bugs with the requirement ID and does not fix product code; QA never invents a rule, price or setting (a TBD in the PRD is an empty club setting, and tests set it explicitly through a fixture instead of relying on a default).

## 1. What we are protecting

In order of damage if it fails. This order drives where the test effort goes.

1. **Money and value.** Wrong amount confirmed, a payment confirmed twice, value lost or created in a ledger, cash refund path existing (PAY-02, PAY-03, PKG-01, CANCEL-02).
2. **Double booking** of a court or a coach, including during holds (BOOK-04).
3. **Tenancy and privacy.** Club A seeing club B, BOOQ staff seeing player, booking or payment data (PLAT, PDPA-01).
4. **Receipts.** Unbroken, never reused, correct legal details (RCPT-01, RCPT-02).
5. **Rules that change money by time.** 12 hour cancel line, hold expiry, package expiry, waitlist offers (CANCEL-01, BOOK-03, PKG-02, CLASS-02).
6. **Language and messages.** Thai and English everywhere, no text in code (TEXT, LINE).
7. Everything else.

## 2. Stack assumed

The PRD's suggested stack is adopted (30 Oct 2026): Next.js with the LIFF SDK, Postgres (Supabase) with row level security by club ID, server jobs for holds, reminders and expiries. Payments by Beam, messages through the LINE Messaging API.

Vitest, Playwright, a real Postgres in tests and a controllable clock were **accepted by the user on 30 Oct 2026 (D30)**. The rest of this table is still a QA proposal for the Architect and DevOps (none of it is in the spec):

| Choice | Proposal | Why |
|---|---|---|
| Unit and integration runner | Vitest | Fast, TypeScript native, same language as the app |
| End to end | Playwright (Chromium, plus WebKit for iOS Safari behaviour) | Pre installed in the cloud sessions; can emulate 375 px and 1280 px, 4G throttling, Thai locale |
| Database in tests | A real Postgres 15+ with the same roles and RLS policies as production (Supabase local stack or a Postgres container). **Not** SQLite, not a mocked client | Race conditions and RLS cannot be tested on a mock |
| Time | One injectable clock in the app (`now()` comes from a single module). Fakes use the same clock | Holds, 12 hour line, expiries and reminders are all time rules |
| Test layout | `tests/unit`, `tests/integration`, `tests/rls`, `tests/concurrency`, `tests/e2e`, `tests/fakes`, `tests/support` | Mirrors the pyramid below |

If the Architect picks differently the pyramid stays; only the tool names change.

## 3. Test pyramid

```
                  /\            Manual / on device (LIFF inside LINE, real bank app, 4G)    ~ 20 checks
                 /  \           E2E (Playwright, fake Beam + fake LINE)                      ~ 25 journeys
                /----\          Integration (real Postgres, API routes, jobs, RLS, races)    ~ 300+ tests
               /      \         Unit (pure rules, no I/O)                                    ~ 400+ tests
              /________\        Static checks (hard coded text, club ID scope, types, lint)  every commit
```

The counts are planning sizes, not targets to hit. The shape is the rule: most rules are proven low in the pyramid because they are fast and exact; E2E proves that the pieces are wired and that the canvas flows work.

### 3.1 Static checks (every commit, DevOps runs them in CI)

| Check | Requirement | How |
|---|---|---|
| No hard coded user facing text | TEXT-01 | Lint over `app/`, templates, receipt and Flex code: string literals that contain letters in JSX text, `alert`, error messages, Flex JSON, PDF templates fail. Allow list for technical strings. The lint is owned by Content/i18n; QA owns the fixtures that prove it catches a violation (a file with a planted literal must fail the lint) |
| Locale parity | TEXT-02, TEXT-05 | Every key in `en.json` exists in `th.json` except `X-` keys (English only). Same variable names `{amount}` in both files for a key. Today the 296 missing Thai keys are all `X-`, see `canvas-gaps.md` D |
| Keys in use are indexed | TEXT-02 | Every key the code uses appears in `locales/copy-index.csv` (file not supplied yet) |
| No edited wording | TEXT-04 | Diff of existing keys between base branch and PR: a changed value for an existing key without a changelog entry fails. New keys must exist in both languages |
| Year is international | design rule | No `2569` and no Buddhist calendar formatting: dates formatted with a fixed Gregorian calendar in both languages |
| Club ID scope | CLAUDE.md | Query lint: every table access in server code goes through the club scoped data layer. A raw query on a club table without `club_id` fails review. Backed by RLS tests, which are the real proof |
| Money type | CLAUDE.md | No floating point on money: lint forbids `parseFloat`, `toFixed` and `number` with decimals on fields named `*_satang`, `amount`, `price`. Money columns are integer satang |
| Timezone | CLAUDE.md | Forbid `new Date()` and `Date.now()` outside the clock module; forbid `getHours()` style local time getters; all formatting passes `Asia/Bangkok` |
| Removed features | CLAUDE.md | A search for check in QR, gift voucher, message editor, slip review queue routes and nav items finds none (test fails if a route like `/admin/check-in` exists) |
| Types | CLAUDE.md | `tsc --noEmit` on app and tests |

### 3.2 Unit tests (pure functions, no database, no network)

The rule is: if a rule can be a pure function, it is one, and it has a unit test with a table of cases. Cases come from the acceptance checks and from the boundaries listed in `traceability.md`.

| Area | Examples | IDs |
|---|---|---|
| Slot rules | 18:30 refused; 18:00 accepted; 06:00 first slot; 23:00 last slot (ends 24:00); 24:00 start refused; day 30 ahead boundary (see Q-04); 61 days refused; slot in the past | BOOK-01 |
| Hold time | Hold length only 10, 15 or 20; other values refused; default 15; backup mode 60 is F16 only | BOOK-03 |
| Price groups | Adult at 18 years 0 days vs 17 years 364 days; switch on the 18th birthday; DOB corrected later changes the price group going forward | AUTH-02 |
| Pricing | Court ฿500; solo = court ฿500 + coach; Adult Coach tier ฿1,300; Student ฿1,200; money is integer satang (50000); percentage rounding half up to the satang, add-ons excluded unless the code says so (D23) | COACH-02, PRICE |
| Coach availability | On leave hidden; booked hidden; 6 in a row allowed, 7th hidden; a free hour between resets the run, unpaid held hours and uncancelled group classes count (D19); solo, group and staff bookings all count | COACH-01 |
| Credit application | Solo credit never applied to a coach added at court checkout; solo credit still leaves ฿500 court due; order of use: package credit, then wallet, then money (D22) | COACH-03, COACH-04 |
| Ledgers | Balance = sum of rows; reasons limited to the allowed set (reserve, return, use, forfeit, expire, adjust); staff entries need a note | PKG-01 |
| Package expiry | Purchase + 3 months, + 5 months; month end purchase (30 Nov + 3 months = 28 Feb, D20); expiry at 23:59 Asia/Bangkok on that day (D20); pause extension adds the pause length | PKG-02, PKG-03, PLAT-03 |
| Cancel rules | Exactly 12h 00m 00s before start = full return; 11h 59m 59s = forfeit; no show = forfeit; credit goes to package, money to wallet; mixed payment split; solo substitution overrides the window | CANCEL-01 |
| Waitlist | Order by position; offer expiry 30 min; no offer when start is under 2 h away; skip declined | CLASS-02 |
| Promo | One code per order; stacking per code with birthday; caps (total, per customer, first time only, minimum spend) | PROMO-01 |
| Referral | Self referral blocked on LINE ID and on phone | PROMO-02 |
| Beam verification | Signature check, amount check in satang, event id idempotency key | PAY-02 |
| Receipt number | Format `HTC-2027-000001`; year from the Bangkok date; padding; no reuse after void | RCPT-01 |
| Locale helper | Variable substitution `{amount}`, missing variable raises, same variables in both languages | TEXT-03 |
| Time | 23:30 UTC on 30 Dec = 06:30 Bangkok on 31 Dec; 17:00 UTC is midnight Bangkok; the year flips at Bangkok midnight, not UTC midnight | all time rules |

### 3.3 Integration tests (real Postgres, real API routes, fakes at the edge)

An integration test boots the app's route handlers against a real database that has the migrations and RLS policies applied, with fake Beam and fake LINE as the only outside systems. Each test creates two clubs (A = Hunter fixture, B = a second club) so tenancy is exercised in every test by default.

| Suite | What it proves | IDs |
|---|---|---|
| `integration/booking` | Server refuses bad slots; hold created on Pay with expiry; held slot visible as held; release by job; release sends the LINE message in the player's language | BOOK-01, BOOK-03 |
| `integration/pricing-checkout` | Checkout lines, add ons, discounts, credit, wallet, amount due; nothing due confirms at once with no QR | PAY-07, COACH-02..04, PROMO-01 |
| `integration/beam` | Callback verified, confirms booking, receipt, LINE card; bad signature, wrong amount, duplicate, late callback (all five scenarios in `tests/fakes`) | PAY-02, PAY-03, PAY-04 |
| `integration/ledgers` | Every movement writes a ledger row with reason; wallet and credits never editable as a single number; direct update of a balance column does not exist | PKG-01 |
| `integration/cancel` | 12 hour line, closure cancel, no show and reversal, no cash refund route exists | CANCEL-01..04, PAY-05 |
| `integration/classes` | Min and max players, audience rule, waitlist offers and the 2 hour cut off | CLASS-01, CLASS-02 |
| `integration/receipts` | Sequence unbroken under parallel confirmations, void rules, daily close totals by method | RCPT-01, RCPT-03 |
| `integration/line` | Each message type sent once, to the right OA, in the right language, at the right time; usage counter; token failure alert; rich menu has 6 tiles | LINE-02..06 |
| `integration/jobs` | Hold expiry, reminders 24h and 2h, package expiry reminders 14 and 3 days, waitlist offer expiry, birthday message. All run on the fake clock | BOOK-03, LINE-05, PKG-03 |
| `integration/audit` | Every change to a booking, balance, price or setting writes an audit entry with actor, old and new value, reason; platform actions also write the P6 log | PLAT-04 |
| `acceptance/F01, F02` | One todo per approved acceptance criterion (173): `tests/acceptance/` | ROLE, PLAT, PDPA, AUTH, LINE-01 |
| `integration/platform` | Club lifecycle Draft, Testing, Live, Paused; go live needs every P4 check; pause rules; support view is setup only; 24 hour allow-changes switch expires | PLAT-01..03 |
| `integration/test-mode` | Test flag set on the server at creation, own non legal receipt series, purge removes only flagged rows of that club and blocks Go live if one cannot be removed, only owner and named BOOQ testers can sign in, BOOQ sees pass or fail only, Beam sandbox only and no simulate payment route exists; test key set in Testing, live set after Go live, swap is a P4 check; test rows excluded from every report, daily close, receipts list and aggregate | PLAT-07, D4, D26, D32, D33 |
| `integration/pdpa` | Consent stored at first sign in; copy of my data; delete on request; staff notes and slips not visible to players | PDPA-01 |
| `concurrency/*` | Race conditions, see `concurrency-tests.md` | BOOK-04 and others |
| `rls/*` | See `rls-test-plan.md` | PLAT, PDPA-01 |

**Role matrix test.** One table driven test calls every API route as each role (Player, Coach, Front desk, Accountant, Owner, Platform admin, Onboarding specialist, anonymous) and asserts allow or deny against the role table in the hand-off. A new route with no row in the matrix fails the build. This is the server side permission proof the spec asks for.

### 3.4 End to end tests (Playwright)

Run against a deployed preview or local stack with fake Beam and fake LINE. Screen size 375 px for player and coach, 1280 px for admin and platform. Each journey maps to the canvas flows, which were click tested on 30 Oct 2026.

| E2E | Canvas flow | IDs |
|---|---|---|
| E2E-01 Guest browses, signs in at checkout, slot kept, pays by Beam, confirmed, LINE card recorded | F1 / Flow 0 | AUTH-01, BOOK-03, PAY-02, LINE-04 |
| E2E-02 First sign in asks only name, phone, consent; no DOB field for Adult | F1 | AUTH-02 |
| E2E-03 Student price path asks for DOB; correcting DOB in Profile works and is never locked | F1 | AUTH-02 |
| E2E-04 Book two hours with bundle credit, nothing due, confirmed with no QR | Flow A | PAY-07 |
| E2E-05 Add a coach at court checkout, pay full ฿1,300 even with solo credits | Flow A | COACH-02, COACH-03 |
| E2E-06 Solo class from Classes with credit; court line still due | Flow B | COACH-04 |
| E2E-07 Hold expires, slot reopens for a second browser, release message recorded | F1 | BOOK-03 |
| E2E-08 Two browsers tap Pay on the same slot at once: one gets QR, one gets a clear message | F1 | BOOK-04 |
| E2E-09 Late Beam callback: slot open (approved) and slot taken (wallet) | F1 | PAY-03 |
| E2E-10 Buy a bundle alone, QR times out, order cancelled, nothing charged | F2 | PAY-04 |
| E2E-11 Buy a bundle, then book with it | F2 | PKG-02 |
| E2E-12 Cancel sheet states outcome first; 12 hour boundary on the fake clock | Flow D | CANCEL-01 |
| E2E-13 Group class full, waitlist, offer in LINE, claim | Flow C | CLASS-02 |
| E2E-14 Front desk walk in, cash with reason code, daily close | F3 / Flow F | PAY-06, RCPT-03 |
| E2E-15 Coach portal K1 to K6 for a coach: own data only | Flow G | COACH |
| E2E-16 Coach leave, owner approves, substitute, customer message | Flow G | COACH |
| E2E-17 Closure with affected bookings preview, cancel with credit back and LINE message | A12 | CANCEL-03 |
| E2E-18 BOOQ onboards a club P1 to P4, Testing, Go live blocked until every check passes | F4 | PLAT-01 |
| E2E-19 Pause a club: banner in admin, player app shows paused, existing bookings still valid | F5b | PLAT-03 |
| E2E-20 Support view shows setup only, nothing about players | F5a | PLAT-02 |
| E2E-21 Thai and English: every journey above runs once in each language; longest string layout checks | all | TEXT-06 |
| E2E-22 Receipt PDF in Thai and English visually compared to the canvas boards R-Receipt-TH and R-Receipt-EN | F1 | RCPT-02 |
| E2E-23 Rich menu tile deep links open the right page directly (browser level) | LINE-02 | BOOK-02, LINE-02 |
| E2E-24 Removed features absent: no check in, no gift vouchers, no message editor, no slip review queue, no simulate payment action | all | CLAUDE.md, D26 |
| E2E-25 Performance: court grid and class schedule under 2 s on throttled 4G (Chromium network emulation, cold cache, 30 day strip) | C4, C7 | Performance |

**Layout checks (TEXT-06).** For every screen the Playwright run injects the longest string of either language for each key it renders (Thai is usually longer), at 375 px, and asserts: no horizontal scroll, no button text wraps to two lines (button height unchanged), content area scrolls. Screenshots are kept as artifacts; they are not pixel baselines except for the two receipts.

**What E2E does not do.** Playwright cannot drive the real LINE app. LIFF inside LINE, silent login, the add friend prompt, the Flex card rendering in the chat, rich menu taps, share to LINE and bank app links are covered by a manual device checklist (section 6.4).

### 3.5 Manual and on device checks

A short list, run on the 7 Dec window, because no tool can do them: LIFF silent login in LINE on iOS and Android; add friend prompt; real Flex card look against the canvas L-Msg boards; rich menu taps; bank app tile links on iOS and Android (the PRD says test before launch); share to LINE; 4G load time in LINE's in app browser.

## 4. Test data and environments

| Env | Use | Beam | LINE |
|---|---|---|---|
| Local / CI | Unit, integration, concurrency, RLS, E2E | Fake Beam | Fake LINE |
| Preview per PR | E2E smoke | Fake Beam | Fake LINE |
| Staging | Development and QA only (D16). Full E2E on fake Beam, Beam sandbox when credentials exist | Fake Beam, then Beam sandbox (open item: Hunter's Beam merchant account and sandbox credentials) | A real test LINE OA and LIFF app for device checks; fake LINE for automation |
| Production, Hunter in status Testing | **The 7 Dec test window runs here (D16).** Test data is flagged and purged at Go live (PLAT-07). Testers are the owner and named BOOQ testers only | **Beam sandbox only. No in app simulate payment (D26)** | Hunter's real OA; test pushes count toward the monthly cap (LINE-07) |
| Production, Live | Go live smoke checklist, read only, after the purge | Live keys | Live |

**Fixtures.** A seed builder in `tests/support` (to be written when the schema exists) creates: Club A "Hunter fixture" (2 courts, 06:00 to 24:00, ฿500 flat, Adult and Student groups, 10 hour and 20 hour bundles, solo and group packs from the PRD tables), Club B "second club" (different prices, one court, slip option) with its own players, and platform staff accounts. Settings that are TBD in the PRD (add on prices, Head Coach price, referral reward, friend discount, birthday discount, max future hours, class below minimum alert, wallet expiry, coach pay) are **set by the fixture to named test values and labelled as test values**; they are not product defaults and the tests never assume them outside the fixture. Where the check says "empty means no limit" (BOOK-05) a second fixture leaves it empty.

**Isolation.** Each integration test runs in its own schema or transaction template so tests run in parallel. Concurrency and RLS tests need real separate connections and so use a per file database, not a rolled back transaction.

**Time.** The test clock starts at a fixed instant, default `2026-12-07T09:00:00+07:00`. Tests move it forward; jobs are triggered by an explicit `runDueJobs()` call, never by waiting.

**Language.** Every user facing assertion goes through the locale helper (key plus variables, in `th` and `en`) so a writer's refined copy replacing the files does not break tests. Tests never assert on literal wording.

## 5. Entry and exit criteria

| Gate | Criteria |
|---|---|
| A feature task is done | Tests written first from its acceptance criteria are green; each ID in the task has at least one test; type check clean; static checks clean |
| A feature is accepted by QA | All its requirement IDs have a traceable test in `traceability.md` with status Green; open questions for it are answered or recorded as known risk by the product owner |
| Ready for the 7 Dec window | Section 6.1 entry criteria met |
| Ready for go live 29 Dec | Section 6.6 exit criteria met |

## 6. Mock booking test plan for the 7 Dec 2026 window

Purpose: prove end to end, with Hunter staff and friendly players, that the booking flows work before public booking opens on 29 Dec 2026 (soft launch 9 Jan 2027). This is the PRD's "end to end testing with mock bookings" and the P4 "Test mode results".

### 6.1 Entry criteria (must be true on 7 Dec)

| # | Criterion | Owner | Source |
|---|---|---|---|
| 1 | Hunter club is in status Testing, passed P2 and P3 setup | Platform / Hunter | PLAT-01 |
| 2 | Waves 1 and 2 are deployed to staging (sign in, court booking, checkout, Beam, LINE messages). Waves 3 and 4 inside the window (the development plan says they must land inside it) | Orchestrator | DEVELOPMENT-PLAN |
| 3 | Beam sandbox credentials for Hunter exist and a sandbox PromptPay charge can be paid by a tester (D26 allows sandbox only; Q-31 says this is not yet confirmed from Beam's docs) | Hunter / Beam | Open item, Q-31 |
| 4 | A real test LINE OA with a Messaging API token, LINE Login channel and LIFF app, rich menu uploaded | Hunter / DevOps | Open item (paid plan needed to test volume) |
| 5 | Privacy consent, receipt and payment text final | Writers / Product | Hand-off, Text and language files |
| 6 | Automated suite green on staging build: unit, integration, concurrency, RLS, E2E | QA | this strategy |
| 7 | Test accounts: at least 2 players (1 Adult, 1 Student by DOB), 1 front desk, 1 owner, 1 accountant, 1 coach, 1 platform admin, 1 onboarding specialist | Hunter / QA | roles table |
| 8 | Questions in `open-questions.md` marked A or B answered | Product owner | open-questions |
| 9 | Test data is flagged on the server at creation, uses its own non legal receipt numbers, and the purge at Go live is rehearsed on a copy (D4, PLAT-07-AC1 to AC4). Each club holds two Beam key sets, Testing uses the test set, and the swap to live keys is a P4 go live item with a smoke test (D32) | Architect | RCPT-01, PLAT-07 |

### 6.2 Test data volumes (QA suggestion, product owner may change)

The PRD gives capacity: two courts, 06:00 to 24:00 = 36 slots a day, 1,080 slots in the 30 day window; Hunter at full capacity is about 960 court hours a month. A realistic soft launch load is a fraction of that.

| Data | Suggested volume | Why |
|---|---|---|
| Mock players | 20 (14 Adult, 6 Student) | Enough for parallel taps and waitlists |
| Mock bookings during the window | At least 150, across all 30 days ahead, both courts, with at least 10 multi hour | Fills the grid, exercises the 2 second load rule |
| Solo classes | At least 20 with 3 coaches, including 3 sets of back to back hours to reach the 6 hour rest line | COACH-01 |
| Group sessions | 6 sessions: 2 full, 2 below minimum, 1 with waitlist, 1 Student only | CLASS-01, CLASS-02 |
| Packages | Each product bought at least once; 2 near expiry (set by fake clock) | PKG |
| Payments | 40 Beam sandbox payments or fake Beam payments, of which 5 late, 3 wrong amount, 3 duplicates | PAY |

### 6.3 Roles in the test

| Tester | Does |
|---|---|
| QA (scripted) | Runs the scripts in 6.4, files bugs with requirement IDs |
| Hunter front desk | Flow F: walk in, cash with reason code, move and cancel bookings, no show, daily close |
| Hunter owner | A16 settings, A9 prices, A10 promotions, A12 closures, A13 and A14 reports and receipts, A17 audit |
| Hunter coach | K1 to K6, leave request |
| Friendly players (10 to 20) | Free play: book, pay, cancel, buy a package, refer a friend, in Thai and in English, on their own phones inside LINE |
| BOOQ team | P1 to P4, support view, pause and unpause (on a copy, not Hunter) |

### 6.4 Scripted scenarios (run by QA, then repeated by Hunter staff)

Each line is a script; every script runs once in Thai and once in English, and once on iOS and once on Android inside LINE.

| Script | Steps in short | IDs | Pass when |
|---|---|---|---|
| S1 Simplest booking (Flow 0 / F1) | Rich menu Book a court opens C4; one open hour; checkout; Pay; Beam QR; pay; confirmed | BOOK-02, AUTH-01, PAY-02, LINE-04, RCPT-01 | LINE card arrives in chat in the player's language with the right details and a receipt number; receipt PDF downloads |
| S2 Bundle booking (Flow A) | Two hours with bundle credit; amount due 0 | PAY-07, PKG-01 | No QR shown; confirmed at once; ledger shows 2 used |
| S3 Add a coach at checkout | Pick coach on C10 | COACH-01..03 | Adult Coach tier pays ฿1,300; credits not applied; coach not offered when on leave |
| S4 Solo class from Classes | Coach, time with court, credit | COACH-04 | Court line is still due |
| S5 Hold and release | Player 1 taps Pay and walks away; player 2 tries the slot | BOOK-03, BOOK-04 | Player 2 sees held; after the hold time the slot opens and player 1 gets the release message |
| S6 Race | Two phones tap Pay on the same slot on a countdown | BOOK-04 | Exactly one QR |
| S7 Late payment | Pay after the hold ended, once with slot open, once with slot taken | PAY-03 | Approved, or wallet credit with a message |
| S8 Package alone | Buy bundle, let the QR time out | PAY-04 | Order cancelled; nothing charged; no credits |
| S9 Cancel | Cancel with more than 12 hours, then under 12 hours | CANCEL-01, CANCEL-02 | The sheet says the outcome first; value to wallet or package; no cash anywhere |
| S10 Group class and waitlist | Fill a class; join waitlist; cancel one seat | CLASS-01, CLASS-02 | First in line gets the LINE offer with a countdown; claim works; no offer within 2 hours of start |
| S11 Closure | Owner closes a booked slot | CANCEL-03 | Booking cancelled, credit back, LINE message |
| S12 No show | Front desk marks no show with a reason, then reverses | CANCEL-04 | Forfeit and reversal appear in the ledger and the audit log |
| S13 Coach leave and substitute | Flow G | COACH, LINE-05 | Customers get the coach changed message and may cancel for full credit |
| S14 Promo and referral | PARTNER100 style code, birthday discount, referral with a second account | PROMO-01, PROMO-02 | One code per order; self referral blocked; reward lands only after the friend's booking is played |
| S15 Receipts and daily close | Day's payments, void one, close | RCPT-01..03 | Numbers unbroken; void reason recorded; close totals match the bank test |
| S16 Roles | Each role tries what it cannot do | roles table | Denied on the server, not only hidden in the UI |
| S17 Platform | P1 to P4 on a scratch club; pause; support view | PLAT-01..05 | Support view shows no player, booking or payment data |
| S18 Language | Switch language mid flow | TEXT-05, TEXT-06 | Starting language follows LINE; toggle in Profile works; no clipped text |
| S19 Messages | Count pushes for one booking | LINE-05, LINE-06 | About 3 to 4 pushes; counter in P1 matches |
| S20 Performance | Court grid on 4G in LINE | Performance | Under 2 seconds |
| S21 Removed features | Look for check in, vouchers, message editor | CLAUDE.md | None present |
| S22 Data rights | Ask for a copy of my data; ask for deletion | PDPA-01 | Both work and are logged (PDPA-01-AC3/AC4; Q-24 for receipts and ledgers) |

### 6.5 Schedule (working back from 7 Dec; dates are proposals)

| Date | Milestone |
|---|---|
| By 6 Nov | Test strategy, traceability and question list approved; fakes skeleton agreed with Architect |
| By 20 Nov | Fakes implemented against the real adapter interfaces; static checks in CI; RLS and concurrency suites written (red) |
| By 27 Nov | Waves 1 and 2 green on staging; QA regression pack runs nightly |
| 30 Nov to 4 Dec | Dress rehearsal by QA on staging with the scripts in 6.4; bugs triaged |
| **7 Dec** | Hunter test window opens, QA on call, daily bug triage |
| Mid window | Waves 3 and 4 land; re run S9 to S15 |
| By 22 Dec | Retest all fixed bugs; test data purge rehearsed (PLAT-07); final privacy, receipt and payment text check |
| 29 Dec | Public booking opens, go live smoke checklist |

### 6.6 Exit criteria for go live

1. No open bug of severity 1 or 2 (below).
2. Every requirement ID that applies to Hunter's launch has a green test in `traceability.md`, or a recorded decision by the product owner that it ships without one.
3. All "before go live" questions in `open-questions.md` answered.
4. Beam test with the real sandbox or merchant account passed for S1, S7, S8 and the bad signature check; real LINE device checks passed.
5. The purge ran (PLAT-07-AC3/AC4) and Hunter's real receipt sequence starts at 000001 (D4). Live Beam keys in use and the swap smoke test passed (D32).
6. A backup restore drill has been done once (PDPA-01 daily backups; DevOps runs it, QA witnesses).

### 6.7 Bugs

Filed as GitHub issues (not by QA editing product code). Title starts with the requirement ID: `BOOK-04: two Pay taps on the same slot both got a QR`. Labels: `bug`, `req:<ID>`, `sev:1..4`, `feature:F##`. Body: build, role, club, language, steps, expected (cite the acceptance check), actual, evidence (screenshot, request ids, ledger rows).

| Sev | Meaning | Examples |
|---|---|---|
| 1 | Money, privacy or double booking | Double booking, cross club read, bad signature accepted, value created or lost, cash refund path |
| 2 | A rule is broken but no money or privacy at risk | Wrong 12 hour line, reminder not sent, wrong receipt detail |
| 3 | Works but wrong or confusing | Wrong language for a message, label wrong |
| 4 | Cosmetic | Spacing, a wrapped button in a low traffic screen |

## 7. Testability requests to the Architect

These are not product rules; they are things the tests need so the rules can be proven. They belong in `design.md` for F01 and F03.

1. One clock module for the whole app and jobs, replaceable in tests.
2. Holds stored with an `expires_at`; a read treats an expired hold as released even if the job has not run. The job then cleans up and sends the message. Tests can then move the clock or the stored time.
3. A job runner with an explicit `runDueJobs()` entry point.
4. Typed conflict errors (court taken, coach taken, slot held, rest rule) so tests can assert the reason, not only the failure.
5. Payment confirmation is idempotent on the Beam event id and charge id (stored), so duplicate callbacks are a database property, not a hope.
6. Adapters for Beam and LINE behind interfaces with a base URL setting, so the fakes in `tests/fakes` plug in without code changes.
7. A way to run a request as a given club and role against the database in tests (the same mechanism production uses for RLS). See `rls-test-plan.md` section 2.
8. The rest rule and the future hours limit (BOOK-05) cannot be enforced by a plain uniqueness constraint. The design must say how they are enforced under concurrency (see `concurrency-tests.md`, section 5).
