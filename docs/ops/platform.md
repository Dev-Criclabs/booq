# Platform console and staff-invite: deploy settings

30 Oct 2026. Read from the code on `main` (`apps/platform/src/server/context.ts`, `apps/staff-invite/src/env.ts`) and, for the items marked **(branch)**, from `be-p/platform-transport`, which was not on `main` when I checked. Every setting has no default in code: a missing or malformed one stops the app before it answers. **No values appear in any document.** Secrets are set in the hosting environment of that one deployment (`secrets.md`).

BOOQ staff sign in with email and a second factor (D3). The password check happens in a **separate small function, `apps/staff-invite`**, which is the only place that holds Supabase keys. `apps/platform` holds none. The console and the function talk through a signed request.

## `apps/platform` (the console, role `booq_platform`)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Role `booq_platform` only. Never `booq_app` or `booq_worker` credentials (FA 4.4) |
| `PLATFORM_SIGNING_KEY` | yes | **Secret.** 32+ characters. Signs the console session cookie. Separate from every club key and from `WEB_RATE_LIMIT_KEY`. Rotating it signs every staff member out, which is acceptable |
| `LINE_API_BASE_URL`, `PROVIDER_PROBE_TIMEOUT_MS` **(branch, platform lane 2)** | **both or neither**; when set, `SECRETS_PUBLIC_KEY` is required | `LINE_API_BASE_URL`: http(s) base of the LINE Messaging API (the console's "Test connection" probe of the value just typed, D167). `PROVIDER_PROBE_TIMEOUT_MS`: whole milliseconds above 0, how long one probe may take. **No value proposed.** Without the pair the console has no probe. Needed for the 7 Dec readiness check of Hunter's LINE and Beam connections |
| `SECRETS_PUBLIC_KEY` | yes, to write a club's LINE and Beam values | Public key PEM of this environment's club secrets pair (`secrets.md`). **Public key only**: this app must never hold `SECRETS_PRIVATE_KEY` |
| `PLATFORM_MAX_BODY_BYTES` | yes | Whole number above 0. Security proposes 64 KiB for small JSON (`webhook_max_body_bytes`); Security to confirm for the console |
| `APP_BASE_URL` | yes | `https` address of the club app, for owner and tester invite links |
| `HEALTH_TOKEN` | optional | 16+ characters. Absent means the health route is not mounted, so the external monitor has nothing to poll: **required for the 7 Dec test** (`worker.md`) |
| `PLATFORM_SIGNIN_RATE_LIMIT`, `PLATFORM_SIGNIN_RATE_WINDOW_SECONDS` | pair, both or neither | Whole numbers. With neither there is no limit: **required before the 7 Dec test**, same rule as the web pair. Security's `boq_totp_max_failures` (5, then a 15 minute lock) is a separate rule in the app. Values are Security's to approve; the web proposal was 10 per 60 s |
| `STAFF_INVITE_URL` **(branch)** | group of three with the next two: all or none | `http` or `https` address of the staff-invite function. Without the group, console sign-in answers 503 |
| `STAFF_INVITE_SIGNING_SECRET` **(branch)** | same group | **Secret.** 32+ characters. The same value is set in `apps/staff-invite`. The console signs its requests to the function with it |
| `PLATFORM_BASE_URL` **(branch)** | required whenever `STAFF_INVITE_URL` is set | `https` address of **the console itself** (not the club app; that is `APP_BASE_URL`). It is the base of the staff enrolment link an admin sends to a new teammate. If it is wrong, every enrolment link points to the wrong place. Set it to the console's real public address once the console is hosted |

### Deploy environment checklist, `apps/platform`

Set in the console's hosting environment (staging, production). Required for the 7 Dec test: `DATABASE_URL` (role `booq_platform`), `PLATFORM_SIGNING_KEY`, `PLATFORM_MAX_BODY_BYTES`, `APP_BASE_URL`, `HEALTH_TOKEN`, `PLATFORM_SIGNIN_RATE_LIMIT` with `PLATFORM_SIGNIN_RATE_WINDOW_SECONDS`, `STAFF_INVITE_URL` with `STAFF_INVITE_SIGNING_SECRET` and `PLATFORM_BASE_URL`, `LINE_API_BASE_URL` with `PROVIDER_PROBE_TIMEOUT_MS` (the probes), and **`SECRETS_PUBLIC_KEY`** (the console writes a club's LINE and Beam values with it, and only with it). **`SECRETS_PRIVATE_KEY` must not be set here.** Also set the `platform.config` rows below before the test.

