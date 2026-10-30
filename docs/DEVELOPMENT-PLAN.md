# BOOQ development plan

How we run the build. It follows `CLAUDE.md` and the Developer Hand-off v1.2. It adds the one thing they
leave open: how several Claude Code sessions (sub-chats) work in parallel without stepping on each other.

Decisions are logged in `docs/decisions.md`. The Notion Booq Product Reference is superseded and is kept only as background (`docs/core/`).

Sources of truth, in order
1. `specs/product/prd-v1.2.md` : every rule and decision.
2. `specs/product/handoff-v1.2.md` : requirement IDs (BOOK-03, PAY-02 ...), architecture, data model, feature backlog F01 to F16.
3. The design canvas (hi-fi H-, G-, S-; Thai T-) : every screen. https://claude.ai/artifact/3Jo8snhzdEXEhVhrRqi3ea
4. `locales/en.json`, `locales/th.json` : all user-facing text.
5. `docs/canvas-gaps.md` : places where the canvas disagrees with the spec. The spec wins.

Dates: today 30 Oct 2026. End-to-end testing with mock bookings starts **7 Dec 2026**, public booking opens **29 Dec 2026**, soft launch 9 Jan 2027.
Privacy consent, receipt and payment text must be final before 7 Dec.

## 1. Spec-driven development, as this repo does it

For each feature `F##` in the backlog, files live in `specs/features/F##-name/`:

| Gate | File | Drafted by | Approved by | Rules |
|---|---|---|---|---|
| 1 Requirements | `requirements.md` | Claude from the PRD and hand-off | **A person** | Keep requirement IDs. Acceptance criteria in Given/When/Then |
| 2 Design | `design.md` | Claude | **A person** | Tables and migrations, API routes, state machine, permission checks, canvas boards used, how it meets PDPA, no-double-booking and TEXT rules |
| 3 Tasks | `tasks.md` | Claude | A person (quick) | Each task under a day, names its requirement IDs |
| 4 Build | code + tests | Claude, one task per run | Reviewer | Tests first from the acceptance criteria. Run tests and type checks. Tick the task. Commit message starts with the IDs, e.g. `BOOK-03 hold slot for payment window` |
| Change | PRD → hand-off → feature specs | | | Code never gets ahead of the spec |

Two stop signs from `CLAUDE.md` apply to every session: if code and spec disagree, **stop and ask**; never invent a price, amount or setting (TBD values are empty club settings).

Nothing in gates 1 to 3 is self-approved. A sub-chat finishes a draft, reports, and waits.

## 2. Feature backlog and build order (from the hand-off)

| # | Feature | IDs | Depends on | Wave |
|---|---|---|---|---|
| F01 | Platform foundation: clubs, locations, resources, roles, settings, audit | PLAT | Booq core | 1 |
| F02 | LINE Login, LIFF, first sign in | AUTH | F01 | 1 |
| F03 | Court booking, schedule, payment hold | BOOK | F01, F02 | 2 |
| F04 | Checkout, pricing, add-ons, promo codes | PAY, PROMO | F03 | 2 |
| F05 | Beam payments (Hunter launch) | PAY | F04 | 2 |
| F10 | LINE messages and rich menu | LINE | F03 | 2 |
| F06 | Packages, credit and wallet ledgers | PKG | F04 | 3 |
| F09 | Cancellation and closures | CANCEL | F06 | 3 |
| F13 | Receipts, reports, daily close | RCPT | F05 | 3 |
| F11 | Club admin A0 to A17 | ADMIN | F03 to F09 | 3, grows with each feature |
| F07 | Solo classes, coach picker, rest rule | COACH | F03, F06 | 4 |
| F08 | Group classes and waitlist | CLASS | F06 | 4 |
| F12 | Coach portal K1 to K6 | COACH | F07 | 4 |
| F14 | Referrals and birthday discount | PROMO | F06 | 5 |
| F15 | Platform console P1 to P6 | PLAT | F01 | 3 to 5 (needed for Testing and Go live) |
| F16 | Slip checking and backup mode | PAY | F04 | **Not for Hunter launch** |

Cross-cutting, specified inside every feature's design.md: PDPA, no double booking, TEXT-01 to TEXT-06, audit entries (PLAT-04).

