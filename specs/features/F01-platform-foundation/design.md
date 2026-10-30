# F01 Platform foundation · Design

Status: **Approved 30 Oct 2026** (gate 2; `docs/decisions.md`, round 7, approved as recommended; the assumptions in section 12 were approved with the design). Drafted 30 Oct 2026 by the Architect role; revised for decisions D32 to D37. Tasks are in `tasks.md` (gate 3). A change to anything below goes through the PRD, then the hand-off, then this file.

Feature: F01 Platform foundation. Requirement IDs: PLAT-01 to PLAT-07, ROLE-01, ROLE-02, PDPA-01 (the IDs ROLE-01, ROLE-02 and PLAT-07 are proposed IDs from the requirements; the PRD and hand-off still need them). Wave 1.

Shared decisions are in `docs/architecture/foundation.md` (revision 4) and are cited as **FA §n**, not repeated. This file settles what is specific to F01: the F01 tables and migrations, routes, state machine, permission checks, jobs, tests and the boards used.

## 1. Requirement coverage

| Requirement | Where this design meets it |
|---|---|
| PLAT-01 Club status | §4 state machine; §5 routes `status`; §3.3 `club_status_change` |
| PLAT-02 Support view | §6 support session and policies; §5 platform support routes; FA §4.4 |
| PLAT-03 Pause | §4.2; §3.3 `club_pause`; §7.3 pause expiry hook |
| PLAT-04 Audit | §8; FA §8 |
| PLAT-05 Switches and templates | §3.2 `club_feature`; §9 templates; §10 settings registry |
| PLAT-06 Import and export | §7.4, §7.5 |
| PLAT-07 Test mode | §7.6; FA §2.6 |
| ROLE-01 Roles are a set | §3.2 `app_user_role`; §6.2 permission check |
| ROLE-02 BOOQ sign in | §6.1 |
| PDPA-01 Data protection | §7.7 data requests; §11 PDPA; FA §4.1 (hosting) |
| CC-1 to CC-6 | §11 |

## 2. What this design does not build

The screens A0 to A17 (F11) and P1 to P6 (F15) are built later on the routes below. F01 supplies the data, server rules, jobs and routes they call. Booking, pricing, ledgers, LINE messages and Beam are other features. Two F01 hooks wait for them: the pause expiry shift (F06) and the purge list for their tables (§7.6).

## 3. Data and migrations

### 3.1 Migration order

Plain SQL files in `packages/db/migrations/`, applied by the Supabase CLI, also run in CI against the local stack. Each file is one transaction. F01 owns numbers 0001 to 0009; later features continue from 0100 per feature block so parallel branches do not collide.

| File | Contents |
|---|---|
| `0001_roles_schemas.sql` | Extensions `btree_gist`, `pgcrypto`. Schemas `app`, `platform`, `audit`. Roles `booq_owner`, `booq_app`, `booq_worker`, `booq_platform`; `revoke all` from `anon`, `authenticated`, `public`; per-role `timezone = 'Asia/Bangkok'`. Helper functions `app.club_id()`, `app.user_id()`, `app.roles()`, `app.has_any_role()` (FA §4.3) |
| `0002_club_setup.sql` | `club`, `club_feature`, `club_setting`, `location`, `resource`, `opening_hours`, `line_connection`, `payment_connection`, `club_secret`, `club_pause`, `club_status_change` |
| `0003_people.sql` | `app_user`, `app_user_role`, `user_staff_note`, `user_consent`, `club_invite`, `club_tester` (F02 adds profile columns, see its design) |
| `0004_platform.sql` | `platform.platform_staff`, `platform.staff_assignment`, `platform.support_session`, `platform.audit_log`, `platform.club_usage_daily`, `platform.config`, `platform.template`, `platform.template_item`, `platform.launch_check`, `platform.export_request`, `bump_usage()` |
| `0005_audit.sql` | `audit_entry`, the writer function, the trigger function, append-only guards, `audit.registry` |
| `0006_test_mode.sql` | `app.test_tables` registry, `is_test` trigger function, `go_live_purge()` |
| `0007_import_export.sql` | `import_job`, `import_row`, `data_export`, `data_request` |
| `0008_rls_grants.sql` | Row-level policies and grants for every table above (§6.3) |
| `0009_seed.sql` | `platform.config` values, templates Tennis and Blank (§9), the settings registry rows |

CI checks that apply to every migration: each new table is in `packages/db/table-classes.ts` (S, D or P), each table with `club_id` has `unique (club_id, id)` and `force row level security`, each audited table has its trigger, each table with `is_test` is in `app.test_tables` (FA §4.5).

### 3.2 Tables

Conventions are FA §2.1 (uuid keys, composite foreign keys, `club_id` first in indexes, text with CHECK instead of enums, satang, `timestamptz`). Only what F01 adds beyond FA §2.2 is detailed here.

**`club`** (class S). `id`, `slug` (unique, URL safe, lower case, becomes part of the address `/c/{slug}`; cannot change after Testing), `name_th`, `name_en`, `legal_name`, `tax_id`, `tax_branch` (text), `registered_address`, `status` (`draft`, `testing`, `live`, `paused`), `payment_option` (`beam`, `slip`), `template_id`, `receipt_prefix`, `default_language` (`th`, `en`), owner contact (`owner_name`, `owner_phone`, `owner_line`, `owner_email`; visible to BOOQ staff, D2), `plan_trial_ends_at`, `billing_starts_at`, `allow_booq_changes_until`, `created_at`, `created_by_staff`. Rule: `legal_name` and the registered address are club data typed in Thai (HO) and appear on receipts only (FA §2.2, PRD "never shows the address").

