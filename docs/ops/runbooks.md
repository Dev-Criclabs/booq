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
- **Bad signature spike:** check whether a key was just rotated. If not, treat as an attack: keep rejecting, rate limit at the edge, tell Security.
- **Wrong amount or unknown order:** nothing is confirmed (PAY-02). Record the order ID, ask Security and the commerce role. Do not "fix" an order by hand.
- **Processing error / missing callback:** use Beam's dashboard (the club's merchant) to look for the payment, then use the reconciliation job to apply it through the normal path. A late payment follows PAY-03 (approve if the slot is open, else wallet). Do not edit rows directly.
- **After a rotation:** run a sandbox or small test payment.

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

## 13. Go live: purge test data (D4)
Product feature (F01, F13, F15). Ops steps around it. Do this with the user's go ahead, never as a side job. Production holds Hunter's Testing data from the 7 Dec test (D16), so this is also the end of the test.
1. Check the P4 go live checks are all passed.
2. Take a **named backup** of production and note its id. Keep it 30 days.
3. Run the purge from the product feature. It removes only rows flagged as test data for this club.
4. Check: counts per table logged, no test flags remain, real settings (courts, prices, staff) untouched, the next receipt number is 000001 (RCPT-01), test receipts used their own non-legal numbers.
5. If something real was removed, stop and use the named backup (runbook 7). Do not edit rows by hand.
6. Swap the club's Beam and LINE keys from test to live values if they differ (`secrets.md`), send one real small payment and one LINE message, then tell the user.

## 14. BOOQ staff cannot sign in or lost their second factor (D3)
1. A platform admin resets the factor after checking the person by another channel. A platform admin cannot reset their own.
2. Never disable the second factor requirement to get someone in.
3. If the email sender is down, invites and resets fail. Check the email service status, then the DNS records (SPF, DKIM, DMARC).
4. Every reset goes to the P6 log.

## 15. A new club's LINE provider (D7)
Each club owns its own LINE provider. Setup steps, in order: the club creates the provider and OA, adds a named BOOQ person as admin, a BOOQ person creates the Messaging API, LINE Login and LIFF channels, sets the LIFF endpoint to the club's URL, pastes the values into the console (write only), sends a test message, and removes BOOQ's admin access if the club asks.