**Probes (decided as D167).** The console probes **only the value just typed**, before it is encrypted. It holds only the public key, so it cannot read back a stored secret (that would need the private key and break SR-03). "Test all again" runs in **the worker**, which holds the private key, and writes `club_health`. So the worker needs the outbound settings of the probes too (`LINE_API_BASE_URL`, `LINE_PUSH_TIMEOUT_MS` already; Beam's address and timeout to come). The console's own outbound URL and timeout settings will be added here when platform lane 2 sends the names (the orchestrator forwards them).

### Platform config values (database table `platform.config`, set by a BOOQ admin, no defaults)

These are not environment variables. They are rows an admin enters in the console, and the code ships none (no invented settings). Known so far, all to be set **before the 7 Dec test**:

| Key | What happens if it is unset | Value |
|---|---|---|
| `console_enrolment_ttl_hours` **(branch)** | Issuing a staff enrolment link is refused (`enrolment:not_configured`), so **no new BOOQ teammate can be invited or have a second factor reset**. The number is hours the single-use link stays valid; it must be above 0 | **No value proposed.** A BOOQ admin decides. (Security's `invite_ttl_hours` figures are for club invites, a different setting) |
| `line_send_max_attempts`, `line_send_retry_seconds` (F10) | The LINE sender has no retry limit or base backoff for a push that fails on a token problem. Messages stay unsent or retry without bound, depending on the code | **No value proposed.** Token-failure retry limit and base backoff, a BOOQ admin or Security decides. Alerts on token failure are in `plan.md` section 5 |
| `beam_reconcile_age_seconds` (F05, pending main) | **Read by the reconcile task. While it is unset, reconcile is off**, so a payment whose callback never arrives is never looked up | **No value proposed.** Must be set before the 7 Dec test. How old a pending payment must be before the worker asks Beam about it |
| `beam_reconcile_interval_seconds` | **Not read by the code.** The cron `WORKER_BEAM_RECONCILE_CRON` replaced it. Do not set it | n/a |
| `pay_tap_limit_count`, `pay_tap_limit_window_seconds` | No limit on new payment holds (F03 design 4.8, D61) | Security proposes 5 holds per 600 s (`threat-model.md` section 6); approval is Security's and the owner's |

The first BOOQ admin account needs a way in before this works (first-admin bootstrap): that is the Architect's and BE-P's design, not set here. Add any other `platform.config` key to this table when a feature adds one.

## `apps/staff-invite` (the only holder of Supabase keys)

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | The project's API address. Not secret |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Secret.** Used for the admin calls (staff invites). Set only here. Nothing else in the system holds it (Security SR-06) |
| `SUPABASE_ANON_KEY` **(branch)** | yes | The project's public key, sent as the `apikey` header on the sign-in calls (password check and the second-factor challenge and verify). Public by design, and the Data API is switched off, so it grants no data access, but keep it **only in this deployment**. Both keys may be only in `apps/staff-invite` (D148; the SR-06 row of the launch checklist now says so) |
| `STAFF_INVITE_SIGNING_SECRET` | yes | **Secret.** 32+ characters, the same value as in `apps/platform`. A request not signed with it is refused |
| `PLATFORM_DATABASE_URL` | yes | Role `booq_platform`, to record what the function does. A second credential for that role, set only here |
| `STAFF_INVITE_MAX_SKEW_SECONDS` | yes | Whole number above 0: how far the request's timestamp may differ from the clock. **300**: starting value, review in the security pass (accepted under D147; a request guard, not a product setting). Replay window versus clock drift |
| `STAFF_INVITE_MAX_BODY_BYTES` | yes | Whole number above 0. **4096**: starting value, review in the security pass (accepted under D147; a request guard, not a product setting). The body is a few fields |

Proposed values above are my suggestions, not rules. The function's address is internal to the console: host it so that only the console can reach it if the host offers that, otherwise the signed request is the only gate, so `STAFF_INVITE_SIGNING_SECRET` must be strong and rotated if it leaks.

### Rotation

| Secret | When | Steps | Effect |
|---|---|---|---|
| `STAFF_INVITE_SIGNING_SECRET` | On suspicion, when a person with access leaves, every 12 months | Change it in `apps/staff-invite` and `apps/platform` together in a quiet hour, redeploy both | Staff cannot sign in or be invited for the minutes between the two deploys (503 or refusal). Existing console sessions continue |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | On suspicion; rotating Supabase's JWT secret changes both | Rotate in Supabase, update `apps/staff-invite`, redeploy | Staff sign in fails until the new values are in |
| `PLATFORM_SIGNING_KEY` | On suspicion | Change in `apps/platform`, redeploy | Every console session ends |

## Spike item: Supabase sign-in paths against a real project

Add to the staging spike (`FA` section 10 item 4, with the queue schema check in `worker.md`). It can only run once a Supabase project exists, and it is not done:

`apps/staff-invite/src/supabase-identity.ts` **(branch)** assumes the following. Confirm each against a real project, with a test staff account and a TOTP factor enrolled, and write what happened here:
1. `POST /auth/v1/token?grant_type=password` with the `apikey` header answers 200 with an `access_token` and a `user` object that **lists the user's factors** (type `totp`, status `verified`) in that same response. If factors are not in the password-grant response, the code must fetch them another way.
2. `POST /auth/v1/factors/{id}/challenge` with the access token as bearer answers 200 with a challenge `id`; a wrong factor or an unusable token answers one of 400, 401, 403 or 422, which the code treats as "wrong code" rather than an error.
3. `POST /auth/v1/factors/{id}/verify` with `challenge_id` and `code` answers 200 for a right code and an error status for a wrong one, and the status codes for a wrong code, an expired challenge and a rate-limited attempt (429) are told apart as the code expects.
4. The calls work with the **Data API, GraphQL and Realtime switched off** (the auth service is separate from them), and with the project's own email rate limits and the custom email sender in place.
5. Time-based codes: the project accepts a code from the neighbouring 30 second window as the code assumes (clock drift), and the server's clock is correct.
6. Enrolment of the staff member's TOTP factor through the invite path works and the session reaches assurance level 2 after verify.
7. Failed attempts: Supabase's own throttling, plus the console's `PLATFORM_SIGNIN_RATE_*` and the app's lock after 5 failures, together do not lock out a legitimate user after one typo.
