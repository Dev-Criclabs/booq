# BOOQ development plan

Source material: the BOOQ design canvas (customer app C, club admin A, coach portal K,
platform console P, LINE messages L, edge states S, receipts R, flow maps).
Everything below is derived from it. Where the design contradicts itself or leaves a
blank, it is listed in section 4 and must be settled before the related build starts.

## 1. What we are building

A multi-tenant booking platform for racquet clubs in Thailand (first club: Hunter Tennis Club).

| Surface | Users | Notes |
|---|---|---|
| Customer app (LIFF inside LINE) | Players | Court booking, solo classes, group classes, packages, wallet, referrals, waitlist, receipts. TH/EN |
| Club admin console | Owner, front desk | Calendar, walk-ins, customers, coaches, pricing, promotions, closures, reports, receipts, settings, staff audit log, setup checklist |
| Coach portal | Coaches | Today, schedule, availability, leave, session detail, earnings |
| Platform console | BOOQ team | Clubs list, new-club wizard, club detail, launch/test mode, templates, team audit log, read-only support view, pause club |
| LINE messaging | Everyone | Rich menu, confirmation, reminder, waitlist offer, cancellation, coach change |
| Back end | All of the above | Tenancy, availability and holds, payments, packages and credits, waitlist, receipts, audit |

Core rules already fixed in the design: unpaid slot is held 15 min; free cancel until 12 h before;
waitlist offer has a 30 min claim window and none within 2 h of start; coach never offered a 7th
teaching hour in a row; bundle hours work on either court, any time, and expire (reminders at 14 and 3 days);
group credit returns on cancellation 12 h or more ahead; money always goes straight to the club.

## 2. Spec-driven development: the steps

The rule: no code without a spec, no spec without acceptance criteria, and the spec is the only
thing the roles share. Specs live in `/specs`, versioned in git, changed only by pull request.

**Step 0. Repo and conventions (half a day)**
Monorepo layout, branch naming (`role/feature`), PR template, definition of done, `CLAUDE.md`
describing the above so every sub-chat starts from the same rules.

**Step 1. Ingest the design into a product spec**
Turn the canvas into text. One file per journey in `/specs/journeys/` (the ten flows A to K already
exist in the flow maps), one per screen group in `/specs/screens/` (C, A, K, P, L, S, R), and
`/specs/rules.md` for every business rule with its number. Export design tokens
(`project/ds/booq/tokens.json`) to `/specs/design-tokens.json`.

**Step 2. Open-questions register**
`/specs/open-questions.md`: every TBD with owner, options, deadline. Section 4 is the first draft.
Nothing in a blocked area is built until its question is closed.

**Step 3. Domain model and glossary**
`/specs/domain.md`: entities (Club, Court, Product, Booking, Hold, Package, Credit, WalletEntry,
Payment, Slip, Coach, Leave, Class, Waitlist, Referral, Receipt, AuditEvent), states and transitions
for each (booking, payment, club status Draft/Testing/Live/Paused), and who may change what.

**Step 4. Contracts**
Before any implementation: `/specs/api/openapi.yaml` (REST), `/specs/events.md` (domain events such as
`booking.confirmed`, `waitlist.offer_sent`, which LINE messaging and reports consume),
`/specs/db/schema.sql` or ORM schema, `/specs/integrations/` (LINE, Beam, bank slip check).
Front end builds against a mock server generated from the OpenAPI file, so nobody waits for the back end.

**Step 5. Acceptance criteria and test plan**
Each journey gets Given/When/Then scenarios in `/specs/acceptance/`. Edge cases come from the S screens
(day full, slip rejected, checking delayed, time ran out, offline, club paused). QA writes these
before the build, so they are the definition of done, not an afterthought.

**Step 6. Architecture decisions**
`/specs/adr/NNNN-*.md`, one per decision (stack, tenancy model, payments approach, i18n, hosting).
Short: context, decision, consequences.

**Step 7. Slice the work into vertical increments**
Order below. Each slice ships a working end-to-end path with tests, not a layer.

| Slice | Contents | Why this order |
|---|---|---|
| 0 | Foundation: repo, CI, DB, auth with LINE, tenancy, design-system package, mock server | Everyone depends on it |
| 1 | Flow 0: book one hour and pay, plus the admin calendar view of it | The design says this is the most common path and gets built first |
| 2 | Club onboarding: platform wizard P1 to P4, setup checklist A0, templates | Needed to create any club at all, including the real one |
| 3 | Flow F front desk (walk-in, cash/PromptPay with reason, daily close) and receipts | Staff can run a day |
| 4 | Flow D cancel, refunds and credits, LINE messages | Closes the loop on money |
| 5 | Packages: flows H and I, wallet, referral (flow E) | Revenue features |
| 6 | Coaches and classes: flows B, C, G, waitlist, coach portal K | Largest rule surface |
| 7 | Reports, coach payouts, promotions, audit log, support view, pause club | Operate and support |
| 8 | Hardening: load, security review, backups, launch rehearsal | Go live |

**Step 8. The build loop, per slice**
1. Spec Owner confirms the slice spec and acceptance criteria are final.
2. Architect confirms contracts cover it, or updates them first (spec PR).
3. Back end and front end build in parallel against the contract.
4. QA runs the acceptance scenarios; failures go back as issues referencing the spec line.
5. Reviewer checks the diff against the spec, not against taste.
6. Spec and code are merged together. If code needed a different behaviour, the spec PR comes first.

**Step 9. Keep spec and code in sync**
CI fails if the OpenAPI file and the generated client differ, if a migration has no schema change in
`/specs/db`, or if a PR touches `/specs` without a changelog line. Monthly: Spec Owner audits drift.

## 3. Roles (sub-chats)

