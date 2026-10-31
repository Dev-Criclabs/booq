# Web app: settings, client IP and rate limiting

Proposal, 30 Oct 2026, from the Orchestrator's request about the sign-in work in `apps/web`. The settings below have **no defaults in code**. The values are proposals, not rules: where a number comes from Security's threat model (`docs/security/threat-model.md` section 6, decision D61, "Security sets the value"), Security and the owner approve it. Re-tune after the 7 Dec test with real numbers.

## Settings for `apps/web`

| Variable | Proposed value | Source and status |
|---|---|---|
| `DATABASE_URL` | connection for role `booq_app` | Set per deployment (`secrets.md`) |
| `WEB_SESSION_SECONDS` | `43200` (12 hours) | F02 design assumption A-14, "absolute 12 hours", which is still open (F02 Q8). Needs the owner's answer |
| `WEB_MAX_BODY_BYTES` | `65536` (64 KiB) | Security proposes 64 KiB for webhook bodies (`webhook_max_body_bytes`); I reuse it for JSON routes because nothing larger is expected. Imports have their own limits (`import_max_bytes`, 2 MiB proposed) and are not this setting. Security to confirm |
| `WEB_SIGNIN_RATE_LIMIT` | `10` | Security's `rate.auth_session_per_ip_per_min` = 10: "sign-ins are rare" |
| `WEB_SIGNIN_RATE_WINDOW_SECONDS` | `60` | Same row; the pair means 10 attempts per IP per minute |
| `LOCALES_DIR` | **Required for the 7 Dec test** (optional in code). A path to the folder that holds `en.json`, `th.json` and `pending/`. **No value proposed**: it depends on where the build puts the folder (below). Unset, the receipt PDF routes answer 503 (F13). The receipt text comes from these files, not from the templates (CLAUDE.md). |
| `WEB_RATE_LIMIT_KEY` | **no value in any document.** A random secret, 32 or more characters (for example `openssl rand -hex 32`) | **Secret.** The HMAC key the limiter uses so that the stored counter key is a keyed hash of the IP, not the address (see "The counter is per process" below). **Required whenever the sign-in rate limit is set.** Per environment, never shared between staging and production, set only in the web deployment (`secrets.md`). Rotating it only resets the counters, which is harmless, but do it in a quiet hour |

**The rate pair is required before launch.** The code treats it as optional, and with both unset there is no limit. That is acceptable on a developer machine and not acceptable in production. Proposed rule for the launch checklist: **both must be set on the staging and production web deployments before the 7 Dec test** (it is a P4 item, like the pay-tap limit, D61), and CI strict mode should fail a deployment config check that finds only one of the pair. DevOps sets them in the hosting environment once Security approves the numbers.

**Import limits (pair, optional until imports are used).** `IMPORT_MAX_ROWS` and `IMPORT_STAGING_HOURS`: set both or neither; with neither, the import answers 503 `import_not_configured`. Security proposes `5000` rows and `24` hours (threat model section 6: `import_max_rows`, and staging rows removed 24 hours after confirm or cancel). Not in the 4 Dec required set unless Hunter imports players.

**Open item: the owner's club data export. BLOCKED ON THE SUPABASE DECISION.** `POST /exports` (be-p/platform-transport c50e72a) answers **503 `export_not_configured`** until three things are chosen:
- **(a) The storage bucket and provider.** Not picked here. It follows the user's pending Supabase decision. Supabase Storage in the same project is the natural default and the earlier proposal (a private bucket under `club_id/`, a short-lived signed link, the file deleted after the link window, same data-processing agreement); listed, not chosen. Nothing in the environment names the bucket yet, so the setting names will come from the code when it is wired.
- **(b) `EXPORT_LINK_SECONDS`**, how long the download link lives. No default in code. Spec A-14 says 24 hours; Security proposes 10 minutes, created on click after the owner is re-checked (`threat-model.md` section 6: `export_link_minutes`). That difference needs a decision from the owner and Security; I propose neither.
- **(c) The queue credential for the web side to enqueue `club_export`**, plus the worker task registration. D162 (b) says the web app does not hold the queue role: a database function that `booq_app` may call enqueues the job. The Architect designs the function; the worker task registration is BE-P's.

None is needed by the 7 Dec test unless the owner is to download a club export then. Listed in `plan.md` section 9.

