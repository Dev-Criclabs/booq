# Runbooks

Each alert in `plan.md` section 5 points here. Steps are a first draft and are **tested on staging before 7 Dec**. Replace the "(staging)" notes with real commands and links once the projects exist. Do not paste personal data into tickets or chat.

Common first step: note the time (Asia/Bangkok), the environment, the club ID (not names), and which alert fired.

## 1. Hold expiry job not running (Page)
Effect: slots stay held after the hold time, players are blocked, no "booking released" message.
1. Check job heartbeat and the last `job_runs` row.
2. Check the scheduler (hosting cron or database cron) is enabled and the job route returns 200 with the job token.
3. Re-run the job by hand. It must be safe to run twice (Architect requirement).
4. Confirm held-and-expired count is 0, then confirm one released LINE message went out.
5. Write the cause in the incident note.

## 2. Reminder or other server job failed (Page / Warn)
1. Find the failing job and error in `job_runs` and the error tracker.
2. Fix or retry. Jobs must be idempotent so a retry does not send a second LINE message. If you cannot be sure, stop and ask the booking or platform back end role.
3. If reminders were missed, ask the Orchestrator whether late reminders should be sent. That is a product choice.

## 3. LINE Messaging API token failed or expiring (Page)
1. Find the club ID in the alert.
2. Ask the club owner or the BOOQ person who set the club up to issue a new token in LINE Developers (steps in `secrets.md` rotation).
3. Paste it into the club's LINE settings in the platform console (write only).
4. Press Test message, confirm a 200, then revoke the old token.
5. Re-run the daily token check. Any messages missed during the gap are a product question for the Orchestrator.

## 4. LINE message quota near the cap (Warn / Page)
1. Look at usage in P1 for the club.
2. Tell the club owner their plan is near its limit. Upgrading is the club's cost and decision.
3. What the app does at the cap is an open product question (`docs/canvas-gaps.md`). DevOps does not change it.

## 5. Beam callback failures (Page / Warn)
- **Bad signature:** nothing changes (PAY-02) and every one shows in P1 (D75). The app raises one alert per time window, not one per request, so a flood does no database work beyond a counter. First check whether a key was just rotated or the club's key set was just swapped. If not, treat it as an attack: keep rejecting, rate limit at the edge, tell Security. A validly signed callback on the inactive key set is recorded, flagged and answered 200 with no change (BEAM-7).
- **Wrong amount or unknown order:** nothing is confirmed (PAY-02). Record the order ID, ask Security and the commerce role. Do not "fix" an order by hand.
- **Processing error / missing callback:** use Beam's dashboard (the club's merchant) to look for the payment, then use the reconciliation job to apply it through the normal path. A late payment follows PAY-03 (approve if the slot is open, else wallet). Do not edit rows directly.
- **No callback for a payment:** the 20 minute wait before looking is an ops default, not a product rule. The server may check Beam's charge status and confirm only when amount and reference match (D73); that is the product's path, DevOps does not do it by hand.
- **After a rotation or key swap:** run a Playground payment in Testing, or the smoke test (runbook 13) before Go live. Never a real payment as a test.

## 6. Site down or slow (Page)
1. Check the hosting status page and the Supabase status page.
2. Check the last deploy. If it was within the hour, roll back to the previous deployment in the hosting dashboard.
3. If a migration was involved, do not roll the app back past a migration that is not backward compatible. Ask the Architect.
4. Post a note to the club owner if it lasts longer than 15 minutes (the club can then tell customers).

## 7. Restore the database
Use for: data loss, bad migration, corruption. **Never restore over production without the user's written approval.**
1. Stop writes: set the club status to Paused only if the product allows (PLAT-03 keeps existing bookings), or turn on the maintenance page.
2. Create a **new** Supabase project in the same region (Singapore, D5). If production has moved to self-hosted Postgres in Thailand (`plan.md` R1), restore into a new instance there. Do not overwrite the current one.
3. Restore into it from the Supabase daily backup, or from the nightly dump:
   - Decrypt the dump with the key from the password manager.
   - `pg_restore --no-owner --clean --if-exists --dbname "$NEW_DATABASE_URL" backup.dump` (run from a safe machine, not a laptop with other keys).
4. Smoke checks (write the exact queries as part of the drill, they need the schema):
   - Row counts for core tables are close to expected.
   - For every credit package and wallet, the balance equals the sum of its ledger rows (PKG-01).
   - The no-double-booking uniqueness rule is present and rejects a duplicate court slot and a duplicate coach slot.
   - Row level security is on for every table.
   - Receipt numbers per club are an unbroken sequence (RCPT-01).
   - The per-club audit hash chain verifies (each row holds the hash of the previous row), and the latest hash per club matches what the nightly job wrote to the backup bucket (Security SR-21, when the chain exists).
