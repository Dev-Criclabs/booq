# BOOQ hand-off

Read this first if you are a new session, a new teammate, or picking the work up after a break.
Last updated: 2026-10-30.

## 1. Where things stand

- **Done:** design canvas (wireframes, hi-fi in Palette D, Thai versions, states, LINE messages, receipts, flow maps, clickable flows F1 to F5b). Product spec drafted. Development plan drafted. Repo is empty of code.
- **Not started:** every line of code, the architecture decisions, the contracts, the test plan.
- **Blocked on the user:** payment model (Q-1), tech stack (Q-9), visual direction (Q-8). See `PRODUCT-SPEC.md` section 12.

## 2. Documents, in reading order

| File | What it is |
|---|---|
| `docs/PRODUCT-SPEC.md` | What to build. Numbered rules (`R-xxx`), screens by surface, open questions Q-1 to Q-17, design defects D-1 to D-10 |
| `docs/DEVELOPMENT-PLAN.md` | How to build it. Spec-driven steps, slices, sub-chat roles |
| `docs/HANDOFF.md` | This file. State, how to start, kickoff prompts, definition of done |
| Design canvas | https://claude.ai/artifact/3Jo8snhzdEXEhVhrRqi3ea , the visual source of truth. File names are the screen IDs. Prefixes: plain = wireframe, H- = hi-fi English, T- = Thai, S- = states, G- = review gaps, L- = LINE, R- = receipt, V- = palette variants, F1-F5 = clickable flow copies. Tokens in `project/ds/booq/tokens.json` |

If the canvas and the spec disagree, the spec wins for behaviour and the canvas wins for look, unless the item is listed in spec section 12, in which case ask.

## 3. Working agreements (apply to every session)

1. **Spec first.** No feature code without a rule ID and acceptance scenario. If a rule is missing, ask the spec owner; do not invent it.
2. **Never build around an [OPEN] item.** Stub behind an interface, note it in the PR, move on.
3. **Stay in your lane.** Edit only the folders your role owns (plan section 3). Need a change elsewhere: open an issue or ask the Orchestrator.
4. **Contract first.** API shapes live in `/specs/api/openapi.yaml`. Change the contract in its own PR before the code that depends on it.
5. **Branches and PRs.** `role/feature` branches, small PRs, each citing rule IDs. Squash merge. No direct pushes to `main`.
6. **Money.** Integer satang. Never floats. Every balance change has a reason and an audit event.
7. **Tenancy.** `club_id` on every row; tests prove cross-club access is impossible.
8. **Copy.** All player-visible text is Thai and English from a message catalog. Policy numbers (12 h, 15 min, 30 min, 6 h) come from club settings, not literals (Q-3).
9. **Report faithfully.** Say what failed, what you skipped, what you assumed. Do not mark a rule done without a test.

## 4. Definition of done

A change is done when:
- It cites the rule IDs it implements, and the spec was updated first if behaviour changed.
- Unit tests cover the rule; an acceptance scenario exists and passes.
- It matches the canvas screen in layout, copy, states (loading, empty, error, paused) and Thai.
- Accessibility basics pass (labels, contrast, tap size, status word not colour alone).
- An audit event is written for any staff or platform action that changes money, bookings, access or settings.
- CI is green, the reviewer approved, and no [OPEN] item was silently decided.

## 5. First 10 actions

| # | Action | Owner |
|---|---|---|
| 1 | Settle Q-1 (Beam or slip), Q-8 (palette vs design-system tokens), Q-9 (stack) with the user | Orchestrator |
| 2 | Create `/specs` skeleton, `CLAUDE.md`, PR template, `docs/roles/*.md` from section 6 | Orchestrator |
| 3 | Split the product spec into `/specs/journeys` and `/specs/rules.md`; write Given/When/Then for flows 0, D, F | Spec owner |
| 4 | Domain model: entities and state machines for booking, payment, hold, package, club status | Architect |
| 5 | OpenAPI draft for slice 1 (availability, hold, checkout, payment confirm, booking read) and mock server | Architect |
| 6 | Repo scaffolding, CI, preview environments, secrets plan, Thai-region hosting | DevOps |
| 7 | Token package and base components (button, chip, slot cell, card, nav) from the chosen palette; Storybook | Design system |
| 8 | Threat model for LINE login, payment webhooks, slips, tenancy, audit log | Security |
| 9 | E2E harness (Playwright) with a fake LINE and a fake payment provider | QA |
| 10 | Resolve design defects D-1 to D-8 with the user or designer | Spec owner |

## 6. Kickoff prompts for sub-chats

Paste the shared preamble, then the role block, into a fresh Claude Code session on this repo.

**Shared preamble**
> You are working on BOOQ, a multi-club booking platform for racquet clubs in Thailand. Read `docs/HANDOFF.md`, `docs/PRODUCT-SPEC.md` and `docs/DEVELOPMENT-PLAN.md` fully before doing anything. Follow the working agreements in HANDOFF section 3. Work on branch `<role>/<feature>`; edit only the folders your role owns; cite rule IDs in commits and PRs; never decide an [OPEN] question; report what you did, what you assumed, and what is blocked. Do not open a pull request unless asked.

