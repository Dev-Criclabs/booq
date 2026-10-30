# Secrets approach

Proposal, 30 Oct 2026. The Architect and Security roles must agree before the first club secret is stored.

## What counts as a secret

| Secret | Scope | Who holds it |
|---|---|---|
| LINE Messaging API channel secret and channel access token | **Per club** (one OA per club) | Club's LINE OA. Entered during club setup |
| LINE Login channel ID and channel secret | Per club | Same |
| LIFF ID | Per club | Not secret (it is in the client URL), but it is per club config, kept with the club record |
| Beam merchant ID, API key / secret key, callback signing secret | **Per club** (each club is its own Beam merchant) | Club's Beam merchant. Entered during club setup |
| Supabase URL and anon key | Per environment | Public by design, still not committed |
| Supabase service role key, database URL | Per environment | Hosting provider only |
| Encryption key for club secrets (below) | Per environment | Hosting provider or a KMS; backup copy in the password manager |
| Slip checking provider key | Platform level, not Hunter | Hosting provider. Only if a slip club exists (F16) |
| Error tracking DSN, monitoring tokens | Per environment | Hosting provider |
| Backup bucket credentials | Platform | GitHub environment secret and password manager |

## Rules

1. **Nothing secret in the repo, ever.** That includes `.env` files, test fixtures, screenshots, docs, locale files and CI logs. `infra/env/.env.example` lists names with empty values. The root `.gitignore` must block `.env*` except `.env.example` (DevOps may not edit the root, so the Orchestrator adds it with the first code; `infra/.gitignore` covers `infra/` now). GitHub secret scanning with push protection is switched on.
2. **Two kinds of storage**, because clubs are added while the app is running, so per club values cannot be environment variables:
   - **Platform secrets** (service role key, encryption key, DSNs) live in the hosting provider's environment variables, one set per environment, and in GitHub *environment* secrets for the deploy jobs that need them. Production values are only readable by production deploys.
   - **Per club secrets** (LINE tokens and secrets, Beam keys) live in the database in a `club_secrets` table (proposed name; Architect decides) as **encrypted values**: envelope encryption in the app with the platform encryption key, or Supabase Vault. Each row has the club ID, a kind, a key version, the ciphertext, created and rotated times and who did it.
3. **Write only.** The platform console (P2 step 4 and 5, P3) lets a platform admin paste a value in and replace it. It never shows it again, only "set" and the last 4 characters. This respects PLAT-02: support view shows connection status, not secrets. The club owner never needs to see them either.
4. **Read only on the server, in the code path that uses them**: the LINE send function, the Beam client, the callback verifier. Row level security denies direct reads of `club_secrets` to every role, including the service role used by browsers (none) and the platform console.
5. **Never logged.** Log scrubbing drops `authorization` headers, tokens, `secret`, `key` fields. Beam callbacks are logged by order ID and verdict, not body.
6. **Tests use fakes.** No real LINE or Beam value is used in CI or in a developer's machine. Staging uses test OA and sandbox values, held in staging only.
7. **Separate by environment.** A staging value is never reused in production. A club's staging OA is a different OA from its production OA.
8. Every set, rotate or delete writes an audit entry (PLAT-04, and P6 for platform actions) with actor, club and kind, never the value.

## Webhooks and callbacks

- Beam callback: verify the signature with the club's callback signing secret, check amount and order ID against the order, and make the handler idempotent. Bad signature or wrong amount changes nothing (PAY-02). The exact scheme comes from Beam's documentation and the sandbox, not from this document.
- LINE webhook (follow/unfollow, if used): verify the `x-line-signature` header with the club's channel secret before reading the body.
- Each club gets its own callback URL path or a club identifier the server resolves first, so the right secret is used. The URL itself is not a secret.

## Rotation

| Secret | Rotate | Steps | Impact |
|---|---|---|---|
| LINE channel access token | Per type: a short lived token on its own schedule (code renews it before expiry, with the monitor alerting at 7 days), a long lived token only if compromised or when staff leave | Issue new token in LINE Developers, paste in console (write only), send a test message, revoke old | Messages fail between revoke and paste, so paste first, revoke second |
| LINE channel secret | If compromised, or when a person who knew it leaves | Reissue in LINE Developers, update the console. Webhook verification fails until the new value is in | Short gap. Do it off peak |
| Beam API key | Every 6 months and on any suspicion | Create the new key in Beam, update, run a sandbox or test payment, delete the old | Payments fail if swapped wrongly. Do it when no hold is open |
| Beam callback signing secret | On suspicion and every 6 months | Beam may sign with the new secret only. Check Beam's docs for overlap support. If none, rotate in a quiet hour and reconcile after (nightly reconciliation catches missed callbacks) | Callbacks in the gap are retried or reconciled |
| Supabase service role key / JWT secret | On suspicion, when a person with access leaves | Rotate in Supabase, update hosting env vars, redeploy. Rotating the JWT secret signs everyone out | Brief outage. Plan it |
| Platform encryption key | Yearly, or on suspicion | Add a new key version, re-encrypt the rows in a job, retire the old version | No outage |
| GitHub / hosting / Supabase accounts | Hardware key or authenticator app 2FA for everyone, no shared logins | | |

**If a secret leaks:** follow `runbooks.md`, "A secret leaked". Rotate first, investigate second.

## Who handles what

- DevOps sets up the storage, the scrubbing, the rotation notes and the alerts.
- Back end platform and LINE (role 5) and commerce (role 4) write the code that reads the secrets.
- Architect decides the table and the encryption method.
- Security reviews it and writes the tests that prove a browser, a coach and a platform admin cannot read a secret.
- A person at BOOQ pastes club values during club setup. The club owner gives them from their own LINE and Beam accounts.

## Open

- Encryption method: app level envelope encryption or Supabase Vault (Architect).
- LINE token type (long lived or short lived, role 5 decides). The monitor is the same either way.
- Whether Beam allows two callback secrets at once (ask Beam when the sandbox opens).
