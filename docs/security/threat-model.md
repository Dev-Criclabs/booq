# BOOQ threat model

Status: **DRAFT v1 by the Security and PDPA reviewer, 30 Oct 2026.** Nothing here is approved or decided. Branch `security/reviews`. This file only describes risks and proposes controls. It changes no rule; where the spec is silent it points to `open-questions.md` (Q numbers) and does not decide.

Companion files: `design-review-F01-F02-F03.md` (findings SR-nn), `launch-checklist.md` (checks for 7 Dec and 29 Dec), `open-questions.md` (Q-nn for the product owner).

## 0. Sources and method

Read for this review: `CLAUDE.md`, `specs/product/prd-v1.2.md`, `specs/product/handoff-v1.2.md`, `docs/decisions.md` (D1 to D80), `docs/DEVELOPMENT-PLAN.md`, `docs/canvas-gaps.md`; from other branches `spec/f01-f02-requirements` (F01 to F05, F11, F12 requirements), `architect/foundation` (`docs/architecture/foundation.md` revision 8, F01, F02, F03 design and tasks, F05 design, the scaffold and `tools/lint`), `qa/test-strategy` (`docs/qa/*`, `tests/fakes`), `devops/foundation` (`docs/ops/*`, `.github/workflows/ci.yml`, `infra/env/.env.example`).

Method: list the assets, the actors and the trust boundaries; for each area in the brief list what an attacker would try (STRIDE as a prompt, not a form); record the control the approved designs already give; record the gap as a finding in the design review; rate what is left over.

Rating: **H** a hard rule in `CLAUDE.md` or the hand-off can be broken, or money or personal data of many people is exposed. **M** exposure limited to one club, one person, or needs an insider. **L** annoyance, or needs several other failures first. Ratings are for the design **as approved**, before the fixes in the design review, and "residual" is after those fixes.

Numbers written A-14, A-15, A-18, A-23 and similar, without a role prefix, are the assumptions in the F01 design section 12; actor ids look like A-EXT and A-PLAYER. "FA" is `docs/architecture/foundation.md`.

Nothing in here was tested against running code: no code exists beyond the scaffold. Claims about Beam, LINE and Supabase behaviour are taken from the architect's and QA's notes of the public documentation, and are marked "unverified" where those notes say the documentation is silent.

## 1. System in one page

```
                  Internet (untrusted)
  ┌────────────────────┬──────────────────────┬─────────────────────────┐
  │ Player / coach /   │ BOOQ staff           │ Beam, LINE servers      │
  │ staff in LINE (LIFF)│ browser              │ (webhooks, API replies) │
  │ or a browser       │                      │                         │
  └─────────┬──────────┴──────────┬───────────┴────────────┬────────────┘
   TB1      │ cookie session      │ email + 2nd factor     │ HMAC signature
  ┌─────────▼──────────┐ ┌────────▼─────────┐              │
  │ apps/web (Next.js) │ │ apps/platform    │              │
  │ player, coach,     │ │ P1 to P6         │              │
  │ club admin, /api,  │ │ DB role:         │              │
  │ webhooks           │ │ booq_platform    │              │
  │ DB role: booq_app  │ └────────┬─────────┘              │
  └─────────┬──────────┘          │                        │
            │         TB2         │                        │
  ┌─────────▼─────────────────────▼────────────────────────▼──┐
  │ Postgres (Supabase): RLS by club_id, exclusion constraints,│
  │ append-only ledgers and audit, class S / D / P tables      │
  └─────────▲─────────────────────────────────────────────────┘
            │  TB3
  ┌─────────┴──────────┐   outbound only: LINE Messaging/Login verify, Beam API,
  │ apps/worker        │   email sender, backup bucket, error tracker
  │ DB role: booq_worker│
  └────────────────────┘
```

Trust boundaries (TB):

| TB | Boundary | What crosses | What must hold |
|---|---|---|---|
| TB1 | Internet to `apps/web` | Browser requests with a session cookie; LIFF ID tokens; Beam and LINE webhooks; guest reads | Nothing from the client is trusted: not the club, the role, the customer id, the price, the amount. The club comes from the server session (FA §4.2). Webhooks are trusted only after the HMAC check (and, for Beam, the charge lookup) |
| TB1b | Internet to `apps/platform` | BOOQ staff sessions | Email plus second factor on every route (ROLE-02). No club-user session is ever accepted here and the reverse |
| TB2 | App to database | SQL over `booq_app`, `booq_worker`, `booq_platform` | RLS by `app.club_id()` set per transaction; D tables have no grant for `booq_platform` (default deny); composite foreign keys; `anon` and `authenticated` have no grants |
| TB3 | Worker to everything | Jobs run with the job's club context | A job for club A never touches club B |
| TB4 | Our servers to Beam and LINE | Outbound API calls with per-club secrets | Secrets are decrypted only in the code path that uses them and never logged; only the order reference is sent to Beam (D76) |
| TB5 | Production to backups and exports | Nightly dump, daily provider backup, owner CSV and ZIP exports | Same access rules as the live database; encrypted; short link lives |
| TB6 | People to the production console | Supabase, hosting, GitHub, LINE and Beam admin consoles | Named people, second factor, break-glass log (see TM-OPS) |

Environments: local and preview (fakes only), staging (LINE test OA and Beam sandbox, fake data), production (the 7 Dec test with Hunter in Testing status, D16, then real).

## 2. Assets

