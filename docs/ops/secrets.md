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
| **Club secrets key pair** (D34, D149; `packages/secrets`): `SECRETS_PUBLIC_KEY` (public, writes) and `SECRETS_PRIVATE_KEY` (private, decrypts). RSA 3072; each secret gets its own AES-256-GCM data key wrapped with the public key, so a leaked public key reveals nothing | Per environment | **Public key:** `apps/platform` (staff write a club's secrets) and `apps/web` (the owner's writes). **Private key:** `apps/web` and `apps/worker` **only**, never `apps/platform` or `apps/staff-invite`. The private key has **two named holders** and an offline recovery copy in the password manager; in no log, repo or chat |
| Slip checking provider key | Platform level, not Hunter | Hosting provider. Only if a slip club exists (F16) |
| `STAFF_INVITE_SIGNING_SECRET` (32+ characters; the same value in `apps/platform` and `apps/staff-invite`) and `PLATFORM_SIGNING_KEY` (32+ characters, console session cookie, `apps/platform` only) | Per environment | Hosting provider, each in its own deployments only. Details and rotation in `platform.md` |
| `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` | Per environment | `apps/staff-invite` only (the staff sign-in function). In no other app. **One planned exception, operator-only:** the first-admin command (runbook 17) needs the service role key on an operator's machine for one run |
| **Operator-only, never an app environment variable:** `BOOTSTRAP_DATABASE_URL` (role `booq_owner`), plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `PLATFORM_BASE_URL` for the first-admin command (`bootstrap:admin`, D163) | Per environment | Not stored in any hosting project, CI secret or repo. Held in the password manager by the two named owner-access holders, read for one run inside a break-glass window (runbook 16, 17), then always rotated afterwards (D165) |
| `WEB_RATE_LIMIT_KEY` (HMAC key of the web sign-in limiter, 32+ characters, web deployment only) | Per environment | Hosting provider |
| Error tracking DSN, monitoring tokens, `HEALTH_TOKEN` (the shared token for the platform health route; set in `apps/platform` and in the external monitor) | Per environment | Hosting provider and the monitor's secret store |
| Backup bucket credentials and the backup encryption key (age) | Platform | Bucket keys in a GitHub environment secret and the password manager. The age private key is held outside the bucket by **two named people**; the bucket access list has two names |

## Rules

1. **Nothing secret in the repo, ever.** That includes `.env` files, test fixtures, screenshots, docs, locale files and CI logs. `infra/env/.env.example` lists names with empty values. The root `.gitignore` must block `.env*` except `.env.example` (DevOps may not edit the root, so the Orchestrator adds it with the first code; `infra/.gitignore` covers `infra/` now). GitHub secret scanning with push protection is switched on.
2. **LINE is per club, down to the provider (D7).** A LINE user ID is only meaningful inside the provider that issued it, which matches the key `(club_id, line_user_id)`. Never reuse a token, channel or LIFF ID across clubs, and never look up a club's secrets by anything but its club ID. The Beam merchant is per club too.
3. **Two kinds of storage**, because clubs are added while the app is running, so per club values cannot be environment variables:
   - **Platform secrets** (`SECRETS_PRIVATE_KEY`, signing keys, DSNs) live in the hosting provider's environment variables, one set per environment, and in GitHub *environment* secrets for the deploy jobs that need them. Production values are only readable by production deploys.
   - **Per club secrets** (LINE tokens and secrets, Beam keys) live in the database in the `club_secret` table (migration 0012) as **ciphertext**: encrypted in the app with the club secrets key pair (D34; envelope `booq1.<keyId>.<wrapped key>.<iv>.<ciphertext>.<tag>`, the club and kind are authenticated, so a row copied to another club or kind fails to decrypt), so the host's disk encryption is not the only layer. Each row has the club ID, a kind (for Beam: `beam_api_key_test`, `beam_hmac_key_test`, `beam_api_key_live`, `beam_hmac_key_live`; LINE: `line_channel_token`, `line_channel_secret`, `line_login_secret`), the key id, the ciphertext, when it was written and by whom. `read_secret` has no club argument and the platform app holds no decrypt key (Security SR-03).
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
| Club secrets key pair | Only on suspicion or loss of custody, or when a holder leaves (see "Key pair: creation, placement, rotation") | **Rotation by re-entry** at launch scale (about seven values per club), or a re-encryption task if BE-P builds one | Secrets unreadable until re-entered, so plan it, never do it casually |
| GitHub / hosting / Supabase accounts | Hardware key or authenticator app 2FA for everyone, no shared logins | | |
| Club owner leaves, or a club changes LINE or Beam account | Revoke BOOQ's access on the club's side, delete the stored values (audited), and set the new ones | | |

