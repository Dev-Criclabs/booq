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
| 7 | **LINE test OA** (under the staging test provider): Messaging API channel, LINE Login channel, LIFF app, rich menu | Rehearsals and the 7 Dec test with real LINE behaviour | **You** create it. **DevOps** stores the values in staging only (or in Hunter's Testing configuration if the 7 Dec test runs on production, `plan.md` section 2). **Role 5** builds the rich menu code | 20 Nov | Free OA stops at 300 push messages a month. Watch the quota |
| 8 | **Hunter's production LINE OA** in **Hunter's own provider**: paid plan (Basic ฿1,280 a month in the PRD estimate), Messaging API, LINE Login, LIFF, verified account if wanted | Production messages (about 3 to 4 per booking) | **Club** owns the OA and provider, and pays the plan directly (PRD). **Club** adds a named BOOQ person as admin only while setting up. **DevOps** gets the tokens through the safe route in `secrets.md` | Start now. Needed 21 Dec | Club pays |
| 9 | **Beam sandbox merchant** | Test Beam payments and callbacks on staging, and in Hunter's Testing configuration on production (D16) | **You** (or BOOQ) sign up with Beam and ask for sandbox credentials. **DevOps** stores them in staging. **QA** uses them for the end to end test | 20 Nov | Free sandbox (confirm) |
| 10 | **Hunter's Beam production merchant** (club's own) | Money goes straight to the club | **Club** applies as the merchant (company documents, bank account). **You** push for dates, because approval can take time. Fees to confirm with Beam sales | Start now. Needed 21 Dec | Per Beam. Open item in the hand-off |
| 11 | **Error tracking** (Sentry or equal) | Alerts on errors without personal data | **You** create the org. **DevOps** configures scrubbing | 20 Nov | Free tier may do |
| 12 | **Uptime / heartbeat monitor** and **alert channel** | Alerts for jobs, token expiry, Beam callbacks | **You** pick the on call people, number and email. **DevOps** wires | 27 Nov | Free or low cost |
| 13 | **Backup storage** in a different cloud account from Supabase, with a lifecycle rule | Independent nightly dump | **You** create the account and bucket. **DevOps** writes the job and the restore steps | 20 Nov | Small |
| 14 | **Email sender for BOOQ staff sign in** (D3): a transactional email service or SMTP account, with SPF, DKIM and DMARC on the BOOQ domain | Invite and password reset emails for the platform console. The auth provider's built-in email is limited and not for production | **You** pick the service and give DevOps the domain DNS. **DevOps** wires it and sets the records | 27 Nov (needs the domain, row 5) | Small |
| 15 | **A tester list**: LINE accounts of the people who test on 7 Dec on production (the owner and named BOOQ testers, D4) | Test OA friends | **You** collect names. They add the test OA | 1 Dec | |
| 16 | **Thai lawyer** (not a technical account) | Deferred by the user (D5 update). Recorded only: the cross-border transfer to Singapore (`plan.md` R1), the privacy notice and breach duties | **You**, when you choose to | No date. Nothing depends on it | Legal fee |
| 17 | **Authenticator apps / hardware keys for BOOQ staff** (D3) | Second factor for the platform console and for GitHub, hosting and Supabase | **You** decide the factor type (authenticator app is fine to start). Each person sets up their own | Before they first sign in | |

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
3. Test LINE and Beam sandbox values into staging, and into Hunter's Testing configuration on production.
4. Health route, job heartbeats, token check and Beam callback counters.
5. First restore drill.