**`club_feature`** (S). `(club_id, feature_key)`, `enabled`. The key set is Q5 in the requirements (assumption A-1, §12). Server rule PLAT-05-AC2: every route declares the feature it needs and `route()` refuses when the club's switch is off.

**`club_setting`** (S). `(club_id, key)`, `value jsonb`, `updated_at`. Keys, types and validation live in the settings registry (§10). A missing row is "unset" (TBD).

**`location`**, **`resource`**, **`opening_hours`** (S) as FA §2.2. Add `resource.sport` from the template; `resource.active=false` cannot be booked and keeps its id (CC-4). Hunter has one location. The add-location UI is not built; the data model allows several (assumption A-2).

**`line_connection`**, **`payment_connection`** (S) as FA §2.2 (`secret_last4`, `line_plan_kind`, `plan_message_limit`, `mode`, and a Beam merchant id for each of the two key sets). **`club_secret`** `(club_id, kind, ciphertext, key_id, written_by, written_at)`; kinds: `line_channel_token`, `line_channel_secret`, `line_login_secret`, and for Beam two sets (decision D32) `beam_api_key_test`, `beam_hmac_key_test`, `beam_api_key_live`, `beam_hmac_key_live`, each with its own `webhook_token_hash_*`; the ciphertext is produced by app-level envelope encryption (decision D34): a data key per row wrapped by a master key held outside the database (the webhook token itself is shown once to the platform at creation and stored hashed; the URL contains it).

**`club_status_change`** (D, append-only). `(club_id, id, from_status, to_status, reason, actor_staff_id, occurred_at)`. Also feeds P6.

**`club_pause`** (S). `(club_id, id, paused_at, pause_reason, paused_by, resumed_at, resume_reason, resumed_by)`; at most one open row per club (partial unique index where `resumed_at is null`). The pause length is `resumed_at - paused_at`.

**`app_user`** (D) as FA §2.2 with F02's columns. Active flag `active boolean`. **`app_user_role`** `(club_id, user_id, role)` with `role in ('player','coach','front_desk','accountant','owner')` (ROLE-01). Rule enforced by a deferrable constraint trigger: an active user keeps at least one role, and the club keeps at least one active `owner` once it leaves Draft (assumption A-3 for requirement Q-B).

**`user_staff_note`**, **`user_consent`** (D; consent is append-only, `(club_id, user_id, notice_version, language, accepted_at)`; the fields are the proposed answer to F01 Q20 and need the PRD and hand-off change first, A-4). Note that the consent screen is F02.

**`club_invite`** (D). `(club_id, id, token_hash, roles text[], kind in ('owner','staff','coach','tester'), created_by_staff | created_by_user, expires_at, used_at, used_by_user)`. Token is random 32 bytes, shown once, stored hashed. Redeeming is done by F02's sign in (assumption A-5 for F02 Q13).

**`club_tester`** (D). `(club_id, user_id, kind in ('owner','boq_tester'), added_by_staff, added_at, removed_at)` (PLAT-07-AC5). Every change goes to P6.

**Platform schema** (class P, no `club_id` except where noted):
- `platform_staff (id, auth_user_id, email, display_name, role in ('platform_admin','onboarding_specialist'), active, created_at)`. `auth_user_id` is the Supabase Auth user (email plus TOTP, FA §4.4). No password in our tables.
- `staff_assignment (staff_id, club_id)` for specialists.
- `support_session (id, staff_id, club_id, opened_at, closed_at, mode in ('edit','look'))`.
- `audit_log` (P6) as FA §8.2.
- `club_usage_daily (club_id, day, metric, value)`; `bump_usage(club, metric, by int)` is the only writer, `SECURITY DEFINER`, fixed search path, refuses `is_test` activity. Metrics in F01: `bookings_confirmed` (called by F03), `line_messages_sent` (F10). Allowed reads: counts per club per day, nothing finer (D2, PLAT-02-AC11).
- `config (key, value jsonb)` with `line_cap_alert_pct`, `line_cap_reminders_pct`, `line_cap_full_pct` (F10 reads them), `support_window_hours`.
- `template`, `template_item (template_id, kind, key, value jsonb)` (§9).
- `launch_check (club_id, check_key, result in ('pass','fail','pending'), checked_at, checked_by)`: pass or fail only, no test content (PLAT-07-AC6).
- `export_request (id, club_id, requested_by_staff, requested_at, status)` for BOOQ-started exports (D14).

**`import_job`** (D) `(club_id, id, kind in ('players','packages','balances'), file_name, status in ('uploaded','validated','failed','confirmed','cancelled'), rows_read, rows_saved, rows_rejected, created_by, created_at, expires_at)`, **`import_row`** `(club_id, job_id, row_no, raw jsonb, errors jsonb)` (staging). **`data_export`** `(club_id, id, kind in ('club','customers'), requested_by_user | requested_by_staff, status, storage_path, expires_at, row_count)`. **`data_request`** `(club_id, id, user_id, kind in ('copy','delete'), status in ('requested','in_progress','done','declined'), requested_at, handled_by, handled_at, note)`.

### 3.3 Server functions (SQL)