5. Replay data created after the restore point: use the Beam report and LINE logs to find orders paid after that point, hand the list to the Orchestrator.
6. Switch the app to the new project (env vars), redeploy, check the health probe.
7. Re-apply deletion requests received after the restore point (PDPA). Ask the Security role for the deletion log.
8. Write down: restore point, time taken, issues. That is the drill record.

**Restore drill (staging, before 7 Dec).** Do steps 2 to 4 on staging with the daily backup, time them, and file the record in `docs/ops/drills/` (new file per drill, no personal data).

## 8. A secret leaked
1. Rotate first. See `secrets.md` rotation table for the secret type.
2. If it was committed: remove from the repo is not enough. History still holds it, so the rotation is the fix.
3. Review access logs for the period since exposure (LINE Developers console, Beam dashboard, Supabase logs).
4. If personal data may have been accessed: go to runbook 9.
5. Note it in the audit log and tell Security.

## 9. Suspected personal data breach
1. Contain: rotate keys, disable the affected route or account.
2. Preserve logs and snapshot the database. Do not delete anything.
3. Tell the user at once. The club is the controller and must be told without delay, since the club may have to notify the regulator within 72 hours when there is a risk to people. The club's adviser decides the wording.
4. Security leads the review. DevOps provides facts and timelines.

## 10. Deploy and rollback
- Deploy to staging: merge to `main`. Production: approver confirms after the staging check.
- Rollback the app: previous deployment in the hosting dashboard.
- Rollback a database change: a new forward migration, or a restore (runbook 7).
- Avoid production deploys during busy booking hours. The busy hours are not known yet; set them from real numbers after launch.

## 11. Pausing a club
This is a product feature (PLAT-03, P3c). Ops does not pause clubs. If a club asks for it urgently, route to a platform admin. Onboarding specialists cannot pause (hand-off role table).

## 12. Preview and staging reset
Preview database: reset from seed weekly, or on request. Staging: reset before the 7 Dec test and on request, only after telling the testers. Production is never reset.

## 13. Go live: key swap, purge, status change (D4, D32, D108)
Product feature (F01 sections 4.1 and 9.3, F13, F15). The order below follows the F01 design; where this runbook and the design differ, the design wins and this file is wrong. Do it with the user's go ahead, never as a side job. Production holds Hunter's Testing data from the 7 Dec test (D16), so this is also the end of the test.