| # | Asset | Where | Why it matters | Class |
|---|---|---|---|---|
| AS-1 | Players' personal data: LINE user ID, display name, full name, phone, date of birth (minors included), language, level, consent record | `app_user`, `user_consent`, `auth_session`, audit values | PDPA. Phone and date of birth identify a person, a date of birth can identify a child | D |
| AS-2 | Staff notes, coach session notes, tags | `user_staff_note`, coach notes (F12) | Free text about a person; may hold health details (sensitive data under PDPA) by accident | D |
| AS-3 | Money state: orders, payments, Beam events, receipts, daily close | `orders`, `payment`, `payment_event`, `receipt` | Integrity of what the club is owed and what customers paid | D |
| AS-4 | Value owed to customers: credit and wallet ledgers | `credit_ledger`, `wallet_ledger` | A forged row is money. Append-only (D28) | D |
| AS-5 | Booking inventory: bookings and `occupancy` | `booking`, `occupancy` | Revenue; no double booking is a hard rule | D |
| AS-6 | Club secrets: Beam API and HMAC keys (test and live sets), webhook tokens, LINE channel token and secret, LINE Login secret | `club_secret` | Beam keys steer where money goes; the LINE token can message every friend of the club's account as the club (phishing) | S, write-only |
| AS-7 | Platform master key that wraps the club secrets | Hosting environment (proposed `CLUB_SECRETS_KEY`) | Opens AS-6 for every club | Platform |
| AS-8 | Audit entries and the P6 log | `audit_entry`, `platform.audit_log` | Evidence; the only way to detect an insider | D, P |
| AS-9 | Club setup: prices, products, hours, payment option, connections | S tables | A changed price or payment connection changes revenue | S |
| AS-10 | BOOQ staff accounts and second factors | `platform.platform_staff`, auth provider | The only people who can change setup of every club | P |
| AS-11 | Club exports, data copies, import staging rows | Private storage, `import_row` | A full copy of a club's players | D |
| AS-12 | Backups and nightly dumps | Provider backups, backup bucket | Everything above, at rest, with a different access path | All |
| AS-13 | Source code, CI, hosting and database admin accounts | GitHub, Vercel, Supabase | Whoever holds them can reach AS-1 to AS-7 | Platform |
| AS-14 | The club's LINE Official Account and Beam merchant account (owned by the club) | Outside BOOQ | Reputation and money; BOOQ staff hold admin access during setup | Club |

## 3. Actors

| Actor | Trust | Can legitimately | Threat view |
|---|---|---|---|
| A-GUEST | None | Browse courts, schedule states, classes, packages of a Live or Paused club | Scraping, DoS, probing for other clubs |
| A-PLAYER | Low | Book, pay, cancel, see own data | Hold abuse, IDOR on other players' rows, tampering with the price or customer id, fake or duplicate accounts, referral abuse (D11) |
| A-COACH | Low-medium | Own schedule, roster of own sessions, own earnings | Reading other coaches' pay, players outside own sessions |
| A-FRONT | Medium | Bookings, walk-ins, cash, customers (names, phone, date of birth), wallet and credit adjustments with a note | Insider fraud (adjustments, cash), data theft by export, reading revenue |
| A-ACCT | Medium | Read and export reports and receipts; names only (D35) | Reading phone or date of birth, writing anything |
| A-OWNER | High within the club | Everything in the club | Compromised owner account; a malicious owner towards players or BOOQ (stored XSS in club text); abuse of import to create value |
| A-BOOQ-ADMIN | High on setup, none on club data (D2, D27) | Create and set up clubs, pause, support view, start exports | Insider reaching club data or payment destinations; account takeover |
| A-BOOQ-SPEC | As above for assigned clubs | Same, no pause | Same, plus reaching an unassigned club |
| A-ENG | Operates the system | Deploy, migrate, restore, read production only through break-glass (plan §6) | The side door around D2: a database client sees everything |
| A-EXT | None | Anything on the internet | Credential stuffing on the console, forged webhooks, replay, injection, supply chain |
| A-THIRD | Partly trusted | LINE, Beam, Supabase, hosting, email, error tracker | A breach or a wrong assumption on their side |

## 4. Threats by area

Columns: **Existing control** is what the approved designs already give (with the section). **Gap** is the finding in the design review (SR-nn) or a carried-forward item (CF-nn). **Res.** is the residual rating if the findings are fixed.

