# Security and PDPA design review: F01, F02, F03

Status: **DRAFT v1 by the Security and PDPA reviewer, 30 Oct 2026.** Branch `security/reviews`. This review reports; it merges nothing and changes no spec. Every fix below is a recommendation for the Architect and the person who approves the design. A fix that changes a rule goes through the PRD, then the hand-off, then the feature spec (CLAUDE.md rule 5).

Reviewed (read in full unless noted):

| Branch | Commit | Files |
|---|---|---|
| `architect/foundation` | `4d83b20` | `docs/architecture/foundation.md` (revision 8), F01, F02, F03 `design.md` and `tasks.md`; F05 `design.md` (callback sections only); `tools/lint/banned-patterns.mjs` |
| `spec/f01-f02-requirements` | `97a9d11` | F01, F02, F03, F05, F11 `requirements.md` (security-relevant parts) |
| `qa/test-strategy` | `41f0e76` | `docs/qa/rls-test-plan.md`, `open-questions.md`, `test-strategy.md` (security parts), `tests/fakes/README.md` |
| `devops/foundation` | `63b8739` | `docs/ops/plan.md`, `secrets.md`, `accounts.md`, `runbooks.md`, `.github/workflows/ci.yml`, `infra/env/.env.example` |

Measured against `threat-model.md` (TM-nn rows) and decisions D1 to D80. F03 `tasks.md` is marked "DRAFT for a quick check"; F01 and F02 tasks and the F03 design are approved, so a finding on an approved design is a proposed amendment.

## How to read a finding

- **Severity.** **Blocking**: if the related task is built as written, a hard rule of CLAUDE.md or a decision (club isolation, BOOQ staff blind, money destination, append-only, PDPA) can be broken, or the design contradicts itself so the task cannot be built without a rule choice. It **must be fixed in the design (and the tests named) before the named build task starts.** **Should fix**: a real weakness or gap that does not break a hard rule by itself, to fix before the feature ships or before the 7 Dec test. **Note**: hygiene, or a choice to record.
- **Where**: file and section, with the task that builds it.
- **Scenario**: how it fails, with a concrete actor.
- **Fix**: the smallest change that closes it.
- **Gate**: the build tasks the finding blocks (blocking), or the point by which it should be done.

## Summary

**31 findings: 7 blocking, 16 should fix, 8 notes.** Plus 10 items carried forward to later feature reviews (CF-01 to CF-10) and 21 questions in `open-questions.md`.

| ID | Sev | Title | Where | Gate |
|---|---|---|---|---|
| SR-01 | **Blocking** | BOOQ staff can become a club owner with an invite link | F01 §5.2, §7.1; F02 §6.10 | F01-T23, T28; F02-T10 |
| SR-02 | **Blocking** | Support window is unbounded and writable by BOOQ staff | F01 §3.2, §6.3; FA §4.4 | F01-T18, T19 |
| SR-03 | **Blocking** | `read_secret` takes a club argument; who decrypts is undefined | F01 §6.3; FA §4.4 | F01-T09 |
| SR-04 | **Blocking** | Append-only audit contradicts erasing personal data in it | F01 §7.7, §8; FA §8.1, FA Q27 | F01-T10, T33 |
| SR-05 | **Blocking** | Imported balances are claimable by anyone who types the phone | F01 §7.4; F02 §4.3; D13 | F01-T31; F02-T09 |
| SR-06 | **Blocking** | Platform app needs the service-role key; Data API surface | F01 §6.1; `.env.example`; lint | F01-T17 (and T03 test) |
| SR-07 | **Blocking** | Player-originated writes: invoker or definer, customer not bound | FA §3.3, §4.3; F03 §4.3, §8 | F03-T07, T08, T13 |
| SR-08 | Should fix | Cross-club job sweeps have no safe privileged path | FA §4.1, §5.4; F03 §6 | before F01-T34 |
| SR-09 | Should fix | Pay-tap limit has no value; unpaid hold hours are unbounded | F03 §4.8; D41, D61 | before F03-T12 |
| SR-10 | Should fix | Idempotency key is not bound to the user | FA §3.5; F03-T11 | before F03-T11 |
| SR-11 | Should fix | CSRF, security headers, one cookie name for all clubs | F01-T13; F02 §4.1 | before F02-T07 |
| SR-12 | Should fix | Rate limits and body caps have no values | F02 §5.2, T24; F03 §5.1 | before 7 Dec |
| SR-13 | Should fix | Return path and invite token handling | F02 §4.2, §6.10 | before F02-T10, T18 |
| SR-14 | Should fix | Test clock override can exist in production | FA §5.5; F01-T02 | before F01-T02 |
| SR-15 | Should fix | Purge fence is a session setting anyone can set | FA §2.6; F01-T27 | before F01-T27 |
| SR-16 | Should fix | BOOQ console: step-up, lockout, sessions, network gate | F01 §6.1; A-10 | before F01-T17 |
| SR-17 | Should fix | Go live key swap does not prove the merchant is the club's | F01 §9.3, A-23; D32 | before F01-T27b |
| SR-18 | Should fix | Data copy: delivery, notes, deadline | F01 §7.7; PDPA-01-AC3 | before F01-T33 |
| SR-19 | Should fix | No registry of personal data columns for anonymising | F01 §7.7 | before F01-T33 |
| SR-20 | Should fix | Import and export hardening | F01 §7.4, §7.5 | before F01-T30 to T32 |
| SR-21 | Should fix | Engineers' database access and audit tamper evidence | ops plan §6; FA §8.1 | before 7 Dec |
| SR-22 | Should fix | Ops documents contradict the design at Go live | runbooks 13; F01 A-23 | before 21 Dec |
| SR-23 | Should fix | CI gates can be skipped; Actions not pinned; stale env names | `ci.yml`; `.env.example` | before F01-T36 |
| SR-24 | Note | Definer functions and views need one checklist | FA §4.5, F01 §6.2 | F01-T05, T15 |
| SR-25 | Note | Pending sign-up keeps a display name the table lacks | F02 §4.3, §7.2 | F02-T02 |
| SR-26 | Note | HMAC "previous" key kind missing; ask Beam for a key without refund rights | FA §6.5; F01 §3.2 | F01-T09 |
| SR-27 | Note | Consent record content, marketing, sensitive free text | F01 A-4; F02 §10 | F02-T09 |
| SR-28 | Note | No way to suspend a player | F01 §5.1 | F11 |
| SR-29 | Note | Club-supplied text and uploads: XSS and active content | all surfaces | F11 |
| SR-30 | Note | Daily usage rows are finer than D2 needs | F01 §3.2 | F01-T16, T35 |
| SR-31 | Note | One master key in the hosting environment | secrets.md; FA §2.2 | before club 2 |