**Keys.** Each club holds **two Beam key sets, test and live** (D32), kept apart as `club_secret` kinds (`secrets.md`). A Testing club uses the test set (Beam's Playground). A Live club uses the live set. The active set follows the club status; nobody types it. There is **no separate "test LINE" configuration**: a club has one LINE channel set, and test messages go through the club's real Official Account and count toward its monthly cap (D32).

**Order of steps** (who does it, who confirms). Every step is logged in P6.
1. A platform admin who did **not** create the owner invite confirms the owner's identity by another channel; the check turns `pass`. (Security checklist, SR-01)
2. The owner confirms the live merchant in the app: sees the merchant name and the last four characters of each key. (SR-17)
3. DevOps takes a **named backup** of production and notes its id. Keep it 30 days.
4. A BOOQ person (the one named in the plan) enters the **live** Beam key set (merchant ID, API key, HMAC key) in the console, write only, with the step-up second factor. The live set is entered only in this window, not earlier, and the live webhook URL with its own token is registered in the club's live Beam dashboard.
5. The **key swap smoke test** (P4 item, D108) runs and must pass: a read-only authenticated call to Beam with the live keys, plus a check that a body signed with the stored live HMAC key verifies. It **moves no money**. Every other P4 check must be `pass` too (pay-tap limit set, owner signed in, LINE connection test, at least one priced product).
6. A platform admin, or the assigned onboarding specialist, runs **Go live**. One transaction runs the checks, then the purge of test rows (only `is_test` rows of this club), then sets the status to Live. Any failure rolls the whole thing back and the club stays Testing.
7. DevOps runs the verification queries and files the output: no test rows remain, real settings (courts, prices, staff) untouched, counts per table logged, the next receipt number is **000001** (RCPT-01), test receipts used their own non-legal series.
8. The on-call person starts the 72 hour watch (Security checklist 2.5).

**No real payment is made as a test.** A payment after the purge would be receipt 000001 in the legal series, real money the club must account for, and it can never go back as cash (CANCEL-02). If the owner wants one real proof, it is a normal booking made by the owner at the normal price after opening, and only if the owner decides so (Security question Q-17). Not a DevOps step.

**If something real was removed:** stop and restore from the named backup (runbook 7). Do not edit rows by hand.

**After Go live:** the test key set is no longer used. A callback to a test URL changes nothing (BEAM-7). Tell the user.

## 14. BOOQ staff cannot sign in or lost their second factor (D3)
1. A platform admin resets the factor after checking the person by another channel. A platform admin cannot reset their own.
2. Never disable the second factor requirement to get someone in.
3. If the email sender is down, invites and resets fail. Check the email service status, then the DNS records (SPF, DKIM, DMARC).
4. Every reset goes to the P6 log.

## 15. A new club's LINE provider (D7)
Each club owns its own LINE provider. Setup steps, in order: the club creates the provider and OA, adds a named BOOQ person as admin, a BOOQ person creates the Messaging API, LINE Login and LIFF channels, sets the LIFF endpoint to the club's URL, pastes the values into the console (write only), sends a test message, and removes BOOQ's admin access if the club asks.

## 16. Break-glass access to production data (SR-21)
Engineers are BOOQ staff, so reading club data breaks the promise that BOOQ never sees players, bookings or payments. It is for a real incident only.
1. A ticket with the reason and the scope (which club, which tables).
2. A second person approves. The access lasts at most **4 hours**, then it is removed.
3. The record (who, what, why, when, ticket) is kept **outside the database**, in the ops record, and the **club owner is told** that it happened and why.
4. Only the two named holders of database owner access (hardware keys) can grant it. The `booq_owner` password is not known to any person; migrations run through CI.
5. Provider access logs are kept and a named person reviews them monthly.
6. Afterwards: remove the access, close the ticket, note whether anything was changed (it should not be).

## 17. Create the first BOOQ admin (D163)
Once per environment that has a console (staging, production), **before the 7 Dec readiness check**, because nobody can invite the first admin. Source of truth for the command: `apps/staff-invite/README.md`, "First admin (D163)" (on `be-p/platform-transport` when I wrote this; reaching `main` next). If it and this runbook differ, the README wins.

**What it does:** creates the provider user and the admin's record, writes one P6 entry (`staff.bootstrapped`, no link in it), and prints **one** enrolment link on standard output, once. It is never a web route. It refuses while any active admin exists, so a second run changes nothing. It does not write `console_enrolment_ttl_hours`.

**Credentials it needs, none with a default.** All four are **operator-only secrets, never an app environment variable** (`secrets.md`):
`BOOTSTRAP_DATABASE_URL` (role `booq_owner`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PLATFORM_BASE_URL` (the console's public address, for the link; not secret).

1. **Decide the person.** A named first admin, with the hardware key or authenticator they will enrol, written in the ops record. The user approves the name. Choose the link life (`--ttl-hours`) with the user: long enough to enrol, short enough to be safe.
2. **Open a break-glass window** (runbook 16): a ticket, a second approver, at most 4 hours. This is the one planned use of the database owner credential and the Supabase admin key by a person, so it needs the same record. Run it from one of the two named holders' machines, **not** from the console's or the web app's host, and not from a machine whose shell history or screen is shared.
3. **Set the four settings in the shell only for this run**, without writing them in shell history or a file (for example by typing them at a hidden prompt or from the password manager's command line tool), then:
   ```sh
   pnpm run bootstrap:admin -- --email <email> --name "<name>" --ttl-hours <hours>
   ```
   All three arguments are required. Do not run it in CI: CI logs would keep the link.
4. **Copy the printed link once** and send it to the named person by a **different channel** from the one used to ask for it. Never paste it into chat or a ticket. It works once, expires, and is stored only as a hash.
5. The person opens the link, sets a password and enrols their authenticator. Confirm they can sign in with the second factor.
6. **Prove it refuses:** run the same command again; it must exit **3** and change nothing.
7. **Close the window:** unset the variables, close the shell, and **rotate the `booq_owner` password and the Supabase admin key if the run was on a machine that is not locked down** (when in doubt, rotate; `secrets.md`). Remove the ticket's access. Record the date, who ran it, who was created, that the link was used.
8. The new admin sets `console_enrolment_ttl_hours` in the console (`PUT /config/console_enrolment_ttl_hours`) **before inviting anyone else** (`platform.md`).

**Exit codes:** 0 done; 1 failed before finishing (nothing kept; a provider user made on the way is removed); 2 a missing or bad setting or argument; 3 an active admin already exists; 4 the email is already a teammate; 5 the identity provider failed. Safe to run again after 1, 2 or 5; nothing was kept.

**If the first link expires before the admin enrols:** the record already counts as an active admin, so the command refuses (exit 3). Until BE-P's `--reissue` mode lands, recovery is: with the database owner credential, delete that admin's `platform.staff_enrolment` and `platform.platform_staff` rows and the provider user (in the provider's dashboard), then run the command again, under a new break-glass window. After `--reissue` exists, use it instead and update this runbook.