### 4.1 TM-ISO: club isolation (`club_id` on every row, RLS)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| ISO-1 | A query without a club filter returns another club's rows | Bug, any user | Restrictive tenant policy on every club table, `FORCE ROW LEVEL SECURITY`, no context means zero rows (FA §4.2, §4.3). CI classification check, tenant isolation suite (F01-T05, T07) | none | L |
| ISO-2 | A child row points at another club's parent (booking to a foreign court) | Bug | Composite keys `(club_id, id)` and composite foreign keys (FA §2.1) | none | L |
| ISO-3 | The club is chosen by the client (URL, header, body) | A-PLAYER | Club only from the server session; slug picks the login channel; mismatch is 404 (FA §4.2, F02 §6.3) | Shared cookie name across clubs on one origin (SR-11) | L |
| ISO-4 | RLS trusts a session setting that anything running SQL as `booq_app` can change | SQL injection, a bypassing code path | No raw pool, `pg` import banned outside `packages/db`, query builder only, no DDL for the role (FA §4.3) | Cross-club worker sweeps need a privileged path that is not designed (SR-08); `read_secret(club, kind)` takes the club as an argument (SR-03); `reserve_court` takes the customer as an argument (SR-07) | M |
| ISO-5 | A `SECURITY DEFINER` function or a view runs with its owner's rights and skips RLS | Bug | Definer list reviewed, fixed search path, `security_barrier` views (FA §4.5, RLS-M05, M06) | `app_user_names`, `public_slot_state` and every definer function need the same checklist (SR-24) | L |
| ISO-6 | The Supabase Data API (PostgREST), GraphQL or Realtime exposes tables with default grants | A-EXT | `anon`, `authenticated` revoked (migration 0001); R3 says no auto REST | The designs do not say the Data API is switched off, and `.env.example` lists the anon and service-role keys (SR-06) | M |
| ISO-7 | A job for club A acts on club B | Bug | Each task opens `withClubTx` for its club (FA §5.2); QA RLS-A15 | The payload's `club_id` is trusted; enqueue rights of `booq_app` (SR-08) | L |
| ISO-8 | Files (receipts, exports, logos, slips) read across clubs by path | A-PLAYER | Private bucket, path starts with `club_id/`, signed URLs, RLS-M08, RLS-A16 | Link lifetimes (SR-20) | L |
| ISO-9 | Public views leak identity of who holds a slot | A-GUEST | Views drop booking id, customer, coach, order; snapshot test (F03 §3.2, §9) | none | L |
| ISO-10 | Shared LINE user across clubs links accounts | A-PLAYER | One LINE provider per club (D7); key `(club_id, line_user_id)`; QA RLS-A11 | none | L |

### 4.2 TM-BLIND: BOOQ staff blocked from player, booking and payment data (D2, D27)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| BLIND-1 | The platform role reads a D table | A-BOOQ-* | `booq_platform` has no grant on D tables; separate app with only that credential; blind suite (FA §4.4, F01-T18) | `apps/platform` needs the Supabase service-role key for staff invites, which is a credential that reads everything when the Data API is on (SR-06) | M |
| BLIND-2 | BOOQ staff become a club user with data access by redeeming an owner or staff invite with their own LINE account | A-BOOQ-* | "No log in as"; `app_user` needs a LINE verification | The owner invite link is shown to the BOOQ person who creates it, so they can use it (SR-01) | **H** |
| BLIND-3 | BOOQ staff give themselves a standing edit window on a Live club and then change prices, LINE or Beam connections | A-BOOQ-* | Window is 24 h, owner-set, expires by itself (PLAT-02) | The column has no upper bound and is writable by the platform role while Draft or Testing (SR-02) | **H** |
| BLIND-4 | Counts leak individuals (a day with one booking) | A-BOOQ-* | Aggregates only through `bump_usage` (D2) | Daily rows exist; expose only the 30-day total to the console (SR-30) | L |
| BLIND-5 | Logs, error tracker or monitoring carry personal data to BOOQ people | A-ENG, A-BOOQ-* | Log scrubbing, no bodies, counts only (plan §5) | PII-marker scan in E2E (QA RLS-P04) must include logs and Sentry; checklist item | L |
| BLIND-6 | Engineers read production data with a database client | A-ENG | Break-glass: ticket, reason, time limit, log (plan §6) | The log is outside the product and the club owner never learns of it (SR-21) | M |
| BLIND-7 | Export started by BOOQ is downloaded by BOOQ | A-BOOQ-* | Start-only; link to the owner only (D14) | none | L |
| BLIND-8 | A BOOQ tester (D4) uses the tester account to read more than own test data | A-BOOQ-* | Tester is an ordinary player account; sees own rows | none | L |
| BLIND-9 | Support view returns more than setup fields | Bug | Fixed projections; schema assertion (QA RLS-P03) | none | L |

### 4.3 TM-ROLE: role sets (D1) and in-club permissions

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| ROLE-1 | A permission checked only in the UI | A-FRONT, A-ACCT | `route({permission})` on every route, build fails without it; matrix in `packages/auth` (F01-T13); QA RLS-R07 route matrix | none | L |
| ROLE-2 | Union of roles grants more than intended (a coach who is also front desk sees coach pay) | Design | Union is the rule (D1, D58); tests per role pair | Add a test per role pair that matters: coach+front desk, accountant+player, owner+coach | L |
| ROLE-3 | Role change or deactivation not effective at once | A-FRONT, ex-staff | Roles read from `app_user_role` per request; sessions revoked (F02-T12) | none | L |
| ROLE-4 | Privilege escalation by assigning roles | A-FRONT | Owner only; last owner protected (F01-T14) | An invite carries `roles text[]`; kind-to-roles must be constrained (SR-01) | L |
| ROLE-5 | Accountant reads phone or date of birth | A-ACCT | No `select` on `app_user`; names through a view; CI test through every route (D35) | View checklist (SR-24) | L |
| ROLE-6 | Front desk sees revenue through totals | A-FRONT | Server-side only; no aggregate routes for that role (FA §4.3) | Security review item: list of every route front desk can call must be diffed against the revenue routes at each feature | M |
| ROLE-7 | Insider abuse of wallet and credit adjustments, cash, no-show reversal | A-FRONT, A-OWNER | Every movement needs a role, a reason and a note, append-only, audited | Nothing limits size or alerts the owner (CF-1, CF-2, Q-09) | M |
| ROLE-8 | An abusive player cannot be stopped | A-PLAYER | `active` flag exists | No route or role to suspend a player (SR-28, Q-10) | M |