- `app.set_club_status(club, to, reason, actor)`: checks the transition table (§4.1) and preconditions, writes `club_status_change`, updates `club`, all in one transaction. The only writer of `club.status`; `club.status` is not updatable by the plain table grants.
- `app.go_live(club, actor)`: runs inside `set_club_status` for `testing -> live`: verifies every `launch_check` is `pass`, then calls `go_live_purge()` (§7.6) in the same transaction, then sets `live`. Any failure rolls the whole thing back and the status stays Testing (PLAT-07-AC4).
- `app.pause_club(club, reason, actor)` and `app.resume_club(club, reason, actor)` (§4.2).
- `app.has_feature(club, key)` for `route()`.
- `platform.bump_usage(...)`.
- `audit.write(...)` and `audit.note(...)` (FA §8.1), and the generic trigger function.

All are `SECURITY INVOKER` except `bump_usage`, `audit.*` and `go_live_purge`, which are `SECURITY DEFINER` with a fixed search path and are listed in `packages/db/definer-functions.ts` for review.

## 4. State machine: club status (PLAT-01, PLAT-03)

### 4.1 Transitions

| From | To | Who | Preconditions | Side effects |
|---|---|---|---|---|
| (new) | Draft | Platform admin, specialist | P2 step 1 saved | Row created; `created_by_staff`; P6 |
| Draft | Testing | Platform admin, specialist (assigned) | Setup steps 1 to 8 done (list in §9.3); `payment_connection` and `line_connection` tests passed | `club_status_change`; P6; testers become able to sign in |
| Testing | Live | Platform admin, specialist (assigned) | Every `launch_check` is `pass` (P4); blank-template rule (§9.3); live Beam keys in place | Purge test data (§7.6); real receipt sequence starts at 000001; P6; club audit entry |
| Live | Paused | **Platform admin only** | A reason is given | `club_pause` row opened; owner LINE message (outbox); banner flag; new booking and buying refused |
| Paused | Live | **Platform admin only** | A reason is given | `club_pause` closed; expiry shift hook (§7.3); owner LINE message; P6 |
| any | any other | refused | | |

Backward moves (Testing to Draft, Live to Testing) are **refused until decided** (requirements Q4; assumption A-6). Delete is not a transition in v1 (D14).

A specialist acts only on assigned clubs; a request for another club returns 404 (D27, ROLE-AC5). A club has exactly one status at a time (a CHECK on the column plus the function as the only writer).

### 4.2 Pause and resume

`pause_club`: in one transaction set status `paused`, insert `club_pause`, insert an outbox row for the owner's LINE (template key from the L set, new key listed in §13), audit and P6. While `paused`, `claim_occupancy` and the checkout routes refuse with `club_paused` (FA §3.3). Existing bookings and holds are untouched: holds run to their normal end; reminders and releases keep running (PLAT-03-AC6). The player app and club admin read `club.status` and the open `club_pause` to show the paused states and banner (PLAT-03-AC4, AC5, AC8).

`resume_club`: close `club_pause`, set `live`, then run every handler registered in `app.pause_handlers` with `(club, paused_at, resumed_at)`. F06 registers the package and wallet expiry shift there, writing one ledger movement per package with the reason (PLAT-03-AC7). Until F06 exists the registry is empty and resume only changes status. A wallet without an expiry has nothing to shift (assumption A-7 for requirements Q11). A payment started before the pause is handled by F05's PAY-03 rules as if no pause (PLAT-03-AC9; assumption A-8).

### 4.3 Visibility by status

| Status | Player app | Club admin | Support view |
|---|---|---|---|
| Draft | Not found, except testers (§7.6) | Owner works through A0 | Edit (platform admin, assigned specialist) |
| Testing | Testers only | Owner and staff | Edit |
| Live | Everyone | Everyone | Look only; edit while `allow_booq_changes_until > now()` |
| Paused | Browse and sign in work; booking and buying refused | Works, banner on every page | Look only unless the window is on (D27) |

## 5. API routes

Conventions are FA §9: typed error codes, no text; `Idempotency-Key` on mutating routes that can be retried; every route declares a permission and (if needed) a feature; the club comes from the session, never from the body; a record outside the caller's reach returns 404.

