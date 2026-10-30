# Secrets approach

Proposal, 30 Oct 2026. The Architect and Security roles must agree before the first club secret is stored.

## What counts as a secret

| Secret | Scope | Who holds it |
|---|---|---|
| LINE Messaging API channel secret and channel access token | **Per club**, one set. Each club has **its own LINE provider** (D7) and owns it. There is **no separate test LINE set**: test messages go through the club's real Official Account (D32) | The club's LINE OA. Entered during club setup |
| LINE Login channel ID and channel secret | Per club, same provider | Same |
| LIFF ID | Per club | Not secret (it is in the client URL), but it is per club config, kept with the club record |
| LINE provider ID (informational) | Per club | Not secret. Kept with the club record so support can tell which provider a key belongs to |
| BOOQ staff second-factor secrets and recovery codes | Per person | Supabase Auth stores the factors. Recovery codes go in the password manager. Never in the repo or the platform console (D3) |
| Email sender (SMTP or API) credentials for auth emails | Per environment | Hosting provider |
| **Beam, two key sets per club (D32):** a **test** set (Playground) and a **live** set, each with merchant ID, API key, HMAC webhook signing key, and, during a rotation, a `previous` HMAC key; plus a long random webhook path token per club **and per set** | **Per club** (each club is its own Beam merchant) | Club's Beam merchant. Entered in the console, write only. The live set is entered only in the Go live window (runbook 13) |
| Database connection strings for the roles `booq_app` (web), `booq_worker` (worker) and `booq_platform` (platform console, its own deployment); `booq_owner` for migrations in CI only | Per environment | Hosting provider (web, worker, platform each get only their own role). `booq_owner` is a CI secret that no person knows. The Data API is off, so no anon or service role key is used by any app (Security SR-06) |
| Supabase service role key | Per environment | Not set in any app environment. Only a staff invite function holds it, if the Architect keeps one |
| Master key for club secrets (D34: an extra layer of encryption in the app, on top of the host's disk encryption) | Per environment | Hosting provider or a managed key service. **Two named holders** and an offline recovery copy in the password manager. In no log, repo or chat |
| Slip checking provider key | Platform level, not Hunter | Hosting provider. Only if a slip club exists (F16) |
| `WEB_RATE_LIMIT_KEY` (HMAC key of the web sign-in limiter, 32+ characters, web deployment only) | Per environment | Hosting provider |
| Error tracking DSN, monitoring tokens, `HEALTH_TOKEN` (the shared token for the platform health route; set in `apps/platform` and in the external monitor) | Per environment | Hosting provider and the monitor's secret store |
| Backup bucket credentials and the backup encryption key (age) | Platform | Bucket keys in a GitHub environment secret and the password manager. The age private key is held outside the bucket by **two named people**; the bucket access list has two names |

## Rules

1. **Nothing secret in the repo, ever.** That includes `.env` files, test fixtures, screenshots, docs, locale files and CI logs. `infra/env/.env.example` lists names with empty values. The root `.gitignore` must block `.env*` except `.env.example` (DevOps may not edit the root, so the Orchestrator adds it with the first code; `infra/.gitignore` covers `infra/` now). GitHub secret scanning with push protection is switched on.
2. **LINE is per club, down to the provider (D7).** A LINE user ID is only meaningful inside the provider that issued it, which matches the key `(club_id, line_user_id)`. Never reuse a token, channel or LIFF ID across clubs, and never look up a club's secrets by anything but its club ID. The Beam merchant is per club too.
3. **Two kinds of storage**, because clubs are added while the app is running, so per club values cannot be environment variables:
   - **Platform secrets** (service role key, encryption key, DSNs) live in the hosting provider's environment variables, one set per environment, and in GitHub *environment* secrets for the deploy jobs that need them. Production values are only readable by production deploys.
   - **Per club secrets** (LINE tokens and secrets, Beam keys) live in the database in a `club_secret` table (Architect names it) as **ciphertext**: encrypted in the app with the master key (D34), so the host's disk encryption is not the only layer. Each row has the club ID, a kind (for Beam: `beam_test_api`, `beam_test_hmac`, `beam_live_api`, `beam_live_hmac`, `previous` variants), a key version, the ciphertext, created and rotated times and who did it. `read_secret` has no club argument and the platform app holds no decrypt key (Security SR-03).
4. **Write only.** The platform console (P2 step 4 and 5, P3) lets a platform admin paste a value in and replace it. It never shows it again, only "set" and the last 4 characters. This respects PLAT-02: support view shows connection status, not secrets. The club owner never needs to see them either.
5. **Read only on the server, in the code path that uses them**: the LINE send function, the Beam client, the callback verifier. Row level security denies direct reads of `club_secrets` to every role, including the service role used by browsers (none) and the platform console.
6. **Never logged.** Log scrubbing drops `authorization` headers, tokens, `secret`, `key` fields. Beam callbacks are logged by order ID and verdict, not body.
7. **Tests use fakes.** No real LINE or Beam value is used in CI or in a developer's machine. Staging uses test OA and sandbox values, held in staging only.
8. **Separate by environment.** A staging value is never reused in production. A club's staging OA is a different OA from its production OA.
9. Every set, rotate or delete writes an audit entry (PLAT-04, and P6 for platform actions) with actor, club and kind, never the value.

## Webhooks and callbacks

- Beam callback: verify the signature with the club's callback signing secret, check amount and order ID against the order, and make the handler idempotent. Bad signature or wrong amount changes nothing (PAY-02). The exact scheme comes from Beam's documentation and the sandbox, not from this document.
- LINE webhook (follow/unfollow, if used): verify the `x-line-signature` header with the club's channel secret before reading the body.
- Each club gets its own callback URL path or a club identifier the server resolves first, so the right secret is used. The URL itself is not a secret. The URL is built from the shared domain (`APP_DOMAIN`, D6), which is not known yet.

## BOOQ staff sign in (D3)

BOOQ staff sign in to the platform console with email plus a second factor (TOTP), never with LINE. Invite only. The second factor is enforced on the server for every platform route. Rotation: when a person leaves, remove the account the same day and rotate any shared value they could read (there should be none). Lost factor: a platform admin resets it after checking the person by another channel, and the reset goes to the P6 log. Platform staff can see no club secret values even after signing in (rule 4 above).

## Rotation

| Secret | Rotate | Steps | Impact |
|---|---|---|---|
| LINE channel access token | Per type: a short lived token on its own schedule (code renews it before expiry, with the monitor alerting at 7 days), a long lived token only if compromised or when staff leave | Issue new token in LINE Developers, paste in console (write only), send a test message, revoke old | Messages fail between revoke and paste, so paste first, revoke second |
| LINE channel secret | If compromised, or when a person who knew it leaves | Reissue in LINE Developers, update the console. Webhook verification fails until the new value is in | Short gap. Do it off peak |
| Beam API key (test set or live set) | Every 6 months and on any suspicion. Each set is rotated on its own | Create the new key in Beam, enter it in the console (write only), run the key check (the read-only smoke test, runbook 13). For the test set a Playground payment is fine. **For the live set never a real payment as a test.** Delete the old key in Beam | Payments fail if swapped wrongly. Do it when no hold is open |
| Beam HMAC webhook signing key (test set or live set) | On suspicion and every 6 months | Whether Beam accepts two secrets at once is open (checked in the Playground). If it does, store the new key and keep the old as `previous` until callbacks verify with the new one. If not, rotate in a quiet hour and reconcile after (the nightly reconciliation catches missed callbacks) | Callbacks in the gap are retried or reconciled |
| Supabase service role key / JWT secret | On suspicion, when a person with access leaves | Rotate in Supabase, update hosting env vars, redeploy. Rotating the JWT secret signs everyone out | Brief outage. Plan it |
| Platform encryption key | Yearly, or on suspicion | Add a new key version, re-encrypt the rows in a job, retire the old version | No outage |
| GitHub / hosting / Supabase accounts | Hardware key or authenticator app 2FA for everyone, no shared logins | | |
| Club owner leaves, or a club changes LINE or Beam account | Revoke BOOQ's access on the club's side, delete the stored values (audited), and set the new ones | | |

**If a secret leaks:** follow `runbooks.md`, "A secret leaked". Rotate first, investigate second.

## Who handles what

- DevOps sets up the storage, the scrubbing, the rotation notes and the alerts.
- Back end platform and LINE (role 5) and commerce (role 4) write the code that reads the secrets.
- Architect decides the table name and the key custody details. The method is decided: an app-level extra layer (D34).
- Security reviews it and writes the tests that prove a browser, a coach and a platform admin cannot read a secret.
- A person at BOOQ pastes club values during club setup. The club owner gives them from their own LINE and Beam accounts.

## Open

- Key custody: the master key sits with two named holders and an offline recovery copy. Moving it into a managed key service is a Security recommendation to do before a second club is onboarded (SR-31).
- LINE token type (long lived or short lived, role 5 decides). The monitor is the same either way.
- Whether Beam allows two callback secrets at once (ask Beam when the sandbox opens).
- If hosting ever moves to self-hosted Postgres in Thailand (`plan.md` R1), Supabase Auth is lost for BOOQ staff sign in, so keep the staff auth code portable. Club secrets already use app-level encryption, so they move unchanged.