### 4.4 TM-BAUTH: BOOQ staff sign in, email plus second factor (D3)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| BAUTH-1 | Password or magic-link phishing, credential stuffing | A-EXT | Second factor required before any session (ROLE-02-AC1); invite only | Authenticator-code phishing is possible; no lockout values; no step-up for dangerous actions (SR-16) | M |
| BAUTH-2 | Lost-factor reset used for takeover | A-EXT | Reset by another platform admin, logged in P6 (F01 A-10) | With one admin there is nobody to reset; define the out-of-band check and the fallback (Q-05) | M |
| BAUTH-3 | A club (LINE) session is accepted by the console or the reverse | A-EXT | Separate cookie name, signing key, deployment (F01 §6.1) | none | L |
| BAUTH-4 | Console reachable from anywhere | A-EXT | None | Put it on its own host name behind an extra gate (SR-16) | M |
| BAUTH-5 | Deactivated staff keep a session | Ex-staff | Deactivation ends sessions (ROLE-02-AC4) | none | L |
| BAUTH-6 | Specialist reaches an unassigned club | A-BOOQ-SPEC | 404 for anything unreachable (D27) | none | L |
| BAUTH-7 | Console actions are done with a stolen session | A-EXT | Session after second factor | Step-up (fresh code within 5 minutes) for pause, Go live, any write to payment or LINE connection or secret, start export, staff invite (SR-16) | M |
| BAUTH-8 | Mail account of a BOOQ person compromised, magic link used | A-EXT | None | Second factor must not be satisfiable by the same mailbox (SR-16) | M |

### 4.5 TM-TEST: test mode data (D4, D33)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| TEST-1 | Test rows count in reports, daily close, receipt lists or platform counts | Bug | `is_test` trigger, one `notTest()` helper, lint, CI seed test (FA §2.6, F01-T29) | none | L |
| TEST-2 | A test row takes a real receipt number, or the real series does not start at 000001 | Bug | Separate series, CHECK ties flag to series; purge tests | Runbook 13 sends a real payment after Go live, which uses number 000001 as a real sale and cannot be undone (SR-22) | M |
| TEST-3 | The purge deletes real data or leaves test data | Bug | Registry of test tables, purge only `is_test` for one club, rollback on failure, named backup first (F01-T27) | The fence for ledger and audit deletes is a session setting any session can set (SR-15) | M |
| TEST-4 | The purge is used to destroy evidence of a real fraud | A-BOOQ-*, A-ENG | Only while status is Testing; one non-test audit entry with counts | A club cannot move back to Testing, so the window is closed after Go live; keep it that way (F01 A-6) | L |
| TEST-5 | Test money flows: sandbox keys used for real or live keys used while testing | Config error | Active key set derived from club status, never typed (D32); a callback on the inactive set is ignored | Live keys should not be stored until the Go live window (launch checklist) | M |
| TEST-6 | Testers are real people with real LINE accounts on production | Design | D16 accepts this | Consent and privacy notice must be final before 7 Dec; testers briefed; whether tester accounts are purged is the architect's open FA Q29 | M |
| TEST-7 | Real players reach a Testing club | A-GUEST | Draft and Testing are 404 for non-testers (AUTH-01-AC15) | none | L |
| TEST-8 | A test clock override exists in production | A-PLAYER via injection | "Absent from production roles" (FA §5.5) | A setting is not a control; the override must not exist in the production function (SR-14) | M |
| TEST-9 | Test LINE messages reach real friends and use the cap | Design | D32 accepts this | Testers only; note in launch checklist | L |
| TEST-10 | BOOQ learns test content through P4 results | A-BOOQ-* | Pass or fail only (PLAT-07-AC6) | Keep `launch_check` free of free-text detail | L |

### 4.6 TM-LINE: LINE login and token handling

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| LINE-1 | A token for club A used at club B | A-PLAYER | Verify with the club's `client_id`, check `aud`, `iss`, `exp` (F02 §4.4) | none | L |
| LINE-2 | A forged or replayed ID token | A-EXT | LINE verify; token valid 1 hour; never stored or logged (AC13) | A stolen token can be replayed for up to an hour; keep tokens out of URLs, referrers and logs (SR-13) | L |
| LINE-3 | Login CSRF: the victim's browser is signed in as the attacker | A-EXT | `SameSite=Lax` cookie | No Origin check or JSON-only rule stated (SR-11) | L |
| LINE-4 | Open redirect through the return path or `liff.state` | A-EXT | "Redirect under the endpoint URL" | Allow-list not stated (SR-13) | M |
| LINE-5 | Cost or DoS: every `POST /auth/session` calls LINE | A-EXT | "Rate limited" with no value | Define limits; reject malformed tokens before the outbound call (SR-12) | M |
| LINE-6 | Invite token leaks through URL, referrer, logs, LINE link preview | A-EXT | Token hashed in DB | Strip from URL on load, no-referrer on that route, short life, atomic single use (SR-01, SR-13) | M |
| LINE-7 | Sessions outlive a role removal | Ex-staff | Server sessions, roles per request | none | L |
| LINE-8 | Webhook forgery (follow/unfollow) | A-EXT | `x-line-signature` HMAC on raw body (F02-T17) | Size cap and bad-signature rate limit (SR-12) | L |
| LINE-9 | Messaging token stolen and used to push phishing to every friend of the club's account | A-EXT, A-ENG | Encrypted at rest, write-only, never logged | Key custody (SR-03, SR-31); rotation runbook exists | M |
| LINE-10 | Pending sign-up row keeps a LINE ID and display name without consent | Design | 30 minute life, purge | Table has no column for the display name the text says it holds (SR-25); store nothing beyond the LINE ID | L |
| LINE-11 | `sub` is not the Messaging user ID (FA Q33) | Platform fact | F02-T00 test before build | Result must be recorded before F02 build | L |
| LINE-12 | Phone typed, unverified: takeover of an imported record or referral abuse | A-PLAYER | D11 flags duplicate phones | Imported balances are claimable by anyone who types the phone (SR-05) | **H** |