### Deploy environment checklist, `apps/web`

Set in the hosting environment of each web deployment (staging, production), all without defaults in code:
`DATABASE_URL`, `WEB_SESSION_SECONDS`, `WEB_MAX_BODY_BYTES`, `WEB_SIGNIN_RATE_LIMIT`, `WEB_SIGNIN_RATE_WINDOW_SECONDS`, `WEB_RATE_LIMIT_KEY`, `LOCALES_DIR` (required for 7 Dec, receipts), `SECRETS_PUBLIC_KEY`, `SECRETS_PRIVATE_KEY` (the web app reads `line_channel_secret` to verify LINE webhooks, D149, and writes the owner's secrets). Never set `NEXT_PUBLIC_LIFF_FAKE=1` on a hosted deploy (it swaps the real LINE sign-in for a fake; see `plan.md` section 11). The last three are one group: set all three or none, and all three before the 7 Dec test. The matching worker settings are in `worker.md`; the limiter's rows are removed by the worker's `rate_limit_sweep` task.

## Which client IP is read

The code reads `x-real-ip`, else the first `x-forwarded-for` entry. On Vercel:

- Vercel's [request headers page](https://vercel.com/docs/headers/request-headers) lists `x-real-ip` and `x-forwarded-for` as the client's public IP, and says `x-forwarded-for` is overwritten rather than forwarded, to prevent spoofing. Vercel's own [honeypot guide](https://vercel.com/kb/guide/how-to-build-a-honeypot-with-vercel-web-application-firewall) says Vercel sets `X-Forwarded-For` from the TCP connection and discards any incoming value, so the **leftmost entry is the real client when Vercel is the outermost edge**.
- **It stops being true if anything sits in front of Vercel** (another CDN, a proxy, a Cloudflare record in proxy mode). Vercel then sees the proxy's address, every player looks like one IP, and the limit would block everyone at once or no one. Rule: **Vercel stays the outermost layer** for the web app, or the code is changed together with the change.
- The docs I found do not say outright whether `x-real-ip` is overwritten the same way as `x-forwarded-for`. **Not confirmed.** The check is easy once a staging deployment exists: send a request that carries forged `x-real-ip` and `x-forwarded-for` values and see what the route receives. I will do it in the staging spike and write the result here. Until then, `x-forwarded-for` (leftmost) is the one the documents support, and the code's preference for `x-real-ip` first should be checked by that test.
- If the app is ever hosted somewhere else (the self-hosted fallback in `plan.md` R1), these headers are spoofable unless the front proxy overwrites them. The reading code should take the trusted header name from configuration then.

## The counter is per process

On Vercel the web app runs as serverless functions: many short-lived instances, each with its own memory. **A per-process counter does not limit anything there**; each instance counts only its own requests and starts again from zero on a cold start. A single instance is only true on one long-lived container, so "one instance is fine for Hunter" is not an option on the recommended host.

Proposal, in two layers:
1. **At the edge, for volume.** Use the host's own firewall rate limit rule on the sign-in and public read routes (Security's `rate.public_read_per_ip_per_min` = 120 and the sign-in numbers above). I have not checked which plan includes rate limiting rules on Vercel. **To confirm** when the paid team plan exists. This stops floods before they reach a function.
2. **In the app, a shared counter in Postgres**, because Postgres is already there and sign-in is rare. A small table keyed by a window start and a **keyed hash of the IP** (an IP address is personal data under the PDPA, so store a hash, not the address), incremented with one upsert per attempt, **before** the call to LINE's verify endpoint (Security: "reject bad tokens before the LINE verify call"). Rows older than the window are removed by the housekeeping task. Cost: one cheap write per sign-in attempt; a flood still costs a write per request, which is why layer 1 matters. This is BE-P's change (a migration and a small module), and Security reviews it.
3. Not proposed: Redis or a similar store. It is another account and another processor that would hold IP-derived data, for a load Hunter does not have. Reconsider if the app moves to many clubs.

The same shared counter can serve the pay-tap limit (`pay_tap_limit_count`), which F03 already puts in the database.

## Error handling

A rejected attempt answers one fixed error code and writes no player record, and no limit event goes to the logs with the IP in clear text (log scrubbing, Security LINE-2). Alerts count rejections per window, not per request (one alert per window, as for bad webhook signatures).
