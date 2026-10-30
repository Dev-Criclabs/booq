# Platform console and staff-invite: deploy settings

30 Oct 2026. Read from the code on `main` (`apps/platform/src/server/context.ts`, `apps/staff-invite/src/env.ts`) and, for the items marked **(branch)**, from `be-p/platform-transport`, which was not on `main` when I checked. Every setting has no default in code: a missing or malformed one stops the app before it answers. **No values appear in any document.** Secrets are set in the hosting environment of that one deployment (`secrets.md`).

BOOQ staff sign in with email and a second factor (D3). The password check happens in a **separate small function, `apps/staff-invite`**, which is the only place that holds Supabase keys. `apps/platform` holds none. The console and the function talk through a signed request.

## `apps/platform` (the console, role `booq_platform`)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Role `booq_platform` only. Never `booq_app` or `booq_worker` credentials (FA 4.4) |
| `PLATFORM_SIGNING_KEY` | yes | **Secret.** 32+ characters. Signs the console session cookie. Separate from every club key and from `WEB_RATE_LIMIT_KEY`. Rotating it signs every staff member out, which is acceptable |
| `PLATFORM_MAX_BODY_BYTES` | yes | Whole number above 0. Security proposes 64 KiB for small JSON (`webhook_max_body_bytes`); Security to confirm for the console |
| `APP_BASE_URL` | yes | `https` address of the club app, for owner and tester invite links |
| `HEALTH_TOKEN` | optional | 16+ characters. Absent means the health route is not mounted, so the external monitor has nothing to poll: **required for the 7 Dec test** (`worker.md`) |
| `PLATFORM_SIGNIN_RATE_LIMIT`, `PLATFORM_SIGNIN_RATE_WINDOW_SECONDS` | pair, both or neither | Whole numbers. With neither there is no limit: **required before the 7 Dec test**, same rule as the web pair. Security's `boq_totp_max_failures` (5, then a 15 minute lock) is a separate rule in the app. Values are Security's to approve; the web proposal was 10 per 60 s |
| `STAFF_INVITE_URL` **(branch)** | pair with the next, both or neither | `http` or `https` address of the staff-invite function. Without the pair, console sign-in answers 503 |
| `STAFF_INVITE_SIGNING_SECRET` **(branch)** | pair with the previous | **Secret.** 32+ characters. The same value is set in `apps/staff-invite`. The console signs its requests to the function with it |

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