Removed, never build: A3 Check-in and any check-in QR, A11 Gift vouchers, A15 Messages editor, an everyday slip review queue.

Schedule reality: that is 15 features in about five weeks to the 7 Dec test start. Wave 1 and 2 are the minimum for a mock end-to-end booking
(sign in, book, pay with Beam, LINE confirmation). Waves 3 and 4 must land inside the test window. F14 and most of F15 can follow, except what is
needed to put Hunter into Testing and Live (P2 to P4). The Orchestrator should re-cut the waves with the user after the first requirements are approved.

## 3. Roles (sub-chats)

Each role is a Claude Code session on its own branch (`<role>/<feature>`), started with `CLAUDE.md` plus the kickoff prompt in section 5.
Roles coordinate through the repo (specs, issues, PRs) and through the Orchestrator, not by editing each other's folders.

| # | Role | Owns (folders / features) | Produces | Must not |
|---|---|---|---|---|
| 0 | **Orchestrator** (this chat) | Backlog order, branch/merge, spec approvals routing, lane disputes | Task assignments, integration, status to the user | Write feature code except glue |
| 1 | **Spec drafter** | `specs/features/*/requirements.md` and `design.md` drafts, with the Architect | Drafts from the PRD and hand-off with Given/When/Then; keeps IDs; flags gaps | Approve its own drafts, decide TBDs |
| 2 | **Architect / data** | Booq core mapping (Store→Club, Branch→Location), migrations, row-level security by club ID, server jobs, API conventions | The shared `design.md` pieces: schema, RLS, uniqueness rules for no double booking, job runner | Feature UI |
| 3 | **Back end: booking** | F03, F07 (rules), F08, F09 | Availability, holds and expiry, atomic court+coach reservation, rest rule, waitlist, cancellation, closures | Payment and pricing code |
| 4 | **Back end: commerce** | F04, F05, F06, F14, F16 later | Pricing, add-ons, promo/referral, Beam integration with signed callbacks, credit and wallet ledgers | Booking rules |
| 5 | **Back end: platform and LINE** | F01, F02, F10, F15 API, audit, support view, pause | Auth, roles, club lifecycle, LIFF, Messaging API, rich menu, Flex cards, usage counts | Pricing |
| 6 | **Front end: player app** | F02 to F10 screens (C1 to C17, S-, G-) | LIFF app at 375 px, Thai and English | Call anything outside the API contract |
| 7 | **Front end: admin and coach** | F11, F12 (A0 to A17, K1 to K6) | Console at 1280 px, coach portal at 375 px | Same |
| 8 | **Front end: platform console and design system** | F15 UI (P1 to P6), Palette D tokens, shared components | Token package and components used by 6 and 7 | Club-specific screens |
| 9 | **Content / i18n** | `locales/*`, `copy-index.csv`, TEXT-01 to 06 checks | Variable pass (TEXT-03), lookup helper, lint that finds hard-coded text, new keys flagged for writers | Edit wording of an existing key |
| 10 | **QA** | Acceptance tests from every approved requirements.md, Playwright, fake Beam and fake LINE | Tests first, regression pack, mock-booking test plan for 7 Dec | Fix bugs (files them with the ID) |
| 11 | **DevOps** | CI, environments, secrets, backups (daily), monitoring, Thai-region hosting | Pipelines and runbooks | Product code |
| 12 | **Security / PDPA** | Threat model, RLS tests, Beam callback signature checks, consent, copy/delete flows | Review reports, blocking findings | Merge anything |
| 13 | **Reviewer** | Every PR vs requirement IDs and canvas board | Approve / block with reasons | Write features |

Parallelism: after the Architect's shared schema and API conventions exist, roles 3 to 5 and 6 to 8 work at the same time per wave.
QA and Content start on day one. A role whose feature is not yet approved at gates 1 and 2 does not write code.

## 4. Open items that are settings, not blockers

The hand-off says build these as empty club settings: add-on prices, Head Coach price, referral reward, friend discount, birthday discount,
max future court hours (BOOK-05, empty means no limit), class-below-minimum alert time, wallet balance expiry, coach pay numbers.

