# line-parity (throwaway)

For F02-T00 (design Q33): check that the LINE Login `sub` equals the Messaging API `source.userId` for one test user in one provider.
It records only user IDs and event types. No message text. Delete the deployment and rotate the test channel token when the check is done.

## Run

Needs three values, given to DevOps through the safe route (`docs/ops/secrets.md`), never in chat or the repo:

| Variable | What |
|---|---|
| `LINE_CHANNEL_SECRET` | the Messaging API channel secret of the test provider |
| `LIFF_ID` | the LIFF app ID (not secret) |
| `PARITY_TOKEN` | a long random path value DevOps makes: `openssl rand -hex 24` |

```
node infra/line-parity/server.mjs        # any HTTPS host, PORT optional
node --test infra/line-parity/handler.test.mjs
```

On Vercel: create a project from this repository with **Root Directory** `infra/line-parity` and the three variables above (`api/index.mjs` and `vercel.json` do the rest). The Vercel path is untested; the handler itself is tested on a local server.

## URLs to enter in LINE (replace `{address}` with the HTTPS address, and `{token}` with `PARITY_TOKEN`)

| Where | Value |
|---|---|
| LIFF app, Endpoint URL | `https://{address}/c/parity/{token}` |
| Messaging API channel, Webhook URL | `https://{address}/hook/{token}` (turn Use webhook on, press Verify) |

## The check

1. The test user adds the Official Account as a friend, then opens the LIFF app (`https://liff.line.me/{liffId}`). The page shows the Login `sub`.
2. The test user sends any message to the account. The receiver logs the webhook `userId` (not the text).
3. `GET https://{address}/result/{token}` shows `match: true` when the IDs are the same.
4. Send one push to that ID and confirm it arrives (use the Messaging API with the test token, from DevOps's machine).
5. Write the result into F02 `design.md` section 3.3.