### 4.7 TM-BEAM: Beam callbacks (D24, D36, D71 to D73)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| BEAM-1 | Forged callback confirms a booking | A-EXT | HMAC-SHA256 over the raw body, constant time, key per club and key set; then the result of a **charge lookup**, not the body, decides (FA §6.5) | none | L |
| BEAM-2 | Replay of an old, genuine callback | A-EXT | No timestamp in Beam's signature; so dedupe on `(club, gateway, charge, event type)` plus the lookup decides (FA §6.5 steps 4 and 5) | none | L |
| BEAM-3 | Wrong amount confirms or is used to launder value | A-EXT, A-FRONT | Mismatch never confirms; flagged; 200 returned (D36); staff credit the wallet with reason `wrong_amount` (D77) | The credit must be tied to the recorded event and its amount, not typed by staff; once per event (CF-1) | M |
| BEAM-4 | Unknown charge | A-EXT | Success answer and flag (D71) | A callback that beats the second transaction (charge id not stored yet) is answered 200 and Beam stops retrying; match on `referenceId` after the lookup (CF-3) | L |
| BEAM-5 | Bad-signature flood (alert fatigue, DB writes, log volume) | A-EXT | 401, no change, alert (D24, D75) | Size cap before HMAC; rate limit; one alert per token per window (SR-12) | L |
| BEAM-6 | Webhook token in the URL leaks to logs | A-ENG | Token only selects the club; HMAC authenticates; token stored hashed | Mask the path token in logs | L |
| BEAM-7 | Test callback after Go live (inactive key set) changes something | Config | Recorded, flagged, 200, no change (FA §6.7) | none | L |
| BEAM-8 | Live keys belong to someone else's Beam merchant: money goes to the wrong account | A-BOOQ-*, A-ENG | Smoke test on the live key set (D32, A-23) | A read-only authenticated call succeeds for **any** valid merchant; it does not prove the merchant is the club's (SR-17) | **H** |
| BEAM-9 | Beam key swap during a Live club, redirecting payments | A-BOOQ-* | Audit in P6 and club log | Owner is not told (SR-02) | M |
| BEAM-10 | Amount unit mismatch (webhook says baht, we assume satang) | Platform fact | The lookup result is used and the unit is checked in the sandbox (FA §6.2) | Sandbox answer must be recorded before F05 build | L |
| BEAM-11 | Late payment double-applied or applied to a taken slot | Bug | Single `applyPayment`, lock order, reclaim through the same constraints, `dedupe_key` (FA §6.6) | none | L |
| BEAM-12 | Stored payer details in `payment_event` | Design | Only the order reference is sent (D76) | Beam's reply may carry payer data; store only needed fields (CF-4) | L |
| BEAM-13 | Beam API key can refund | A-ENG | No refund method in the interface; lint (FA §6.3) | Ask Beam for a key without refund rights (SR-26) | L |
| BEAM-14 | Missing callback leaves a paid booking unconfirmed | Platform fact | `beam_reconcile` every 5 minutes (D73) | none | L |
| BEAM-15 | Hold-then-pay griefing: many charges created | A-PLAYER | Pay-tap limit (D61) | See TM-HOLD | M |

### 4.8 TM-SEC: stored secrets (D27, D34)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| SEC-1 | A BOOQ person reads a secret from the console | A-BOOQ-* | Write-only, last 4 characters (D27) | none | L |
| SEC-2 | Database copy reveals secrets | Backup thief | App-level envelope encryption, master key outside the DB (D34) | Master key lives in hosting environment variables read by every app (SR-03, SR-31) | M |
| SEC-3 | The web role can decrypt every club's secret | Injection, bug | `app.read_secret` | Club passed as argument; "adapters' role" undefined (SR-03) | **H** |
| SEC-4 | Secrets in logs, errors, Sentry, test fixtures, CI output | Bug | Scrubbing rules (secrets.md rule 6); log-scan test | PII/secret marker scan in CI (checklist) | L |
| SEC-5 | Secrets in the repo | Developer | Push protection, `.gitignore` blocks `.env*` | Root `.gitignore` is still to be added by the Orchestrator (secrets.md rule 1): confirm done before first code that reads env | L |
| SEC-6 | Rotation breaks payments or messages | Operator | Rotation table, runbooks | Key kind `previous` HMAC is missing in the table the design lists (SR-26) | L |
| SEC-7 | Service-role or anon key present in app environments | Config | Lint bans `service_role` in code | `.env.example` lists both keys (SR-06) | M |
| SEC-8 | One key set used for the other environment | Config | Derived from status; per-environment projects | none | L |