**If a secret leaks:** follow `runbooks.md`, "A secret leaked". Rotate first, investigate second.

## Key pair: creation, placement, rotation (D34, D149)

**Facts from the code** (`packages/secrets/src/envelope.ts`): the writers (`apps/platform`, `apps/web`) hold only `SECRETS_PUBLIC_KEY`. Readers (`apps/web`, `apps/worker`) hold `SECRETS_PRIVATE_KEY`. Each reader process holds **one** private key at a time. The envelope carries a key id (the first 16 hex characters of the SHA-256 of the public key), and the database stores that id next to the row. Both variables are PEM text, as one line with literal `\n` is accepted.

**Create (once per environment; staging and production never share a pair).**
1. A named holder runs, on an operator machine (not a shared one, not CI): `node infra/keys-generate.mjs <private-key-file>`. It writes the private key to a file with mode 600 (never overwrites), prints only the public key as one line and the key id. The private key is never printed.
2. Move the private key file into the password manager (two named holders can read it), then delete the file. Write the key id and the date in the ops record.
3. Place the keys in the hosting environment variables, per app, as in the table above: `SECRETS_PUBLIC_KEY` in `apps/platform` and `apps/web`; `SECRETS_PRIVATE_KEY` in `apps/web` and `apps/worker` only. D149: key creation and placement is a DevOps plus user action, done before the first club secret is written.
4. Check: enter a test value for a test club through the console and read it through the app that is allowed to; confirm `club_secret` holds only a `booq1.` envelope and that the stored key id matches the one noted in step 2.
5. Never: put the private key in the console, the repository, a CI secret, the platform app, or any chat.

**Rotate (open in D149; this is the proposal).** The single-key reader means a new pair cannot be introduced alongside the old one without a change in the code. So:
- **Loss or compromise of the private key:** every stored secret must be treated as exposed. Rotate the club's LINE and Beam credentials at their source first (reissue the LINE token and channel secret, create new Beam keys), then create a new pair, place it, and **enter the new values through the console** (write only). Old rows stay unreadable and are overwritten by the new writes. `SELECT key_id, count(*)` over `club_secret` (owner role, break-glass) shows when no row carries the old id.
- **Planned rotation (a holder leaves, yearly review):** a new pair needs the old rows re-encrypted. At launch scale (about seven values for Hunter) the least risky route is to re-enter them with the new public key. Asked of the Architect: a one-off re-encryption task that holds both private keys for one run would avoid re-entry; build it before a second club exists.
- During any rotation, new writes use the new public key at once and reads use whichever private key the app holds, so do the swap in a quiet hour and re-enter immediately after.
- Record every creation and rotation: date, who, key id before and after.


## Who handles what

- DevOps sets up the storage, the scrubbing, the rotation notes and the alerts.
- Back end platform and LINE (role 5) and commerce (role 4) write the code that reads the secrets.
- Architect decides the table name and the key custody details. The method is decided: an app-level extra layer (D34).
- Security reviews it and writes the tests that prove a browser, a coach and a platform admin cannot read a secret.
- A person at BOOQ pastes club values during club setup. The club owner gives them from their own LINE and Beam accounts.

## Open

- Key custody: the private key sits with two named holders and an offline recovery copy. Moving it into a managed key service is a Security recommendation to do before a second club is onboarded (SR-31).
- LINE token type (long lived or short lived, role 5 decides). The monitor is the same either way.
- Whether Beam allows two callback secrets at once (ask Beam when the sandbox opens).
- If hosting ever moves to self-hosted Postgres in Thailand (`plan.md` R1), Supabase Auth is lost for BOOQ staff sign in, so keep the staff auth code portable. Club secrets already use app-level encryption, so they move unchanged.