Settled 30 Oct 2026: PAY-03 (late Beam payment: approve if the slot is open, else wallet), the PDF receipt keeps the registered address,
the PRD's suggested stack is adopted, and the date of birth is never locked.

Still open (details in `docs/canvas-gaps.md`, section C): effect of a corrected date of birth on already-held student packages;
whether "owed to customers" includes wallets; behaviour at a club's LINE message cap (undecided, not blocking); rich menu labels; the A0 address toggle.
Not code questions but needed for F05: Hunter's Beam merchant account, sandbox credentials and fees; the club's paid LINE OA plan.

## 5. Kickoff prompts for sub-chats

Shared preamble, pasted first:
> You are working on BOOQ (Hunter Tennis Club is the first club). Read `CLAUDE.md`, then `specs/product/prd-v1.2.md`, `specs/product/handoff-v1.2.md` and `docs/DEVELOPMENT-PLAN.md`. Follow the Spec-Driven loop: requirements, then design, then tasks, then one task per run. Draft and stop at each gate; a person approves requirements and design. Work on branch `<role>/<feature>`, edit only the folders your role owns, name requirement IDs in commits, never invent a rule, price or setting, never write user-facing text in code (use `locales/*.json` keys). If code and spec disagree, stop and ask. Do not open a pull request unless asked.

Role blocks (each is appended to the preamble):
- **Spec drafter:** "Role: spec drafter. Draft `specs/features/F01-platform-foundation/requirements.md` from PLAT-01 to PLAT-06 and PDPA-01, with Given/When/Then for each. Then F02. Keep IDs, cite PRD sections, list gaps as questions. Wait for approval before design.md."
- **Architect / data:** "Role: architect. Draft the shared design for F01: Booq core mapping (Store→Club, Branch→Location), the data model in the hand-off, row-level security by club ID, the uniqueness rule that reserves court and coach in one transaction including holds, UTC-free Asia/Bangkok handling, money as integer satang, ledgers for credit and wallet, the job runner for holds, reminders, expiries."
- **Back end roles:** "Role: back end `<booking|commerce|platform-line>`. Own the features listed for your role in `docs/DEVELOPMENT-PLAN.md` section 3. Start only when requirements.md and design.md for the feature are approved. Tests first from the acceptance criteria."
- **Front end roles:** "Role: front end `<player|admin-coach|platform+design-system>`. Build from the hi-fi boards named in design.md and the mock/real API. Palette D, DM Sans with Noto Sans Thai, 375 px or 1280 px, WCAG AA, 44 px targets, states never by colour alone. All text from `locales/*`; buttons never wrap; content scrolls."
- **Content / i18n:** "Role: content and i18n. Do the TEXT-03 pass: replace sample values (names, dates, times, prices, counts) with named variables in both `locales/en.json` and `locales/th.json` using the same key and same variable names, without editing wording. Produce `locales/copy-index.csv` (key, screens, canvas boards; the file is not in the repo yet and needs the writers' spreadsheets or a canvas scan). Add a lint that fails on hard-coded user-facing text. Report new keys needed."
- **QA:** "Role: QA. Turn each approved requirement's acceptance criteria into tests before the code exists. Build a fake Beam (valid, bad signature, wrong amount, late) and a fake LINE. Plan the 7 Dec mock-booking test. File bugs with the requirement ID."
- **DevOps:** "Role: DevOps. CI with lint, types, tests and the hard-coded-text check; preview environments; secrets handling for LINE and Beam keys; daily backups; monitoring for jobs and LINE token failures."
- **Security / PDPA:** "Role: security. Review each feature's design.md before approval: tenancy isolation, server-side permission checks, BOOQ staff blocked from player/booking/payment data, Beam callback verification, consent and data copy/delete, slips and staff notes staff-only."
- **Reviewer:** "Role: reviewer. Check each PR against its requirement IDs and canvas board. Block on: decided TBDs, wrong lane, missing tests, hard-coded text, missing audit entry, missing club ID scope."

## 6. Next actions

1. Orchestrator starts: Spec drafter (F01, F02), Architect/data, Content/i18n, DevOps, QA harness.
2. A person approves F01 and F02 requirements, then design.
3. Waves 1 and 2 start building; Orchestrator re-cuts waves with the user against the 7 Dec date.