### 5.1 Club app (`apps/web`, prefix `/api/c/{slug}`)

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /club` | any signed-in role | Name, language, status, banner state (paused reason), feature switches the surface needs |
| `PUT /club/business` | owner | Hours-independent business and tax details, VAT switch, receipt prefix is read-only (A16) |
| `GET /settings`, `PUT /settings/{key}` | owner (read: owner, accountant) | Validated by the registry (§10); writes an audit entry with old and new value |
| `PUT /hours`, `PUT /resources/{id}`, `POST /resources` | owner | Opening hours and courts. Refuses a change that would shorten hours over existing bookings and says to use a closure (PLAT-02 Meets) |
| `GET /staff`, `POST /staff/invites`, `PUT /staff/{userId}/roles`, `POST /staff/{userId}/deactivate` | owner | Role sets (ROLE-01-AC5); invite link created; roles assigned by the owner only |
| `PUT /support-window` `{on: true|false}` | owner | Sets `allow_booq_changes_until = now()+24h` or `null` (PLAT-02-AC4, AC5) |
| `GET /audit` | owner | Search by staff, record type, record id, date (PLAT-04-AC7, AC8) |
| `POST /imports`, `GET /imports/{id}`, `POST /imports/{id}/confirm`, `DELETE /imports/{id}` | owner | §7.4 |
| `POST /exports`, `GET /exports/{id}` | owner | §7.5 |
| `GET /data-requests`, `POST /data-requests/{id}/handle` | front desk, owner (assumption A-9 for Q25) | §7.7 |
| `POST /me/data-requests` `{kind}`, `GET /me/data-requests` | any signed-in player | Copy or delete (PDPA-01-AC3, AC4) |
| `GET /testers` | owner | Tester list read-only (set by BOOQ) |

### 5.2 Platform console (`apps/platform`, prefix `/api/platform`)

Authentication: Supabase Auth email plus second factor; the session carries `staffId` and `role`; no club context. Every route below that names a club first checks admin, or assignment for a specialist, and returns 404 otherwise.

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /clubs` | any staff | P1: status, setup progress, **aggregate** 30-day booking count from `club_usage_daily`, alerts |
| `POST /clubs` | admin, specialist | P2 step 1: creates a Draft club |
| `PUT /clubs/{id}/setup/{section}` | admin, assigned specialist | Sections: `basics`, `plan`, `resources-hours`, `line`, `payments`, `features`, `template`. Allowed only while Draft or Testing, or when the support window is on (§6.3); secrets are write-only |
| `POST /clubs/{id}/connections/{line\|beam}/test` | admin, assigned specialist | "Test connection": calls LINE or Beam server side, returns pass or fail and updates `club_health` |
| `GET /clubs/{id}` | admin, assigned specialist | P3: checklist, missing items and who owes them, owner contact, aggregate counts |
| `POST /clubs/{id}/status` `{to, reason?}` | admin; specialist for Draft, Testing, Live | `set_club_status`; pause and resume are separate |
| `POST /clubs/{id}/pause`, `POST /clubs/{id}/resume` `{reason}` | **admin only** | §4.2 |
| `POST /clubs/{id}/owner-invite` | admin, assigned specialist | Creates the owner invite link (shown once) and logs it |
| `GET /clubs/{id}/support/setup` | admin, assigned specialist | The setup-only projection: hours and courts, products and pricing with add-ons, LINE, payment connections, settings; secrets show `secret_last4` only (D27) |
| `PUT /clubs/{id}/support/setup/{section}` | as above | Edits; refused when look only. Opens a `support_session` on first use |
| `GET /clubs/{id}/launch`, `POST /clubs/{id}/launch/{checkKey}/run` | admin, assigned specialist | P4 results as pass or fail; running a check |
| `GET/PUT /clubs/{id}/testers` | admin, assigned specialist | Tester list; invites for BOOQ testers; each change to P6 |
| `POST /clubs/{id}/exports` | admin, assigned specialist | Starts an export; returns status only (D14, PLAT-06-AC12) |
| `GET /templates` | any staff | P5 |
| `GET/POST/PUT /team`, `GET /audit-log` | admin | P6: staff accounts and platform actions; sign-ins and failures are recorded here (ROLE-02-AC5) |

Routes that do not exist anywhere: delete club (D14), cash refund, any route that returns players, bookings, payments, slips, receipts, wallets or reports to the platform app, and any "log in as". The platform app cannot reach them because its database role has no privilege on those tables (FA §4.4).

## 6. Permission checks

### 6.1 BOOQ sign in (ROLE-02)

`apps/platform` uses Supabase Auth with password or magic link plus TOTP; a session is created only after the second factor (AC1). The auth user must exist in `platform.platform_staff` with `active = true`; otherwise the session is ended (AC4). A LINE-signed club session is never accepted by the platform app (separate cookie name, separate signing key, separate deployment) and a BOOQ account cannot get a club session, because `app_user` creation requires a LINE verification (AC2, AC3). Sign in, failed sign in, second-factor reset and teammate invite write `platform.audit_log` (AC5). Which factor type and the reset process are requirements Q-C (assumption A-10: authenticator app, reset by another platform admin).

### 6.2 Club roles (ROLE-01, ROLE-AC1 to AC6)

`packages/auth` holds the permission matrix; a role set is the union (AC2). Permission names used by F01: `club.read`, `club.business.write`, `settings.read`, `settings.write`, `hours.write`, `resource.write`, `staff.manage`, `roles.assign`, `audit.read`, `import.run`, `export.run`, `datarequest.handle`, `support-window.write`.

| Permission | Player | Coach | Front desk | Accountant | Owner |
|---|---|---|---|---|---|
| `club.read` | yes | yes | yes | yes | yes |
| `settings.read` | | | | yes | yes |
| `settings.write`, `club.business.write`, `hours.write`, `resource.write` | | | | | yes |
| `staff.manage`, `roles.assign`, `support-window.write` | | | | | yes |
| `audit.read`, `import.run`, `export.run` | | | | | yes |
| `datarequest.handle` | | | yes | | yes |
| `customer.contact.read` (phone, date of birth) | | | yes | **no** | yes |
| `customer.names.read` (names on receipts and reports) | | | yes | yes | yes |

Accountant (decision D35): sees names on receipts and reports, not phone numbers or dates of birth. This is enforced twice: the accountant has no `select` on `app_user`; accountant routes read names through the view `app_user_names (club_id, id, full_name, display_name)`, which has the tenant filter built in; and the permission `customer.contact.read` is refused. A CI test requests phone and date of birth as an accountant through every route and expects them to be absent.

Two layers, as in FA §4.3: `route({permission})` on the server, and row-level policies. A route without a declared permission fails the build. Platform permissions are checked against `platform_staff.role` and `staff_assignment`.