### 4.9 TM-IMP: CSV import and club export (D13, D14)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| IMP-1 | Imported credit and wallet value is claimed by the wrong person | A-PLAYER | Match on phone at first sign in (D13) | Phone is unverified (SR-05) | **H** |
| IMP-2 | Malicious CSV: size, row count, encoding, injected formulas, club id column | A-OWNER | All or nothing, club id ignored, raw file not kept | No size or row limit values (SR-20) | M |
| IMP-3 | Import mints value after Go live (owner or a hijacked owner session) | A-OWNER | Owner only; audit entries for each balance | Allow the balance part of import only before Go live, or with a BOOQ admin approval (Q-13) | M |
| IMP-4 | Staging rows hold personal data too long | Design | `expires_at`, staging clean-up job | Purge failed and cancelled jobs within 24 hours; mind backups | L |
| IMP-5 | Export link is passed on or kept too long | A-OWNER, A-EXT | Short-lived signed link, owner only | 24 hours (A-14) is long for a whole-club file (SR-20) | M |
| IMP-6 | CSV formula injection: a player names themselves `=HYPERLINK(...)` and the owner opens the export in a spreadsheet | A-PLAYER | None | Neutralise cells starting `= + - @` tab or CR in every CSV export (SR-20) | M |
| IMP-7 | Export includes slips and staff notes | Design | Not included until decided (F01 A-15, F01 Q18) | Decide with Q-08 | L |
| IMP-8 | BOOQ starts an export and redirects the link | A-BOOQ-* | Only the owner receives a link | none | L |
| IMP-9 | Imported players who never sign in stay in the database | Design | Inactive until first sign in | Retention rule for unclaimed imports (Q-07) | L |

### 4.10 TM-AUD: audit log integrity (D28)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| AUD-1 | An app role edits or deletes an audit row or a ledger row | A-FRONT, A-OWNER, bug | Revoke, trigger, CI test, no insert for app roles (FA §2.3, §8.1) | none | L |
| AUD-2 | The table owner or a database administrator drops the trigger or edits rows | A-ENG | Migrations as `booq_owner` through CI | No tamper evidence outside the database (SR-21) | M |
| AUD-3 | A change happens with no entry | Bug | Triggers on every audited table, CI registry check, rollback if the entry fails | none | L |
| AUD-4 | Actor and reason forged through session settings | Injection | Same as ISO-4 | Same | L |
| AUD-5 | Personal data kept forever in audit values after deletion | Design | FA Q27 says redact | Cannot be done under the append-only guards (SR-04) | **H** |
| AUD-6 | Purge is used to delete audit rows of real activity | Bug | `is_test` fence | Forgeable setting (SR-15) | M |
| AUD-7 | The owner is not told of BOOQ changes | A-BOOQ-* | BOOQ writes appear in the club's audit log | Active notice for payment and LINE connection changes (SR-02) | M |
| AUD-8 | The log is not read | Operator | Owner-only A17 | Weekly digest of adjustments, role changes and platform writes to the owner (Q-09) | M |

### 4.11 TM-HOLD: slot-hold abuse (D61)

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| HOLD-1 | One player holds many hours by repeating Pay | A-PLAYER | Per-player Pay-tap limit as a platform setting, value by Security (D61); second tap returns the same hold (D47) | No value yet; limit off when unset (SR-09, §6 proposes values) | M |
| HOLD-2 | One selection holds a whole day, on every court, again each 15 minutes | A-PLAYER | `max_future_court_hours` (BOOK-05), empty by default; no separate limit per selection (D41) | With BOOK-05 empty a single player can block Hunter's evening for the whole window; cap concurrent unpaid hold hours (SR-09, Q-04) | **H** |
| HOLD-3 | Many accounts | A-EXT | Phone duplicates flagged (D11); LINE account needed | Add per-IP limit on first-sign-in, hold-to-pay conversion alert per account (SR-09, SR-12) | M |
| HOLD-4 | Staff-side abuse or a hijacked staff account | A-FRONT | Counts against the staff member; override needs a reason (D49) | Staff need their own, higher, limit (SR-09) | L |
| HOLD-5 | Hold on behalf of another player | A-PLAYER | Route chooses the customer | The function accepts a customer argument (SR-07) | M |
| HOLD-6 | Same idempotency key reused across users returns another user's hold or QR | A-PLAYER | Key table `(club_id, key)` | Bind to the user (SR-10) | M |
| HOLD-7 | Paused club bypass | A-PLAYER | Refused for everyone (D60) | none | L |
| HOLD-8 | Greedy booking of future hours with no payment ever | A-PLAYER | Holds expire at 10 to 20 minutes | Nothing stops paid-then-cancel patterns beyond the 12-hour rule | L |
| HOLD-9 | Player cannot be blocked | A-PLAYER | `active` flag | SR-28 | M |

### 4.12 TM-PDPA: personal data and PDPA

The club is the controller and BOOQ the processor (PDPA-01, hand-off). References to the law are my understanding and **must be confirmed by Thai counsel** (the user has already left a legal check open at D10).