Each role is its own Claude Code session on its own branch, started with a brief from
`/docs/roles/<role>.md` (to be generated from the table below). The Orchestrator is this chat.
Roles talk through the repo (specs, issues, PRs) and through messages from the Orchestrator, never by
editing each other's folders.

| # | Role | Owns | Reads | Produces | Does not |
|---|---|---|---|---|---|
| 0 | **Orchestrator / tech lead** (this chat) | Slice plan, merges, conflict resolution, role briefs | Everything | Task assignments, integration branch, status | Write feature code except glue |
| 1 | **Product spec owner** | `/specs/journeys`, `/specs/rules.md`, `/specs/open-questions.md`, acceptance criteria | Design canvas, flow maps | Specs with numbered rules and Given/When/Then; closes questions with the user | Decide stack or write code |
| 2 | **Architect** | `/specs/domain.md`, `/specs/api`, `/specs/events.md`, `/specs/db`, `/specs/adr` | Specs | Contracts, schema, ADRs, mock server | Implement features |
| 3 | **Back end: booking core** | Availability, holds and expiry, court and coach scheduling, rest rule, waitlist, cancellations, closures | Contracts | Services, migrations, unit and integration tests | Touch payment code |
| 4 | **Back end: payments and wallet** | Beam and PromptPay/slip check, packages, credits, wallet, refunds, promo codes, referral, receipts, VAT toggle | Contracts, payment provider docs | Same, plus reconciliation job | Touch booking rules |
| 5 | **Back end: platform and integrations** | Tenancy, club lifecycle, auth and roles, LINE (webhook, LIFF login, rich menu, push), audit log, support-view access, notifications | Contracts, LINE docs | Same | Touch pricing rules |
| 6 | **Front end: customer app** | LIFF app, C screens, S edge states, TH/EN, rich-menu deep links | Design canvas, tokens, mock server | Screens matching the design, component tests | Call the back end outside the contract |
| 7 | **Front end: admin and coach** | A and K screens, calendar, setup checklist | Same | Same | Same |
| 8 | **Front end: platform console and design system** | P screens, shared UI kit and token package used by 6 and 7, club brand presets | Same | Component library, Storybook, P screens | Build club-specific screens |
| 9 | **QA / test engineer** | `/specs/acceptance`, e2e suite (Playwright), test data, fake-slip and sandbox fixtures, regression pack | Specs, running builds | Test plans, e2e tests, bug reports tied to spec lines, release sign-off | Fix bugs (files them) |
| 10 | **DevOps / SRE** | CI/CD, environments, secrets, observability, backups, Thai data region, cost | ADRs | Pipelines, IaC, dashboards, runbooks | Product code |
| 11 | **Security and compliance** | Threat model, PDPA (personal data, consent, deletion), payment and slip handling, RBAC review, audit-log integrity, tax-receipt rules | Specs, code | Review reports, required fixes, checklists | Merge anything |
| 12 | **Code reviewer** | Every PR against its spec | Specs, diff | Review comments, approve/block | Write features |

Optional later: **Content and i18n** (Thai/English copy, LINE message wording), **Data and reports** (A13, payouts, exports), **Support/ops** (runbook for flow K).

How the work parallelises: after Step 4, roles 3, 4, 5 work against the contract and 6, 7, 8 against the mock
server at the same time. QA (9) writes scenarios from Step 5 onward, so tests exist before features land.
DevOps (10) is needed in slice 0, security (11) reviews contracts in Step 4 and each slice before merge.

Suggested first wave of sessions: 1 (spec), 2 (architect), 10 (devops), 8 (design system). The rest start
when Step 4 contracts exist, so they have something to build against.

## 4. Open questions found in the design

The authoritative register is `PRODUCT-SPEC.md` section 12 (Q-1 to Q-17, plus design defects D-1 to D-10).
The short list below was the first pass and is kept for context. See `HANDOFF.md` for state and kickoff prompts.

| # | Question | Where it shows up | Blocks |
|---|---|---|---|
| Q1 | **Payment model.** Settings says "Beam, each booking gets its own QR, no slips, no backup mode". Flows, C11 and A04 still describe PromptPay QR plus slip upload, slip verification and a backup slip-check screen. Which is real, or are both supported per club? | Settings vs flows, F1 vs F1b screens | Slice 1 |
| Q2 | Max future court hours per player `[X]` | Settings, Booking | Slice 1 |
| Q3 | Below-minimum class alert `[X]` hours before | Settings, Coaches and classes | Slice 6 |
| Q4 | Wallet balance expiry | Settings, Packages and wallet | Slice 5 |
| Q5 | VAT: tax invoices off until the club registers; receipt format and numbering | Settings, R receipts | Slice 3 |
| Q6 | Support view: look only or can act (setting says BOOQ can make changes for 24 h) | Platform flows | Slice 7 |
| Q7 | Self sign-up for clubs, BOOQ's own pricing, multiple branches, web address | Platform flows "Open questions" | Slice 2 |
| Q8 | Variants: the canvas has several visual variants (V-, T-, H- sets, palettes). Which is final? | V-Palettes, H- vs T- vs plain sets | Slice 0 design system |
| Q9 | Tech stack and hosting (design does not say) | n/a | Slice 0 |

## 5. Recommended defaults, to be confirmed

Not decided by the design, so these are proposals for the Architect to turn into ADRs:

- TypeScript monorepo, Next.js for the three web consoles and the LIFF app, a Node API (NestJS or Fastify), PostgreSQL, Redis for holds and queues.
- Tenancy by `club_id` on every row with row-level security.
- Time handling: store UTC, render Asia/Bangkok, club-level timezone field for later.
- Money as integer satang, never floats.
- OpenAPI first, generated clients, mock server from the spec.
- Hosting in a region close to Thailand with daily backups and PDPA-aware retention.