### 6.3 Row-level policies and grants (migration 0008)

- Every club table: the restrictive tenant policy of FA §4.3, `FORCE ROW LEVEL SECURITY`.
- `club` for `booq_app`: `id = app.club_id()`; writes by owner only through the routes above; `status`, `slug` after Testing, and `allow_booq_changes_until` are not directly writable (functions only).
- S tables for `booq_platform`: `select` for admin or assigned specialist; `insert/update` only when the club's status is `draft` or `testing`, or `allow_booq_changes_until > now()` (the policy reads the club row; there is no job, it expires by itself). A Paused club is neither, so it is look only (D27).
- D tables for `booq_platform`: **no grant at all.**
- `club_secret`: `booq_platform` and `booq_app` get `insert, update`, never `select`, and never see the plaintext or the master key; reads go through a `SECURITY DEFINER` function `app.read_secret(club, kind)` callable only by `booq_worker` and the payment/LINE adapters' role (listed in `definer-functions.ts`).
- `audit_entry`, ledgers: no `insert` for any app role; only the definer writer functions insert (FA §8.1).
- `platform.club_usage_daily`: `select` for `booq_platform` and `booq_app` (own club only); no direct `insert`.

## 7. Behaviour

### 7.1 Creating a club (Flow J)

P2 step 1 creates a Draft club with the chosen template copied into the club (§9). Steps 2 to 5 are saved at any time. P3 invites the owner with a `club_invite` of kind `owner`; the owner signs in with LINE (F02), the invite creates `app_user` with role `owner` and the club audit entry. The owner finishes steps 6 to 9 in A0 (F11).

### 7.2 Support session

The first read or write by BOOQ staff on a club opens a `support_session` (mode `edit` or `look` as the policy allows), writes `audit.note()` to the club's audit log and to P6 with the staff name. A visit with no changes is still logged (PLAT-02-AC6). Sessions close after inactivity or when the staff member leaves the club view; the length of inactivity is not in the spec (assumption A-11: 30 minutes, platform config `support_session_idle_minutes`).

### 7.3 Pause expiry hook

`app.pause_handlers (name, handler)` is a registry of SQL functions run by `resume_club` in registered order inside the same transaction. Contract: handler receives `(club, paused_at, resumed_at)`, must be idempotent for a given `club_pause.id`, and writes ledger movements, not silent edits. F06 registers `shift_package_expiry`. F10 registers `reschedule_expiry_reminders`.

### 7.4 CSV import (PLAT-06-AC1 to AC10, AC18)

1. `POST /imports` with kind and file. The file is parsed into `import_row` staging rows in one request; the raw file is never stored (AC10). Size and row limits are a platform config (no value invented here).
2. Validation runs on every row; errors are listed per row with a reason **code** (the client maps codes to locale keys). Any error: status `failed`, nothing saved, the owner fixes the file and uploads again (AC1, AC2).
3. A valid file shows a preview with counts; `POST /imports/{id}/confirm` saves in one transaction: players, customer packages and ledger movements with reason `import` and the owner as actor; **never bookings** (AC18, AC3). A club ID in the file is ignored (AC5). Amounts are read as THB and stored as satang; dates as Bangkok dates (AC9).
4. Players are created without a LINE user ID, inactive until first sign in; at first LINE sign in F02 matches them on normalised phone (AC7). Two matches or none: not matched automatically (assumption A-12 for Q16: the player gets a normal new profile and staff see an "unmatched import" flag). Duplicate phones are flagged (D11).
5. One audit entry for the import (file name, counts) and one per created balance (AC6). Package expiry from the file is kept as given (assumption A-13 for Q15); recomputing from validity is rejected as a surprise to the owner.
6. Import is refused for every role except the owner, including BOOQ support (AC8).

### 7.5 Data export (PLAT-06-AC11 to AC17)

BOOQ staff `POST /clubs/{id}/exports` inserts `export_request`; a `booq_worker` task picks it up **in the club's context**, builds a ZIP of CSVs for that club only (every query is club scoped, AC11), writes it to the private bucket under `club_id/`, and creates `data_export`. Only the owner (`GET /exports/{id}`) receives a short-lived signed link; BOOQ staff see only the status (AC12). The link life is a platform config (requirements Q1 open; assumption A-14: the owner downloads from A16, link valid 24 hours, the owner may also start an export). Each export writes an audit entry with who, which export and row count (AC15). The A5 customer CSV (AC13) and report exports (AC14) reuse the same scoped repositories and audit rule; their screens are F11 and F13. Slips and staff notes are in the full export only if Q18 says so (AC16; assumption A-15: not included until decided). No delete-club exists (AC17).

### 7.6 Test mode (PLAT-07, FA §2.6)

- `app.test_tables (table_name, delete_order)` lists every table that carries `is_test`. Each later feature's migration adds its tables here; CI fails if a table has the column and is not registered. F01 registers its own.
- A `BEFORE INSERT` trigger sets `is_test` from the club status at insert time; the column cannot be updated (AC1).
- `go_live_purge(club)` deletes only `is_test` rows of that club in `delete_order`, in the Go live transaction, and the append-only triggers allow it only through that function (FA §2.6). It writes one non-test audit entry with row counts and one P6 entry (AC8).
- Testers (AC5): the owner and BOOQ testers in `club_tester`. A BOOQ tester receives a tester invite link, signs in with LINE and gets a normal player account flagged as a tester; no BOOQ credential is involved (ROLE-02-AC2). F02's sign-in gate uses `club_tester`.
- BOOQ staff see pass or fail per check only (`launch_check`); the P4 page never queries D tables (AC6). Test-flagged rows are excluded from all reports, the daily close, receipt lists and platform counts, and show only in test-mode views (AC7, decision D33; mechanism in FA §2.6).
- Test payments use Beam's Playground only (D26, AC9).
- Test receipt marking is a new L key (§13).

