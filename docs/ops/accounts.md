# Accounts and credentials to arrange

For the user (project owner). DevOps cannot create these and will not ask for passwords or keys in chat. Never paste a key into a chat or the repo. Put keys in the places named in `secrets.md`.

Legend: **You** = the user. **Club** = Hunter Tennis Club owner. **DevOps** = this role. **Lead** = the person who will own the account long term.

Use a company email address (not a personal one) and 2FA on every account. Record each account's owner and the recovery method in the password manager.

| # | Account | Why | Who does what | Needed by | Cost to confirm |
|---|---|---|---|---|---|
| 1 | **GitHub** repo settings | CI, branch protection, secret scanning | **You** (admin): protect `main`, require check `CI result`, one review, switch on secret scanning, push protection, Dependabot. Optionally set repository variables `CI_STRICT` and `LOCALE_STRICT` later. DevOps writes the files | 6 Nov | Included in the plan, check private repo features |
| 2 | **Password manager / shared vault** | Holds recovery info, emergency copy of the encryption key | **You** choose one and invite the people who need it | 6 Nov | |
| 3 | **Supabase** organisation, 3 projects: `preview`, `staging`, `production` (Pro plan for staging and production) | Postgres, auth storage, backups | **You** create the organisation and billing. **DevOps** configures after, from the invite. Region: see `plan.md` Decision 3 | Preview and staging 13 Nov, production 21 Dec | Pro per project. PITR add-on if approved |
| 4 | **Hosting** (Vercel recommended): team, 2 projects (staging, production) plus previews | Runs Next.js and cron | **You** create team and billing. **DevOps** wires the repo, env vars and region | 13 Nov | Paid team plan |
| 5 | **Domain and DNS** | LIFF endpoint URL must be HTTPS on a stable address; the PRD leaves open whether each club gets its own address or a shared BOOQ address with the club's name | **You** decide the domain; this is also an **open product question** in the PRD. **DevOps** sets up DNS and certificates. A staging subdomain is enough for 7 Dec | 20 Nov (staging), 21 Dec (production) | Domain fee |
| 6 | **LINE Developers provider** (one provider for BOOQ) | The hand-off says each club's OA, LINE Login channel and LIFF app live under one provider | **You** create the provider (a LINE Business ID owned by the company, not a person). **DevOps** adds the callback and LIFF endpoint URLs | 13 Nov | Free |
| 7 | **LINE test OA** (staging): Messaging API channel, LINE Login channel, LIFF app, rich menu | The 7 Dec test with real LINE behaviour | **You** create the test OA and channels (DevOps can give click by click steps). **DevOps** stores the values in staging only. **Role 5** builds the rich menu code | 20 Nov | Free OA stops at 300 push messages a month. Test OA is enough for a few testers; watch the quota |
| 8 | **Hunter's production LINE OA**: paid plan (Basic ฿1,280 a month in the PRD estimate), Messaging API, LINE Login, LIFF, verified account if wanted | Production messages (about 3 to 4 per booking) | **Club** owns the OA and pays the plan directly (PRD). **You** or **Club** adds BOOQ staff as admins. **DevOps** gets the tokens through the safe route in `secrets.md` | Start now. Needed 21 Dec | Club pays |
| 9 | **Beam sandbox merchant** | Test Beam payments and callbacks on staging | **You** (or BOOQ) sign up with Beam and ask for sandbox credentials. **DevOps** stores them in staging. **QA** uses them for the end to end test | 20 Nov | Free sandbox (confirm) |
| 10 | **Hunter's Beam production merchant** (club's own) | Money goes straight to the club | **Club** applies as the merchant (company documents, bank account). **You** push for dates, because approval can take time. Fees to confirm with Beam sales | Start now. Needed 21 Dec | Per Beam. Open item in the hand-off |
| 11 | **Error tracking** (Sentry or equal) | Alerts on errors without personal data | **You** create the org. **DevOps** configures scrubbing | 20 Nov | Free tier may do |
| 12 | **Uptime / heartbeat monitor** and **alert channel** | Alerts for jobs, token expiry, Beam callbacks | **You** pick the on call people, number and email. **DevOps** wires | 27 Nov | Free or low cost |
| 13 | **Backup storage** in a different cloud account from Supabase, with a lifecycle rule | Independent nightly dump | **You** create the account and bucket. **DevOps** writes the job and the restore steps | 20 Nov | Small |
| 14 | **Email sender** (only if the product needs one) | Not in the specs, so nothing is needed now | None | | |
| 15 | **A staging tester list**: LINE accounts of the people who test on 7 Dec | Test OA friends | **You** collect names. They add the test OA | 1 Dec | |

## Not accounts, but needed

- A named **on call** person and a second backup for 29 Dec onward.
- A person to approve production deploys.
- A legal or PDPA adviser for the club's privacy notice, processor terms, where data is stored (Singapore), and breach duties. Text must be final before 7 Dec.
- A decision on the production domain (open product question).

## Hand-off rule

When an account is ready, the **You** or **Club** person adds DevOps as a member (invite, not a shared password). For secrets, you or the club owner enters the value in the club setup screen or hosting settings yourself. DevOps confirms that it works and never reads the value.

## What DevOps does with each, in order

1. Supabase and hosting projects. Region, backups, access.
2. Env var names from `infra/env/.env.example`.
3. Staging LINE test OA values and Beam sandbox values into staging.
4. Health route, job heartbeats, token check and Beam callback counters.
5. First restore drill.
