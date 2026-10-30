# Accounts and credentials to arrange

For the user (project owner). DevOps cannot create these and will not ask for passwords or keys in chat. Never paste a key into a chat or the repo. Put keys in the places named in `secrets.md`.

Legend: **You** = the user. **Club** = Hunter Tennis Club owner. **DevOps** = this role. **Lead** = the person who will own the account long term.

Use a company email address (not a personal one) and 2FA on every account. Record each account's owner and the recovery method in the password manager.

| # | Account | Why | Who does what | Needed by | Cost to confirm |
|---|---|---|---|---|---|
| 1 | **GitHub** repo settings | CI, branch protection, secret scanning | **You** (admin): protect `main`, require check `CI result`, one review, switch on secret scanning, push protection, Dependabot. Optionally set repository variables `CI_STRICT` and `LOCALE_STRICT` later. DevOps writes the files | 6 Nov | Included in the plan, check private repo features |
| 2 | **Password manager / shared vault** | Holds recovery info, emergency copy of the encryption key | **You** choose one and invite the people who need it | 6 Nov | |
| 3 | **Supabase** organisation, 3 projects in **Singapore**: `preview`, `staging`, `production` (Pro plan for staging and production). **Sign the data-processing agreement** (D5) | Postgres, auth, storage, backups | **You** create the organisation, billing and sign the DPA. **DevOps** configures after, from the invite. Production is needed earlier because the 7 Dec test runs there (D16) | Preview and staging 13 Nov, **production 20 Nov** | Pro per project. PITR add-on if approved |
| 4 | **Hosting** (Vercel recommended): team, 2 projects (staging, production) plus previews | Runs Next.js and cron | **You** create team and billing. **DevOps** wires the repo, env vars and region | 13 Nov | Paid team plan |
| 5 | **Domain and DNS** | One shared BOOQ domain with the club in the URL (D6). LIFF endpoints need HTTPS on a stable address | **You** supply the domain later (D6) and give DevOps DNS access. **DevOps** sets up DNS, certificates and the `APP_DOMAIN` config. Until then staging uses the hosting provider's address | Needed before Hunter's LINE side is set up, ideally 20 Nov | Domain fee |
| 6 | **LINE provider and LINE Business ID, one per club** (D7) | Each club owns its own LINE accounts. BOOQ no longer creates one shared provider | **Club** creates and owns its own provider, OA, LINE Login channel and LIFF app (DevOps gives click by click steps). **You** create one separate provider only for BOOQ's own **staging test** club, so engineering has something to test with. **DevOps** sets the callback and LIFF endpoint URLs | Staging test provider 13 Nov. Hunter's own 21 Dec | Free |
| 7 | **LINE test OA** (under the staging test provider): Messaging API channel, LINE Login channel, LIFF app, rich menu | Development and QA on staging only. The 7 Dec test does **not** use it: test messages go through Hunter's real OA (row 8, D32) | **You** create it. **DevOps** stores the values in staging only. **Role 5** builds the rich menu code | 20 Nov | Free OA stops at 300 push messages a month. Watch the quota |
| 8 | **Hunter's production LINE OA** in **Hunter's own provider**: paid plan (Basic ฿1,280 a month in the PRD estimate), Messaging API, LINE Login, LIFF, verified account if wanted | **Needed for the 7 Dec test**, because Testing messages go through the club's real Official Account and count toward its monthly cap (D32). The free plan stops at 300 messages | **Club** owns the OA and provider, and pays the plan directly (PRD). **Club** adds a named BOOQ person as admin only while setting up; DevOps lists that person and removes them after setup unless the club asks otherwise. **DevOps** gets the tokens through the safe route in `secrets.md` | **27 Nov** (moved from 21 Dec). Start now | Club pays |
| 9 | **Beam sandbox merchant** (Playground) for Hunter | The **test key set**: Hunter's Testing status uses it, on production from the 7 Dec test (D16, D32). Also staging. The live key set is separate and comes at Go live (row 10) | **You** (or BOOQ) sign up with Beam and ask for Playground credentials. **DevOps** stores them as the club's test set. **QA** uses them for the end to end test | 20 Nov | Free sandbox (confirm) |
| 10 | **Hunter's Beam production merchant** (club's own) | Money goes straight to the club | **Club** applies as the merchant (company documents, bank account). **You** push for dates, because approval can take time. Fees to confirm with Beam sales | Start now. Needed for the **live key set** in the Go live window (runbook 13), by 21 Dec | Per Beam. Open item in the hand-off |
| 11 | **Error tracking** (Sentry or equal) | Alerts on errors without personal data | **You** create the org. **DevOps** configures scrubbing | 20 Nov | Free tier may do |
| 12 | **Uptime / heartbeat monitor** and **alert channel** | Alerts for jobs, token expiry, Beam callbacks | **You** pick the on call people, number and email. **DevOps** wires | 27 Nov | Free or low cost |
| 13 | **Backup storage** in a different cloud account from Supabase, with a lifecycle rule | Independent nightly dump | **You** create the account and bucket. **DevOps** writes the job and the restore steps | 20 Nov | Small |
| 14 | **Email sender for BOOQ staff sign in** (D3): a transactional email service or SMTP account, with SPF, DKIM and DMARC on the BOOQ domain | Invite and password reset emails for the platform console. The auth provider's built-in email is limited and not for production | **You** pick the service and give DevOps the domain DNS. **DevOps** wires it and sets the records | 27 Nov (needs the domain, row 5) | Small |
| 15 | **A tester list**: LINE accounts of the people who test on 7 Dec on production (the owner and named BOOQ testers, D4) | Test OA friends | **You** collect names. They add the test OA | 1 Dec | |
| 16 | **Authenticator apps / hardware keys for BOOQ staff** (D3) | Second factor for the platform console and for GitHub, hosting and Supabase | **You** decide the factor type (authenticator app is fine to start). Each person sets up their own | Before they first sign in | |
| 17 | **Hardware keys or passkeys** for the two or three people with production owner rights (GitHub, hosting, database provider) | Account takeover protection (Security OPS-4) | **You** buy them and name the people. Each person enrols their own | Before production is created (20 Nov) | Small |
| 18 | **Key custody**: the master key for club secrets and the backup (age) key each need **two named holders** and an offline recovery copy in the password manager. The database owner access list has at most two names | Security R-12, SR-21 | **You** name the people. **DevOps** sets it up | 20 Nov | |