| ID | Threat or duty | Existing control | Gap | Res. |
|---|---|---|---|---|
| PDPA-1 | Consent at first sign in, recorded | `user_consent` append-only, notice version, language, time (F01 A-4) | Store a hash of the exact consent text shown; list the purposes; marketing messages need a clear position (SR-27, Q-11) | M |
| PDPA-2 | Players under 18 (D10, open): valid consent, guardian role | Student price from date of birth; D10 skipped | Text cannot be final before 7 Dec. In Thai law the age of civil majority is 20 (my understanding), so the group needing guardian consent may include 18 and 19 year olds, who the app treats as Adults (Q-03) | **H** |
| PDPA-3 | Copy request | Request stored, audited, handled by front desk, file by LINE (PDPA-01-AC3) | Delivery mechanism, identity, notes, deadline (SR-18) | M |
| PDPA-4 | Delete request | `anonymise_user` keeps ledgers, receipts, bookings under a pseudonymous id (A-18) | Completeness across every table and JSON column (SR-19); audit values (SR-04); deadline | M |
| PDPA-5 | Retention | "Set when legal input is available" (F01 A-21, F01 Q13) | Nothing is ever deleted by time today; propose a schedule (Q-07) | M |
| PDPA-6 | Encryption | TLS, host disk encryption, app layer for secrets (D34) | Confirm backups and the nightly dump are encrypted with a key not stored with them (checklist) | L |
| PDPA-7 | Accountant view | Names only (D35) | SR-24 | L |
| PDPA-8 | Sensitive data by accident: injuries and health in staff notes or coach session notes | Notes are staff only | Warning text on note fields; do not ask for health data (Q-12) | M |
| PDPA-9 | Cookies and tracking | Only session and language cookies (A-15) | Keep it so; a banner is not needed while true | L |
| PDPA-10 | Breach duty: the controller tells the regulator within 72 hours where there is a risk; the processor tells the controller without delay | Runbook 9 | Named owner of the procedure, a contact for the club, a data-processing agreement between each club and BOOQ (Q-14) | M |
| PDPA-11 | Records of processing, processor contracts | DPAs listed in `accounts.md` | Club to BOOQ agreement and a records-of-processing sheet are not in any plan (Q-14, checklist) | M |
| PDPA-12 | Backups keep deleted players until they age out | Runbook 7 step 7 re-applies deletions after a restore | Privacy notice says so; deletion log kept (checklist) | L |
| PDPA-13 | Minors' photos and names in the coach portal (K5 roster "with photo") | F02 A-3: the LINE picture is not stored | The two statements disagree; decide when F12 is designed (CF-6) | L |
| PDPA-14 | A player in two clubs: a request at one club touches the other | Separate accounts (PRD) | none | L |

### 4.13 TM-WEB: web layer

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| WEB-1 | CSRF on cookie-authenticated routes | A-EXT | `SameSite=Lax`; mutating routes take `Idempotency-Key` | Not a CSRF control; add Origin and `Sec-Fetch-Site` check and JSON-only (SR-11) | M |
| WEB-2 | Stored XSS: club text (names, coach bio, class names, promo codes, notes, logo) shown in the player app, admin, platform console, LINE Flex or PDF | A-OWNER, A-PLAYER | React escaping by default (assumed) | No lint against raw HTML, no CSP, no rule for uploads or the receipt renderer (SR-29, CF-5) | M |
| WEB-3 | Missing security headers (CSP, HSTS, `frame-ancestors`, `Referrer-Policy`, `X-Content-Type-Options`) | A-EXT | None stated | SR-11 | M |
| WEB-4 | Same origin for all clubs | A-OWNER | Session cookie bound to a club; server refuses a mismatch | One malicious club page runs script in the origin that serves every club; CSP and no raw HTML make this a low risk (SR-29) | M |
| WEB-5 | Public schedule endpoints scraped or flooded | A-GUEST | `no-store` | Edge rate limit and a query budget (SR-12) | L |
| WEB-6 | SSRF from a renderer or image fetch | A-OWNER | None | Only fixed outbound hosts; receipt renderer must not fetch user-supplied URLs (CF-5) | L |
| WEB-7 | Uploads (logo, coach photo) with active content | A-OWNER | RLS-M08 path rule | Reject SVG or serve it sandboxed from another origin (SR-29) | L |
| WEB-8 | Dependency compromise | A-EXT | Lockfile, `--frozen-lockfile`, Dependabot | Pin third-party Actions by commit; keep `GITHUB_TOKEN` read-only (SR-23) | M |

### 4.14 TM-OPS: operations and insiders

| ID | Threat | Actor | Existing control | Gap | Res. |
|---|---|---|---|---|---|
| OPS-1 | CI passes while security gates are absent | Process | `CI_STRICT` variable | Off by default, so a missing RLS or static-check script is only a notice (SR-23) | M |
| OPS-2 | Backups readable by more people than the database | A-ENG | Encrypted dump, separate account, two named restorers | Bucket access list and age key custody to be listed (checklist) | M |
| OPS-3 | Runbooks contradict the design (Go live, key swap) | Process | Drafts | SR-22 | M |
| OPS-4 | Account takeover of GitHub, Vercel, Supabase | A-EXT | Second factor for everyone (plan §6) | Hardware key or passkey for the two or three people with production owner rights (checklist) | M |
| OPS-5 | Stale cron-style job routes | Design drift | `.env.example` has `JOBS_AUTH_TOKEN` while the design uses Graphile Worker with no job routes | Remove or specify (SR-23) | L |
| OPS-6 | Restore resurrects deleted players or test data | Operator | Deletion log, runbook 7 | Checklist drill | L |

## 5. Risk register

