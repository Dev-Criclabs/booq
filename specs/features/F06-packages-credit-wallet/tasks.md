# F06 Packages, credit and wallet ledgers · Tasks

Status: **DRAFT for a quick check (gate 3).** Drafted 30 Oct 2026 from the F06 design (`design.md`, drafted 30 Oct 2026, with the payment ports of section 4.9 and the claim transfer of section 4.8; the Architect reviews it) and the approved requirements (`requirements.md`). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `PKG-01 reserve credit in the booking transaction`. A merged migration is never edited. New text goes in `locales/pending/F06.json` (D81).

Roles: **BE-C** back end commerce, **FE-P** front end player app, **FE-A** front end admin, **QA**, **Arch**, **Content**.

Depends on: F01 T09 (setup tables), T12 (people), T13 (route wrapper), T18 (grants, policies, blind suite), T34 (worker); F03 `app.release_handlers` (F03 §4.5) and `confirm_booking`, `reclaim_order`; F04 migration 0301 (`package_product`), `order_line` with its allocation columns (0303) and `restore_order_entitlements` (0304); F05 `app.apply_payment` and `app.payment_ports` (F05-T05a to c, `docs/architecture/apply-payment.md`); `0103_claims.sql` (claims registry on `main`); F10 `app.enqueue_message` (reminders, T14). Migration numbers 0501 to 0513, one task per file, rising with task order (the design's 0504 is split into 0504, 0511, 0512 and 0513 so that each task owns one file; the design table is updated in the same change).

## A. Tables, ledgers, views

- [ ] **F06-T01** Migration 0501: `customer_package` (product snapshot, immutable `credits_total`, `purchase_date`, `expires_at`, unique `(club_id, order_id, product_id)`), `package_extension`, `wallet_account`; check that `package_product` has the F06 columns. IDs: PKG-02-AC1, AC4, CC-1. Role: BE-C · Deps F04 0301, F01-T12 · Size: M
  Tests first: `credits_total` cannot be updated; a second grant row for the same order and product is refused; every table has its class and club columns; another club's package is not reachable.
- [ ] **F06-T02** Migration 0502: `credit_ledger` and `wallet_ledger` as FA §2.3 (reasons, sign rules, `payment_id`, dedupe keys, staff note checks), append-only by revoke, trigger and FORCE RLS, deferred `balance >= 0` triggers. IDs: PKG-01-AC1 to AC3, AC5, AC7, D83. Role: BE-C · Deps T01 · Size: M
  Tests first: `UPDATE` and `DELETE` fail as every role including the owner; a staff row without a note is refused; an `adjust` below zero is refused; the reason set equals the D78 list (and `import_transfer` only after T08 and the PRD row).
- [ ] **F06-T03** Migration 0503: views `wallet_balance`, `package_balance`, `package_status` (derived, never stored). IDs: PKG-01-AC1, PKG-03-AC3. Role: BE-C · Deps T02 · Size: S
  Tests first: after random movements the view equals the ledger sum; an expired package shows `expired` from `app.now()`.

## B. Functions (one migration file per task)

- [ ] **F06-T04** Migration 0504: wallet functions `wallet_credit`, `wallet_spend` (anchor lock, attempt keyed `spend:{order_line}:{attempt}`), `wallet_return`, `wallet_adjust`. IDs: PKG-01-AC4, AC7, AC8, R2, D83. Role: BE-C · Deps T02, T03 · Size: M
  Tests first: two parallel spends of the last ฿100 give one success; `wallet_return` called twice returns once; a spend on an unclaimed or inactive customer is refused (`customer_not_claimed`); an adjust that would go negative is refused.
- [ ] **F06-T05** Migration 0505: release handler `app.f06_release(order, reason)` registered in `app.release_handlers`. IDs: R1-AC8, BOOK-03-AC5 (F03). Role: BE-C · Deps T04, T06a, F03 release handlers · Size: S
  Tests first: a released hold returns every reserved credit and wallet spend once; a second release changes nothing.
- [ ] **F06-T06a** Migration 0511: credit functions part one, `eligible_credits` (fit by type, tier and price group, nearest expiry first, Student credit for Student items after 18, D84) and `credit_reserve` (package row lock, attempt keyed `reserve:{order_line}:{attempt}`) and `credit_return` (D85: lost after expiry when the player cancels). IDs: PKG-01-AC8, R1-AC1, AC2, AC9, D84, D85. Role: BE-C · Deps T03 · Size: M
  Tests first: two parallel reserves of the last credit give one success; a released then reclaimed line reserves again with attempt 2; a return after the package expired is refused for a player cancel and allowed for a closure; a Student credit held by an 18 year old fits only Student items.
- [ ] **F06-T06b** Migration 0513: credit functions part two: `credit_use`, `credit_forfeit`, `credit_reverse_forfeit`, `credit_adjust`, `credit_expire`. IDs: R1-AC3 to AC5, PKG-03-AC3, AC4. Role: BE-C · Deps T06a · Size: M
  Tests first: `use` writes change 0 once per booking; a reversal of a forfeit writes a `return` row, never an edit; expire writes one row for the unreserved remainder and none for reserved credit (D85).
- [ ] **F06-T07** Migration 0512: `grant_package` with the expiry arithmetic (calendar months, last day clamp, 23:59 Bangkok), `extend_package` (owner, reason, one at a time), `extend_for_pause` (exact length then 23:59, package and wallet expiry), `wallet_expire` (only when set). IDs: PKG-02-AC2, AC3, PKG-03-AC5, AC7, AC10, D20, D88, D89, D90. Role: BE-C · Deps T06b · Size: M
  Tests first: the expiry table (31 Oct, 30 Nov, 29 Dec across the year, 31 Aug plus 6, 29 Feb 2028 plus 12, 5 Jan plus 3 giving 5 Apr) in Bangkok time; a pause under a day; a Student product refused for an adult; `wallet_expire` refuses to run with the setting empty; a second grant of one order grants once.
- [ ] **F06-T08** Migration 0509: the claim handler `wallet_transfer` (`app.f06_claim_transfer`) registered in `app.claim_handlers`, the reason `import_transfer` added to both CHECKs, the inert guard on spend, reserve and list. IDs: PLAT-06-AC3, AC7, D13, D105. Role: BE-C · Deps T07, `0103_claims.sql`, the PRD and hand-off rows for `import_transfer` · Size: M
  Tests first: an imported balance cannot be spent or listed while unclaimed; confirming a claim writes paired rows so the imported user ends at zero and the claimant gains exactly the amount; packages keep their expiry; a repeated confirm transfers once; the sum of `import` and `import_transfer` rows equals the amount imported.
- [ ] **F06-T09** Migration 0510: register `reserve_credit_and_wallet`, `grant_package` and `credit_wallet` in `app.payment_ports` (`app.port_*` wrappers per design §4.9) and add `wallet_ledger.payment_id`. IDs: PKG-01-AC12, R3-AC1, R3-AC7, R3-AC9. Role: BE-C · Deps T04, T06a, T07, F05-T05a · Size: M
  Tests first: a missing port raises `payment:port_missing:{port}` and leaves the payment pending; `reserve_credit_and_wallet` returns false and writes nothing when the wallet is short or a package expired, true twice writes once; `grant_package` raises on a non package order; `credit_wallet` twice with one key returns one id, one order and one row; an unlisted reason raises.
- [ ] **F06-T10** Migration 0506: sweep functions for `package_expire` and `wallet_expire`, the `session_start` credit handler hook, dedupe indexes. IDs: PKG-03-AC3, R1-AC3. Role: BE-C · Deps T06b, T07 · Size: S
  Tests first: a package at its expiry gets one `expire` row for the unreserved remainder; running the sweep twice writes once.
- [ ] **F06-T11** Migration 0507: policies and grants for the tables, views and functions; the Accountant column limits (names, no phone or date of birth); table class registry entries. IDs: PKG-01, CC-1, CC-3, D35. Role: BE-C · Deps T10, F01-T18 · Size: M
  Tests first: the blind suite shows BOOQ staff read nothing of F06's class D tables; a player reads only their own ledger; the Accountant view has no phone or date of birth; another club answers 404.
- [ ] **F06-T12** Migration 0508: settings registry rows `wallet_expiry_days` (may be unset), `package_expiry_reminder_days` (Tennis template 14 and 3). IDs: PKG-03-AC1, AC10, D116, D89. Role: BE-C · Deps F01 registry · Size: S
  Tests first: unset wallet expiry means nothing expires; the reminder list is read from the setting, never from code.

## C. Jobs and reminders

- [ ] **F06-T13** Worker tasks `package_expire` and `wallet_expire` (per club, `withClubTx`, idempotent, test clock). IDs: PKG-03-AC3, AC10. Role: BE-C · Deps T10, F01-T34 · Size: S
  Tests first: at 23:59:59 and 00:00:00 Bangkok on the expiry date the package is active then expired; the task run twice writes once.
- [ ] **F06-T14** Reminder enqueue at grant, extension and pause through `app.enqueue_message` with keys holding `expires_at` and N. IDs: PKG-03-AC1, AC2, AC6, D116. Role: BE-C · Deps T07, F10-T05 · Size: S
  Tests first: reminders at 14 and 3 days once each; an extension voids the old rows and creates new ones; a package with no credits left sends none.

## D. Routes

- [ ] **F06-T15** Player routes: `GET /packages` (public columns only, D103), `GET /me/credits`, `GET /me/ledger`. IDs: PKG-01-AC10, PKG-02-AC7, AC8, AC9. Role: BE-C · Deps T11, F01-T13 · Size: M
  Tests first: a guest reads only the named product columns; a product with no price is absent; the ledger lists every movement newest first with the reason key.
- [ ] **F06-T16** Staff routes: wallet and credit adjust, package extend, cash package sale, customer credits, value owed. IDs: PKG-01-AC4, PKG-03-AC5, R2-AC7, R3-AC5, D57, D88. Role: BE-C · Deps T11, F05 cash route · Size: M
  Tests first: adjust without a note is refused; front desk cannot extend; the Accountant reads value owed and cannot adjust; the value owed shows credit and wallet as separate lines.

## E. Front end

- [ ] **F06-T17** C9 Packages (three tabs) from the public route, with Thai and English and longest string layout. IDs: PKG-02-AC1, AC7 to AC9. Role: FE-P · Deps T15, `packages/ui` · Size: M
  Tests first: component tests with the longest Thai and English strings; a product with no price is not shown.
- [ ] **F06-T18** C14 Credits and wallet with the movement history and one reason label per ledger reason. IDs: PKG-01-AC10, PKG-03-AC3. Role: FE-P · Deps T15 · Size: M
  Tests first: every reason has a label in both languages; the balance shown equals the route's.
- [ ] **F06-T19** C10P, C11P and C12P package checkout, payment and confirmation screens (with F04 and F05 routes). IDs: R3-AC1 to AC4, PAY-04. Role: FE-P · Deps T15, F04 Pay route, F05 C11P · Size: M
  Tests first: the package confirmation shows credits, expiry and Book now; a time ran out state shows when the QR ends.
- [ ] **F06-T20** A6 customer profile: credits, wallet, adjust and extend actions with the written reason. IDs: PKG-01-AC4, PKG-03-AC5, ADMIN-07. Role: FE-A · Deps T16 · Size: M
  Tests first: the adjust form cannot submit without a reason; front desk does not see Extend.
- [ ] **F06-T21** Content: `locales/pending/F06.json` with the ledger reason labels, package states and the extension labels (new keys, listed for the writers). IDs: TEXT-01 to TEXT-04. Role: Content · Deps design section 12 · Size: S
  Tests first: the audit passes; same variables in both languages.

## F. Cross-checks and sweep

- [ ] **F06-T22** Property and concurrency suite: random movements keep balance equal to the ledger sum and never negative; two spends and two reserves of the last unit; 20 parallel grants of one order; reserve, release, reclaim cycles. IDs: PKG-01-AC1, AC7, AC8. Role: QA · Deps T04 to T09 · Size: M
  Tests first: this task is the tests; they must fail if the attempt number is removed from the keys.
- [ ] **F06-T23** Append-only and blind suite for F06: `UPDATE` and `DELETE` as every role on both ledgers and extensions; BOOQ staff read nothing; a withdraw or refund route does not exist. IDs: PKG-01-AC5, AC9, CANCEL-02. Role: QA · Deps T11, T16 · Size: S
  Tests first: the route inventory lists no route that refunds or withdraws.
- [ ] **F06-T24** Acceptance sweep: run the AC to test table, close gaps, record results against PKG-01 to PKG-03 and R1 to R3. IDs: all F06. Role: QA · Deps all · Size: M
  Done when: every AC has a passing test or a filed bug naming its ID.

## Order and size

T01 to T03 first, then T04 and T06a in parallel, then T06b, T07, T05, T08, T09, T10, T11, T12 (rising migration numbers), then T13 and T14, T15 and T16, then the screens, then F. About 24 tasks, each under a day. `import_transfer` (T02, T08) waits for the PRD and hand-off rows.