### 7.7 Data requests (PDPA-01-AC3 to AC7)

A player's `POST /me/data-requests` stores the request and an audit entry. Staff handle it in the screen F11 will build (requirements Q25 open; routes exist now). **Copy:** the handler builds the player's file (profile, bookings, credits, receipts; staff notes excluded, assumption A-17 for Q21) as a scoped export and sends it by LINE. **Delete:** shows the staff what will be lost (future bookings, credits, wallet) before confirming; on confirm, the function `app.anonymise_user(user)` replaces name, phone, date of birth, LINE ID, language and level with null or a pseudonym, removes tags, notes and consent text links, deactivates the user and redacts those fields in the user's `audit_entry` JSON. Ledger, receipt and booking rows stay with the pseudonymous id (receipt numbers are never reused). A future booking is handled by staff before confirming (requirements Q22 open; assumption A-18: the function refuses while a future confirmed booking exists, so staff must cancel it first). The same LINE user signing in later is a new player with a new consent (F02 Q15). Retention periods are set when legal input is available.

## 8. Audit (PLAT-04)

All of FA §8. F01 specifics:

- Audited F01 tables: `club`, `club_feature`, `club_setting`, `location`, `resource`, `opening_hours`, `line_connection`, `payment_connection`, `club_secret` (write event only, never values, never the ciphertext), `app_user` (including date of birth), `app_user_role`, `club_invite`, `club_tester`, `club_pause`, `club_status_change`, `import_job`, `data_export`, `data_request`.
- `route()` sets the transaction-local `reason` where the screen asks for one (status change, pause, resume, role change, setting change). A staff ledger movement without a note is refused by the table CHECK (PLAT-04-AC3).
- A change that cannot write its audit entry rolls back (AC2): the trigger runs in the same transaction, and a failure raises.
- P6 events written by F01: club created, setup section changed, connection tested, status change, pause, resume, support session opened and closed, support edit, tester list change, owner invite created, export started, purge run, BOOQ staff account events and every sign in and failure (ROLE-02-AC5).
- The owner reads the club log through `GET /audit`; front desk, accountant and coach get 404 (AC8). BOOQ staff cannot read it (AC9).
- Append-only for both logs (AC6) and times in Asia/Bangkok (AC11).

## 9. Templates and settings

### 9.1 Templates (PLAT-05)

`platform.template` and `platform.template_item` hold the Tennis (Hunter defaults) and Blank templates as data. Padel and Pickleball exist as rows marked `to_build = true` and cannot be chosen (AC11). Creating a club **copies** the template items into the club's own tables (products and prices as `package_product`, `court_price_rule`, `coach_tier`, `add_on`, `price_group`, settings, sport labels); later template edits never change existing clubs (AC7). The chosen template id is saved on the club and the copy is audited (AC12).

The Tennis template carries only values the spec gives: court ฿500 (50000 satang), the 10 hour bundle ฿4,500 for 3 months, the 20 hour bundle ฿8,000 for 5 months, solo and group singles and 8 packs for Adult and Student, hold 15 minutes, claim time 30 minutes, no offers within 2 hours, rest cap 6, group classes 4 to 6 players, opening hours 06:00 to 24:00 (PRD, D8, AC13, AC15). Every TBD stays an empty setting (AC9): add-on prices, Head Coach price, referral reward, friend discount, birthday discount, max future court hours, class-below-minimum alert time, wallet balance expiry, coach pay. The Blank template copies nothing; every setting is unset (AC8). Booking length is not a template value.

Whether the P5 actions New template, Duplicate and Edit exist in v1 is requirements Q5 (assumption A-1: only the two templates, read-only in the console).

### 9.2 Seeds

`0009_seed.sql` inserts the template rows and platform config. It contains no player data.

### 9.3 Go live checks

The check keys are data rows per template (`launch_check.check_key`) so the list can change without code. The spec's P4 list is requirements Q7 (open). Until it is answered the design implements these assumed checks (A-19): LINE connection test passed, the **pay-tap limit is set** (decision D61, F03 §4.8), and Beam **key swap** (decision D32: the club's live Beam key set is entered and active, the test key set is no longer used, and a smoke test passes; see A-23), at least one product with a price, every setting the template marks `required` is set (BOOK-05 and the other TBD settings are not `required`), owner signed in, at least one successful test booking on the Playground, no open launch failure. For a Beam club the fake-slip tests of H-P4-Launch are replaced by Beam tests (Gaps A2).

## 10. Settings registry

`packages/db/settings-registry.ts` defines, per key, type, allowed values, whether it may be unset, and the owner role. Validation is on the server (PLAT-05 settings paragraph). No default values live in code; the registry only describes shape.