| ID | Risk | Rating | Mitigation or fallback | Owner |
|---|---|---|---|---|
| R-01 | **Hosting location (D5).** The production database is on Supabase in the nearest region, Singapore, with a data-processing agreement. The legal check of this is parked by the user. Fallback if it is ever refused: Postgres self-hosted in Thailand, which the architecture keeps bounded by using plain Postgres plus only three Supabase services (Auth for BOOQ staff, Storage, pooler) | Parked by the user | Keep the app free of Supabase-only features where a plain choice is as easy; a move is easier before real data exists | User |
| R-02 | BOOQ staff can become owner of a club by redeeming an invite (BLIND-2) | H until SR-01 | SR-01 | Architect |
| R-03 | Payment destination can be changed by BOOQ staff or pointed at the wrong merchant (BEAM-8, BEAM-9, BLIND-3) | H until SR-02, SR-17 | SR-02, SR-17 | Architect, DevOps |
| R-04 | Imported balances claimed by the wrong person (LINE-12, IMP-1) | H until SR-05 | SR-05 | Architect, product owner |
| R-05 | Under-18 consent text not final (PDPA-2, D10) | H for 29 Dec; M for 7 Dec if only adult testers | Q-03 | Product owner, counsel |
| R-06 | One player can block most of the club's inventory (HOLD-2) | H until SR-09 and Q-04 | Pay-tap values (§6), concurrent unpaid hold cap | Product owner, Architect |
| R-07 | Secrets exposure through key custody (SEC-2, SEC-3) | M | SR-03, SR-31 | Architect, DevOps |
| R-08 | Audit and erasure conflict (AUD-5) | H until SR-04 | SR-04 | Architect |
| R-09 | Insider fraud by front desk with wallet adjustments (ROLE-7) | M | Q-09, CF-1, CF-2 | Product owner |
| R-10 | Schedule: 15 features in five weeks; security tests and reviews are the first thing cut | M | The blocking findings are small design edits now and large rework later; the RLS suite, platform-blind suite and the Beam fake tests are required before 7 Dec | Orchestrator |
| R-11 | Beam and LINE behaviours that the documentation does not state (replay, amount unit, expiry after QR time, sub parity) | M | Sandbox and device checks before F05 and F02 builds (checklist Gate 1) | DevOps, QA |
| R-12 | Single points of key custody (master key, age key, platform admin) and a small team | M | Two named holders each; documented recovery | DevOps |
| R-13 | A club's own LINE Official Account or Beam merchant is administered by BOOQ people during setup | M | Remove BOOQ admin access after setup; list in checklist | DevOps, club |

## 6. Security-owned settings and proposed values

Decision D61 gives these to Security. They are platform configuration (`platform.config`), never code, and are proposals for the owner to approve. Re-tune after the 7 Dec test with real numbers.

| Key | Proposed value | Reasoning |
|---|---|---|
| `pay_tap_limit_count` | **5** new holds | Normal use is one to three taps (pick, pay, maybe change the time). A second tap on the same selection returns the same hold and does not count (D47), and a failed charge inside a hold is a new charge, not a new hold (D72) |
| `pay_tap_limit_window_seconds` | **600** | Ten minutes covers the longest hold (20 minutes) loosely and makes a patient re-hold loop slow |
| `pay_tap_limit_staff_count` (new key, design change SR-09) | **20** in the same window | Front desk may book several walk-ins in a rush; their limit counts against the staff member (F03 §4.8) |
| `max_unpaid_hold_hours` (new key, needs Q-04) | **4** unpaid held hours per player at one time | Bounds blocked inventory even when `max_future_court_hours` is empty. Two hours is a common session; four allows two courts or two sessions |
| `charges_per_hold_limit` (new key) | **3** | D72 allows a new charge after a failure; stops a loop of charge creation against Beam |
| `rate.auth_session_per_ip_per_min` | **10** | Sign-ins are rare. Reject bad tokens before the LINE verify call |
| `rate.auth_session_per_club_per_min` | **120** | Protects the outbound verify call; Hunter's real peak is far lower |
| `rate.public_read_per_ip_per_min` | **120** | Schedule reads while browsing; enforce at the edge |
| `rate.webhook_bad_signature_per_token_per_10min` | **20**, then drop without work | One P1 alert per token per window |
| `webhook_max_body_bytes` | **64 KiB** | Beam and LINE bodies are small; check before the HMAC |
| `boq_totp_max_failures` | **5**, then 15 minute lock | |
| `boq_session_idle_minutes`, `boq_session_absolute_hours` | **30**, **8** | Matches A-11 for support sessions |
| `boq_step_up_minutes` | **5** | Fresh second factor for dangerous actions (SR-16) |
| `club_staff_session_idle_minutes` | **60** (owner, front desk, accountant); players keep A-14 | Counter PCs are shared |
| `invite_ttl_hours` | owner **72**, staff and coach **168**, tester **336** | Short, single use |
| `allow_booq_changes_max_hours` | **24**, enforced in the database | PLAT-02 says 24 hours; this makes it a hard cap |
| `export_link_minutes` | **10**, created on click after the owner is re-checked | 24 hours (A-14) is long for a whole-club file |
| `export_file_retention_hours` | **24** | Delete the file after the link window |
| `data_copy_link_minutes` | **10** | Link opens only inside a signed-in session of the same player |
| `import_max_rows`, `import_max_bytes` | **5000**, **2 MiB** | Hunter's list is far smaller |
| `data_request_due_days` | **30** (counsel to confirm) | Deadline stored on the request, reminder to the owner at day 20 |
| `idempotency_key_retention_days` | **7** (as designed) | |
| `log_retention_days` | **30** (as DevOps proposes) | |

## 7. Assumptions and out of scope

Assumed: the approved designs are built as written; Beam and LINE behave as their public documentation says where it speaks; each club is a separate Beam merchant and LINE provider (D7); the platform has no user-facing way to read club data besides the setup-only support view.

Out of scope for this version, to be reviewed when the design exists: F04 pricing and promo codes, F05 design in detail (only the callback threats are listed above), F06 ledgers in detail (principles are in FA §2.3), F07 to F10, F12, F13 receipts and PDF renderer, F14 referrals, F15 console screens, F16 slip checking. Items for those reviews are listed as CF-nn at the end of the design review.

## 8. How this file is used

The design review cites these IDs. The launch checklist turns each H or M residual into a check with evidence. When a design changes, update the affected rows here in the same pull request.
