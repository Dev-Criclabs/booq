# Lanes: which folders each role may edit

Written 30 Oct 2026 by the Reviewer. Use it to spot a pull request outside its lane in under a minute: list the changed files (`git diff --name-only origin/<base>...HEAD`), find the author's role, and compare.

**Sources.** `docs/DEVELOPMENT-PLAN.md` section 3 (roles, "Owns", "Must not"); the F01 and F02 task lists (`Role:` on every task: Arch, BE-P, FE-P, DevOps, QA, Content; F03 adds BE-B); `CLAUDE.md` ("Never edit the wording of an existing key", rule changes order); `docs/decisions.md`. Where the plan names a role but not a folder, the folder is taken from where that role's branch already works (`spec/f01-f02-requirements`, `architect/foundation`, `qa/test-strategy`, `devops/foundation`, `i18n/text-variables`) and is marked *observed*.

**Status of the folder map.** `docs/architecture/build-plan.md` section 3 proposed a finer folder ownership table. The user approved the build plan on 30 Oct 2026 (decision D81, on `main`): the ordered merge, `packages/contract`, registries as fragments, `locales/pending/`, and the wave and lane plan. The lanes in section 1 therefore include those approved extras; they are still marked *(from build plan)* because the development plan itself does not name them. Section 4 lists the places where the approved build plan goes beyond the development plan or `CLAUDE.md` and still needs a one-line update in those source documents.

## 1. Lane table

`E` = may edit. `own` = owns the folder (others send a small request or PR to the owner). `-` = must not edit. Anything not listed for a role is outside its lane.