## What was checked and found sound

So the review is read as an audit and not only a list of faults. These designs do the following correctly and should not be weakened:

- Club ID on every row, composite keys and composite foreign keys, a restrictive tenant policy ANDed with permissive ones, `FORCE ROW LEVEL SECURITY`, zero rows when no context (FA §2.1, §4.3).
- The club is never read from the client; roles are read from `app_user_role` on each request; a request for a club or record out of reach is 404 (FA §4.2, D27).
- BOOQ blindness by absence of privilege (no grant on D tables), a separate app, a separate database role and "no log in as" (FA §4.4). The blind suite proves it (F01-T18).
- LINE ID token verified with the club's own channel as audience; tokens not stored or logged (F02 §4.4).
- Beam confirmation by a charge **lookup** after the signature check, so a replayed or forged callback cannot decide the outcome; raw-body HMAC, constant-time compare, event de-duplication, no refund method in the interface (FA §6.3, §6.5).
- No double booking by exclusion constraints, with expiry independent of the job (FA §3).
- Ledgers and audit append-only in three ways (grant, trigger, CI test); balances derived by sum (FA §2.3).
- Test data flagged by trigger, with a registry and a guarded purge (FA §2.6, apart from SR-15).
- Server-side session store that lets a role removal take effect on the next request (F02 §7.2).
- Public schedule views that drop all identity (F03 §3.2).
- Secrets write-only, last four characters only (D27).

---

## Blocking findings

### SR-01 · Blocking · BOOQ staff can become a club owner with an invite link