## Not accounts, but needed

- A named **on call** person and a second backup for 29 Dec onward.
- A person to approve production deploys.
- Consent text must be final before 7 Dec. Consent for players under 18 is still undecided (D10).
- The domain (D6): you supply it later. Everything is built to take it as a config value.

## Hand-off rule

When an account is ready, the **You** or **Club** person adds DevOps as a member (invite, not a shared password). For secrets, you or the club owner enters the value in the club setup screen or hosting settings yourself. DevOps confirms that it works and never reads the value.

## What DevOps does with each, in order

1. Supabase and hosting projects. Singapore, backups, access, second factor on every account.
2. Env var names from `infra/env/.env.example`.
3. Staging: test provider values and Beam Playground values. Production: Hunter's own LINE values and the Beam **test** key set in its Testing configuration. The Beam **live** key set is entered only in the Go live window (runbook 13).
4. Health route, job heartbeats, token check and Beam callback counters.
5. First restore drill.

## F02-T00: LINE test setup (exact list)

Why: F02-T00 checks that the user ID from LINE Login is the same ID the Messaging API uses to push to that person (design Q33, LINE-01-AC5), and that the Add friend option works as decided (D38). If the IDs differ, the F02 design reopens, so do this before F02 is built.

**You do** (a company LINE Business ID, not a personal one; names in the LINE consoles may differ a little from these):
1. In LINE Developers, create **one test provider**. Name it so nobody mistakes it for a club (for example "BOOQ test"). It is the staging test provider from row 6 above.
2. In that provider, create **one LINE Login channel**. Note its **channel ID** and **channel secret**.
3. In the same provider, create **one Messaging API channel** (it comes with an Official Account) and link it to the Login channel. Note its **channel secret** and issue a **channel access token**. Pick the language of the account; make it Thai.
4. In the Login channel, create **one LIFF app**:
   - Endpoint URL: `https://{domain}/c/{slug}` as in the task. The domain is not decided yet (D6), so use the staging address DevOps gives you (a stable HTTPS address from the hosting provider). The URL can be edited later.
   - Scope: the profile and OpenID scopes the F02 design asks for (`openid`, `profile`).
   - **Add friend option: On (normal)** (D38).
   - Note the **LIFF ID**.
5. Choose **one test user**: a real LINE account of someone on the team. They **add the test Official Account as a friend**, and open the LIFF app once from the phone.
6. Give **DevOps** the values through the safe route (`secrets.md`). Never paste channel secrets or tokens into chat or the repo.

**DevOps does:** set the Messaging API webhook URL to a throwaway receiver that records only `source.userId`, no message text (a small script in `infra/`, not written yet because it needs your staging address); sign in through LIFF as the test user and compare the Login `sub` with the webhook `source.userId`; send one push to that ID and confirm it arrives; write the result (IDs match, or not) into `design.md` section 3.3 of F02; delete the throwaway receiver and rotate the test channel token afterwards.

**Done when:** a note in F02 `design.md` section 3.3 says the IDs match. If they do not, stop and tell the Orchestrator.

## Beam Playground (for F05, before its build starts)

Why: the F05 design guesses a few things about Beam that its public documentation does not say (`design.md` section 3.3, G1 to G13). DevOps checks them in Beam's Playground, which "doesn't move real money", and writes the answers back before the F05 build starts. This needs Hunter's Playground keys, not live keys.

**You and the club do:**
1. Hunter (the club) has, or applies for, a Beam merchant account. This is row 10 above. The Playground is separate from production: its keys, host and webhooks are different and isolated.
2. In the Beam dashboard, for the **Playground**, get: the **merchant ID**, the **Playground API key**, and the **HMAC key** for webhooks (Beam shows it under Developers, Webhooks). Ask Beam, if it is not shown. Keep production keys out of this step.
3. Register a **Playground webhook URL** in the dashboard. DevOps gives you the URL once the staging address exists. It carries a long random token in its path (`/api/webhooks/beam/{token}`), so treat it like a secret.
4. Give DevOps the three values through the safe route (a password manager entry shared with DevOps, or a GitHub environment secret in an environment named `beam-playground`). Not in chat, not in the repo.
5. Ask Beam sales for the confirmed fees and whether the Playground can re-send a webhook (open items in the F05 design).

**DevOps does:** run the checks G1 to G13 against the Playground with those keys, one by one, and write what happened under section 3.3 of the F05 design (G1 amount unit, G2 and G3 expiry, G4 referenceId, G5 lookup fields, G6 one HMAC key, G7 webhook delivery and Mark as Succeeded, G8 idempotency key, G9 read-only key test call, G10 image, G11 answer time, G12 UTC timestamps, G13 long webhook path). If any guess is wrong, the "If wrong" column of the design says what changes, and the Orchestrator is told. At the end the Playground keys stay in the Testing configuration of Hunter on production (D16) and the live keys are added only at Go live (runbook 13).