| Folder or file | Orch. | Spec drafter | Architect | BE-B (booking) | BE-C (commerce) | BE-P (platform, LINE) | FE-P (player) | FE-A (admin, coach) | FE-D (platform console, design system) | Content / i18n | QA | DevOps | Security | Reviewer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `CLAUDE.md` | own | - | - | - | - | - | - | - | - | - | - | - | - | - |
| `specs/product/**` (PRD, hand-off) | own | - | - | - | - | - | - | - | - | - | - | - | - | - |
| `docs/decisions.md`, `docs/canvas-gaps.md`, `docs/DEVELOPMENT-PLAN.md`, `docs/core/**` | own | - | - | - | - | - | - | - | - | - | - | - | - | - |
| `specs/features/F##-*/requirements.md` | approves routing | own | - (comments only) | - | - | - | - | - | - | - | - | - | review notes in own folder | - |
| `specs/features/F##-*/design.md` | routes | - (flags gaps) | own | - | - | - | - | - | - | - | - | - | review notes in own folder | - |
| `specs/features/F##-*/tasks.md` | routes | - | own; a task's tick is edited only by the PR that does the task | tick own task | tick own task | tick own task | tick own task | tick own task | tick own task | tick own task | tick own task | tick own task | - | - |
| `docs/architecture/**` | - | - | own | - | - | - | - | - | - | - | - | - | - | - |
| `packages/db/**` (migrations, RLS, functions, registries, `withClubTx`) | - | - | own | E booking functions, own migration block *(build plan, D81)* | E commerce functions, own migration block *(build plan, D81)* | E for F01/F02 tasks that name BE-P (for example T09 reads/writes via the Architect's modules) | - | - | - | - | - | - | - | - |
| `packages/auth/**`, `apps/platform/**` (API side), `packages/line/**`, `apps/worker/**` | - | - | - | - | - | own | - | - | - | - | - | - | - | - |
| `packages/domain/booking/**`, F03/F07/F08/F09 rules, availability, holds, rest rule, waitlist, cancellation, closures | - | - | - | own | - | - | - | - | - | - | - | - | - | - |
| `packages/domain/pricing/**`, `packages/payments/**`, ledgers (credit, wallet), promo, referral, Beam integration | - | - | - | - | own | - | - | - | - | - | - | - | - | - |
| `packages/time/**`, `packages/domain/phone.ts` and other shared pure helpers named in an F01 or F02 task | - | - | own for `time`; BE-P for helpers its tasks name | - | - | E per task | - | - | - | - | - | - | - | - |
| `packages/contract/**` *(build plan, D81)* | - | - | - | E own routes | E own routes | E own routes | review | review | review | - | - | - | - | - |
| `apps/web/**` player route group, player screens (C1 to C17, S-, G-) | - | - | - | - | - | - | own | - | - | - | - | - | - | - |
| `apps/web/**` admin and coach route groups (A0 to A17, K1 to K6) | - | - | - | - | - | - | - | own | - | - | - | - | - | - |
| `apps/platform/**` screens (P1 to P6), `packages/ui/**` (Palette D tokens, shared components) | - | - | - | - | - | API routes only | - | consume only | own | - | - | - | - | - |
| `packages/i18n/**` (loader, `t()`, formatters) | - | - | - | - | - | - | consume | consume | consume | own | - | - | - | - |
| `locales/en.json`, `locales/th.json` (wording, numbering) | - | - | - | - | - | - | - | - | - | own | - | - | - | - |
| `locales/copy-index.csv`, `locales/*.md`, `locales/*.csv`, `tools/i18n/**` | - | - | - | - | - | - | - | - | - | own | - | - | - | - |
| New keys proposed by a feature (D51) | - | - | - | list in the task | list in the task | list in the task | list in the task | list in the task | list in the task | adds and numbers them | - | - | - | - |
| `tools/lint/**` (banned patterns), table-class and audit-trigger checks | - | - | own | - | - | - | - | - | - | - | - | wires into CI (F01-T36) | - | - |
| `tests/**` (acceptance, e2e, concurrency, rls, `tests/fakes`, `tests/support`), `docs/qa/**` | - | - | - | unit tests beside own code only | unit tests beside own code only | unit tests beside own code only | unit tests beside own code only | unit tests beside own code only | unit tests beside own code only | tests for `tools/i18n` | own | - | - | - |
| `packages/testing/**` (database harness, fixtures; not the fakes) | - | - | own | - | - | - | - | - | - | - | E fixtures | - | - | - |
| `.github/**`, `infra/**`, `docs/ops/**` | - | - | - | - | - | - | - | - | - | - | - | own | - | - |
| Security reports (threat model, RLS review, Beam callback review) | - | - | - | - | - | - | - | - | - | - | - | - | own (path not yet set; propose `docs/security/**`) | - |
| `docs/review/**` | - | - | - | - | - | - | - | - | - | - | - | - | - | own |
| `package.json`, `pnpm-*.yaml`, `tsconfig*.json`, `vitest.config.ts` (workspace root) | - | - | own (F01-T01) | - | - | - | - | - | - | - | - | E CI-related changes | - | - |

Rules that hold in every row:

1. **The Reviewer edits only `docs/review/**`.** The Reviewer never writes product code, never merges, never opens a pull request.
2. **No role edits another role's file to "help".** A change elsewhere is a request to the owner (a small PR the owner approves).
3. **`docs/decisions.md`, the PRD and the hand-off are edited only by the Orchestrator**, in the order PRD, then hand-off, then feature specs (`CLAUDE.md` rule 5). Designs cite decisions and never edit them.
4. **A spec drafter does not approve its own drafts or decide a TBD.** Approval is a person's (plan section 1).
5. **A role whose feature is not approved at gates 1 and 2 writes no code** (plan section 3).
6. **Content never changes the wording of an existing key through a product PR; wording changes come back only from the writers' files** (`CLAUDE.md`; hand-off "How refined copy comes back"). The `Content` lane owns the files, but still never rewrites wording on its own initiative.

## 2. Roles and what each must not do (from plan section 3)

| Role | Produces | Must not (plan) | Typical branch |
|---|---|---|---|
| Orchestrator | task assignments, integration, status to the user, lane disputes | write feature code except glue | `claude/...` |
| Spec drafter | `requirements.md` and `design.md` drafts with Given/When/Then, keeps IDs, flags gaps | approve its own drafts, decide TBDs | `spec/<feature>` |
| Architect / data | Booq core mapping, migrations, RLS by club ID, uniqueness rules for no double booking, job runner, API conventions | feature UI | `architect/<feature>` |
| Back end: booking (BE-B) | F03, F07 rules, F08, F09 | payment and pricing code | `be-b/<feature>` |
| Back end: commerce (BE-C) | F04, F05, F06, F14, F16 later | booking rules | `be-c/<feature>` |
| Back end: platform and LINE (BE-P) | F01, F02, F10, F15 API, audit, support view, pause | pricing | `be-p/<feature>` |
| Front end: player (FE-P) | LIFF app at 375 px, Thai and English | call anything outside the API contract | `fe-p/<feature>` |
| Front end: admin and coach (FE-A) | console 1280 px, coach portal 375 px | same | `fe-a/<feature>` |
| Front end: platform console and design system (FE-D) | P1 to P6, Palette D tokens, shared components | club-specific screens | `fe-d/<feature>` |
| Content / i18n | variable pass, lookup helper, hard-coded text lint, new keys flagged for writers | edit wording of an existing key | `i18n/<feature>` |
| QA | acceptance tests, Playwright, fake Beam, fake LINE, mock-booking plan | fix bugs (files them with the ID) | `qa/<feature>` |
| DevOps | CI, environments, secrets, backups, monitoring, Thai-region hosting | product code | `devops/<feature>` |
| Security / PDPA | threat model, RLS tests, Beam callback checks, consent, copy/delete flows, review reports | merge anything | `security/<feature>` |
| Reviewer | approve or block each PR against its IDs and board | write features | `reviewer/<topic>` |

Role names BE-B, BE-C, FE-A and FE-D are the shorthand the task lists and the draft build plan use for plan roles 3, 4, 7 and 8. The plan's role 5 "Back end: platform and LINE" is BE-P.

## 3. What the F01 and F02 task lists put in each lane

Each task names one `Role:`. A task is **in lane** when the files it creates belong to that role's row above. This table lists the tasks whose role needs a second look at the boundary.

| Task | Named role | Files it creates | Lane check |
|---|---|---|---|
| F01-T01 repo scaffold (done on `architect/foundation`) | Arch | `apps/*`, `packages/*`, `tools/lint`, root config | In lane for Arch (root config). Created apps and packages are empty placeholders. The scaffold predates D81; the Reviewer reviews it with the Wave 0 merges |
| F01-T02, T03, T04, T05, T06, T09, T10, T11, T12, T15, T16, T18, T20, T24, T26, T27, T27b | Arch | `packages/db/**`, `packages/testing/**` | In lane |
| F01-T07 tenant isolation suite | QA/Arch | a generic suite driven by the table registry | Splits two lanes. The suite lives under `tests/rls` (QA) and reads the registry from `packages/db` (Arch). A PR for it may touch both only if it adds no other change to the Arch file |
| F01-T08, T13, T14, T17, T19, T21, T22, T23, T25, T28, T30 to T35 | BE-P | `packages/auth`, `apps/platform` API, `packages/domain/...` helpers, `apps/worker` | In lane. T08 (settings registry) writes registries under `packages/db/registry/` per the build plan fragment rule: Architect owns the index, BE-P owns its own fragment |
| F01-T29 test exclusion helper, lint, CI harness | Arch/QA | `tools/lint`, CI harness | Arch owns the lint, QA owns the seeded-rows harness, DevOps owns CI wiring. Must be two small PRs or one PR with all three approvals |
| F01-T36 static checks wired | DevOps/Arch | `.github/**`, `tools/lint/**` | Arch for `tools/lint`; DevOps for `.github`. One PR may not mix them without both owners' approval |
| F01-T37, F02-T24, F02-T25 acceptance sweeps | QA | `tests/**`, `docs/qa/**` | In lane. Closing gaps by editing product code is not in lane (QA files bugs) |
| F02-T00 LIFF set up with a real LINE account | DevOps with the user | design note in `specs/features/F02-.../design.md` section 3.3 | The only place a non-Architect is asked to write in a `design.md`. Treat as a recorded result by the Architect, not a DevOps edit; Question to the Orchestrator |
| F02-T01, T02, T03, T04, T05 to T17 | BE-P | `packages/db` migrations 0101 to 0199, `packages/auth`, `packages/line` | Migrations 0101 and up are written by BE-P under the per-feature number block approved in D81, while the plan gives migrations to the Architect. approved by D81 (section 4, item 2) |
| F02-T13 `price_group_for` and the Student check | BE-P | `packages/domain/...` | Used by F04 and F06 (BE-C). Owner: BE-P; BE-C consumes it and does not copy it |
| F02-T18 to T23 | FE-P | `apps/web/**` player group, `packages/i18n` consumers | In lane. A new key goes through the Content flow, not into `locales/*.json` directly |
| F03 tasks (BE-B) | BE-B | `packages/domain/booking`, migrations 0201 to 0299 | In lane; migrations are the same Question as above |

## 4. Where the draft build plan goes beyond the development plan

Approved by D81, so they are lanes the Reviewer enforces. The development plan and `CLAUDE.md` have not been updated to match (raised as M-1 and M-2 in `docs/review/spec-consistency.md`). Where `CLAUDE.md` and the approved build plan disagree, the Reviewer follows `CLAUDE.md` for the rule and the build plan for the folder, and asks the Orchestrator to align the text.

| # | Proposed in `docs/architecture/build-plan.md` | Development plan or `CLAUDE.md` says | Effect on lanes |
|---|---|---|---|
| 1 | `packages/contract/**` new package; "BE roles write, FE-P reviews" | Plan role 6: front end "must not call anything outside the API contract"; no package named | A new shared folder with three writers and no single owner. Needs an owner and a rule for who approves a change |
| 2 | BE-B and BE-C write migrations in their own number blocks; the Architect owns the index | Plan role 2: the Architect owns migrations and row level security; roles 3 and 4 do not list migrations | Widens BE-B, BE-C and BE-P into `packages/db`. Reviewer will check that RLS, club ID and the table-class registry are still the Architect's pattern |
| 3 | Registries are one fragment file per feature in `packages/db/registry/` | Not addressed | Each role edits only its own fragment; the index and the registry builder stay with the Architect |
| 4 | New locale keys go to `locales/pending/<feature>.json`; Content merges them into `en.json` and `th.json` with numbers | `CLAUDE.md`: "add a new key in both files following the same prefix and numbering, and list it in the task" | Changes where a feature role writes. Until approved, a feature PR that adds a key to `locales/*.json` directly is a Question (it is what `CLAUDE.md` says), and a PR that writes `locales/pending/**` is a Question (it is the proposed way). Content tooling (lint, copy-index) must read the pending folder before this is safe |
| 5 | QA's `tests/` stays at the repository root; `packages/testing` holds only the database harness and fixtures | Plan role 10 (QA) owns "acceptance tests ... fake Beam and fake LINE" without a path | Consistent with the QA branch; confirmed here as the lane |
| 6 | Branch names such as `be-p/f01-platform`, `arch/f01-db` | Plan s.3: `<role>/<feature>` | The role prefix is not the same on every branch (`arch/` vs `architect/`). Pick one spelling so the lane can be read from the branch name |
| 7 | Role "Security / PDPA" has no folder | Plan role 12 produces "review reports, blocking findings" | Needs a path (propose `docs/security/**`) or Security reports only as PR comments |

## 5. Quick lane test for a PR

1. `git diff --name-only origin/<base>...HEAD` and group the files by top-level folder.
2. Find the author's role from the branch prefix, the task's `Role:` and the commit trailer.
3. Every file must be in a row marked `own` or `E` for that role. If one is not, it is a Block (or a Question where marked *proposed*).
4. Look separately for these always-blocked edits from any non-owner: `docs/decisions.md`; the PRD and hand-off; `CLAUDE.md`; wording values of existing keys in `locales/*.json`; `tests/fakes/**`; `.github/**`; any edit of a merged migration; `docs/review/**`.
5. A PR may touch two lanes only when its task says so (the table in section 3) and each owner approved. Otherwise ask for two PRs.