- **Where:** F01 design §5.2 (`POST /clubs/{id}/owner-invite` "creates the owner invite link (shown once)"), §7.1, `GET/PUT /clubs/{id}/testers` (BOOQ tester invites), §3.2 `club_invite` (`roles text[]`); F02 design §6.10 (redeeming an invite gives the invite's roles); tasks F01-T23, F01-T28, F02-T10. Threat rows BLIND-2, ROLE-4, LINE-6.
- **Scenario:** A platform admin or specialist creates the owner invite for a club in Testing or Live, keeps the link, and opens it with their own personal LINE account. Redemption creates an `app_user` with role `owner` (F02 §6.10). That person is now a normal club owner: A5 and A6 show every player's phone and date of birth, A14 shows receipts, A16 offers a full export, wallets can be adjusted. Every check passes: no BOOQ credential was used (ROLE-02-AC2 and AC3 hold) and RLS correctly allows an owner. The headline guarantee of D2, D27, PDPA-01-AC1 and CLAUDE.md ("BOOQ platform staff never see a club's players, bookings, payments...") is defeated by one link. The same happens if the link is forwarded, appears in a LINE group, or is fetched by a link preview. A tester invite whose `roles` array is not constrained could carry more than `player`.
- **Fix:**
  1. The system delivers the owner invite to `club.owner_email` (SMTP is already needed for BOOQ staff mail). The link is **never returned to the staff member**; the console shows only status (sent, opened, redeemed) and the redeemer.
  2. Redemption writes P6 and the club audit entry with the redeemer's LINE display name and the phone typed at C2. P3 shows both beside `owner_phone`. A phone that does not match `club.owner_phone` marks the club "owner not verified" and Go live is refused until a platform admin **other than the one who created the invite** confirms with the owner by another channel. Add this as a `launch_check` row.
  3. After an owner invite exists, a change to `club.owner_*` contact details needs a second platform admin and is logged.
  4. Invite properties: single use and atomic (`UPDATE club_invite SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING ...`), expiry from `invite_ttl_hours` (proposal 72 for owner), creator stored. A CHECK ties kind to roles: `owner` gives `{owner}`, `tester` gives `{player}` only, `staff` and `coach` are created by an owner only. The platform may create only `owner` and `tester` invites.
  5. BOOQ people who need to test use `tester` invites only (D4).
- **Tests to add:** the API never returns an invite token after creation; two parallel redemptions give one winner; a tester invite cannot produce any role but player; a platform account cannot create a staff or coach invite; Go live refused while the owner is unverified.
- **Gate:** blocks F01-T23 (owner invite creation), F01-T28 (tester invites), F02-T10 (redemption). Needs the product owner's choice on delivery and on who verifies the owner (Q-01).

### SR-02 · Blocking · The support window is unbounded and writable by BOOQ staff

- **Where:** F01 §3.2 (`club.allow_booq_changes_until`), §6.3 (the column is "not directly writable" for `booq_app` only; for `booq_platform` S tables allow insert and update while Draft or Testing), FA §4.4(4), §5.1 `PUT /support-window`; tasks F01-T18, F01-T19. Threat rows BLIND-3, BEAM-9, AUD-7.
- **Scenario:** `club` is an S table, so `booq_platform` may update it while the club is Draft or Testing. Nothing stops that update from setting `allow_booq_changes_until` to a far date. BOOQ then takes the club Live (a specialist may, D15). The policy `allow_booq_changes_until > now()` stays true, so BOOQ keeps edit rights on a Live club indefinitely: prices, hours, LINE connection, **payment connection and Beam keys**. If the Beam keys are replaced with another merchant's, every callback still verifies (it uses the stored HMAC key) and money flows elsewhere. The owner is not told; the change sits in an audit log nobody reads (AUD-8).
- **Fix:**
  1. `booq_platform` gets no UPDATE on `club.status`, `club.allow_booq_changes_until` or `club.allow_booq_changes_set_at` (column grants). Only `app.set_support_window(club, on)`, called from the owner's route, writes them, and sets `allow_booq_changes_until = now() + interval '24 hours'`.
  2. A CHECK: `allow_booq_changes_until <= allow_booq_changes_set_at + interval '24 hours'`. The policy reads both columns.
  3. `set_club_status` clears the window on Go live, on pause and on resume.
  4. Any platform write to `payment_connection`, `line_connection` or `club_secret` on a club that is Live or Paused creates an owner notice (admin banner and a LINE message through the outbox; new keys for the writers), as well as the audit entry. In Draft and Testing the notice is not needed.
- **Tests to add:** the platform role gets `permission denied` updating those columns; a window of 25 hours is refused by the database; Go live clears the window; a platform write on a Live club with the window on creates the owner notice.
- **Gate:** blocks F01-T18 (grants and policies) and F01-T19 (support view and window).

### SR-03 · Blocking · `read_secret` takes a club argument, and who decrypts is undefined

- **Where:** F01 §6.3 (`app.read_secret(club, kind)` "callable only by `booq_worker` and the payment/LINE adapters' role"), §3.2 `club_secret`, FA §4.4(6), `secrets.md` rules 3 to 5, `.env.example` (`CLUB_SECRETS_KEY`); task F01-T09. Threat rows SEC-2, SEC-3.
- **Scenario:** The Beam callback route, the Pay route and the LINE sender all live in `apps/web` or `apps/worker`, so those processes hold the master key and a database role that may call the definer function. The function accepts any `club` and any `kind`. A route bug, a SQL injection, or a stolen web credential reads every club's Beam keys and LINE tokens. "The adapters' role" is not one of the three roles in FA §4.1, so the design does not say which database role it is. The master key is a plain environment variable in every app, including the platform app.
- **Fix:**
  1. No club parameter. The function reads `app.club_id()` and fails when it is null. A `kind` allow-list per caller purpose (`beam_*` for the payment adapter, `line_*` for the sender).
  2. One module `packages/secrets` is the only code that imports the master key or calls the function; a lint enforces it.
  3. Split rights. `apps/platform` only ever **encrypts**: use an asymmetric envelope (public key in the platform app, private key in web and worker) or a KMS key whose Encrypt permission is the platform app's and whose Decrypt permission is web and worker's. A compromised platform app then cannot read a secret even if it could read the ciphertext.
  4. Every read increments a per-club counter (never the value) so a burst of reads is visible to monitoring.
  5. State which process runs the Beam callback route and createQr and under which role, in the F01 design.
- **Tests to add:** in club A's context, asking for club B's secret returns nothing; `booq_platform` cannot execute the function; the platform app's environment holds no decrypt key; a secret never appears in a log, response, error, Sentry event or CI output (marker scan).
- **Gate:** blocks F01-T09.

### SR-04 · Blocking · Append-only audit contradicts erasing personal data in it

- **Where:** F01 §7.7 (`anonymise_user` "redacts those fields in the user's `audit_entry` JSON"), FA §10.1 Q27 ("redact them in audit JSON"), FA §8.1 (append-only), F01 requirements PLAT-04-AC6 ("the server refuses and the database rejects it too") and PDPA-01-AC4; tasks F01-T10 (builds the guards) and F01-T33 (needs the redaction). Threat row AUD-5.
- **Scenario:** F01-T10 makes `UPDATE` and `DELETE` on `audit_entry` fail for every role, including the owner, with one exception, the Go live purge of `is_test` rows. `app.anonymise_user` must rewrite old and new values that hold names, phone numbers and dates of birth. There is no allowed path for it. The developer building T33 will weaken D28 (a second exception, written in a hurry), or leave the personal data in the log for ever (PDPA erasure not met, and the log is outside the player's reach), or the test fails and someone has to decide a rule. CLAUDE.md says to stop and ask when code and spec disagree; the spec disagrees with itself.
- **Fix:** keep `audit_entry` immutable and move personal values out of it. For audited personal columns (`full_name`, `phone`, `date_of_birth`, `line_user_id`, free-text notes) the entry stores the column name and a reference, and the values go to `audit_pii (entry_id, column_name, old_value, new_value)`. The only `DELETE` path on `audit_pii` is `app.anonymise_user`, a definer function that checks `current_user` (not a session setting, see SR-15) and writes one append-only `audit_erasure` row (pseudonymous user id, request id, time, number of values removed). The owner's date-of-birth history (D55) then shows "erased" for those entries. This also keeps personal data out of every backup of the audit table longer than needed. Alternative: store only a keyed hash of the old and new values; simpler, but the owner loses the readable date-of-birth history that D12 and D55 promise.
- **Tests to add:** after a deletion request, no marker value (QA's PII markers) remains in `audit_entry`, `audit_pii`, ledger notes or outbox params; `audit_entry` rows are unchanged; an `audit_erasure` row exists; no role can `DELETE` from `audit_pii` except through the function.
- **Gate:** blocks F01-T10 (the shape of the table must be settled before the guards are written) and F01-T33.

### SR-05 · Blocking · Imported balances are claimable by anyone who types the phone

- **Where:** F01 §7.4 step 4 and requirement PLAT-06-AC7 (imported players "match on phone at first sign in"), D11 (phone typed, not verified), D13; F02 §4.3 (C2 collects the phone). Note that no F02 task implements the match (T09 does not mention it). Tasks F01-T31, F02-T09. Threat rows LINE-12, IMP-1, R-04.
- **Scenario:** The club imports its existing customer list with credits and wallet balances (reason `import`, D13). A stranger signs in with any LINE account, types the phone number of a customer with a balance (a number is easy to learn) and is matched to the imported record: they see and can spend that person's credits and wallet, and read the stored name and date of birth if C2 pre-fills them. The real customer later signs in, is "new", and has lost their balance. Both cases are disputes the club cannot resolve from the data. Duplicate phones are flagged (D11) but nothing prevents the claim.
- **Fix (consistent with D11 and D13, which forbid a code check in v1):**
  1. The match is silent and attaches the profile only. C2 never shows "we found your record" and never pre-fills imported fields.
  2. Imported credit and wallet movements are `pending_claim` until the front desk or owner confirms the claim (the screen shows the imported name and the typed name and phone, and the staff member checks the person at the counter). The spend and reserve paths ignore pending balances. Unclaimed imports are listed to staff and expire by a retention rule (Q-07).
  3. Add the missing F02 task for the match, with these rules.
  4. Add a field to `import_row` and the ledger writer: `claim_status`. Staff confirmation writes an audit entry.
- **Tests to add:** a second person typing the same phone sees no balance and no imported field; after confirmation the balance is spendable once; two claimants leave the record unclaimed; an unclaimed import is not counted in "owed to customers" until claimed (decide with D57 owner).
- **Gate:** blocks F01-T31 (the confirm step that writes the ledger rows) and the F02 match task (add it as F02-T09b). Needs the product owner to accept staff confirmation as the exception to "match on phone" (Q-02).

### SR-06 · Blocking · Platform app needs the service-role key; Data API surface

- **Where:** F01 §6.1 and F01-T17 (Supabase Auth with TOTP; staff are invited by a platform admin); FA R4, R8, §4.4(3); `infra/env/.env.example` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); `tools/lint/banned-patterns.mjs` (bans `service_role` in `apps/` and `packages/`). Threat rows BLIND-1, ISO-6, SEC-7.
- **Scenario:** Inviting a teammate, resetting a factor or deactivating an account through Supabase Auth uses the admin API, which needs the service-role key. So `apps/platform` must hold it. Supabase projects expose a Data API (PostgREST) and GraphQL by default; the service-role key bypasses RLS there. With the Data API on, the platform app holds a credential that reads and writes every table including players and payments, and the central argument of FA §4.4(3) ("the platform app holds no credential that can read player data") is false. Also, the lint bans the string everywhere in `apps/`, so the team will either exempt the platform app (weakening the check) or avoid the admin API; and an anon key in every environment invites client-side Supabase calls that R3 forbids. Whether `anon` and `authenticated` default grants reach tables created by the migration role depends on which role runs the migrations; the design says `booq_owner`, which must be verified, because Supabase's tooling runs as `postgres` by default.
- **Fix:** choose one and record it in the F01 design.
  1. **Preferred:** disable the Data API, GraphQL and Realtime on the staging and production projects; remove the anon and service-role keys from every app environment except one small, separate invite function that holds the service-role key and nothing else; update `.env.example` and the lint wording (the lint allows the string only in that one path); CI/launch check: a request with the anon key to `/rest/v1/` returns an error, and `anon` and `authenticated` have no privilege on any object.
  2. **Plan B:** build BOOQ staff sign in in-house in the `platform` schema (password hash, a vetted TOTP library, single-use hashed recovery codes). No Supabase Auth dependency.
- **Tests to add:** the anon key cannot read any table; the platform app's environment holds no service-role key (option 1: only the invite function does); `has_table_privilege('anon', ...)` false for every object; migrations run as `booq_owner` in CI and in production.
- **Gate:** blocks F01-T17; add the first two tests to F01-T03.

### SR-07 · Blocking · Player-originated writes: invoker or definer, and the customer is not bound

- **Where:** FA §3.3 ("`claim_occupancy` ... `SECURITY INVOKER` so RLS still applies"), FA §4.3 (booking policies: staff all; player and coach select only), F03 §4.3 (`app.reserve_court(order, customer, resource, start_hours[], coach, source, confirm_now, override_reason)`), §8 (permissions), §4.2 step 1; tasks F03-T07, F03-T08, F03-T13. Threat rows ISO-4, HOLD-5.
- **Scenario:** As written the player role has no INSERT on `booking` or `occupancy`, so an invoker function cannot run for a player. The developer will make it a definer function or add broad insert policies. Then: (a) `customer` is a parameter, so a player (or a bug in the Pay route) holds slots in another player's name: it burns the victim's future-hours allowance, sends them a "booking released" LINE message and blocks the slot; (b) `source`, `override_reason` and `confirm_now` are parameters: `confirm_now = true` confirms a booking with no payment, and nothing in the function says it can only be true when the order's frozen amount due is zero or a cash payment exists; (c) a definer function without a fixed search path and without the club taken from `app.club_id()` is a cross-club write path.
- **Fix:**
  1. Decide and write it down: `reserve_court`, `confirm_booking`, `reclaim_order`, `release_hold`, `move_booking` are `SECURITY DEFINER` with a fixed search path, listed in `definer-functions.ts` and tested (RLS-M06). The player and coach roles get **no** direct INSERT, UPDATE or DELETE on `booking` or `occupancy`.
  2. Inside: club from `app.club_id()` only; `customer := app.user_id()` unless the caller holds owner or front desk, in which case the argument must belong to the club; `source` derived from the caller's role; `override_reason` accepted only from staff; `confirm_now` is **not a parameter**: the function reads the order and confirms only when the frozen amount due is zero (PAY-07) or a cash payment record exists; status gate, pay-tap check (SR-09) and limit check in the same function.
  3. `reclaim_order` and `confirm_booking` accept only an order owned by the caller's club and, for `reclaim_order`, only from the payment path (callable by the role the callback runs under, not by the player route).
- **Tests to add:** a player passing another customer's id gets their own or a refusal; a direct `INSERT` into `booking` as a player fails; `confirm_now` cannot be forced; a player cannot call `reclaim_order`; a call with club B's order id from club A's context finds nothing.
- **Gate:** blocks F03-T07 and F03-T08 (and T13 for `confirm_booking`).

---

## Should-fix findings

### SR-08 · Should fix · Cross-club job sweeps have no safe privileged path

- **Where:** FA §4.1 (`booq_worker` "still under RLS", "a separate dispatcher reads only the job queue"), §5.4 (sweep jobs: `hold_release`, `package_expire`, `session_start`, `session_end`, `beam_reconcile`, `offer_expiry`, `line_usage_sync`), F03 §6; tasks F01-T34, F03-T19, F03-T06. Threat rows ISO-4, ISO-7.
- **Scenario:** A sweep has to find due rows across all clubs, but under RLS with no `BYPASSRLS` and a club context per transaction, such a query returns nothing. The developer will give the worker `BYPASSRLS` or write a definer function that returns whole rows. Also, `booq_app` can add jobs to the Graphile queue; the worker trusts the club id in the payload.
- **Fix:** one reviewed definer function per sweep that returns only `(club_id, id)` pairs and is executable by `booq_worker` only; each task then opens `withClubTx` for that club and **re-reads the row under RLS**. Treat payload `club_id` as untrusted: the task re-validates. Wrap enqueueing in `app.enqueue(kind, id)` for `booq_app` and revoke direct access to the queue's `add_job`.
- **Tests:** `booq_worker` has no `BYPASSRLS`; sweep functions return ids only; a job payload with club A's id for a row of club B does nothing.
- **Gate:** decide before F01-T34.

### SR-09 · Should fix · Pay-tap limit has no value; unpaid hold hours are unbounded

- **Where:** F03 §4.8 (D61), §4.4, D41 ("no separate limit on hours per selection; BOOK-05 governs"), BOOK-05 (`max_future_court_hours` empty means no limit), F01 §9.3 (`pay_tap_limit_set` check); tasks F03-T10, F03-T12. Threat rows HOLD-1 to HOLD-4, R-06.
- **Scenario:** With `max_future_court_hours` empty (it is a TBD setting) one Pay tap can hold every hour of a court for a day; a second tap the other court. The holds last 10 to 20 minutes; a patient player (or a second LINE account, since a phone is typed and LINE accounts are cheap) re-holds, blocking Hunter's next day of bookings at the cost of a few taps. The pay-tap limit counts taps, not blocked inventory, and is off while the keys are unset.
- **Fix:**
  1. D61 asks Security for the value. Proposed in `threat-model.md` §6: `pay_tap_limit_count = 5`, `pay_tap_limit_window_seconds = 600`, plus a higher staff limit (`pay_tap_limit_staff_count = 20`) as a new key because walk-in rushes are legitimate.
  2. Add `max_unpaid_hold_hours` (proposal 4) to `platform.config`, checked in `reserve_court` under the same per-customer advisory lock as the future-hours limit. It bounds blocked inventory even when BOOK-05 is empty. This is a new rule, so it needs the product owner (Q-04).
  3. Add `charges_per_hold_limit` (proposal 3) for the "new charge in the same hold" path (D72).
  4. Extend the Go live check `pay_tap_limit_set` to cover the new keys (and, if the owner agrees, `max_future_court_hours` being set or explicitly marked "no limit" by the owner).
  5. Count holds that expire unpaid per player per day (a count, shown to the club owner by name in the admin) and flag high values.
  6. Per-IP limit on first sign-in (SR-12) and the suspend path (SR-28).
- **Tests:** the existing D61 tests with the proposed values from config; a player at 4 unpaid hours is refused a fifth; a staff member at 20 per window; a failed charge allows a new charge up to the cap.
- **Gate:** values settled before F03-T12; the new rule needs Q-04.

### SR-10 · Should fix · Idempotency key is not bound to the user

- **Where:** FA §2.2 (`idempotency_key` pk `(club_id, key)`), FA §3.5, F03-T11.
- **Scenario:** The stored response (order, hold, Beam QR image) is returned to whoever sends the same key. If a client builds predictable keys (for example from the slot), or an attacker learns one, a second player in the same club receives another player's order and QR.
- **Fix:** key the table by `(club_id, user_id, key)`, store the request hash, return the stored response only to the same user and refuse a different hash for the same key. Clients send random UUIDs; the server never derives a key from the slot. Purge after 7 days (as designed).
- **Tests:** user B sending user A's key gets no response body; the same key with a different payload is refused.
- **Gate:** before F03-T11.

### SR-11 · Should fix · CSRF, security headers, one cookie name for all clubs

- **Where:** FA §9 (API conventions), F01-T13 (`route()`), F02 §4.1 (`__Host-` cookie, `SameSite=Lax`), §5.2 (`POST /auth/session`); task F02-T07. Threat rows ISO-3, LINE-3, WEB-1, WEB-3.
- **Scenario:** The designs name `SameSite=Lax` and the `Idempotency-Key` header, which are not CSRF controls. Lax does not cover same-site pages or top-level navigations that trigger a state change on GET. `POST /auth/session` can be hit cross-site to sign a victim into the attacker's account (login CSRF). No security headers are specified. Because one domain serves every club (D6) and the cookie has one fixed name, a person using two clubs overwrites their own session and gets 404 (fail closed, but it breaks LINE use of two clubs).
- **Fix:** `route()` enforces on every cookie-authenticated non-GET: `Origin` (or `Sec-Fetch-Site`) must match the app origin; `Content-Type: application/json`; no state change on GET. Headers set once in the app: `Content-Security-Policy` (nonce for scripts, `frame-ancestors 'none'`), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` (`no-referrer` on `/join`), `Permissions-Policy`. Name the cookie per club (`__Host-booq-{club short id}`), keep the server-side club check. The platform console is on its own host name with its own cookie and the same headers.
- **Tests:** a cross-origin POST is refused; a form-encoded POST is refused; a snapshot test fails when a header changes; two clubs' sessions coexist in one browser.
- **Gate:** before F02-T07 and in F01-T13.

### SR-12 · Should fix · Rate limits and body caps have no values

- **Where:** F02 §5.2 ("Rate limited"), F02-T24 ("value from platform config, none invented"), F02-T17 and FA §6.5 (webhooks), F03 §5.1 (public reads), F02 §4.4 (one LINE verify call per sign in). Threat rows LINE-5, LINE-8, BEAM-5, WEB-5, HOLD-3.
- **Scenario:** Anyone can flood `POST /auth/session` and make the server call LINE each time; flood the webhook endpoints with bad signatures (each one logged and alerted); or scrape and hammer the public schedule.
- **Fix:** values in `threat-model.md` §6 (proposals), kept in `platform.config`; enforce IP limits at the edge and per-user and per-token limits in the app. Reject malformed or oversize ID tokens (structure, length) **before** the outbound verify call. Cap webhook bodies (proposal 64 KiB) before the HMAC. One P1 alert per token per window, not per request. Rate limit counters hold a salted hash of the IP that is dropped after 24 hours (an IP is personal data). Refusals are typed codes (`rate_limited` with seconds), never text.
- **Tests:** burst tests per route; the verify call is not made for a malformed token; alert count is bounded under a flood.
- **Gate:** before the 7 Dec test; in F02-T24.

### SR-13 · Should fix · Return path and invite token handling

- **Where:** F02 §4.2 (`liff.login({ redirectUri })` "keeps where the player was going"), §6.2 (return to the same path and query), §6.10 (`/c/{slug}/join?invite={token}`); tasks F02-T10, F02-T11, F02-T18. Threat rows LINE-2, LINE-4, LINE-6.
- **Scenario:** A crafted link sets the return target to another site or to another club's path (open redirect inside LINE's trusted-looking browser: phishing). The invite token sits in the URL, so it reaches access logs, `Referer` headers and LINE's link preview fetch.
- **Fix:** one function `safeReturnPath(slug, path)` used for `redirectUri`, `liff.state` and every post-login redirect: must start with `/c/{slug}/`, no `//`, no backslash, no scheme or host, decoded once, length cap, otherwise fall back to the club home. On `/join` the page exchanges the token by POST and removes it from the address (`history.replaceState`), with `Referrer-Policy: no-referrer`; the token is masked in server logs; LINE ID tokens are never put in a URL.
- **Tests:** a table of hostile return paths all resolve to the club home; a log scan finds no invite token or ID token.
- **Gate:** before F02-T10 and F02-T18.

### SR-14 · Should fix · The test clock override can exist in production

- **Where:** FA §5.5 ("In test databases only, `app.now()` honours a setting ... impossible in production because the setting that enables it is absent from production roles"), F01-T02. Threat row TEST-8.
- **Scenario:** A custom session setting can be set by any session, so "absent from production roles" is not a barrier. If `app.now()` reads the setting in production, anyone who can run SQL as `booq_app` (injection, a bug that sets a setting from input) can move "now" to extend a hold, open the booking window, make a package unexpired or the 12-hour cancel rule pass.
- **Fix:** the production function body is `select now()` and contains no `current_setting` call. The override version is created only by a migration that CI applies to test databases and that is not in the production migration set. CI check: in the production migration set, the source of `app.now()` has no reference to a setting.
- **Tests:** a test that sets the old setting name in a production-shaped database and asserts time did not move.
- **Gate:** before F01-T02.

### SR-15 · Should fix · The purge fence is a session setting anyone can set

- **Where:** FA §2.6 ("allow a `DELETE` only when the purge function has set a transaction-local flag and the row is `is_test`"), F01 §7.6, F01-T27. Threat rows TEST-3, AUD-6.
- **Scenario:** A transaction-local custom setting can be set by any session. The fence therefore rests on the revoked DELETE grants alone. If a future migration grants DELETE to a role, or the owner role is used, the flag can be set and `is_test` rows (and, if `is_test` were ever wrongly true, real rows) vanish from append-only tables.
- **Fix:** the append-only trigger allows the exception only when `current_user` equals the purge function's dedicated owner role (the function is definer-owned by it), and the row is `is_test` **and** belongs to the club passed to the function, read from the function's own argument held in a variable the trigger cannot be tricked into reading from a session setting. Same pattern for `anonymise_user` (SR-04).
- **Tests:** setting the flag in a plain session and trying `DELETE` fails even for the owner role; the purge function removes only `is_test` rows of one club.
- **Gate:** before F01-T27.

### SR-16 · Should fix · BOOQ console: step-up, lockout, sessions, network gate

- **Where:** F01 §6.1, A-10 (authenticator app, reset by another platform admin), A-11, ROLE-02; tasks F01-T17, T21, T22, T23; `runbooks.md` 14. Threat rows BAUTH-1 to BAUTH-8.
- **Scenario:** A phished password plus a relayed authenticator code gives a session on a console that can pause clubs, change payment connections and start exports for every club. Magic-link sign in plus a second factor delivered to the same mailbox is one factor. There is no failed-code lockout, session length, or re-check for dangerous actions; the console is reachable from the whole internet. Lost-factor reset by "another platform admin" has no answer when only one admin exists.
- **Fix:** (1) second factor is a TOTP app at minimum; a passkey or hardware key for platform admins is recommended (phishing-resistant); never SMS or email code. (2) Magic links, if used, never replace the second factor, and a link plus the same mailbox cannot satisfy it. (3) Lockout after 5 failed codes for 15 minutes, with an alert. (4) Console sessions 30 minutes idle and 8 hours absolute; a fresh second factor within 5 minutes (step-up) for: pause and resume, Go live and any status change, write to a payment or LINE connection or a secret, start export, create or change a staff account, owner invite. (5) The console has its own host name and an extra gate (IP allow-list, or an access proxy) until BOOQ has more than a handful of staff (Q-18). (6) Reset: another platform admin plus an out-of-band check; with a single admin, the user's written procedure and a P6 entry (Q-05). (7) Recovery codes are single use, hashed, shown once.
- **Tests:** no session without the second factor on any route (including the API); step-up is required for each listed action; lockout works; session ends at the idle and absolute limits.
- **Gate:** before F01-T17; step-up before T21, T22, T23.

### SR-17 · Should fix · The Go live key swap does not prove the merchant is the club's

- **Where:** F01 §9.3 and A-19, A-23 ("a read-only authenticated call to Beam with the live keys plus a check that a body signed with the stored live HMAC key verifies; it moves no money"), D32; task F01-T27b; `runbooks.md` 13. Threat rows BEAM-8, R-03.
- **Scenario:** Any valid Beam merchant passes that check: the club's, another club's pasted by mistake, or one controlled by whoever typed the keys (BOOQ staff set up the connection, accounts.md). The first sign is a club that is not paid. Payments are PromptPay to whatever merchant the key belongs to, and the design has no refund path.
- **Fix:** the check also reads the merchant identity from Beam with the live key (merchant id and name, if the authenticated call returns them; to be confirmed in the sandbox) and compares it with the merchant id the **club owner** confirmed in A0 or A16. The owner sees the merchant name and the last four characters of each key and ticks "These live payment details are mine" (a `launch_check` row, `owner_confirmed_merchant`). Live keys are entered only in the Go live window, after the 7 Dec test, so production never holds a live set during Testing. After Go live, a change to the live key set needs the support window (SR-02) and notifies the owner.
- **Tests:** a valid key of a different merchant fails the check; the check fails while the owner has not confirmed; changing the live set on a Live club needs the window and creates an owner notice.
- **Gate:** before F01-T27b. Needs Q-06.

### SR-18 · Should fix · Data copy: delivery, notes, deadline

- **Where:** F01 §7.7 ("sends it by LINE"; staff notes excluded, A-17), PDPA-01-AC3, AC4, AC7; task F01-T33. Threat row PDPA-3.
- **Scenario:** A LINE push cannot carry a file, so a link is sent; a link in a chat history stays valid, can be forwarded, and the phone may be lost. There is no time limit on handling the request. Excluding staff notes (A-17) is a legal risk: the PDPA right of access covers personal data the club holds about the person, and a note about a player is such data (my understanding; counsel to confirm).
- **Fix:** the LINE message carries a link that opens only inside a signed-in session of the **same** player; the link is single use and lives `data_copy_link_minutes` (proposal 10); the file is deleted after `export_file_retention_hours`. `data_request.due_at` is set from `data_request_due_days` (proposal 30, counsel to confirm), the owner is reminded at day 20 and overdue requests show in the admin. Decide the contents with Q-08 (recommendation: include staff notes unless counsel advises an exception, and tell the player what was withheld).
- **Tests:** the link fails for another session and after use; the file is gone after the retention window; `due_at` is set.
- **Gate:** before F01-T33.

### SR-19 · Should fix · No registry of personal data columns for anonymising

- **Where:** F01 §7.7 (`anonymise_user` "replaces name, phone, date of birth, LINE ID, language and level ..."), FA §2.2; task F01-T33. Threat row PDPA-4.
- **Scenario:** Personal data lives in more places than the user row: audit values (SR-04), `message_outbox.params`, `idempotency_key` stored responses, `import_row.raw`, `auth_session` (LINE ID, display name), `club_invite`, exports and data copies in storage, ledger and booking `note` fields, receipts (customer name). A deletion that covers only `app_user` leaves the rest and nobody notices.
- **Fix:** a column registry like `table-classes.ts`: `pii-columns.ts` lists every column that can hold personal data of a player, with the action on deletion (null, pseudonym, drop row, keep because the law requires it, e.g. receipt number and amounts). CI fails when a new `jsonb` or free-text column is not in it. `anonymise_user` is driven by the registry. A test seeds QA's PII markers in every registered place for one user and asserts none remain except the explicitly retained fields. Decide what a receipt shows after deletion with the accountant (receipt-name snapshot).
- **Gate:** before F01-T33.

### SR-20 · Should fix · Import and export hardening

- **Where:** F01 §7.4, §7.5, A-14 (link valid 24 hours), PLAT-06; tasks F01-T30, T31, T32. Threat rows IMP-2 to IMP-6.
- **Scenario and fix:**
  1. **CSV formula injection.** A player types `=HYPERLINK("...")` as their name; the owner or accountant opens an export (A5, A13, A14, full export) in a spreadsheet and it runs. Neutralise every exported text cell that starts with `=`, `+`, `-`, `@`, tab or carriage return (prefix with `'`). Apply to all CSV exports, in the shared CSV writer, with a test.
  2. **Import limits.** No limits are stated. Use `import_max_rows` and `import_max_bytes` (proposals 5000, 2 MiB), reject other encodings than UTF-8 and files with a different number of columns, strip control characters, cap field lengths. Staging rows for failed and cancelled jobs are purged within 24 hours.
  3. **Import mints value.** The balance part of an import creates liabilities. Allow it only while the club is Draft or Testing, or with a platform admin's approval after Go live (Q-13). The audit entry per balance exists; add a weekly digest (Q-09).
  4. **Export link.** 24 hours is long for a whole-club file. Create the signed link on click after the owner is re-checked (re-sign-in or step-up), life `export_link_minutes` (proposal 10), delete the file after `export_file_retention_hours` (proposal 24), and note that backups keep it until they age out.
  5. **Provenance.** Each export records requester, scope, row count and a file hash in the audit log (as designed) so a leak can be traced.
- **Gate:** before F01-T30 to T32.

### SR-21 · Should fix · Engineers' database access and audit tamper evidence

- **Where:** `plan.md` §6 (break-glass access), `runbooks.md` 7 and 9, FA §8.1; PLAT-04. Threat rows BLIND-6, AUD-2.
- **Scenario:** Anyone with the provider's SQL editor or the `postgres` role sees every club's players and can alter the audit table by disabling a trigger. D2 and PDPA-01 say BOOQ staff never see club data; in practice the engineers are BOOQ staff. The break-glass log is outside the product, so the club owner never learns of a read. A tampered audit log cannot be told from a clean one.
- **Fix:** (1) At most two named people hold database owner access, with hardware keys; the `booq_owner` password is not known to people and migrations run through CI. (2) Break-glass: ticket, reason, 4-hour limit, a second person approves; the record is kept outside the database and the **club owner is told** the access happened and why (Q-16). (3) Tamper evidence: a per-club hash chain on `audit_entry` and the ledgers (each row stores the hash of the previous row and of itself), and a nightly job that writes the latest hash per club to the off-provider backup bucket. A restore or an audit review verifies the chain. (4) Provider access logs are kept and reviewed monthly.
- **Gate:** the process before 7 Dec (production holds real tester data); the hash chain by 21 Dec.

### SR-22 · Should fix · Ops documents contradict the design at Go live

- **Where:** `runbooks.md` 13 step 6 ("Swap the club's Beam and LINE keys ... send one real small payment"), F01 §4.1 (Testing to Live needs live Beam keys in place and a passing check), A-23 (smoke test moves no money), D32; `plan.md` §8. Threat rows TEST-2, OPS-3.
- **Scenario:** The runbook swaps keys **after** the purge and makes a real payment. The design swaps **before** Go live and uses a no-money check. A real payment after the purge becomes receipt 000001 in the legal series, is real money the club must account for, and cannot be returned as cash (CANCEL-02, PAY-05). Two documents that disagree will be followed in the wrong order under pressure.
- **Fix:** align the runbook to F01 §4.1: live keys entered in the Go live window and verified (SR-17), then the Go live transaction runs the checks and the purge, then the status is Live. No real payment is made as a test. If the owner wants one real end-to-end proof, it is a normal booking by the owner at the normal price, made after opening, with the owner's explicit decision (Q-17). Add the order of steps and who confirms each to the runbook.
- **Gate:** before 21 Dec.

### SR-23 · Should fix · CI gates can be skipped; Actions not pinned; stale env names

- **Where:** `.github/workflows/ci.yml` (`CI_STRICT` off by default, so a missing `test` or lint script is a notice; third-party actions at major tags), `infra/env/.env.example` (`JOBS_AUTH_TOKEN`, scheduler hitting job routes; Supabase URL and keys), FA §5.2 (Graphile Worker, no job routes). Threat rows OPS-1, OPS-5, WEB-8.
- **Scenario:** The tenant isolation suite, the platform-blind suite and the static checks could be absent and the pipeline still shows green. A compromised third-party action tag runs in CI. A stale `JOBS_AUTH_TOKEN` suggests HTTP job routes that the architecture does not have; if someone builds them, they are an unauthenticated trigger risk.
- **Fix:** set `CI_STRICT=true` now that F01-T01 exists; add a required job that fails if the named security suites are missing (a file list: `tests/rls/*`, the blind suite, `tools/lint/banned-patterns.mjs` run); pin third-party actions to commit SHAs; keep `permissions: contents: read`; enable Dependabot and run `pnpm audit` as a non-blocking report with high findings reviewed weekly; remove `JOBS_AUTH_TOKEN` and the heartbeat design that depends on job routes, or specify the routes (constant-time token compare, no personal data).
- **Gate:** before F01-T36.

---

## Notes

### SR-24 · Note · Definer functions and views need one checklist

`app_user_names` (accountant), `public_slot_state`, `public_day_state`, `duplicate_phone_flags`, `wallet_balance` and `package_balance` are views. A view runs with its owner's rights, so each needs `security_barrier` and the tenant filter written into its definition (the accountant cannot be given `select` on `app_user`, so `app_user_names` cannot be `security_invoker`, which conflicts with RLS-M05's default expectation; record the exception). Every definer function sits in `definer-functions.ts` with a fixed search path, the club from `app.club_id()`, and a test. Add to F01-T05 and F01-T15. Rows ISO-5, ROLE-5, PDPA-7.

### SR-25 · Note · Pending sign-up keeps a display name the table lacks

F02 §4.3 says the pending session "holds only `line_user_id`, the LINE display name and the language", but §7.2 `auth_session` has no display-name column. Store nothing but the LINE user ID and language before consent (data minimisation, AUTH-02-AC3); read the display name again when the profile is saved. Purge on expiry (30 minutes). Row LINE-10.

### SR-26 · Note · HMAC "previous" key kind missing; Beam key rights

FA §6.5 step 2 loads "current and previous" HMAC keys for rotation, but the `club_secret` kinds in F01 §3.2 have no `previous`. Add `beam_hmac_key_{test,live}_previous` with an expiry. Ask Beam for an API key limited to creating and reading charges, without refund rights (the refund endpoint exists and is never called). Rows SEC-6, BEAM-13.

### SR-27 · Note · Consent record content, marketing, sensitive free text

`user_consent` holds notice version, language and time. Add a hash of the exact text shown and the list of purposes covered. Decide whether birthday and referral LINE messages are inside the consent purpose or need a separate choice (Q-11). Staff notes and coach session notes are free text; health details (an injury) are sensitive data under PDPA (my understanding) and need a warning on the field (Q-12). The consent text for players under 18 is open (D10, Q-03). Row PDPA-1, PDPA-8.

### SR-28 · Note · No way to suspend a player

`app_user.active` exists but F01 routes deactivate staff only. A club needs to stop an abusive or fraudulent player (hold abuse, referral abuse, payment disputes) without deleting them. Add a front desk or owner action, audited, with a reason, that refuses new holds and purchases and keeps existing bookings (Q-10). Rows ROLE-8, HOLD-9.

### SR-29 · Note · Club-supplied text and uploads

Club names, coach bios, class names, promo codes and notes appear in the player app, the admin, the platform console, LINE Flex cards and PDF receipts, and every club's pages share one origin. Rules: no raw HTML rendering anywhere (lint `dangerouslySetInnerHTML` and equivalents), CSP (SR-11), Flex cards built from JSON not markup, uploads limited to JPEG, PNG, WebP with size caps and re-encoding, SVG rejected or served sandboxed from another origin, and the receipt renderer never fetches a user-supplied URL (CF-05). Rows WEB-2, WEB-4, WEB-7.

### SR-30 · Note · Daily usage rows are finer than D2 needs

`platform.club_usage_daily` stores a count per club per day. D2 allows "bookings in the last 30 days per club". On a small club a daily count can identify one person's booking. Keep the daily rows server side and expose only the rolling 30-day total to the console. Row BLIND-4.

### SR-31 · Note · One master key in the hosting environment

`CLUB_SECRETS_KEY` is an environment variable readable by anyone with project access (secrets.md). Acceptable for the first club if two named people hold it with hardware-key sign in and the key is rotated yearly; move to a managed KMS before the second club (Q-21). Row SEC-2.

---

## Carried forward to later reviews

These came up while reading the designs in scope but belong to features not yet designed in full. Security will review them with those designs.

| ID | For | Item |
|---|---|---|
| CF-01 | F05, F06 | A `wrong_amount` credit must be created from the recorded mismatch event, with the amount read from the event (not typed), once per event (`dedupe_key`), and only by roles the owner allows (FA §6.5, D77) |
| CF-02 | F06, F11 | Wallet and credit `adjust`, no-show reversal and cash entries: size thresholds, owner approval above a limit, weekly digest to the owner (Q-09) |
| CF-03 | F05 | A callback that arrives before the charge id is stored is answered 200 as unknown (D71) and Beam stops retrying; after the lookup match `referenceId` to a pending payment of that club and amount, or leave it for `beam_reconcile` with an alert |
| CF-04 | F05 | Store only the fields needed from Beam's payload in `payment_event`; Beam's real payload may carry payer details (check in the sandbox) |
| CF-05 | F13 | PDF receipts: no user-supplied URL or HTML in the renderer; escape club and customer text; test receipts visibly marked |
| CF-06 | F12 | K5 shows a player photo while F02 A-3 stores none; minors in rosters (D10) |
| CF-07 | F05, DevOps | Beam webhook token and HMAC rotation procedure and whether Beam accepts two secrets at once |
| CF-08 | F13 | Daily close against the bank and Beam report; who may void a receipt; cash drawer differences |
| CF-09 | F14 | Referral abuse: self-referral is blocked by LINE ID and phone, and phone is unverified, so two numbers defeat it; keep the reward small or capped (a setting) |
| CF-10 | F10 | LINE message content built from locales only; no personal data in `params` beyond names needed; outbox rows purged by rule |

## Security tests to add to the QA plan

QA's RLS plan (RLS-M01 to M12, A01 to A20, P01 to P18, R01 to R07) is sound. Add these, each named with its finding:

| Test | Finding |
|---|---|
| A BOOQ account never receives an invite token after creation; parallel redemption has one winner; tester invite yields player only | SR-01 |
| Platform role cannot update the status or window columns; 25 hour window refused by the database; Go live clears the window | SR-02 |
| Cross-club `read_secret` returns nothing; platform app holds no decrypt key | SR-03 |
| After deletion, no PII marker in `audit_entry`, `audit_pii`, outbox, idempotency, import staging, sessions, invites, storage | SR-04, SR-19 |
| Second claimant sees no imported balance; balance spendable only after staff confirmation | SR-05 |
| Anon key against the Data API fails; no object grants to `anon` or `authenticated` | SR-06 |
| Player passes another customer id to the claim function; `confirm_now` cannot be forced; direct insert into `booking` fails | SR-07 |
| Worker has no `BYPASSRLS`; sweep output is ids only; a hostile job payload does nothing | SR-08 |
| Unpaid hold hours cap; pay-tap limit with proposed values; charge cap per hold | SR-09 |
| Idempotency key of user A used by user B returns nothing | SR-10 |
| Cross-origin and form-encoded POST refused; header snapshot; two clubs' sessions in one browser | SR-11 |
| Burst tests; malformed token never reaches LINE; alert count bounded | SR-12 |
| Hostile return paths; no tokens in logs | SR-13 |
| `app.now()` in the production set has no setting reference | SR-14 |
| Plain session setting cannot unlock the purge or erasure path | SR-15 |
| Step-up needed for each dangerous console action; lockout; session limits | SR-16 |
| Different merchant's key fails Go live; owner confirmation required | SR-17 |
| Data copy link single use, same-player, expires | SR-18 |
| Formula-injection cells neutralised in every CSV export | SR-20 |
| Hash chain verifies after a restore | SR-21 |
| PII and secret marker scan across logs, Sentry events and CI output | BLIND-5, SEC-4 |

## Decisions needed

Open questions with recommendations are in `open-questions.md`. Those that gate a build task: Q-01 (SR-01), Q-02 (SR-05), Q-04 (SR-09), Q-05 (SR-16), and Q-03 (consent text for under-18 players, due before 7 Dec).