| Key | Type and validation | Unset allowed | Source |
|---|---|---|---|
| `hold_minutes` | one of 10, 15, 20 | no (template value) | PRD, HO BOOK-03 |
| `booking_window_days` | integer 1 or more | no | HO BOOK-01 |
| `cancel_window_hours` | integer 0 or more | no | HO CANCEL-01 |
| `max_future_court_hours` | integer 1 or more | **yes** (no limit) | HO BOOK-05 |
| `waitlist_claim_minutes` | integer 1 or more | no | HO CLASS-02 |
| `waitlist_no_offer_hours` | integer 0 or more | no | HO CLASS-02 |
| `rest_cap_hours` | integer 1 or more | no | PRD rest rule |
| `group_min_players`, `group_max_players` | integers, min at most max | no | PRD group classes |
| `below_min_alert_minutes` | integer 1 or more | **yes** | PRD |
| `package_expiry_reminder_days` | list of integers, template `[14, 3]` | no | HO PKG-03 |
| `wallet_expiry_months` | integer 1 or more | **yes** | PRD |
| `package_qr_minutes` | integer 1 or more | no | HO PAY-04 |
| `vat_enabled` | boolean | no | HO RCPT-02 |
| `auto_slip_check` | boolean (slip clubs only) | n/a | PRD backup mode |
| `allow_booq_until` | not a setting row: column on `club` | | PLAT-02 |

Rules: the 60 minute booking length is not a key and cannot be created (a CHECK in the `occupancy` table and no registry entry). `hold_minutes` outside 10, 15, 20 is refused. Every write audits old and new values.

## 11. How the cross-cutting rules are met

- **Club ID scope (CC-1):** FA §2.1 (composite keys), §4.2 and §4.3 (context and policies). All F01 tables except the `platform` schema carry `club_id`. A request for another club's record returns 404.
- **Server permissions (CC-2):** §6; the platform app has no credentials for D tables.
- **PDPA (CC-3):** personal data F01 touches: owner contact (class S, visible to BOOQ by decision D2), the player record, consent, roles, audit values, import files (parsed and discarded, §7.4), exports (private bucket, signed link, short life). BOOQ never reads player, booking or payment data (FA §4.4). Hosting is FA §4.1 (D5). Slips and staff notes are staff only. Consent is a record, append-only.
- **Encryption (PDPA-01-AC9, decision D34):** TLS for all traffic in transit; the host's standard disk encryption at rest (Supabase's encrypted storage); stored secrets (Beam and LINE keys) get an extra application-level layer so a database copy alone does not reveal them. Who owns a breach procedure remains an open item for a person (requirements Q23, security baseline).
- **No double booking (CC-4):** F01 has no booking logic. Resources keep stable ids; inactive resources are refused by `claim_occupancy`; pause and closure never delete bookings; hour changes that conflict with bookings are refused and sent to a closure.
- **TEXT (CC-5):** no text in code. Routes return codes. The keys used are listed per screen in §13; every new key is added in both files by the content role and sent to the writers. X keys are English only. Dates use the international year.
- **Other (CC-6):** Bangkok time (FA §7), satang, no invented values (the registry and templates hold only spec values; TBD stays empty).

## 12. Assumptions approved with this design

These need a person's yes or no; none changes the tables much.

| Id | Assumption | Requirement question |
|---|---|---|
| A-1 | Feature switches in v1: payment option, slip checking, backup mode, coach add at checkout; P5 has only Tennis and Blank, read-only | Q5 |
| A-2 | Data model allows several locations, no add-location UI | Q26 |
| A-3 | A club keeps at least one active owner once it leaves Draft; a user keeps at least one role | Q-B |
| A-4 | `user_consent` holds notice version, language and time | Q20 |
| A-5 | Invites are created in F01 (`club_invite`) and redeemed in F02's sign in; screens by F11 and F15 | F02 Q13 |
| A-6 | No backward status moves in v1 | Q4 |
| A-7 | A wallet with no expiry is not touched on resume | Q11 |
| A-8 | A payment started before a pause is handled by PAY-03 as if no pause | Q12 |
| A-9 | Front desk and owner handle data requests | Q25 |
| A-10 | BOOQ second factor is an authenticator app; reset by another platform admin | Q-C |
| A-11 | Support session idle close after 30 minutes (platform config) | none |
| A-12 | Unmatched import phone: normal new profile plus a flag for staff | Q16 |
| A-13 | Imported package keeps the file's expiry date | Q15 |
| A-14 | Owner downloads exports from A16, link valid 24 hours, owner may start an export | Q1 |
| A-15 | Slips and staff notes not in the full export until decided | Q18 |
| A-16 | Decided (D33): test activity is excluded from all reports, daily close, receipts lists and platform counts | Q-E |
| A-17 | Staff notes are not in a player's data copy | Q21 |
| A-18 | Deletion is refused while a future confirmed booking exists | Q22 |
| A-19 | The Go live check list in §9.3 | Q7 |
| A-20 | Both Thai and English club text fields are required to save | Q27 |
| A-21 | Backups and audit retention periods are set when legal input is available | Q13 |
| A-22 | May one person be booked in two places at once: not decided; F03 must add a rule if not | Q-A |
| A-23 | The key swap smoke test is a read-only authenticated call to Beam with the live keys plus a check that a body signed with the stored live HMAC key verifies; it moves no money. Exactly what "smoke test" means is not in D32 | none |

## 13. Text keys and canvas boards

**Existing keys** are looked up by the content role once `copy-index.csv` is generated (D31). Known: A-0362 "Allow BOOQ to make changes", A-0498, A-0066, A-0519 (pause banner), P-0442 (paused), P-0413, P-0414, P-0419, P-0422 (privacy), X-0133 (export club data).