**Spec owner**
> Role: product spec owner. Own `/specs/journeys`, `/specs/rules.md`, `/specs/open-questions.md`, `/specs/acceptance` (with QA). Task: split PRODUCT-SPEC.md into per-journey files with numbered rules and Given/When/Then scenarios, flows 0, D and F first. Re-read the canvas screens for any rule you cannot source. Keep the open-questions register current and bring decisions to the Orchestrator. Do not write code or choose the stack.

**Architect**
> Role: architect. Own `/specs/domain.md`, `/specs/api`, `/specs/events.md`, `/specs/db`, `/specs/adr`. Task: model entities and state machines, then write the OpenAPI contract for slice 1 and a runnable mock server. Record each decision as a short ADR. Design for multi-tenancy by `club_id` with row-level security, UTC storage with Asia/Bangkok display, integer satang, idempotent payment webhooks, atomic slot holds. Do not implement features.

**Back end: booking core**
> Role: back end, booking core. Own availability, holds and expiry, scheduling of courts and coaches, the 6-hour rest rule, waitlist, cancellations, closures. Build against `/specs/api` and `/specs/db`. Implement R-010 to R-024, R-040 to R-047, R-090. Test the race where two players take the same slot. Do not touch payment code.

**Back end: payments and wallet**
> Role: back end, payments and wallet. Own the payment provider integration, slip verification, packages, credits, wallet, promo codes, referral, receipts. Implement R-030 to R-038, R-050 to R-063, R-070 to R-083 for whichever payment model the user chose (Q-1). Build the ledger as append-only. Do not touch booking rules.

**Back end: platform and integrations**
> Role: back end, platform and integrations. Own tenancy, club lifecycle (Draft, Testing, Live, Paused), auth and roles, LINE (webhook, Login and LIFF, push, rich menu), audit log, support-view access, notification scheduling. Implement R-001 to R-006, R-091, R-120, section 8 of the spec. Do not touch pricing.

**Front end: customer app**
> Role: front end, customer app. Own the LIFF app (C screens, S states). Build from the canvas hi-fi screens and the mock server, Thai and English, using the shared design-system package. Implement section 4 of the spec. Match slot states, copy and empty/error/paused states. Do not call anything outside the OpenAPI contract.

**Front end: admin and coach**
> Role: front end, club admin and coach portal. Own A and K screens. Start with A01 calendar, A02, A02b, then A0. Implement sections 5 and 6 of the spec against the mock server and the shared design-system package. Respect role-based navigation (R-001 to R-004).

**Front end: platform console and design system**
> Role: front end, platform console and design system. Own the shared token and component package and the P screens. First deliverable: tokens and base components with Storybook, once the user decides Q-8. Then P1 to P4. Keep the package consumable by the other two front-end roles with a stable API.

**QA**
> Role: QA and test engineer. Own `/specs/acceptance`, the Playwright suite, test data, and fixtures for a fake LINE and fake payment provider (including fake slips: valid, wrong amount, wrong account, late). Write scenarios before features land, tie every failing test to a rule ID, and file bugs; do not fix them. Own the regression pack and release sign-off.

**DevOps**
> Role: DevOps and SRE. Own CI/CD, environments, secrets, observability, backups, hosting in a region close to Thailand. First deliverable: repo CI (lint, types, tests, OpenAPI drift check), preview environments, a secrets approach for LINE and payment keys. Write runbooks. Do not write product code.

**Security and compliance**
> Role: security and compliance reviewer. Review contracts and each slice before merge: tenancy isolation, role checks, LINE login and token handling, payment webhooks, slip upload handling, audit-log integrity, PDPA (consent, copy-of-data, deletion, retention), receipt legal content. Produce a threat model and a checklist; block merges for blocking findings. Do not write features.

**Code reviewer**
> Role: reviewer. For each PR, check the diff against the cited rule IDs and the canvas screen, not against taste. Flag anything that decides an [OPEN] item, edits outside the author's lane, lacks a test, or skips an audit event. Approve or block with specific reasons.

## 7. Starting the sessions

Order: Orchestrator (existing session) → spec owner, architect, DevOps, design system → after slice-1 contracts exist: three back-end roles and customer app, admin app → QA from day one in parallel with the spec owner.

The Orchestrator can create each session with a kickoff prompt from section 6 and message it later. Each session works on its own branch; the Orchestrator integrates.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Payment model undecided (Q-1) means rework of checkout, C11 states, A04 | Decide first; stub the payment interface until then |
| Policy numbers hard-coded in the design copy | Message catalog takes parameters from club settings |
| Design contradictions (D-1 to D-10) leak into code | Spec owner resolves before the related slice starts |
| Two sources of visual truth (Q-8) | One token package, decided once |
| LINE and payment sandboxes may need club credentials | DevOps and Orchestrator request test accounts early |
| Legal receipt content still placeholders (Q-5) | Treat as launch blocker for any real club |
| Many parallel sessions drift | Contract-first, lane ownership, Orchestrator merges |

## 9. Contacts and access to arrange

To be filled by the user: LINE developers provider and test OA, Beam sandbox merchant (if Q-1 chooses Beam), PromptPay and slip-check provider (if slip), club legal details for receipts, domain name, hosting account, designer contact for defects D-1 to D-10.