**New keys needed** (both languages for A, L, P; X English only; none added by this design):
- A: import preview and row error reasons, export started and ready, "not allowed for your role", audit "change" lines with named variables, setting validation errors (hold time), unmatched imported player flag.
- L: owner paused / resumed LINE message, "test receipt" marking (PLAT-07-AC2), data copy delivered message.
- P: data request confirmations if not already in the G-C17-Privacy keys.
- X: BOOQ sign in and second factor screens and errors, tester list, purge confirmation, aggregate count labels, resume action and reason, export confirmation, status change refusals with named variables, "to build" template label, support session labels.

**Canvas boards used:** H-P1-Clubs (and -clear, -paused), H-P2-Step1-Basics to H-P2-Step5b-Payments-slip, H-P3-Club-detail (and -alert, -fixed, -live), H-P3b-Support-view, H-P3c-Pause-club, H-P4-Launch, H-P5-Templates, H-P5b-Templates-blank, H-P6-Team-audit, H-A0-Setup-checklist, H-A05-Customers, H-A16-Settings, H-A17-Staff-audit, H-A09b-Pricing-groups, H-A01 pause banner, S-A01-Paused, S-C03-Paused, G-C17-Privacy, G-C17-Personal-details, H-C17-Profile-receipts, and the T- twins of the A and P boards (X boards have no Thai twin). Gaps used: A2, A7, C5, C7. The sign-in screen for BOOQ staff has no board (requirements Q-C).

## 14. Tests (written first at the build step, from the acceptance criteria)

All tests run against a real Postgres (FA §4.5, decision D30); Playwright for the screens built on these routes in later features.

| Group | Covers | Test |
|---|---|---|
| Tenant isolation | CC-1, ROLE-AC6 | For every club table: club A context cannot read, update or delete club B rows; insert with B's id fails; no context returns zero rows; composite foreign keys across clubs fail; wrong-club slug returns 404 |
| Platform blind | PLAT-02-AC1, PDPA-01-AC1 | As `booq_platform`: `select/insert/update/delete` on every D table fails with permission denied; `club_secret` select fails; platform routes for players, bookings, payments return 404 |
| Support window | PLAT-02-AC2 to AC5 | Draft edits succeed; Live look only; owner toggle opens 24 hours; clock moved 24 hours closes it; early off closes at once; Paused behaves as Live |
| Status machine | PLAT-01-AC1 to AC10 | Each allowed and refused transition by role; specialist not assigned gets 404; pause by specialist refused; no reason refused; Go live refused with a failed check; purge failure keeps Testing; every change in `club_status_change` and P6 |
| Pause | PLAT-03-AC1 to AC11 | New booking refused (API and screen), existing booking and reminders kept, resume runs registered handlers once, banner state |
| Roles | ROLE-01-AC1 to AC6, ROLE-AC1 to AC6 | Union of roles; owner-only role assignment; BOOQ account never gets a club role; last owner protected |
| BOOQ sign in | ROLE-02-AC1 to AC5 | No session without the second factor; deactivated staff ends a session; every attempt in P6 |
| Audit | PLAT-04-AC1 to AC11 | One entry per audited change in the same transaction; failing audit rolls back; staff ledger movement without note refused; edits and deletes of `audit_entry` fail for every role; owner-only read; Bangkok times |
| Accountant columns | D35 | As an accountant, every route that lists customers, receipts or reports returns names and never phone or date of birth; direct `select` on `app_user` fails |
| Test exclusion | PLAT-07-AC7, D33 | Seed test rows in every report, daily close, receipts list and P1 count: all return zero; test-mode view shows them to the owner only while Testing |
| Key sets | D32 | Testing uses the test set; Live uses the live set; a callback on the inactive set's URL changes nothing; Go live is refused until the key swap check passes; plaintext secrets never appear in the database, logs or responses |
| Settings | PLAT-05, §10 | `hold_minutes` 12 refused; 60 minute length cannot be set; unset TBDs read as unset; every write audited |
| Templates | PLAT-05-AC7 to AC15 | Tennis copy equals the PRD offer in satang; later template edit leaves clubs unchanged; Blank copies nothing; TBD values are empty; "to build" templates cannot be chosen |
| Import | PLAT-06-AC1 to AC10, AC18 | One bad row saves nothing; all-valid saves players, packages, `import` ledger rows and no bookings; other club's id ignored; non-owner refused; raw file not kept; phone match and duplicate flag |
| Export | PLAT-06-AC11 to AC17 | Only that club's rows; BOOQ cannot download; owner link works and expires; audit entry; no delete-club route exists |
| Test mode | PLAT-07-AC1 to AC9 | Flag set on insert and not removable; test receipt series separate; purge removes only test rows and only that club's; real receipt starts at 000001; non-testers see not found; aggregates exclude test |
| Data requests | PDPA-01-AC3 to AC7 | Request stored and audited; copy contains the listed data and no staff notes; deletion anonymises and keeps receipts; refuses with a future booking |
| Static checks | CC-5, FA §4.5 | No hard-coded text; every route declares a permission; no `service_role`; every table classified; every audited table has its trigger |

## 15. Not decided here

D10 (consent for players under 18) is F02's. The LINE cap is F10's. The hosting legal check is deferred by the user. The questions in §12 are assumptions to confirm; the open items in the requirements that §12 does not list (Q-D which aggregate counts, beyond P1's 30-day bookings, which is the only count designed) stay open.
